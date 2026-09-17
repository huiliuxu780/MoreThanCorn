"""Agent control plane + runtime proxy (AgentScope 2.0.8 native)."""
from __future__ import annotations

import hashlib
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import agent_execution as ex
from .. import agentscope_client as rt
from ..auth import require_role, require_operator
from ..db import get_db
from ..models import Agent, AgentSessionIndex, AgentVersion, Release

router = APIRouter(prefix="/api/v2/agents", tags=["agents-v2"])


class ReleaseBody(BaseModel):
    agent_version_id: str
    environment: str = "prod"


class TurnBody(BaseModel):
    text: str


class RunBody(BaseModel):
    text: str
    output_schema: dict[str, Any] | None = None
    conversation_key: str | None = None
    timeout_seconds: float = 300.0


class SessionBody(BaseModel):
    conversation_key: str | None = None
    policy: str = "conversation"
    # 09-16 对比弹窗：版本对比=release 绑定；模型对比=compare+model_override（闸门）
    release_id: str | None = None
    model_override: dict | None = None
    compare: bool = False


def _agent(db: Session, aid: str) -> Agent:
    agent = db.get(Agent, aid)
    if agent is None:
        raise HTTPException(404, "agent not found")
    return agent


def _session_runtime_ref(db: Session, uid: str, agent: Agent, sid: str) -> tuple[str, str]:
    """(runtime_agent_id, runtime_uid) for a session-scoped operation.

    P1-01 dedupe + P0-08 归属一致性：运行时对象活在发布 owner 名下，会话级
    操作必须用索引行记录的 runtime owner 身份连运行时（调用者身份鉴权仍由
    require_role 完成）。无索引行时回落 agent 的 active prod release。
    """
    idx = db.query(AgentSessionIndex).filter_by(session_id=sid, agent_id=agent.id).first()
    if idx and idx.runtime_agent_id:
        return idx.runtime_agent_id, (idx.user_id or uid)
    runtime_id, release = ex.resolve_runtime_agent(db, uid, agent, environment="prod")
    owner = (release.runtime_binding_snapshot or {}).get("owner") or uid
    return runtime_id, owner



@router.post("/{aid}/releases")
def create_release(aid: str, body: ReleaseBody, request: Request, db: Session = Depends(get_db), user: dict = Depends(require_operator)):
    agent = _agent(db, aid)
    version = db.get(AgentVersion, body.agent_version_id)
    if version is None or version.agent_id != aid:
        raise HTTPException(404, "version not found")
    # P0-06: same atomic publish transaction as the canonical endpoint
    from ..agent_release import ConcurrentPublishError, publish_release
    try:
        release = publish_release(
            db,
            actor=user.get("username", "dev"),
            agent=agent,
            version=version,
            environment=body.environment,
        )
    except ConcurrentPublishError as exc:
        raise HTTPException(409, str(exc))
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    binding = release.runtime_binding_snapshot or {}
    return {"release_id": release.id,
            "agentscope_agent_id": binding.get("agentscope_agent_id")}


@router.get("/{aid}/runtime-view")
def runtime_view(aid: str, request: Request, db: Session = Depends(get_db), user: dict = Depends(require_role())):
    agent = _agent(db, aid)
    uid = user.get("username", "dev")
    compiled_draft, draft_digest, _ = ex.compile_system_prompt(agent.config or {})
    release = (
        db.query(Release)
        .filter_by(agent_id=aid, environment="prod", status="active")
        .order_by(Release.created_at.desc())
        .first()
    )
    running = None
    published = None
    if release:
        binding = release.runtime_binding_snapshot or {}
        published = {
            "release_id": release.id,
            "version_id": release.agent_version_id,
            "digest": binding.get("prompt_digest"),
        }
        rid = binding.get("agentscope_agent_id")
        if rid:
            try:
                rec = rt.get_agent(uid, rid)
                data = rec.get("data", rec)
                live_prompt = data.get("system_prompt", "")
                running = {
                    "agentscope_agent_id": rid,
                    "digest": hashlib.sha256(live_prompt.encode()).hexdigest(),
                    "matches_published": hashlib.sha256(
                        live_prompt.encode()
                    ).hexdigest()
                    == binding.get("prompt_digest"),
                }
            except rt.RuntimeError_:
                running = {"agentscope_agent_id": rid, "missing": True}
    return {
        "editing": {"digest": draft_digest},
        "published": published,
        "running": running,
    }


