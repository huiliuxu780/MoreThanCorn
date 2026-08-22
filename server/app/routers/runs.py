import json
import time

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import NodeRun, Run, RunEvent
from ..runner import RunError, create_run

router = APIRouter(prefix="/api/runs", tags=["runs"])


@router.post("", status_code=202)
def start_run(payload: dict, db: Session = Depends(get_db)):
    try:
        run = create_run(db, payload["workflowId"], payload.get("trigger", "test"),
                         payload.get("input", {}), payload.get("idempotencyKey"))
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
def events_list(run_id: str, db: Session = Depends(get_db)):
    evs = db.query(RunEvent).filter_by(run_id=run_id).order_by(RunEvent.sequence).all()
    return {"items": [{"sequence": e.sequence, "type": e.type, "nodeId": e.node_id,
                       "at": e.created_at.isoformat(), "payload": e.payload} for e in evs]}
