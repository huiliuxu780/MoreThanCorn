import json
import time
from datetime import timedelta

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import CallRecord, NodeRun, Run, RunEvent
from ..runner import RunError, create_run

router = APIRouter(prefix="/api/runs", tags=["runs"])


@router.post("", status_code=202)
def start_run(payload: dict, db: Session = Depends(get_db)):
    try:
        run = create_run(db, payload["workflowId"], payload.get("trigger", "test"),
                         payload.get("input", {}), payload.get("idempotencyKey"),
                         version_id=payload.get("versionId"))  # SDD A-01：可指定运行不可变版本
    except RunError as e:
        raise HTTPException(409, str(e))
    return {"runId": run.id, "status": run.status}


@router.get("")
def list_runs(workflowId: str = "", db: Session = Depends(get_db)):
    q = db.query(Run).order_by(Run.created_at.desc())
    if workflowId:
        q = q.filter(Run.workflow_id == workflowId)
    runs = q.limit(50).all()
    return [{
        "runId": r.id, "status": r.status, "trigger": r.trigger,
        "startedAt": r.started_at.isoformat() if r.started_at else None,
        "durationMs": r.duration_ms, "error": r.error,
    } for r in runs]


@router.get("/{run_id}")
def get_run(run_id: str, db: Session = Depends(get_db)):
    run = db.get(Run, run_id)
    if not run:
        raise HTTPException(404, "run not found")
    nrs = db.query(NodeRun).filter_by(run_id=run_id).order_by(NodeRun.started_at).all()
    return {
        "runId": run.id, "status": run.status, "trigger": run.trigger,
        "input": run.input, "output": run.output, "error": run.error,
        "startedAt": run.started_at.isoformat() if run.started_at else None,
        "endedAt": run.ended_at.isoformat() if run.ended_at else None,
        "durationMs": run.duration_ms,
        "nodeRuns": [{
            "nodeRunId": n.id, "nodeId": n.node_id, "nodeType": n.node_type,
            "status": n.status, "input": n.input, "output": n.output, "error": n.error,
            "durationMs": n.duration_ms,
        } for n in nrs],
    }


@router.post("/{run_id}/cancel")
def cancel_run(run_id: str, db: Session = Depends(get_db)):
    run = db.get(Run, run_id)
    if not run:
        raise HTTPException(404, "run not found")
    if run.status in ("queued", "running"):
        run.status = "cancelled"
        db.commit()
    return {"runId": run.id, "status": run.status}


@router.get("/{run_id}/events")
async def run_events(run_id: str, request: Request,
                     last_event_id: int = Header(0, alias="Last-Event-ID")):
    async def gen():
        cursor = last_event_id
        idle = 0
        while idle < 60:
            if await request.is_disconnected():
                return
            db = next(get_db())
            evs = db.query(RunEvent).filter(RunEvent.run_id == run_id,
                                            RunEvent.sequence > cursor) \
                .order_by(RunEvent.sequence).limit(100).all()
            for ev in evs:
                cursor = ev.sequence
                idle = 0
                data = json.dumps({"type": ev.type, "nodeId": ev.node_id,
                                   "nodeRunId": ev.node_run_id, "payload": ev.payload},
                                  ensure_ascii=False)
                yield f"id: {ev.sequence}\nevent: {ev.type}\ndata: {data}\n\n"
            terminal = any(e.type in ("workflow_completed", "workflow_failed") for e in evs)
            db.close()
            if terminal:
                return
            import asyncio
            await asyncio.sleep(0.5)
            idle += 1
    return StreamingResponse(gen(), media_type="text/event-stream")


@router.get("/{run_id}/events-list")
def events_list(run_id: str, nodeRunId: str = "", db: Session = Depends(get_db)):
    q = db.query(RunEvent).filter_by(run_id=run_id)
    if nodeRunId:
        q = q.filter_by(node_run_id=nodeRunId)
    evs = q.order_by(RunEvent.sequence).all()
    return {"items": [{"sequence": e.sequence, "type": e.type, "nodeId": e.node_id,
                       "nodeRunId": e.node_run_id, "channel": e.channel,
                       "at": e.created_at.isoformat(), "payload": e.payload} for e in evs]}