@router.get("/{aid}/sessions")
def list_sessions(aid: str, request: Request, db: Session = Depends(get_db), user: dict = Depends(require_role())):
    rows = (
        db.query(AgentSessionIndex)
        .filter_by(agent_id=aid)
        .order_by(AgentSessionIndex.created_at.desc())
        .limit(100)
        .all()
    )
    return {
        "items": [
            {
                "session_id": r.session_id,
                "trigger_kind": r.trigger_kind,
                "conversation_key": r.conversation_key,
                "automation_id": r.automation_id,
                "agentflow_node_run_id": r.agentflow_node_run_id,
                "created_at": r.created_at.isoformat(),
            }
            for r in rows
        ]
    }


@router.post("/{aid}/sessions")
def open_session(aid: str, body: SessionBody, request: Request, db: Session = Depends(get_db), user: dict = Depends(require_operator)):
    agent = _agent(db, aid)
    uid = user.get("username", "dev")
    if body.model_override and not body.compare:
        raise HTTPException(422, detail={
            "code": "MODEL_OVERRIDE_TEST_ONLY",
            "message": "modelOverride 仅对比会话（compare=true）可用"})
    from ..models import Release as _Rel
    _rel = db.get(_Rel, body.release_id) if body.release_id else None
    if body.release_id and _rel is None:
        raise HTTPException(404, "release not found")
    try:
        index = ex.start_session(
            db,
            uid,
            agent,
            trigger_kind="chat",
            policy=body.policy,
            conversation_key=body.conversation_key or "default",
            release_override=_rel,
            model_override=body.model_override if body.compare else None,
        )
    except ValueError as exc:
        # §六.8：未发布/无模型等前置缺失给明确引导，不裸 500
        raise HTTPException(422, str(exc))
    return {"session_id": index.session_id, "index_id": index.id}


@router.post("/{aid}/sessions/{sid}/turns")
def chat_turn(aid: str, sid: str, body: TurnBody, request: Request, db: Session = Depends(get_db), user: dict = Depends(require_operator)):
    agent = _agent(db, aid)
    uid = user.get("username", "dev")
    index = db.query(AgentSessionIndex).filter_by(session_id=sid, agent_id=aid).first()
    if index is None:
        raise HTTPException(404, "session not indexed")
    runtime_id, runtime_uid = _session_runtime_ref(db, uid, agent, sid)
    rt.chat_trigger(runtime_uid, runtime_id, sid, body.text)
    return {"status": "started", "session_id": sid}


@router.get("/{aid}/sessions/{sid}/messages")
def messages(aid: str, sid: str, request: Request, db: Session = Depends(get_db), user: dict = Depends(require_role())):
    agent = _agent(db, aid)
    uid = user.get("username", "dev")
    runtime_id, runtime_uid = _session_runtime_ref(db, uid, agent, sid)
    return rt.session_messages(runtime_uid, runtime_id, sid)


@router.get("/{aid}/sessions/{sid}/status")
def status(aid: str, sid: str, request: Request, db: Session = Depends(get_db), user: dict = Depends(require_role())):
    agent = _agent(db, aid)
    uid = user.get("username", "dev")
    runtime_id, runtime_uid = _session_runtime_ref(db, uid, agent, sid)
    return rt.session_status(runtime_uid, runtime_id, sid)


@router.post("/{aid}/sessions/{sid}/interrupt")
def interrupt(aid: str, sid: str, request: Request, db: Session = Depends(get_db), user: dict = Depends(require_operator)):
    agent = _agent(db, aid)
    uid = user.get("username", "dev")
    runtime_id, runtime_uid = _session_runtime_ref(db, uid, agent, sid)
    return rt.interrupt_session(runtime_uid, runtime_id, sid)


