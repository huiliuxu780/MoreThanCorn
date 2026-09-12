"""AgentFlow control plane + task board projection + internal tool callbacks."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import agentscope_client as rt
from ..agentflow_executor import (
    rerun_node,
    resolve_agentflow_release,
    scan_script_wakers,
    script_projection,
    start_run,
    validate_script_definition,
)
from ..auth import require_role, require_operator
from ..board_projection import (
    ENDED,
    SOURCE_LABELS,
    map_agentflow_lane,
    map_session_lane,
    map_workflow_lane,
)
from ..db import get_db
from ..models import (
    Agent,
    AgentFlowDefinition,
    AgentFlowNodeRun,
    AgentFlowRelease,
    AgentFlowRun,
    AgentFlowVersion,
    AgentSessionIndex,
    Run,
)
from ..runner import create_run as create_workflow_run

flows_router = APIRouter(prefix="/api/v2/agentflows", tags=["agentflow"])
board_router = APIRouter(prefix="/api/board", tags=["board"])
internal_router = APIRouter(prefix="/api/internal/agent-tools", tags=["internal"])

INTERNAL_TOKEN = os.environ.get("MTC_INTERNAL_TOKEN", "")


class FlowBody(BaseModel):
    name: str
    description: str = ""


class FlowPatchBody(BaseModel):
    name: str | None = None
    description: str | None = None


class FlowVersionBody(BaseModel):
    definition: dict[str, Any]


class FlowReleaseBody(BaseModel):
    version_id: str
    environment: str = "prod"


class FlowRunBody(BaseModel):
    release_id: str | None = None
    definition_id: str | None = None
    input: dict[str, Any] = {}


def _digest(definition: dict) -> str:
    return hashlib.sha256(
        json.dumps(definition, sort_keys=True).encode()
    ).hexdigest()


@flows_router.get("")
def list_flows(db: Session = Depends(get_db), user: dict = Depends(require_role())):
    rows = db.query(AgentFlowDefinition).order_by(AgentFlowDefinition.created_at.desc()).all()
    out = []
    for d in rows:
        versions = db.query(AgentFlowVersion).filter_by(definition_id=d.id).count()
        latest_ver = (
            db.query(AgentFlowVersion)
            .filter_by(definition_id=d.id)
            .order_by(AgentFlowVersion.version_no.desc())
            .first()
        )
        node_count = len(((latest_ver.definition or {}).get("nodes") or [])) if latest_ver else 0
        release = (
            db.query(AgentFlowRelease)
            .join(AgentFlowVersion, AgentFlowVersion.id == AgentFlowRelease.version_id)
            .filter(AgentFlowVersion.definition_id == d.id, AgentFlowRelease.status == "active")
            .order_by(AgentFlowRelease.created_at.desc())
            .first()
        )
        active_version_no = None
        if release is not None:
            rv = db.get(AgentFlowVersion, release.version_id)
            active_version_no = rv.version_no if rv else None
        out.append(
            {
                "id": d.id,
                "name": d.name,
                "description": d.description,
                "version_count": versions,
                "node_count": node_count,
                "active_release_id": release.id if release else None,
                "active_version_no": active_version_no,
            }
        )
    return {"items": out}


@flows_router.post("")
def create_flow(body: FlowBody, db: Session = Depends(get_db), user: dict = Depends(require_operator)):
    d = AgentFlowDefinition(name=body.name, description=body.description, created_by=user.get("username", "dev"))
    db.add(d)
    db.commit()
    db.refresh(d)
    return {"id": d.id}


@flows_router.patch("/{fid}")
def patch_flow(
    fid: str,
    body: FlowPatchBody,
    db: Session = Depends(get_db),
    user: dict = Depends(require_role()),
):
    """09-11 治理轮：详情页标题就地重命名（对齐原站 WakerFlow 详情铅笔入口）。"""
    row = db.get(AgentFlowDefinition, fid)
    if row is None:
        raise HTTPException(404, "agentflow not found")
    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(422, "name 不能为空")
        row.name = name[:64]
    if body.description is not None:
        row.description = body.description
    db.commit()
    return {"id": row.id, "name": row.name, "description": row.description}


@flows_router.post("/{fid}/versions")
def create_version(fid: str, body: FlowVersionBody, db: Session = Depends(get_db), user: dict = Depends(require_operator)):
    d = db.get(AgentFlowDefinition, fid)
    if d is None:
        raise HTTPException(404, "flow not found")
    if (body.definition or {}).get("kind") == "script":
        # 16号稿 P1：脚本形态版本——契约校验（可解析/run 入口/waker 可解析/64KB）
        try:
            validate_script_definition(db, body.definition)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        # P3：投影与调用点随版本固化（画布数据源，服务端单一计算）
        try:
            from ..agentflow_executor import script_projection

            projection, call_sites = script_projection(body.definition["script"])
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        meta = body.definition.setdefault("meta", {})
        meta["callSites"] = call_sites
        meta["projection"] = projection
    else:
        nodes = body.definition.get("nodes") or []
        if not nodes:
            raise HTTPException(422, "flow needs at least one node")
        for n in nodes:
            if n.get("kind") == "agent" and db.get(Agent, n.get("agent_id", "")) is None:
                raise HTTPException(422, f"node {n.get('id')}: agent not found")
    last = (
        db.query(AgentFlowVersion)
        .filter_by(definition_id=fid)
        .order_by(AgentFlowVersion.version_no.desc())
        .first()
    )
    v = AgentFlowVersion(
        definition_id=fid,
        version_no=(last.version_no + 1) if last else 1,
        definition=body.definition,
        content_digest=_digest(body.definition),
        created_by=user.get("username", "dev"),
    )
    db.add(v)
    db.commit()
    db.refresh(v)
    return {"id": v.id, "version_no": v.version_no, "digest": v.content_digest}


@flows_router.delete("/{fid}")
def delete_flow(fid: str, db: Session = Depends(get_db), user: dict = Depends(require_operator)):
    """删除 AgentFlow 定义（版本/发布级联；运行历史只读保留）。"""
    d = db.get(AgentFlowDefinition, fid)
    if d is None:
        raise HTTPException(404, "agentflow not found")
    ver_ids = [v.id for v in db.query(AgentFlowVersion).filter_by(definition_id=fid).all()]
    if ver_ids:
        db.query(AgentFlowRelease).filter(AgentFlowRelease.version_id.in_(ver_ids)).delete(
            synchronize_session=False)
        db.query(AgentFlowVersion).filter_by(definition_id=fid).delete(synchronize_session=False)
    db.delete(d)
    db.commit()
    return {"ok": True}


@flows_router.get("/{fid}/versions")
def list_versions(fid: str, db: Session = Depends(get_db), user: dict = Depends(require_role())):
    rows = db.query(AgentFlowVersion).filter_by(definition_id=fid).order_by(AgentFlowVersion.version_no.desc()).all()
    return {"items": [
        {"id": v.id, "version_no": v.version_no, "digest": v.content_digest,
         "created_at": v.created_at.isoformat(), "definition": v.definition}
        for v in rows
    ]}


@flows_router.post("/{fid}/releases")
def release_flow(fid: str, body: FlowReleaseBody, db: Session = Depends(get_db), user: dict = Depends(require_operator)):
    v = db.get(AgentFlowVersion, body.version_id)
    if v is None or v.definition_id != fid:
        raise HTTPException(404, "version not found")
    stale = (
        db.query(AgentFlowRelease)
        .join(AgentFlowVersion, AgentFlowVersion.id == AgentFlowRelease.version_id)
        .filter(AgentFlowVersion.definition_id == fid, AgentFlowRelease.status == "active")
        .all()
    )
    for s in stale:
        s.status = "stopped"
    r = AgentFlowRelease(version_id=v.id, definition_id=fid,
                         environment=body.environment, status="active")
    db.add(r)
    db.commit()
    db.refresh(r)
    return {"id": r.id}


@flows_router.get("/{fid}/runs")
def list_flow_runs(fid: str, db: Session = Depends(get_db), user: dict = Depends(require_role())):
    rows = (
        db.query(AgentFlowRun)
        .join(AgentFlowRelease, AgentFlowRelease.id == AgentFlowRun.release_id)
        .join(AgentFlowVersion, AgentFlowVersion.id == AgentFlowRelease.version_id)
        .filter(AgentFlowVersion.definition_id == fid)
        .order_by(AgentFlowRun.started_at.desc())
        .limit(100)
        .all()
    )
    out = []
    for r in rows:
        nodes = (
            db.query(AgentFlowNodeRun)
            .filter_by(run_id=r.id)
            .order_by(AgentFlowNodeRun.started_at)
            .all()
        )
        out.append(
            {
                "id": r.id,
                "status": r.status,
                "trigger_kind": r.trigger_kind,
                "input": r.input,
                "output": r.output,
                "error": r.error,
                "started_at": r.started_at.isoformat(),
                "ended_at": r.ended_at.isoformat() if r.ended_at else None,
                "nodes": [
                    {
                        "id": n.id,
                        "node_id": n.node_id,
                        "attempt": n.attempt,
                        "agent_id": n.agent_id,
                        "session_id": n.session_id,
                        "status": n.status,
                        "input_version": n.input_version,
                        "input": n.input,
                        "output": n.output,
                        "error": n.error,
                    }
                    for n in nodes
                ],
            }
        )
    return {"items": out}


@flows_router.post("/runs")
def run_flow(body: FlowRunBody, db: Session = Depends(get_db), user: dict = Depends(require_operator)):
    # P0-05: definition_id resolves via definition → version → active release
    # (the old code wrongly queried AgentFlowRelease.version_id == definition_id)
    try:
        release = resolve_agentflow_release(
            db, release_id=body.release_id, definition_id=body.definition_id
        )
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    try:
        # F0：start_run 只落 queued 行并入队即返回，不阻塞 HTTP（AC-004）
        run = start_run(db, user.get("username", "dev"), release, body.input, trigger_kind="manual")
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"run_id": run.id, "status": run.status, "output": run.output, "error": run.error}


@flows_router.get("/runs/{rid}/events")
async def flow_run_events(rid: str, db: Session = Depends(get_db), user: dict = Depends(require_role())):
    """F0 ⑦：Flow SSE 代理——只读平台 NodeRun/Run 增量事实（§8.2），
    不透传运行时、不新造第二套状态。终态后发送 flow:done 并收流。"""
    import asyncio

    from fastapi.responses import StreamingResponse

    async def event_generator():
        last_sig: str | None = None
        while True:
            db.expire_all()
            run = db.get(AgentFlowRun, rid)
            if run is None:
                yield f"data: {json.dumps({'event': 'flow:not_found'})}\n\n"
                return
            nodes = (
                db.query(AgentFlowNodeRun)
                .filter_by(run_id=rid)
                .order_by(AgentFlowNodeRun.started_at, AgentFlowNodeRun.attempt)
                .all()
            )
            snapshot = {
                "run": {
                    "id": run.id,
                    "status": run.status,
                    "output": run.output,
                    "error": run.error,
                    "started_at": run.started_at.isoformat() if run.started_at else None,
                    "ended_at": run.ended_at.isoformat() if run.ended_at else None,
                },
                "nodes": [
                    {
                        "id": n.id,
                        "node_id": n.node_id,
                        "attempt": n.attempt,
                        "session_id": n.session_id,
                        "status": n.status,
                        "output": n.output,
                        "error": n.error,
                        "started_at": n.started_at.isoformat() if n.started_at else None,
                        "ended_at": n.ended_at.isoformat() if n.ended_at else None,
                    }
                    for n in nodes
                ],
            }
            sig = json.dumps(snapshot, sort_keys=True, default=str)
            if sig != last_sig:
                last_sig = sig
                yield (
                    "data: "
                    + json.dumps(
                        {"event": "flow:snapshot", "data": snapshot},
                        ensure_ascii=False,
                        default=str,
                    )
                    + "\n\n"
                )
            if run.ended_at is not None:
                yield f"data: {json.dumps({'event': 'flow:done'})}\n\n"
                return
            await asyncio.sleep(1.0)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@flows_router.get("/runs/{rid}")
def get_run(rid: str, db: Session = Depends(get_db), user: dict = Depends(require_role())):
    run = db.get(AgentFlowRun, rid)
    if run is None:
        raise HTTPException(404, "run not found")
    nodes = db.query(AgentFlowNodeRun).filter_by(run_id=rid).order_by(AgentFlowNodeRun.started_at).all()
    return {
        "id": run.id,
        "status": run.status,
        "input": run.input,
        "output": run.output,
        "error": run.error,
        "trigger_kind": run.trigger_kind,
        "started_at": run.started_at.isoformat(),
        "ended_at": run.ended_at.isoformat() if run.ended_at else None,
        "nodes": [
            {
                "id": n.id,
                "node_id": n.node_id,
                "attempt": n.attempt,
                "agent_id": n.agent_id,
                "session_id": n.session_id,
                "status": n.status,
                "input_version": n.input_version,
                "input": n.input,
                "error": n.error,
            }
            for n in nodes
        ],
    }


@flows_router.post("/runs/{rid}/nodes/{node_id}/rerun")
def rerun(rid: str, node_id: str, db: Session = Depends(get_db), user: dict = Depends(require_operator)):
    node = rerun_node(db, user.get("username", "dev"), rid, node_id)
    return {"node_run_id": node.id, "attempt": node.attempt, "status": node.status}


class RunInputBody(BaseModel):
    value: Any = None
    skipped: bool = False


@flows_router.post("/runs/{rid}/inputs/{node_run_id}")
def answer_run_input(
    rid: str,
    node_run_id: str,
    body: RunInputBody,
    db: Session = Depends(get_db),
    user: dict = Depends(require_operator),
):
    """P2/AC-S3：答复脚本 askUser 挂起节点（waiting）——写回运行时 Future，
    节点终态由执行流的 stage:end 事件结算。"""
    run = db.get(AgentFlowRun, rid)
    if run is None:
        raise HTTPException(404, "run not found")
    if run.status in ("succeeded", "failed", "cancelled"):
        raise HTTPException(409, "run already terminal")
    node = db.get(AgentFlowNodeRun, node_run_id)
    if node is None or node.run_id != rid:
        raise HTTPException(404, "node run not found")
    if node.status != "waiting":
        raise HTTPException(409, "node is not waiting for input")
    request_id = (node.input or {}).get("request_id")
    if not request_id:
        raise HTTPException(409, "node has no pending input request")
    rt.script_resume(
        agentflow_run_id=rid, request_id=request_id,
        value=body.value, skipped=body.skipped,
    )
    return {"ok": True, "node_run_id": node.id}


class GenerateScriptBody(BaseModel):
    brief: str
    waker_ids: list[str] = []
    waker_names: dict[str, str] = {}
    current_script: str | None = None


def _strip_code_fences(text: str) -> str:
    t = (text or "").strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[1] if "\n" in t else t
        if t.rstrip().endswith("```"):
            t = t.rstrip()[:-3]
    return t.strip() + "\n"


@flows_router.post("/generate-script")
def generate_script(body: GenerateScriptBody, db: Session = Depends(get_db), user: dict = Depends(require_operator)):
    """P4/AC-S6：NL → 脚本（真实 LLM，走平台 _call_model 通道）；产物过契约校验，
    未过带错重试一次，仍未过 422 交人工编辑。"""
    if not body.brief.strip():
        raise HTTPException(422, "brief 不能为空")
    if not body.waker_ids:
        raise HTTPException(422, "至少提供一个可用 waker（Agent id）")
    waker_list = "\n".join(
        f'- waker="{wid}"（{body.waker_names.get(wid, wid)}）' for wid in body.waker_ids
    )
    current = (
        f"\n\n当前脚本（在其基础上按需求调整，未提及的部分保持稳定）：\n{body.current_script}"
        if body.current_script
        else ""
    )
    base_prompt = (
        "你是 WakerFlow 脚本生成器。把用户需求写成一个可直接运行的 Python 脚本。\n\n"
        "硬性契约（违反即作废）：\n"
        "1. 顶层定义 META = {\"inputSchema\": {...}, \"outputSchema\": {...}, \"phases\": [...]}，"
        "均为 JSON Schema，属性带中文 description，phases 是阶段标题列表；\n"
        "2. 必须定义 async def run(ctx)，函数体第一行 "
        "`phase, log, worker, askUser, parallel = ctx.primitives`；\n"
        "3. 每个工作项写成 `await worker(<中文提示词>, waker=<waker id>, "
        "label=<唯一标识>, phase=<阶段标题>)`，需要结构化输出时加 schema=<JSON Schema>；\n"
        "4. 人工确认/输入用 `await askUser(<中文问题>, options=[...], label=<唯一标识>, "
        "default=<缺省选项>)`，返回 {\"value\", \"skipped\"}；\n"
        "5. 并行用 `await parallel([lambda: worker(...), ...])`，失败子项为 None，"
        "脚本需自行 filter 后使用；\n"
        "6. 循环/条件直接用 for/if 等原生语法；run 返回一个 dict（对照 META.outputSchema）；\n"
        "7. 只允许使用下方给定的 waker id，且每个 worker 调用必须带 waker= 常量参数。\n\n"
        f"可用的 waker：\n{waker_list}{current}\n\n用户需求：\n{body.brief}\n\n"
        "只输出 Python 源码本体，不要 markdown 围栏，不要任何解释。"
    )
    from ..runner import _call_model

    last_error = ""
    for attempt in range(2):
        prompt = base_prompt
        if attempt > 0:
            prompt += (
                f"\n\n上一次生成未通过校验，错误：{last_error}\n"
                "请修正该问题后重新输出完整脚本（仍只输出源码本体）。"
            )
        try:
            raw, _t = _call_model(db, "qwen-plus", prompt)
        except Exception as exc:  # noqa: BLE001 —— LLM 通道失败直接 422，不静默
            raise HTTPException(502, f"模型调用失败：{exc}") from exc
        code = _strip_code_fences(raw)
        try:
            scan_script_wakers(code)
            script_projection(code)
            ids = scan_script_wakers(code)
            unknown = [w for w in ids if w not in body.waker_ids]
            if unknown:
                raise ValueError(f"使用了未授权的 waker: {unknown}")
            if not ids:
                raise ValueError("没有任何 worker(waker=...) 调用")
            return {"script": code, "attempts": attempt + 1}
        except ValueError as exc:
            last_error = str(exc)
    raise HTTPException(422, f"生成脚本未通过契约校验：{last_error}")


# ---------------------------------------------------------------------------
# board projection
# ---------------------------------------------------------------------------


def _period_start(period: str) -> datetime:
    days = int(period.replace("d", "") or 30)
    return datetime.now(timezone.utc) - timedelta(days=days)


@board_router.get("/summary")
def board_summary(period: str = "30d", db: Session = Depends(get_db), user: dict = Depends(require_role())):
    rows = _project(db, user.get("username", "dev"), period)
    lanes = {}
    for r in rows:
        lanes[r["lane"]] = lanes.get(r["lane"], 0) + 1
    return {
        "period": period,
        "total": len(rows),
        "running": lanes.get("running", 0) + lanes.get("waiting", 0),
        "needs_action": lanes.get("waiting", 0),
        "ended": sum(v for k, v in lanes.items() if k in ENDED),
        "lanes": lanes,
    }


@board_router.get("/tasks")
def board_tasks(
    period: str = "30d",
    offset: int = 0,
    limit: int = 20,
    keyword: str = "",
    lane: str = "",
    source: str = "",
    executor: str = "",
    db: Session = Depends(get_db),
    user: dict = Depends(require_role()),
):
    """任务投影（executor 过滤 = QoderWake per-Waker 任务看板同构）。"""
    rows = _project(db, user.get("username", "dev"), period)
    if keyword:
        rows = [r for r in rows if keyword.lower() in (r["title"] or "").lower()]
    if lane:
        wanted = set(lane.split(","))
        rows = [r for r in rows if r["lane"] in wanted]
    if source:
        wanted = set(source.split(","))
        rows = [r for r in rows if r["source"] in wanted]
    if executor:
        rows = [r for r in rows
                if executor == (r.get("executor_id") or "") or executor in (r.get("executor") or "")]
    rows.sort(key=lambda r: r["updated_at"] or "", reverse=True)
    return {"items": rows[offset : offset + limit], "total": len(rows)}


@board_router.get("/filter-options")
def filter_options(db: Session = Depends(get_db), user: dict = Depends(require_role())):
    """触发方式枚举（QoderWake 7 值同构）：只暴露面向用户的 6 类，内部 kind 折叠后去重。

    过滤值用「内部 kind 集合」（逗号分隔）表达一个触发类型，保持既有 source 过滤语义。
    """
    display = ["手动触发", "定时触发", "事件触发", "API 触发", "@Waker 触发", "对话触发"]
    buckets: dict[str, list[str]] = {d: [] for d in display}
    for k, label in SOURCE_LABELS.items():
        if label in buckets:
            buckets[label].append(k)
    return {
        "sources": [{"value": ",".join(buckets[d]) or d, "label": d} for d in display],
        "lanes": ["pending", "running", "done", "waiting", "failed,cancelled"],
        "periods": ["7d", "30d", "90d"],
    }


def _project(db: Session, uid: str, period: str) -> list[dict]:
    start = _period_start(period)
    rows: list[dict] = []

    indexes = (
        db.query(AgentSessionIndex)
        .filter(AgentSessionIndex.created_at >= start)
        .order_by(AgentSessionIndex.created_at.desc())
        .limit(300)
        .all()
    )
    # P1-1：优先使用索引创建期固化的 runtime_agent_id，避免重发布后漂移
    triples = [
        {
            "user_id": i.user_id,
            "agent_id": i.runtime_agent_id or _runtime_agent(db, uid, i.agent_id),
            "session_id": i.session_id,
        }
        for i in indexes
    ]
    triples = [t for t in triples if t["agent_id"]]
    statuses: dict[str, dict] = {}
    if triples:
        try:
            for s in rt.sessions_status(uid, triples):
                statuses[s["session_id"]] = s
        except rt.RuntimeError_:
            statuses = {}
    for i in indexes:
        st = statuses.get(i.session_id, {})
        lane = map_session_lane(
            st.get("status"), st.get("finished_reason"), 1 if st.get("found") else 0
        )
        agent = db.get(Agent, i.agent_id)
        rows.append(
            {
                "id": f"session:{i.session_id}",
                "kind": "agent-session",
                "title": f"{agent.name if agent else i.agent_id} · {i.trigger_kind}",
                "executor": agent.name if agent else i.agent_id,
                "executor_id": i.agent_id,
                "source": i.trigger_kind,
                "source_label": SOURCE_LABELS.get(i.trigger_kind, i.trigger_kind),
                "lane": lane,
                "ended": lane in ENDED,
                "status_label": lane,
                "updated_at": i.created_at.isoformat(),
                "session_id": i.session_id,
                "detail_route": f"/agents/{i.agent_id}/chat?session={i.session_id}",
            }
        )

    runs = db.query(Run).filter(Run.created_at >= start).order_by(Run.created_at.desc()).limit(200).all()
    for r in runs:
        lane = map_workflow_lane(r.status)
        rows.append(
            {
                "id": f"workflow:{r.id}",
                "kind": "workflow-run",
                "title": f"Workflow {r.workflow_version_id or ''} #{r.id[:8]}",
                "executor": "Workflow",
                "executor_id": "",
                "source": r.trigger,
                "source_label": SOURCE_LABELS.get(r.trigger, r.trigger),
                "lane": lane,
                "ended": lane in ENDED,
                "status_label": r.status,
                "updated_at": (
                    getattr(r, "updated_at", None) or r.created_at
                ).isoformat(),
                "detail_route": f"/operations/runs/{r.id}",
            }
        )

    flows = db.query(AgentFlowRun).filter(AgentFlowRun.started_at >= start).order_by(AgentFlowRun.started_at.desc()).limit(200).all()
    for f in flows:
        lane = map_agentflow_lane(f.status)
        rows.append(
            {
                "id": f"agentflow:{f.id}",
                "kind": "agentflow-run",
                "title": f"AgentFlow #{f.id[:8]}",
                "executor": "AgentFlow",
                "executor_id": "",
                "source": f.trigger_kind,
                "source_label": SOURCE_LABELS.get(f.trigger_kind, f.trigger_kind),
                "lane": lane,
                "ended": lane in ENDED,
                "status_label": f.status,
                "updated_at": (f.ended_at or f.started_at).isoformat(),
                "session_id": None,
                "detail_route": f"/agentflows/runs/{f.id}",
            }
        )
    return rows


def _runtime_agent(db: Session, uid: str, agent_id: str) -> str | None:
    from ..models import Release

    release = (
        db.query(Release)
        .filter_by(agent_id=agent_id, environment="prod", status="active")
        .order_by(Release.created_at.desc())
        .first()
    )
    if release is None:
        return None
    return (release.runtime_binding_snapshot or {}).get("agentscope_agent_id")


# ---------------------------------------------------------------------------
# internal callbacks for runtime platform tools
# ---------------------------------------------------------------------------


class RunWorkflowBody(BaseModel):
    workflow_id: str
    input: dict[str, Any] = {}
    session_id: str = ""


class RunFlowBody(BaseModel):
    agent_flow_id: str
    input: dict[str, Any] = {}
    session_id: str = ""


class RunPlatformToolBody(BaseModel):
    tool_version_id: str
    args: dict[str, Any] = {}
    session_id: str = ""


def _check_internal(token: str) -> None:
    # P0-5: 未配置 INTERNAL_TOKEN 时必须拒绝（禁止空 token 放行外部请求）
    if not INTERNAL_TOKEN:
        raise HTTPException(501, "MTC_INTERNAL_TOKEN not configured — internal calls blocked")
    if token != INTERNAL_TOKEN:
        raise HTTPException(401, "invalid internal token")


class _UnindexedFlowSession:
    """运行时自建 flow 节点 Session（无平台索引行）的占位主体（F0 修复）。

    release_id 为空 → 工具/资源白名单为空集 → run-platform-tool/run-workflow
    等一律 403；flow 节点的平台工具清单本就为空（工具装配走各节点 Agent 的
    Release），此占位只保证鉴权链走通到白名单判定，不放大权限。"""

    release_id = None
    user_id = ""
    agent_id = ""
    session_id = ""


def _ensure_execution_active(db: Session, idx) -> None:
    """F0/AC-003：所属执行链已终态的 Session，回调令牌失效。

    只在能从平台事实正向判定终态时拒绝；手工/对话 Session（无 automation/
    flow/workflow 关联）不设终态，令牌长期有效。schedule 复用 Session 由
    「存在 active 触发日志」判断，两次 fire 之间本不应有工具回调。"""
    if idx.agentflow_run_id:
        fr = db.get(AgentFlowRun, idx.agentflow_run_id)
        if fr is not None and fr.status != "running":
            raise HTTPException(401, "session execution terminal")
        return
    if idx.workflow_run_id:
        run = db.get(Run, idx.workflow_run_id)
        if run is not None and run.status in ("succeeded", "failed", "cancelled"):
            raise HTTPException(401, "session execution terminal")
        return
    if idx.automation_id or idx.trigger_log_id:
        from ..models import AutomationTriggerLog

        active = (
            db.query(AutomationTriggerLog)
            .filter(
                AutomationTriggerLog.session_id == idx.session_id,
                AutomationTriggerLog.status.in_(("received", "accepted", "running")),
            )
            .first()
        )
        if active is None:
            raise HTTPException(401, "session execution terminal")


def _authorized_session(db: Session, session_id: str, session_token: str):
    """P0-08: 共享传输 Token 之上叠加会话级绑定（F0 修订）。

    校验链：X-MTC-Session-Token 的 sha256 必须等于索引行 session_token_hash
    （或其 flow-run 的 run_token_hash，仅运行中）。A 用户的令牌打不开 B 用户的
    Session；终态执行链的令牌失效（AC-003）。运行时自建的 flow 节点 Session
    在索引行产生前按运行中 flow-run 令牌放行——旧实现此处提前 401，节点执行
    期间的回调全部失败。返回索引行（或无索引占位主体）。"""
    import hashlib

    from ..models import AgentFlowRun, AgentSessionIndex

    if not session_id:
        raise HTTPException(401, "session binding required")
    if not session_token:
        raise HTTPException(401, "session token required")
    digest = hashlib.sha256(session_token.encode()).hexdigest()
    idx = db.query(AgentSessionIndex).filter_by(session_id=session_id).first()
    if idx is None:
        _check_flow_run_token(db, session_token)
        return _UnindexedFlowSession()
    if idx.session_token_hash and hmac.compare_digest(digest, idx.session_token_hash):
        _ensure_execution_active(db, idx)
        return idx
    # flow 节点 Session：按其 agentflow_run 的 run 令牌校验（仅运行中有效）
    if idx.agentflow_run_id:
        flow_run = db.get(AgentFlowRun, idx.agentflow_run_id)
        if (
            flow_run
            and flow_run.status == "running"
            and flow_run.run_token_hash
            and hmac.compare_digest(digest, flow_run.run_token_hash)
        ):
            return idx
    # 兜底：在运行中 flow run 里查令牌，且仅认「该 run 的节点 Session」——
    # 修复：NodeRun 反链字段是 run_id，旧代码引用不存在的 agentflow_run_id 列，
    # 此分支一旦触发即 500。
    running = (
        db.query(AgentFlowRun)
        .filter(AgentFlowRun.status == "running",
                AgentFlowRun.run_token_hash.isnot(None))
        .all()
    )
    for fr in running:
        if not hmac.compare_digest(digest, fr.run_token_hash or ""):
            continue
        from ..models import AgentFlowNodeRun
        owns = (
            db.query(AgentFlowNodeRun)
            .filter_by(session_id=session_id, run_id=fr.id)
            .first()
        )
        if owns is not None:
            return idx
    raise HTTPException(401, "invalid session token")


def _session_token_matches(db: Session, idx, session_token: str) -> bool:
    """索引行令牌（或其 flow-run 令牌）匹配判定。"""
    import hashlib

    from ..models import AgentFlowRun

    if not session_token:
        return False
    digest = hashlib.sha256(session_token.encode()).hexdigest()
    if idx.session_token_hash and hmac.compare_digest(digest, idx.session_token_hash):
        return True
    if idx.agentflow_run_id:
        fr = db.get(AgentFlowRun, idx.agentflow_run_id)
        if fr and fr.run_token_hash and hmac.compare_digest(digest, fr.run_token_hash):
            return True
    return False


def _check_flow_run_token(db: Session, session_token: str) -> None:
    """无平台索引行的运行时侧 Session（flow 节点）：按 running flow-run 令牌校验。"""
    import hashlib

    from ..models import AgentFlowRun

    if not session_token:
        raise HTTPException(401, "session token required")
    digest = hashlib.sha256(session_token.encode()).hexdigest()
    running = (
        db.query(AgentFlowRun)
        .filter(AgentFlowRun.status == "running",
                AgentFlowRun.run_token_hash.isnot(None))
        .all()
    )
    if not any(hmac.compare_digest(digest, fr.run_token_hash or "") for fr in running):
        raise HTTPException(401, "invalid session token")


def _release_tool_version_ids(db: Session, idx) -> set[str]:
    """该 Session 所属 Release 冻结的全部 ToolVersion id（白名单）。"""
    from ..models import Release as _Release

    if not idx.release_id:
        return set()
    rel = db.get(_Release, idx.release_id)
    if rel is None:
        return set()
    frozen = (rel.runtime_binding_snapshot or {}).get("_frozen_tools") or {}
    return {ft.get("tool_version_id") for ft in frozen.values() if ft.get("tool_version_id")}


def _release_resource_ids(db: Session, idx, key: str) -> set[str]:
    """该 Session 所属 Release 清单中某类资源 id 集合（workflow_ids/agentflow_ids）。"""
    from ..models import Release as _Release

    if not idx.release_id:
        return set()
    rel = db.get(_Release, idx.release_id)
    if rel is None:
        return set()
    resources = (rel.runtime_binding_snapshot or {}).get("resources") or {}
    return set(resources.get(key) or [])


@internal_router.get("/session-manifest")
def session_manifest(
    session_id: str,
    x_mtc_internal: str = Header(default=""),
    x_mtc_session_token: str = Header(default=""),
    db: Session = Depends(get_db),
):
    """运行时 extra_agent_tools 拉取 Session 的平台 Tool 清单（P0-2 工具链）。

    P0-08：共享 Token（传输门）+ 会话令牌（绑定门）双重校验；清单只来自该
    Session 所属 Release 的冻结快照。flow 节点 Session 无索引行时按 flow-run
    令牌放行并返回空清单（节点工具装配走各自 Agent 的 Release）。"""
    _check_internal(x_mtc_internal)
    from ..models import AgentSessionIndex, Tool, ToolVersion

    idx = db.query(AgentSessionIndex).filter_by(session_id=session_id).first()
    if idx is None:
        # 运行时创建的 flow 节点 Session：校验 flow-run 令牌后返回空清单
        _check_flow_run_token(db, x_mtc_session_token)
        return {"tool_ids": []}
    if not _session_token_matches(db, idx, x_mtc_session_token):
        raise HTTPException(401, "invalid session token")
    from ..models import Release as _Release

    manifest: dict = {}
    tool_policy: dict = {}
    if idx.release_id:
        rel = db.get(_Release, idx.release_id)
        snap = (rel.runtime_binding_snapshot or {}) if rel else {}
        manifest = snap.get("resources") or {}
        tool_policy = snap.get("frozen_tool_policy") or {}
    # P1-8: prefer frozen tool versions from the release binding
    frozen_tools = {}
    if idx.release_id and rel:
        frozen_tools = (rel.runtime_binding_snapshot or {}).get("_frozen_tools") or {}
    tools = []
    if tool_policy and tool_policy.get("platform_tools") is False:
        manifest = {**manifest, "tool_ids": []}
    for tid in manifest.get("tool_ids") or []:
        ft = frozen_tools.get(tid)
        if ft:
            tv = db.get(ToolVersion, ft["tool_version_id"])
        else:
            # fallback: latest ready (pre-P1-8 release)
            tv = (
                db.query(ToolVersion)
                .filter_by(tool_id=tid, status="ready")
                .order_by(ToolVersion.version_no.desc())
                .first()
            )
        if tv is None:
            continue
        tool = db.get(Tool, tid)
        tools.append(
            {
                "tool_version_id": tv.id,
                "name": (tool.name if tool else tid),
                "description": (tool.description or tool.name) if tool else tid,
                "input_schema": tv.input_schema or {"type": "object", "properties": {}},
            }
        )
    permission_policy = (
        (rel.runtime_binding_snapshot or {}).get("frozen_permission_policy") or {}
        if idx.release_id and rel
        else {}
    )
    return {"tool_ids": tools, "tool_policy": tool_policy, "permission_policy": permission_policy}


@internal_router.post("/run-platform-tool")
def run_platform_tool(
    body: RunPlatformToolBody,
    x_mtc_internal: str = Header(default=""),
    x_mtc_session_token: str = Header(default=""),
    db: Session = Depends(get_db),
):
    """P0-08：会话令牌绑定 + Tool 白名单——只允许执行该 Session 所属 Release
    冻结清单内的 ToolVersion（Agent 无法调用未挂载的 Tool）。"""
    _check_internal(x_mtc_internal)
    idx = _authorized_session(db, body.session_id, x_mtc_session_token)
    allowed = _release_tool_version_ids(db, idx)
    if body.tool_version_id not in allowed:
        raise HTTPException(
            403, f"tool version {body.tool_version_id} not in release manifest"
        )
    from ..platform_tool_exec import execute_tool_version

    try:
        return execute_tool_version(db, body.tool_version_id, body.args or {})
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(404, str(exc)) from exc


@internal_router.post("/run-workflow")
def internal_run_workflow(
    body: RunWorkflowBody,
    x_mtc_internal: str = Header(default=""),
    x_mtc_session_token: str = Header(default=""),
    db: Session = Depends(get_db),
):
    """P0-08：会话令牌绑定 + Workflow 必须在该 Session Release 清单内声明。"""
    _check_internal(x_mtc_internal)
    idx = _authorized_session(db, body.session_id, x_mtc_session_token)
    if body.workflow_id not in _release_resource_ids(db, idx, "workflow_ids"):
        raise HTTPException(
            403, f"workflow {body.workflow_id} not declared in release manifest"
        )
    from ..runner import RunError as _RunError
    try:
        run = create_workflow_run(db, body.workflow_id, trigger="agent", run_input=body.input)
    except _RunError as exc:
        raise HTTPException(404, str(exc)) from exc
    return {"run_id": run.id, "status": run.status}


@internal_router.post("/run-agent-flow")
def internal_run_flow(
    body: RunFlowBody,
    x_mtc_internal: str = Header(default=""),
    x_mtc_session_token: str = Header(default=""),
    db: Session = Depends(get_db),
):
    """P0-08：会话令牌绑定 + AgentFlow 必须在 Release 清单内声明；
    子 run 记录父 Session（审计链）。"""
    _check_internal(x_mtc_internal)
    idx = _authorized_session(db, body.session_id, x_mtc_session_token)
    if body.agent_flow_id not in _release_resource_ids(db, idx, "agentflow_ids"):
        raise HTTPException(
            403, f"agentflow {body.agent_flow_id} not declared in release manifest"
        )
    try:
        release = resolve_agentflow_release(db, definition_id=body.agent_flow_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    run = start_run(db, idx.user_id, release, body.input, trigger_kind="agent_tool",
                    parent_session_id=idx.session_id)
    return {"run_id": run.id, "status": run.status, "output": run.output}