def _tok_total(d: dict | None) -> int:
    d = d or {}
    return int(d.get("total") or (d.get("prompt", 0) or 0) + (d.get("completion", 0) or 0) or 0)


# 调研 07 §3 Trace 模型对齐：span type 词表 / usage / attributes / error{code,message,retryable}
_SPAN_TYPE = {"model": "LLM", "tool": "TOOL", "mcp": "TOOL", "knowledge": "KNOWLEDGE"}


def _usage(d: dict | None) -> dict:
    d = d or {}
    return {"inputTokens": int(d.get("prompt", 0) or 0), "outputTokens": int(d.get("completion", 0) or 0)}


def _err(e: dict | None) -> dict | None:
    if not e:
        return None
    return {"code": e.get("code") or "RUN_ERROR", "message": e.get("message") or str(e),
            "retryable": bool(e.get("retryable", False))}


@router.get("/{run_id}/trace")
def run_trace(run_id: str, db: Session = Depends(get_db)):
    """观测视图（SDD design-run-observability）：Run→NodeRun→CallRecord 组装 span 树。"""
    run = db.get(Run, run_id)
    if not run:
        raise HTTPException(404, "run not found")
    nrs = db.query(NodeRun).filter_by(run_id=run_id).order_by(NodeRun.started_at).all()
    nr_ids = [n.id for n in nrs]
    calls = db.query(CallRecord).filter(CallRecord.node_run_id.in_(nr_ids or ["-"])) \
        .order_by(CallRecord.created_at).all() if nr_ids else []
    by_nr: dict[str, list[CallRecord]] = {}
    for c in calls:
        by_nr.setdefault(c.node_run_id or "", []).append(c)

    def iso(dt):
        return dt.isoformat() if dt else None

    def call_span(c: CallRecord) -> dict:
        ended = c.created_at
        started = ended - timedelta(milliseconds=c.latency_ms or 0)
        return {"id": c.id, "kind": c.kind, "type": _SPAN_TYPE.get(c.kind, "TOOL"),
                "name": c.target_id or c.kind, "status": c.status,
                "startedAt": iso(started), "endedAt": iso(ended), "durationMs": c.latency_ms,
                "usage": _usage(c.token_usage), "tokenUsage": c.token_usage or {},
                "attributes": {"protocol": c.kind, "targetType": c.target_type},
                "input": c.request, "output": c.response,
                "error": _err(c.error), "children": []}

    children = []
    for n in nrs:
        children.append({
            "id": n.id, "kind": "node", "type": "WORKFLOW", "name": n.node_id, "nodeType": n.node_type,
            "status": n.status, "startedAt": iso(n.started_at), "endedAt": iso(n.ended_at),
            "durationMs": n.duration_ms, "attempt": n.attempt,
            "usage": _usage(n.token_usage), "tokenUsage": n.token_usage or {},
            "attributes": {"nodeId": n.node_id, "nodeType": n.node_type, "attempt": n.attempt},
            "input": n.input, "output": n.output,
            "error": _err(n.error), "children": [call_span(c) for c in by_nr.get(n.id, [])],
        })
    total_tokens = _tok_total(run.token_usage) or sum(_tok_total(c.token_usage) for c in calls)
    return {
        "root": {"id": run.id, "kind": "run", "type": "AGENT" if run.agent_id else "WORKFLOW",
                 "name": f"Run {run.id[:8]}", "status": run.status,
                 "startedAt": iso(run.started_at), "endedAt": iso(run.ended_at),
                 "durationMs": run.duration_ms, "usage": _usage(run.token_usage),
                 "tokenUsage": run.token_usage or {},
                 "attributes": {"trigger": run.trigger, "agentId": run.agent_id,
                                "originRunId": run.origin_run_id},
                 "input": run.input, "output": run.output, "error": _err(run.error), "children": children},
        "totalTokens": total_tokens,
        "modelCalls": sum(1 for c in calls if c.kind == "model"),
    }