@router.delete("/{aid}/sessions/{sid}")
def delete_session(aid: str, sid: str, request: Request, db: Session = Depends(get_db), user: dict = Depends(require_operator)):
    """删除对话任务（2026-09-10）：运行时 Session 永久删除 + 平台索引行清理。

    运行时删除失败（如已不存在）不阻断索引清理——索引是平台侧视图，
    用户删除意图必须生效；失败原因随响应返回。

    审计返工 P0-6 事故修复（09-10 二轮）：被平台 Run 引用的 Session 是执行证据载体，
    删除会制造 run→session 孤儿引用（本日实际发生 5 条）；此类 Session 一律 409 拒绝。
    """
    agent = _agent(db, aid)
    from ..models import Run
    ref_runs = db.query(Run).filter(Run.agentscope_session_id == sid).count()
    if ref_runs:
        raise HTTPException(409, detail={
            "code": "SESSION_REFERENCED_BY_RUN",
            "message": f"该会话被 {ref_runs} 条平台 Run（执行证据）引用，禁止删除以避免孤儿引用"})
    uid = user.get("username", "dev")
    idx = db.query(AgentSessionIndex).filter_by(session_id=sid, agent_id=aid).first()
    runtime_uid = idx.user_id if idx else uid
    runtime_id = idx.runtime_agent_id if idx else None
    runtime_error = None
    if runtime_id:
        try:
            rt.delete_session(runtime_uid, runtime_id, sid)
        except rt.RuntimeError_ as exc:
            runtime_error = str(exc)[:200]
    db.query(AgentSessionIndex).filter_by(session_id=sid, agent_id=aid).delete()
    db.commit()
    return {"deleted": True, "session_id": sid, "runtime_error": runtime_error}


@router.post("/{aid}/sessions/{sid}/confirm")
def confirm_hitl(aid: str, sid: str, request: Request, body: dict | None = None,
                 db: Session = Depends(get_db), user: dict = Depends(require_role())):
    """HITL 批准/拒绝（P0-H 09-10）：会话 awaiting_permission 时，取最后一条
    含未决 tool_call 的 assistant 消息，向运行时提交 UserConfirmResultEvent。

    body: {"confirmed": true|false}；无未决工具调用时 409（不伪造确认）。
    """
    agent = _agent(db, aid)
    uid = user.get("username", "dev")
    runtime_id, runtime_uid = _session_runtime_ref(db, uid, agent, sid)
    confirmed = bool((body or {}).get("confirmed", True))
    msgs = rt.session_messages(runtime_uid, runtime_id, sid).get("messages", [])
    reply_id = None
    pending: list[dict] = []
    for m in reversed(msgs):
        if m.get("role") != "assistant":
            continue
        content = m.get("content") or []
        result_ids = {
            str(b.get("id") or b.get("tool_call_id") or "")
            for b in content
            if isinstance(b, dict) and b.get("type") == "tool_result"
        }
        pending = [
            b for b in content
            if isinstance(b, dict) and b.get("type") == "tool_call"
            and str(b.get("id") or "") not in result_ids
        ]
        if pending:
            reply_id = str(m.get("id") or "")
            break
    if not pending or not reply_id:
        raise HTTPException(409, detail={
            "code": "NO_PENDING_PERMISSION",
            "message": "当前会话没有等待确认的工具调用",
        })
    return rt.chat_confirm(runtime_uid, runtime_id, sid, reply_id, pending, confirmed)


@router.get("/{aid}/sessions/{sid}/stream")
def stream_proxy(aid: str, sid: str, request: Request, db: Session = Depends(get_db), user: dict = Depends(require_role())):
    """SSE 平台代理（审核 P0-5）：浏览器同源连接平台；平台以服务端鉴权身份
    连接 Runtime。不再向浏览器暴露 Runtime 地址，也不接受客户端自报用户。"""
    import httpx
    from fastapi.responses import StreamingResponse

    agent = _agent(db, aid)
    uid = user.get("username", "dev")
    runtime_id, runtime_uid = _session_runtime_ref(db, uid, agent, sid)
    url = rt.stream_url(sid, runtime_id)

    def proxy():
        with httpx.Client(timeout=httpx.Timeout(None, read=None)) as client:
            with client.stream("GET", url, headers={"X-User-ID": runtime_uid}) as upstream:
                for chunk in upstream.iter_raw():
                    yield chunk

    return StreamingResponse(proxy(), media_type="text/event-stream")


@router.post("/{aid}/runs")
def single_run(aid: str, body: RunBody, request: Request, db: Session = Depends(get_db), user: dict = Depends(require_operator)):
    """一次性运行（P0-B 09-10）：fresh Session + 平台 Run 行（执行事实）。

    - 带 output_schema：同步结构化执行，Run 直接落终态（succeeded/502）；
    - 不带：异步触发（chat_trigger），Run=running，由 automation_watcher 按
      真实 Session 状态对账结算（不伪造终态）。
    返回平台 Run ID + 真实 AgentScope Session ID。
    """
    agent = _agent(db, aid)
    if bool(agent.archived):
        raise HTTPException(409, detail={"code": "AGENT_ARCHIVED",
                                         "message": f"Agent「{agent.name}」已归档，退出产品运行面"})
    uid = user.get("username", "dev")
    from datetime import datetime, timezone

    from ..models import Run
    from ..runner import emit

    def _mk_run(index, status: str, output: dict | None = None,
                error: dict | None = None) -> Run:
        rel = db.get(Release, index.release_id) if index.release_id else None
        now = datetime.now(timezone.utc)
        run = Run(
            agent_id=aid, trigger="api",
            input={"text": body.text[:4000]},
            agent_version_id=rel.agent_version_id if rel else None,
            definition_source="version" if rel else None,
            status=status, output=output, error=error,
            agentscope_session_id=index.session_id,
            started_at=now,
            ended_at=now if status in ("succeeded", "failed") else None,
            runtime_snapshot={"releaseId": rel.id, "environment": rel.environment} if rel else {},
        )
        db.add(run)
        db.commit()
        db.refresh(run)
        return run

    if body.output_schema:
        try:
            index, result = ex.run_structured(
                db,
                uid,
                agent,
                body.text,
                body.output_schema,
                trigger_kind="manual",
                conversation_key=body.conversation_key,
                policy="conversation" if body.conversation_key else "fresh",
                timeout_seconds=body.timeout_seconds,
            )
        except Exception as exc:  # noqa: BLE001 —— 真实失败如实上抛，不伪造结果
            raise HTTPException(502, detail={"code": "RUN_FAILED", "message": repr(exc)})
        run = _mk_run(index, "succeeded",
                      output=result.get("structured_output") or {"content": result.get("text", "")})
        emit(db, run.id, "agent_completed",
             payload={"sessionId": index.session_id, "mode": "structured"})
        return {"run_id": run.id, "session_id": index.session_id, **result}
    index = ex.run_turn(
        db,
        uid,
        agent,
        body.text,
        trigger_kind="manual",
        conversation_key=body.conversation_key,
        policy="conversation" if body.conversation_key else "fresh",
    )
    run = _mk_run(index, "running")
    emit(db, run.id, "agent_started",
         payload={"sessionId": index.session_id, "mode": "turn"})
    return {"run_id": run.id, "session_id": index.session_id, "status": "started"}


# --- workspace resources (Library/Workspace two-state) ---------------------


@router.get("/{aid}/sessions/{sid}/skills")
def workspace_skills(aid: str, sid: str, request: Request, db: Session = Depends(get_db), user: dict = Depends(require_role())):
    agent = _agent(db, aid)
    uid = user.get("username", "dev")
    runtime_id, runtime_uid = _session_runtime_ref(db, uid, agent, sid)
    return rt.workspace_skills(runtime_uid, runtime_id, sid)


@router.post("/{aid}/sessions/{sid}/skills/upload")
async def upload_skill(
    aid: str,
    sid: str,
    request: Request,
    root: str = "skill",
    files: list[UploadFile] = [],
    db: Session = Depends(get_db),
    user: dict = Depends(require_operator),
):
    agent = _agent(db, aid)
    uid = user.get("username", "dev")
    runtime_id, runtime_uid = _session_runtime_ref(db, uid, agent, sid)
    parts = [(f.filename or "SKILL.md", await f.read()) for f in files]
    rt.upload_workspace_skill(runtime_uid, runtime_id, sid, root, parts)
    return {"status": "installed"}


@router.get("/{aid}/sessions/{sid}/mcps")
def workspace_mcps(aid: str, sid: str, request: Request, db: Session = Depends(get_db), user: dict = Depends(require_role())):
    agent = _agent(db, aid)
    uid = user.get("username", "dev")
    runtime_id, runtime_uid = _session_runtime_ref(db, uid, agent, sid)
    return rt.workspace_mcps(runtime_uid, runtime_id, sid)


class McpBody(BaseModel):
    name: str
    url: str


@router.post("/{aid}/sessions/{sid}/mcps")
def add_mcp(aid: str, sid: str, body: McpBody, request: Request, db: Session = Depends(get_db), user: dict = Depends(require_operator)):
    agent = _agent(db, aid)
    uid = user.get("username", "dev")
    runtime_id, runtime_uid = _session_runtime_ref(db, uid, agent, sid)
    rt.add_workspace_mcp(
        runtime_uid,
        runtime_id,
        sid,
        {"name": body.name, "is_stateful": False, "mcp_config": {"type": "http_mcp", "url": body.url}},
    )
    return {"status": "added"}


@router.get("/{aid}/sessions/{sid}/mcp-library")
def mcp_library(aid: str, sid: str, request: Request, db: Session = Depends(get_db), user: dict = Depends(require_role())):
    uid = user.get("username", "dev")
    return rt.mcp_library(uid)


# --- knowledge -------------------------------------------------------------

kb_router = APIRouter(prefix="/api/v2/knowledge-bases", tags=["knowledge-v2"])


@kb_router.get("/config-status")
def kb_config_status(db: Session = Depends(get_db), user: dict = Depends(require_role())):
    """P0-H（09-10）：Knowledge 诚实状态——无火山引擎/embedding 鉴权即 NOT_CONFIGURED。

    不伪造可用：逐条检查 enabled KnowledgeSource 的 embedding 模型与凭据可解析性；
    任一环节缺失即 NOT_CONFIGURED 并给出原因（发布链同口径 fail-closed）。
    """
    from sqlalchemy import select as _select

    from ..agent_execution import runtime_credential_id
    from ..models import KnowledgeSource as _KS
    from ..models import Model as _Model

    rows = db.execute(_select(_KS)).scalars().all()
    items = []
    reasons: list[str] = []
    ready = False
    for ks in rows:
        item = {"id": ks.id, "name": ks.name, "status": ks.status, "mount": "unmounted"}
        if ks.status != "enabled":
            item["reason"] = "KnowledgeSource 已停用（不注册、不挂载、留痕）"
            reasons.append(f"{ks.name}: 停用")
        elif not ks.embedding_model_id:
            item["reason"] = "未配置 embedding 模型"
            reasons.append(f"{ks.name}: 无 embedding 模型")
        else:
            emb = db.get(_Model, ks.embedding_model_id)
            if emb is None:
                item["reason"] = "embedding 模型不存在"
                reasons.append(f"{ks.name}: embedding 模型不存在")
            else:
                try:
                    runtime_credential_id(db, user.get("username", "dev"), ks.embedding_model_id)
                    item["mount"] = "registrable"
                    ready = True
                except ValueError as exc:
                    item["reason"] = f"embedding 凭据不可用（火山引擎/DashScope 鉴权未配置）：{exc}"
                    reasons.append(f"{ks.name}: 凭据不可用")
        items.append(item)
    if not rows:
        reasons.append("平台未配置任何 KnowledgeSource")
    return {
        "status": "READY" if ready else "NOT_CONFIGURED",
        "reasons": reasons,
        "knowledge_sources": items,
        "note": "无火山引擎鉴权时保持 NOT_CONFIGURED；禁止 synthetic KB ID 与伪造调用成功。",
    }


class KbBody(BaseModel):
    name: str
    model_id: str
    dimensions: int = 1024


@kb_router.post("")
def create_kb(body: KbBody, request: Request, db: Session = Depends(get_db), user: dict = Depends(require_role())):
    uid = user.get("username", "dev")
    cfg = ex.chat_model_config(db, uid, body.model_id)
    emb = {
        "type": cfg["type"],
        "credential_id": cfg["credential_id"],
        "model": "text-embedding-v3",
        "dimensions": body.dimensions,
        "parameters": {},
    }
    kb_id = rt.create_knowledge_base(uid, body.name, emb)
    return {"knowledge_base_id": kb_id}


@kb_router.post("/{kb_id}/documents")
async def upload_doc(kb_id: str, file: UploadFile, request: Request, user: dict = Depends(require_role())):
    uid = user.get("username", "dev")
    doc_id = rt.upload_knowledge_document(uid, kb_id, file.filename or "doc.txt", await file.read())
    return {"document_id": doc_id}


@kb_router.get("/{kb_id}/documents/status")
def doc_status(kb_id: str, ids: str, request: Request, user: dict = Depends(require_role())):
    uid = user.get("username", "dev")
    return rt.knowledge_document_status(uid, kb_id, [i for i in ids.split(",") if i])


@kb_router.post("/{kb_id}/search")
def kb_search(kb_id: str, body: TurnBody, request: Request, user: dict = Depends(require_role())):
    uid = user.get("username", "dev")
    return rt.search_knowledge_base(uid, kb_id, body.text)
