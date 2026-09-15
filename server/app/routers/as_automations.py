"""Automations v2 (QoderWake-verified semantics) + data ingress layer."""
from __future__ import annotations

import hashlib
import hmac
import json
import secrets as pysecrets
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import and_, func, or_, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import agent_execution as ex
from .. import agentscope_client as rt
from ..agentflow_executor import resolve_agentflow_release
from ..agentflow_executor import start_run as start_agentflow_run
from ..auth import require_role, require_operator
from ..db import get_db
from ..models import (
    Agent,
    AgentFlowDefinition,
    AgentFlowRelease,
    AutomationApiKey,
    AutomationDefinition,
    AutomationTrigger,
    AutomationTriggerLog,
    AgentSessionIndex,
    Connection,
    DataAsset,
    DataSource,
    DataSourceEvent,
    EventDelivery,
    EventRoute,
    Release,
    Workflow,
)
from ..runner import create_run as create_workflow_run

router = APIRouter(prefix="/api/v2/automations", tags=["automations-v2"])

MAX_TRIGGERS = 5


class AutomationBody(BaseModel):
    name: str
    description: str = ""
    target_kind: str
    agent_id: str | None = None
    workflow_id: str | None = None
    workflow_version_id: str | None = None
    agentflow_id: str | None = None
    agentflow_release_id: str | None = None
    session_policy: str = "fresh"
    prompt_template: str = ""
    input_mapping: dict[str, Any] = {}
    max_runs: int | None = None
    deadline: str | None = None
    triggers: list[dict[str, Any]] = []


class TriggerBody(BaseModel):
    kind: str
    config: dict[str, Any] = {}


def _auto(db: Session, aid: str) -> AutomationDefinition:
    auto = db.get(AutomationDefinition, aid)
    if auto is None:
        raise HTTPException(404, "automation not found")
    return auto


# ---------- P0-G（09-10）：执行者真实校验 + 展示 ----------

_TARGET_KINDS = ("agent", "workflow", "agentflow")


def _executor_info(db: Session, target_kind: str, agent_id: str | None,
                   workflow_id: str | None, agentflow_id: str | None) -> dict:
    """真实执行者展示信息（名称/类型/头像）；目标缺失如实标记 missing。"""
    tid = agent_id or workflow_id or agentflow_id
    row = None
    if tid:
        model = {"agent": Agent, "workflow": Workflow,
                 "agentflow": AgentFlowDefinition}.get(target_kind)
        row = db.get(model, tid) if model else None
    return {
        "kind": target_kind,
        "id": tid,
        "name": getattr(row, "name", None),
        "avatar": getattr(row, "avatar", None) or getattr(row, "icon", None),
        "missing": row is None,
    }


def _validate_target(db: Session, uid: str, body: "AutomationBody") -> None:
    """保存阶段完整目标校验（任务书 §九）：类型/存在性/归档/可执行发布态。

    无效目标在保存时即返回明确 422，不允许保存后触发时才失败。
    """
    if body.target_kind not in _TARGET_KINDS:
        raise HTTPException(422, detail={
            "code": "BAD_TARGET_KIND",
            "message": f"target_kind 必须是 {'|'.join(_TARGET_KINDS)}"})
    if body.target_kind == "agent":
        if not body.agent_id:
            raise HTTPException(422, detail={
                "code": "TARGET_REQUIRED", "message": "执行者为 Agent 时必须选择 Agent"})
        agent = db.get(Agent, body.agent_id)
        if agent is None:
            raise HTTPException(422, detail={
                "code": "TARGET_NOT_FOUND", "message": f"Agent {body.agent_id} 不存在"})
        if bool(agent.archived):
            raise HTTPException(422, detail={
                "code": "TARGET_ARCHIVED",
                "message": f"Agent「{agent.name}」已归档，退出产品运行面，不可作为执行者"})
        rel = (db.query(Release)
               .filter_by(agent_id=agent.id, environment="prod", status="active")
               .first())
        if rel is None:
            raise HTTPException(422, detail={
                "code": "TARGET_NOT_EXECUTABLE",
                "message": f"Agent「{agent.name}」无 active prod Release，"
                           "请先发布生产版本再选为执行者（禁止跨环境静默降级）"})
    elif body.target_kind == "workflow":
        if not body.workflow_id:
            raise HTTPException(422, detail={
                "code": "TARGET_REQUIRED", "message": "执行者为 Workflow 时必须选择 Workflow"})
        wf = db.get(Workflow, body.workflow_id)
        if wf is None:
            raise HTTPException(422, detail={
                "code": "TARGET_NOT_FOUND",
                "message": f"Workflow {body.workflow_id} 不存在"})
        # 审计返工（09-10 二轮）：与前端选择器同一语义——仅 published 可作为执行者；
        # 定时执行入口 create_run(trigger=schedule) 同样要求已发布版本（NO_PUBLISHED_VERSION），
        # 不得允许保存一个注定触发失败的草稿目标。显式固定已发布版本时放行。
        if wf.status != "published" and not body.workflow_version_id:
            raise HTTPException(422, detail={
                "code": "TARGET_NOT_EXECUTABLE",
                "message": f"Workflow「{wf.name}」未发布，请先发布再选为执行者"})
        if body.workflow_version_id:
            from ..models import WorkflowVersion
            wv = db.get(WorkflowVersion, body.workflow_version_id)
            if wv is None or wv.workflow_id != wf.id:
                raise HTTPException(422, detail={
                    "code": "TARGET_VERSION_MISMATCH",
                    "message": "workflow_version_id 不属于该 Workflow"})
    else:  # agentflow
        if not body.agentflow_id and not body.agentflow_release_id:
            raise HTTPException(422, detail={
                "code": "TARGET_REQUIRED",
                "message": "执行者为 AgentFlow 时必须选择 AgentFlow"})
        # 审计返工 P0-1：先判存在性（NOT_FOUND），再判可执行性（NOT_EXECUTABLE），
        # 与 Agent/Workflow 同一语义分层；resolver 对"无 active Release"抛 ValueError，
        # 不得笼统归为 NOT_FOUND。
        if body.agentflow_id:
            flow = db.get(AgentFlowDefinition, body.agentflow_id)
            if flow is None:
                raise HTTPException(422, detail={
                    "code": "TARGET_NOT_FOUND",
                    "message": f"AgentFlow {body.agentflow_id} 不存在"})
        try:
            release = resolve_agentflow_release(
                db, release_id=body.agentflow_release_id,
                definition_id=body.agentflow_id)
        except ValueError as exc:
            code = "TARGET_NOT_EXECUTABLE" if body.agentflow_id else "TARGET_NOT_FOUND"
            message = ("AgentFlow 无 active Release，请先发布再选为执行者"
                       if body.agentflow_id else str(exc))
            raise HTTPException(422, detail={"code": code, "message": message})
        if release is None:
            raise HTTPException(422, detail={
                "code": "TARGET_NOT_EXECUTABLE",
                "message": "AgentFlow 无 active Release，请先发布再选为执行者"})


def _serialize(db: Session, auto: AutomationDefinition) -> dict:
    triggers = db.query(AutomationTrigger).filter_by(automation_id=auto.id).all()
    return {
        "id": auto.id,
        "name": auto.name,
        "description": auto.description,
        "target_kind": auto.target_kind,
        "agent_id": auto.agent_id,
        "workflow_id": auto.workflow_id,
        "agentflow_id": auto.agentflow_id,
        "agentflow_release_id": auto.agentflow_release_id,
        "executor": _executor_info(db, auto.target_kind, auto.agent_id,
                                   auto.workflow_id, auto.agentflow_id),
        "enabled": auto.enabled,
        "session_policy": auto.session_policy,
        "prompt_template": auto.prompt_template,
        "input_mapping": auto.input_mapping,
        "max_runs": auto.max_runs,
        "deadline": auto.deadline.isoformat() if auto.deadline else None,
        "runtime_schedule_id": auto.runtime_schedule_id,
        "last_auto_fire_at": auto.last_auto_fire_at.isoformat()
        if auto.last_auto_fire_at
        else None,
        "auto_run_count": auto.auto_run_count,
        "last_auto_status": auto.last_auto_status,
        "triggers": [
            {"id": t.id, "kind": t.kind, "config": t.config, "enabled": t.enabled}
            for t in triggers
        ],
    }


def _sync_schedule(db: Session, uid: str, auto: AutomationDefinition) -> None:
    """Materialize/rebuild/tear down the AgentScope Schedule for agent targets.

    P0-03: the Schedule is pinned to the Agent Release that was active prod at
    sync time — model AND parameters come from that release's frozen snapshot
    (``runtime_release_id`` records the pin).  Draft edits never drift an
    existing Schedule.  Switch rule on republish: when the active prod Release
    changes, the next sync (create/update/enable) DELETES the old Schedule and
    recreates it from the new release snapshot; between syncs the old Schedule
    keeps running its pinned release.
    """
    sched_triggers = [
        t
        for t in db.query(AutomationTrigger)
        .filter_by(automation_id=auto.id, kind="schedule")
        .all()
        if t.enabled
    ]
    if auto.target_kind != "agent" or not auto.enabled or not sched_triggers:
        if auto.runtime_schedule_id:
            try:
                rt.patch_schedule(uid, auto.runtime_schedule_id, enabled=False)
            except rt.RuntimeError_:
                pass
        return
    trig = sched_triggers[0]
    cron = trig.config.get("cron", "0 9 * * *")
    tz = trig.config.get("timezone", "Asia/Shanghai")
    agent = db.get(Agent, auto.agent_id or "")
    if agent is None:
        raise HTTPException(422, "automation agent missing")
    try:
        runtime_id, release = ex.resolve_runtime_agent(
            db, uid, agent, environment="prod"
        )
    except ValueError as exc:
        # 保存后 Release 被回滚/下线：如实 422 引导重新发布，不裸 500
        raise HTTPException(422, str(exc))
    if auto.runtime_schedule_id and auto.runtime_release_id == release.id:
        rt.patch_schedule(
            uid,
            auto.runtime_schedule_id,
            enabled=True,
            cron_expression=cron,
            timezone=tz,
        )
        return
    if auto.runtime_schedule_id:
        # republished since the schedule was created → replace it so the
        # schedule follows the new release snapshot (no model drift)
        try:
            rt.delete_schedule(uid, auto.runtime_schedule_id)
        except rt.RuntimeError_:
            pass
        auto.runtime_schedule_id = None
        auto.runtime_release_id = None
    schedule_id = rt.create_schedule(
        uid,
        name=auto.name,
        description=auto.prompt_template or auto.description or auto.name,
        cron_expression=cron,
        timezone=tz,
        agent_id=runtime_id,
        chat_model_config=ex.chat_model_config_for_release(db, uid, release),
        stateful=auto.session_policy == "stateful",
        ended_at=auto.deadline.isoformat() if auto.deadline else None,
    )
    auto.runtime_schedule_id = schedule_id
    auto.runtime_release_id = release.id
    db.commit()


def _payload_sha(payload: dict) -> str:
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, ensure_ascii=False, default=str).encode()
    ).hexdigest()


def _target_of(log: AutomationTriggerLog) -> tuple[str | None, str | None]:
    """target 联合形状（Spec §7.2）：兼容期回退三列。"""
    if log.target_kind and log.target_ref:
        return log.target_kind, log.target_ref
    if log.session_id:
        return "agent_session", log.session_id
    if log.agentflow_run_id:
        return "agentflow_run", log.agentflow_run_id
    if log.workflow_run_id:
        return "workflow_run", log.workflow_run_id
    return None, None


def invocation_dto(log: AutomationTriggerLog) -> dict:
    """AutomationInvocation DTO（Spec §7.2/§12.3）；状态以大写 canonical 暴露。"""
    kind, ref = _target_of(log)
    source = log.source
    source_mode = None
    if source == "polling":
        source, source_mode = "event", "polling"
    return {
        "id": log.id,
        "automationId": log.automation_id,
        "triggerId": log.trigger_id,
        "source": source,
        "sourceMode": source_mode,
        "idempotencyKey": log.idempotency_key,
        "status": (log.status or "").upper(),
        "attempt": log.attempt,
        "retryOfId": log.retry_of_id,
        "cancelRequested": log.cancel_requested_at is not None,
        "target": {"kind": kind, "id": ref} if kind else None,
        "conversationKey": log.conversation_key,
        "queuedAt": log.queued_at.isoformat() if log.queued_at else None,
        "startedAt": log.started_at.isoformat() if log.started_at else None,
        "endedAt": log.ended_at.isoformat() if log.ended_at else None,
        "createdAt": log.created_at.isoformat() if log.created_at else None,
        "errorCode": log.error_code,
        "errorDetail": log.error_detail,
        "error": log.error or None,
    }


TERMINAL_LOG_STATUSES = ("completed", "failed", "cancelled")


def dispatch(
    db: Session,
    uid: str,
    auto: AutomationDefinition,
    payload: dict[str, Any],
    *,
    source: str,
    idempotency_key: str | None = None,
    trigger_id: str | None = None,
    retry_of: AutomationTriggerLog | None = None,
) -> AutomationTriggerLog:
    """F2：按 Spec §7.4 准入顺序处理一次触发（错误码 per §13.1）。

    原子幂等：partial unique index (automation_id, idempotency_key)——
    同 key 同 payload 返回原 Invocation；同 key 异 payload 409（API 层翻译）。
    """
    now = datetime.now(timezone.utc)
    attempt = (retry_of.attempt + 1) if retry_of is not None else 1
    sha = _payload_sha(payload)

    def _reject(log: AutomationTriggerLog | None, code: str, message: str) -> None:
        if log is not None:
            log.status = "rejected"
            log.error_code = code
            log.error = message
            log.ended_at = datetime.now(timezone.utc)
            # 释放幂等键：REJECTED 不占用 key，后续修正后的触发可重用
            log.idempotency_key = None
            db.commit()
        raise ValueError(f"[{code}] {message}")

    # 1. 建立接收事实（含幂等键；冲突由 partial unique index 兜底）
    log = AutomationTriggerLog(
        automation_id=auto.id,
        trigger_id=trigger_id,
        source=source,
        idempotency_key=idempotency_key,
        status="received",
        payload_sha=sha,
        input=payload if isinstance(payload, dict) else {"payload": payload},
        attempt=attempt,
        retry_of_id=retry_of.id if retry_of is not None else None,
        created_at=now,
    )
    db.add(log)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        existing = (
            db.query(AutomationTriggerLog)
            .filter_by(automation_id=auto.id, idempotency_key=idempotency_key)
            .first()
        )
        if existing is None:
            raise
        if existing.payload_sha and existing.payload_sha != sha:
            raise ValueError(
                "[IDEMPOTENCY_PAYLOAD_MISMATCH] 相同幂等键对应不同输入（409）")
        return existing  # DEDUPED：返回原 Invocation 引用，不创建目标执行体

    # 4'. 幂等预检（已有记录：同 sha 返回原引用，异 sha 409）
    if idempotency_key:
        dup = (
            db.query(AutomationTriggerLog)
            .filter(AutomationTriggerLog.id != log.id,
                    AutomationTriggerLog.automation_id == auto.id,
                    AutomationTriggerLog.idempotency_key == idempotency_key)
            .first()
        )
        if dup is not None:
            db.delete(log)
            db.commit()
            if dup.payload_sha and dup.payload_sha != sha:
                raise ValueError(
                    "[IDEMPOTENCY_PAYLOAD_MISMATCH] 相同幂等键对应不同输入（409）")
            return dup  # DEDUPED

    # 2-3. 定义/触发器存在由调用方保证（_auto）；4. 幂等已过
    # 5'. 目标有效性：封存 Agent 在消耗配额前拒绝（AGENT_ARCHIVED）
    if auto.target_kind == "agent":
        target_agent = db.get(Agent, auto.agent_id or "")
        if target_agent is not None and target_agent.archived:
            _reject(log, "AGENT_ARCHIVED", "agent archived")

    # 5-6. enabled/deadline/maxRuns（P0-5 原子门）
    gate = db.execute(
        text("""
            UPDATE automation_definition
            SET auto_run_count = auto_run_count + 1,
                last_auto_fire_at = NOW()
            WHERE id = :aid
              AND enabled = TRUE
              AND (max_runs IS NULL OR auto_run_count < max_runs)
              AND (deadline IS NULL OR deadline > NOW())
            RETURNING auto_run_count, max_runs
        """),
        {"aid": auto.id},
    ).first()
    if gate is None:
        db.refresh(auto)
        if not auto.enabled:
            _reject(log, "AUTOMATION_DISABLED", "automation disabled")
        if auto.max_runs is not None and auto.auto_run_count >= auto.max_runs:
            _reject(log, "MAX_RUNS_REACHED", f"max_runs ({auto.max_runs}) reached")
        if auto.deadline and auto.deadline <= datetime.now(timezone.utc):
            _reject(log, "DEADLINE_PASSED", f"deadline passed: {auto.deadline.isoformat()}")
        _reject(log, "AUTOMATION_GATE_FAILED", "automation gating failed")

    # 9. 准入通过 → accepted/queued
    log.status = "accepted"
    db.commit()

    # 10-11. 创建目标占位并派发（任何失败 → FAILED 带错误码，不留裸 repr）
    try:
        prompt_text = ex.render_prompt(auto.prompt_template, payload)
        if auto.target_kind == "agent":
            agent = db.get(Agent, auto.agent_id or "")
            if agent is None:
                raise ValueError("agent missing")
            index = ex.start_session(
                db,
                uid,
                agent,
                trigger_kind="schedule" if source == "schedule" else source,
                policy=auto.session_policy,
                conversation_key=payload.get("conversation_key"),
                automation_id=auto.id,
                trigger_log_id=log.id,
            )
            log.target_kind = "agent_session"
            log.target_ref = index.session_id
            log.session_id = index.session_id
            log.status = "queued"
            log.queued_at = datetime.now(timezone.utc)
            db.commit()
            runtime_id = index.runtime_agent_id or ex.resolve_runtime_agent(
                db, uid, agent, environment="prod"
            )[0]
            rt.chat_trigger(uid, runtime_id, index.session_id, prompt_text)
            # chat_trigger 成功即真实派发（Spec §7.3 RUNNING=真实目标已开始）
            log.status = "running"
            log.started_at = datetime.now(timezone.utc)
        elif auto.target_kind == "workflow":
            run = create_workflow_run(
                db,
                auto.workflow_id or "",
                trigger="schedule" if source == "schedule" else "api",
                run_input=payload,
                pinned_version_id=auto.workflow_version_id,
            )
            log.target_kind = "workflow_run"
            log.target_ref = run.id
            log.workflow_run_id = run.id
            log.status = "queued"
            log.queued_at = datetime.now(timezone.utc)
        else:
            release = resolve_agentflow_release(
                db,
                release_id=auto.agentflow_release_id,
                definition_id=auto.agentflow_id,
            )
            flow_run = start_agentflow_run(
                db, uid, release, payload, trigger_kind=source, automation_id=auto.id
            )
            log.target_kind = "agentflow_run"
            log.target_ref = flow_run.id
            log.agentflow_run_id = flow_run.id
            log.status = "queued"
            log.queued_at = datetime.now(timezone.utc)
    except Exception as exc:  # noqa: BLE001
        log.status = "failed"
        log.error_code = "TARGET_EXECUTION_FAILED"
        log.error_detail = {"repr": repr(exc)}
        log.error = repr(exc)
        log.ended_at = datetime.now(timezone.utc)
    db.commit()
    return log

_SORT_COLUMNS = {
    "created_at": AutomationDefinition.created_at,
    "updated_at": AutomationDefinition.updated_at,
    "name": AutomationDefinition.name,
    "last_auto_fire_at": AutomationDefinition.last_auto_fire_at,
    "auto_run_count": AutomationDefinition.auto_run_count,
}


@router.get("")
def list_automations(request: Request, db: Session = Depends(get_db), user: dict = Depends(require_role())):
    """列表（P0-G 09-10）：执行者/触发类型/状态筛选 + 排序 + 分页。

    query: executor=<agent|workflow|agentflow>:<id>（或裸 id）、triggerKind=
    schedule|api|event|mq|polling、status=enabled|disabled、keyword、
    sort=created_at|name|last_auto_fire_at|auto_run_count、order=asc|desc、
    page、pageSize。
    """
    qp = request.query_params
    try:
        page = max(1, int(qp.get("page", "1")))
        page_size = min(100, max(1, int(qp.get("pageSize", qp.get("page_size", "20")))))
    except ValueError:
        raise HTTPException(422, "page/pageSize 必须是整数")
    q = db.query(AutomationDefinition)
    executor = (qp.get("executor") or "").strip()
    if executor:
        kind, _, eid = executor.partition(":")
        if not eid:  # 裸 id：三列任一命中
            eid = kind
            q = q.filter(
                (AutomationDefinition.agent_id == eid)
                | (AutomationDefinition.workflow_id == eid)
                | (AutomationDefinition.agentflow_id == eid))
        elif kind == "agent":
            q = q.filter(AutomationDefinition.agent_id == eid)
        elif kind == "workflow":
            q = q.filter(AutomationDefinition.workflow_id == eid)
        elif kind == "agentflow":
            q = q.filter(AutomationDefinition.agentflow_id == eid)
        else:
            raise HTTPException(422, "executor 前缀必须是 agent|workflow|agentflow")
    trigger_kind = (qp.get("triggerKind") or qp.get("trigger_kind") or "").strip()
    if trigger_kind:
        sub = (db.query(AutomationTrigger.automation_id)
               .filter(AutomationTrigger.kind == trigger_kind,
                       AutomationTrigger.enabled.is_(True)))
        q = q.filter(AutomationDefinition.id.in_(sub))
    status = (qp.get("status") or "").strip()
    if status == "enabled":
        q = q.filter(AutomationDefinition.enabled.is_(True))
    elif status == "disabled":
        q = q.filter(AutomationDefinition.enabled.is_(False))
    elif status:
        raise HTTPException(422, "status 必须是 enabled|disabled")
    keyword = (qp.get("keyword") or "").strip()
    if keyword:
        q = q.filter(AutomationDefinition.name.ilike(f"%{keyword}%"))
    sort = (qp.get("sort") or "created_at").strip()
    if sort not in _SORT_COLUMNS:
        raise HTTPException(422, f"sort 必须是 {'|'.join(_SORT_COLUMNS)}")
    col = _SORT_COLUMNS[sort]
    order = (qp.get("order") or "desc").strip().lower()
    if order not in ("asc", "desc"):
        raise HTTPException(422, "order 必须是 asc|desc")
    q = q.order_by(col.asc() if order == "asc" else col.desc())
    total = q.count()
    rows = q.offset((page - 1) * page_size).limit(page_size).all()
    return {"items": [_serialize(db, r) for r in rows],
            "total": total, "page": page, "pageSize": page_size}


@router.post("")
def create_automation(body: AutomationBody, db: Session = Depends(get_db), user: dict = Depends(require_operator)):
    if len(body.triggers) > MAX_TRIGGERS:
        raise HTTPException(422, f"at most {MAX_TRIGGERS} triggers")
    # P0-G（09-10）：保存阶段完整目标校验——无效目标 422，不落库
    _validate_target(db, user.get("username", "dev"), body)
    auto = AutomationDefinition(
        name=body.name,
        description=body.description,
        target_kind=body.target_kind,
        agent_id=body.agent_id,
        workflow_id=body.workflow_id,
        workflow_version_id=body.workflow_version_id,
        agentflow_id=body.agentflow_id,
        agentflow_release_id=body.agentflow_release_id,
        session_policy=body.session_policy,
        prompt_template=body.prompt_template,
        input_mapping=body.input_mapping,
        max_runs=body.max_runs,
        deadline=datetime.fromisoformat(body.deadline) if body.deadline else None,
        created_by=user.get("username", "dev"),
    )
    db.add(auto)
    db.commit()
    db.refresh(auto)
    for t in body.triggers:
        db.add(AutomationTrigger(automation_id=auto.id, kind=t["kind"], config=t.get("config", {})))
    db.commit()
    _sync_schedule(db, user.get("username", "dev"), auto)
    return _serialize(db, auto)


@router.get("/{aid}")
def get_automation(aid: str, db: Session = Depends(get_db), user: dict = Depends(require_role())):
    return _serialize(db, _auto(db, aid))


@router.put("/{aid}")
def update_automation(aid: str, body: AutomationBody, db: Session = Depends(get_db), user: dict = Depends(require_operator)):
    auto = _auto(db, aid)
    if (body.target_kind, body.agent_id, body.workflow_id, body.agentflow_id) != (
        auto.target_kind,
        auto.agent_id,
        auto.workflow_id,
        auto.agentflow_id,
    ):
        raise HTTPException(422, "执行方式与执行对象保存后不可修改，请新建自动任务")
    auto.name = body.name
    auto.description = body.description
    auto.session_policy = body.session_policy
    auto.prompt_template = body.prompt_template
    auto.input_mapping = body.input_mapping
    auto.max_runs = body.max_runs
    auto.deadline = datetime.fromisoformat(body.deadline) if body.deadline else None
    db.query(AutomationTrigger).filter_by(automation_id=aid).delete()
    for t in body.triggers[:MAX_TRIGGERS]:
        db.add(AutomationTrigger(automation_id=aid, kind=t["kind"], config=t.get("config", {})))
    db.commit()
    _sync_schedule(db, user.get("username", "dev"), auto)
    return _serialize(db, auto)


@router.post("/{aid}/triggers")
def add_trigger(aid: str, body: TriggerBody, db: Session = Depends(get_db), user: dict = Depends(require_operator)):
    auto = _auto(db, aid)
    count = db.query(AutomationTrigger).filter_by(automation_id=aid).count()
    if count >= MAX_TRIGGERS:
        raise HTTPException(422, f"at most {MAX_TRIGGERS} triggers")
    db.add(AutomationTrigger(automation_id=aid, kind=body.kind, config=body.config))
    db.commit()
    _sync_schedule(db, user.get("username", "dev"), auto)
    return _serialize(db, auto)


@router.patch("/{aid}/enabled")
def set_enabled(aid: str, enabled: bool, db: Session = Depends(get_db), user: dict = Depends(require_operator)):
    auto = _auto(db, aid)
    auto.enabled = enabled
    db.commit()
    _sync_schedule(db, user.get("username", "dev"), auto)
    return _serialize(db, auto)


def _http_status_for_dispatch_error(exc: ValueError) -> int:
    msg = str(exc)
    if msg.startswith("[IDEMPOTENCY_PAYLOAD_MISMATCH]"):
        return 409
    if msg.startswith(("[AUTOMATION_DISABLED]", "[MAX_RUNS_REACHED]", "[DEADLINE_PASSED]",
                       "[AGENT_ARCHIVED]")):
        return 409
    return 422


@router.post("/{aid}/run-now")
def run_now(aid: str, request: Request, response: Response,
            idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
            db: Session = Depends(get_db), user: dict = Depends(require_operator)):
    """F2：手动运行（AC-001）——202 + Invocation DTO + statusUrl；不计自动统计。"""
    auto = _auto(db, aid)
    uid = user.get("username", "dev")
    body = {}
    try:
        log = dispatch(db, uid, auto, body, source="manual", idempotency_key=idempotency_key)
    except ValueError as exc:
        raise HTTPException(_http_status_for_dispatch_error(exc), str(exc)) from exc
    dto = invocation_dto(log)
    response.status_code = 202
    response.headers["Location"] = f"/api/v2/invocations/{log.id}"
    return {"invocationId": log.id, "status": dto["status"],
            "statusUrl": f"/api/v2/invocations/{log.id}", "sessionId": log.session_id}


@router.get("/{aid}/history")
def history(aid: str, db: Session = Depends(get_db), user: dict = Depends(require_role())):
    auto = _auto(db, aid)
    uid = user.get("username", "dev")
    logs = (
        db.query(AutomationTriggerLog)
        .filter_by(automation_id=aid)
        .order_by(AutomationTriggerLog.created_at.desc())
        .limit(100)
        .all()
    )
    items = []
    for log in logs:
        items.append(
            {
                "id": log.id,
                "source": log.source,
                "status": log.status,
                "session_id": log.session_id,
                "workflow_run_id": log.workflow_run_id,
                "agentflow_run_id": log.agentflow_run_id,
                "error": log.error,
                "created_at": log.created_at.isoformat(),
            }
        )
    # reconcile running logs against the runtime session truth
    running = [l for l in logs if l.status == "running" and l.session_id]
    if running and auto.agent_id:
        from .. import agent_execution as ex

        agent = db.get(Agent, auto.agent_id)
        try:
            runtime_id, _ = ex.resolve_runtime_agent(
                db, uid, agent, environment="prod"
            )
            triples = [
                {"user_id": uid, "agent_id": runtime_id, "session_id": l.session_id}
                for l in running
            ]
            states = {s["session_id"]: s for s in rt.sessions_status(uid, triples)}
            for l in running:
                st = states.get(l.session_id or "", {})
                if st.get("status") == "running":
                    continue
                fr = st.get("finished_reason")
                if fr in ("error", "interrupted", "cancelled"):
                    l.status = "failed"
                elif fr:
                    l.status = "completed"
            db.commit()
            for item in items:
                live = next((l for l in running if l.id == item["id"]), None)
                if live:
                    item["status"] = live.status
        except Exception:  # noqa: BLE001 —— reconcile 失败不阻断历史读取
            pass

    # auto statistics come from the runtime schedule sessions only
    if auto.runtime_schedule_id:
        sessions = rt.schedule_sessions(uid, auto.runtime_schedule_id)
        auto.auto_run_count = len(sessions)
        if sessions:
            latest = max(sessions, key=lambda s: s.get("created_at", ""))
            auto.last_auto_fire_at = datetime.fromisoformat(
                latest.get("created_at").replace("Z", "+00:00")
            ) if latest.get("created_at") else None
        # GAP-2：max_runs 为准入门——达限后停用运行时 Schedule（反应式准入）
        if auto.max_runs is not None and auto.auto_run_count >= auto.max_runs:
            try:
                rt.patch_schedule(uid, auto.runtime_schedule_id, enabled=False)
            except rt.RuntimeError_:
                pass
        db.commit()
    return {"items": items, "auto_run_count": auto.auto_run_count, "last_auto_fire_at": auto.last_auto_fire_at.isoformat() if auto.last_auto_fire_at else None}


@router.post("/{aid}/enable")
def enable_alias(aid: str, db: Session = Depends(get_db),
                 user: dict = Depends(require_operator)):
    """F-audit：Spec §12.2 canonical 启停别名（实现同 PATCH /{aid}/enabled）。"""
    return set_enabled(aid, True, db=db, user=user)


@router.post("/{aid}/disable")
def disable_alias(aid: str, db: Session = Depends(get_db),
                  user: dict = Depends(require_operator)):
    return set_enabled(aid, False, db=db, user=user)


invocations_router = APIRouter(prefix="/api/v2/invocations", tags=["invocations"])


@invocations_router.get("/{iid}/events")
def invocation_events(iid: str, db: Session = Depends(get_db),
                      user: dict = Depends(require_role())):
    """F-audit：Spec §12.3 Invocation 事件流（目标执行事实的轻量摘要）。

    workflow/flow 目标 → RunEvent/NodeRun 行；agent session 目标 → 运行时消息
    摘要（单次批调用）；运行时不可达时返回空列表 + note，不伪装。
    """
    log = db.get(AutomationTriggerLog, iid)
    if log is None:
        raise HTTPException(404, "invocation not found")
    items: list[dict] = []
    note = None
    if log.workflow_run_id:
        from ..models import RunEvent
        rows = (db.query(RunEvent).filter_by(run_id=log.workflow_run_id)
                .order_by(RunEvent.created_at.desc()).limit(200).all())
        items = [{"type": e.type, "nodeId": e.node_id, "payload": e.payload,
                  "createdAt": e.created_at.isoformat() if e.created_at else None}
                 for e in rows]
    elif log.agentflow_run_id:
        from ..models import AgentFlowNodeRun
        rows = (db.query(AgentFlowNodeRun)
                .filter_by(run_id=log.agentflow_run_id)
                .order_by(AgentFlowNodeRun.started_at).all())
        items = [{"type": f"node_{r.status}", "nodeId": r.node_id,
                  "payload": {"session_id": r.session_id, "error": r.error or None},
                  "createdAt": r.started_at.isoformat() if r.started_at else None}
                 for r in rows]
    elif log.session_id:
        from ..work_item_projection import _runtime_agent_of

        idx = db.query(AgentSessionIndex).filter_by(session_id=log.session_id).first()
        runtime_id = idx.runtime_agent_id if idx else None
        if idx and not runtime_id and idx.agent_id:
            runtime_id = _runtime_agent_of(db, idx.agent_id)
        if idx and runtime_id:
            try:
                msgs = rt.session_messages(idx.user_id, runtime_id, log.session_id)
                items = [{"type": f"message_{m.get('role')}", "nodeId": None,
                          "payload": {"finished": bool(m.get("finished_reason"))},
                          "createdAt": m.get("created_at")}
                         for m in (msgs.get("messages") or [])[-50:]]
            except rt.RuntimeError_:
                note = "runtime unreachable"
        else:
            note = "runtime binding missing"
    return {"invocationId": iid, "items": items, "note": note}


@invocations_router.get("/{iid}")
def get_invocation(iid: str, db: Session = Depends(get_db),
                   user: dict = Depends(require_role())):
    """F2：Invocation 详情（Spec §12.3）。"""
    log = db.get(AutomationTriggerLog, iid)
    if log is None:
        raise HTTPException(404, "invocation not found")
    return invocation_dto(log)


@invocations_router.post("/{iid}/cancel", status_code=202)
def cancel_invocation(iid: str, db: Session = Depends(get_db),
                      user: dict = Depends(require_operator)):
    """F2：取消（Spec §12.3 矩阵）——agent 中断 Session；agentflow queued 直取/运行中
    中断节点 Session；workflow queued 直取、运行中 409（runner 无运行中取消能力，登记）。"""
    log = db.get(AutomationTriggerLog, iid)
    if log is None:
        raise HTTPException(404, "invocation not found")
    if log.status in TERMINAL_LOG_STATUSES:
        raise HTTPException(409, "invocation already terminal")
    now = datetime.now(timezone.utc)
    if log.cancel_requested_at is None:
        log.cancel_requested_at = now
        db.commit()

    interrupted = 0
    if log.target_kind in (None, "agent_session") and log.session_id:
        idx = db.query(AgentSessionIndex).filter_by(session_id=log.session_id).first()
        if idx is not None and idx.runtime_agent_id:
            try:
                rt.interrupt_session(idx.user_id, idx.runtime_agent_id, log.session_id)
                interrupted += 1
            except rt.RuntimeError_:
                pass  # 尽力中断；watcher 按真实终态结算
    elif log.target_kind == "agentflow_run" and log.agentflow_run_id:
        fr = db.get(AgentFlowRun, log.agentflow_run_id)
        if fr is not None and fr.status == "queued":
            fr.status = "cancelled"
            fr.ended_at = now
            db.commit()
        elif fr is not None and fr.status == "running":
            for idx in db.query(AgentSessionIndex).filter_by(agentflow_run_id=fr.id).all():
                try:
                    rt.interrupt_session(idx.user_id, idx.runtime_agent_id, idx.session_id)
                    interrupted += 1
                except rt.RuntimeError_:
                    pass
    elif log.target_kind == "workflow_run" and log.workflow_run_id:
        run = db.get(Run, log.workflow_run_id)
        if run is not None and run.status in ("queued", "pending"):
            run.status = "cancelled"
            run.ended_at = now
            db.commit()
        elif run is not None and run.status not in ("succeeded", "failed", "cancelled"):
            raise HTTPException(409, "workflow running cancel not supported yet")
    return {"id": log.id, "status": log.status.upper(),
            "cancelRequested": True, "interrupted": interrupted}


@invocations_router.post("/{iid}/retry", status_code=202)
def retry_invocation(iid: str, db: Session = Depends(get_db),
                     user: dict = Depends(require_operator)):
    """F2：重试 = 新 Invocation（retry_of_id 指向原记录，attempt+1，同冻结输入）。"""
    log = db.get(AutomationTriggerLog, iid)
    if log is None:
        raise HTTPException(404, "invocation not found")
    if log.status not in TERMINAL_LOG_STATUSES:
        raise HTTPException(409, "invocation not terminal — cancel or wait")
    auto = db.get(AutomationDefinition, log.automation_id)
    if auto is None:
        raise HTTPException(404, "automation definition missing")
    try:
        new_log = dispatch(db, auto.created_by or "dev", auto,
                           log.input or {}, source=log.source,
                           trigger_id=log.trigger_id, retry_of=log)
    except ValueError as exc:
        raise HTTPException(_http_status_for_dispatch_error(exc), str(exc)) from exc
    return {"invocationId": new_log.id, "retryOfId": log.id,
            "attempt": new_log.attempt, "status": invocation_dto(new_log)["status"],
            "statusUrl": f"/api/v2/invocations/{new_log.id}"}


@router.get("/{aid}/invocations")
def list_invocations(aid: str, status: str = "", page: int = 1, pageSize: int = 50,
                     db: Session = Depends(get_db),
                     user: dict = Depends(require_role())):
    """F2：自动任务运行历史 = Invocation DTO（Spec §12.2）。"""
    q = db.query(AutomationTriggerLog).filter_by(automation_id=aid)
    if status:
        q = q.filter_by(status=status.lower())
    total = q.count()
    rows = (q.order_by(AutomationTriggerLog.created_at.desc())
            .offset((page - 1) * pageSize).limit(pageSize).all())
    return {"items": [invocation_dto(l) for l in rows],
            "total": total, "page": page, "pageSize": pageSize}


@router.post("/{aid}/api-keys")
def create_api_key(aid: str, db: Session = Depends(get_db), user: dict = Depends(require_operator)):
    _auto(db, aid)
    raw = f"mtc_{pysecrets.token_urlsafe(24)}"
    row = AutomationApiKey(
        automation_id=aid,
        key_hash=hashlib.sha256(raw.encode()).hexdigest(),
        label="default",
    )
    db.add(row)
    db.commit()
    return {"key": raw, "id": row.id}


@router.delete("/{aid}")
def delete_automation(aid: str, db: Session = Depends(get_db), user: dict = Depends(require_operator)):
    auto = _auto(db, aid)
    uid = user.get("username", "dev")
    if auto.runtime_schedule_id:
        try:
            rt.delete_schedule(uid, auto.runtime_schedule_id)
        except rt.RuntimeError_:
            pass
    db.query(AutomationTrigger).filter_by(automation_id=aid).delete()
    db.delete(auto)
    db.commit()
    return {"status": "deleted"}


# ---------------------------------------------------------------------------
# external API invoke (our own auth/idempotency; not atk_ style)
# ---------------------------------------------------------------------------

ext_router = APIRouter(prefix="/api/v2/external", tags=["external"])


@ext_router.post("/automations/{key_id}/invoke", status_code=202)
def invoke(
    key_id: str,
    request: Request,
    payload: dict[str, Any] = {},
    authorization: str = Header(default=""),
    idempotency_key: str = Header(default=""),
    db: Session = Depends(get_db),
):
    key_row = db.get(AutomationApiKey, key_id)
    if key_row is None or key_row.revoked_at:
        raise HTTPException(404, "key not found")
    token = authorization.removeprefix("Bearer ").strip()
    if not hmac.compare_digest(hashlib.sha256(token.encode()).hexdigest(), key_row.key_hash):
        raise HTTPException(401, "invalid key")
    auto = db.get(AutomationDefinition, key_row.automation_id)
    if auto is None:
        raise HTTPException(404, "automation not found")
    try:
        # F2：幂等/门禁/错误码统一在 dispatch（Spec §7.4）
        log = dispatch(db, auto.created_by or "dev", auto, payload, source="api",
                       idempotency_key=idempotency_key or None, trigger_id=key_id)
    except ValueError as exc:
        raise HTTPException(_http_status_for_dispatch_error(exc), str(exc)) from exc
    dto = invocation_dto(log)
    return {"status": dto["status"], "invocationId": log.id,
            "target": dto["target"], "statusUrl": f"/api/v2/invocations/{log.id}"}


# ---------------------------------------------------------------------------
# data ingress
# ---------------------------------------------------------------------------

ingress_router = APIRouter(prefix="/api/v2/data-sources", tags=["ingress"])


class SourceBody(BaseModel):
    name: str
    kind: str
    config: dict[str, Any] = {}
    secret: dict[str, Any] | str | None = None


class SourcePatchBody(BaseModel):
    """09-14 D3：数据源治理页编辑体（archived 只允许 false——归档走 DELETE）。"""
    name: str | None = None
    config: dict[str, Any] | None = None
    status: str | None = None
    archived: bool | None = None
    connection_id: str | None = None
    asset_id: str | None = None


@ingress_router.get("")
def list_sources(includeArchived: str = "", db: Session = Depends(get_db),
                 user: dict = Depends(require_role())):
    q = db.query(DataSource).order_by(DataSource.created_at.desc())
    if includeArchived != "yes":
        q = q.filter(DataSource.archived.is_(False))
    rows = q.all()
    return {
        "items": [
            {
                "id": s.id,
                "name": s.name,
                "kind": s.kind,
                "config": s.config,
                "status": s.status,
                "archived": bool(s.archived),
                "has_secret": bool(s.secret_ref),
                "cursor": s.cursor,
                "last_poll_at": s.last_poll_at.isoformat() if s.last_poll_at else None,
            }
            for s in rows
        ]
    }


def _validate_source_config(kind: str, config: dict,
                            connection_id: str | None = None) -> None:
    """09-14 类型体系：分类型必填校验（保存即拒，不留到拉取时才炸）。

    D5：connection_id 设置时 endpoint/project 由 Connection 承载，此处不重复要求。
    """
    from ..source_adapters import SOURCE_KINDS
    if kind not in SOURCE_KINDS:
        raise HTTPException(422, f"kind 只允许 {list(SOURCE_KINDS)}")
    if kind == "api_pull":
        url = str(config.get("url") or "")
        if not url.startswith(("http://", "https://")):
            raise HTTPException(422, "api_pull 源需要 config.url（http(s)）")
        from ..egress import enforce_egress
        enforce_egress(url)
    elif kind == "feishu_bitable":
        if not (config.get("app_token") and config.get("table_id")):
            raise HTTPException(422, "飞书多维表格源需要 config.app_token 与 config.table_id")
    elif kind == "maxcompute":
        if not (config.get("table") or config.get("sql")):
            raise HTTPException(422, "MaxCompute 源需要 config.table 或 config.sql")
        if not connection_id and not (config.get("endpoint") and config.get("project")):
            raise HTTPException(422, "MaxCompute 源需要 connection_id 或 config.endpoint/project")
        if config.get("sql") and not str(config["sql"]).strip().lower().startswith("select"):
            raise HTTPException(422, "config.sql 仅支持 SELECT（只读）")
    elif kind == "sls":
        if not config.get("logstore"):
            raise HTTPException(422, "SLS 源需要 config.logstore")
        if not connection_id and not (config.get("endpoint") and config.get("project")):
            raise HTTPException(422, "SLS 源需要 connection_id 或 config.endpoint/project")


@ingress_router.post("")
def create_source(body: SourceBody, db: Session = Depends(get_db), user: dict = Depends(require_operator)):
    _validate_source_config(body.kind, body.config)
    src = DataSource(name=body.name, kind=body.kind, config=body.config)
    if body.secret is not None:
        from ..secrets import encrypt_secret, serialize_secret
        src.secret_ref = encrypt_secret(serialize_secret(body.secret))
    if body.kind == "webhook":
        token = pysecrets.token_urlsafe(18)
        src.auth_token_hash = hashlib.sha256(token.encode()).hexdigest()
        db.add(src)
        db.commit()
        db.refresh(src)
        return {"id": src.id, "webhook_token": token}
    db.add(src)
    db.commit()
    db.refresh(src)
    return {"id": src.id}


@ingress_router.get("/health-summary")
def health_summary(db: Session = Depends(get_db),
                   user: dict = Depends(require_role())):
    """16 号稿 B1：概览带每源健康聚合（常数条查询，禁 N+1）。

    24h 窗=UTC 滚动（事件/投递落库即 utcnow）；deliveries24h.filtered 取
    filtered 事件数（filtered 不产生 delivery 行，F5 AC-023/024）；
    routeCount 仅计未归档路由。
    """
    since = datetime.now(timezone.utc) - timedelta(hours=24)
    sources = (db.query(DataSource)
               .filter(DataSource.archived.is_(False))
               .order_by(DataSource.created_at.desc()).all())
    sids = [s.id for s in sources] or ["-"]
    ev_total = dict(db.query(DataSourceEvent.source_id, func.count(DataSourceEvent.id))
                    .filter(DataSourceEvent.source_id.in_(sids),
                            DataSourceEvent.created_at >= since)
                    .group_by(DataSourceEvent.source_id).all())
    ev_filtered = dict(db.query(DataSourceEvent.source_id, func.count(DataSourceEvent.id))
                       .filter(DataSourceEvent.source_id.in_(sids),
                               DataSourceEvent.created_at >= since,
                               DataSourceEvent.status == "filtered")
                       .group_by(DataSourceEvent.source_id).all())
    dl_rows = (db.query(DataSourceEvent.source_id, EventDelivery.status,
                        func.count(EventDelivery.id))
               .join(DataSourceEvent, DataSourceEvent.id == EventDelivery.event_id)
               .filter(DataSourceEvent.source_id.in_(sids),
                       EventDelivery.created_at >= since)
               .group_by(DataSourceEvent.source_id, EventDelivery.status).all())
    rt_count = dict(db.query(EventRoute.source_id, func.count(EventRoute.id))
                    .filter(EventRoute.source_id.in_(sids),
                            EventRoute.archived.is_(False))
                    .group_by(EventRoute.source_id).all())
    deliveries: dict[str, dict[str, int]] = {}
    for sid_, status_, n in dl_rows:
        d = deliveries.setdefault(sid_, {"completed": 0, "failed": 0, "dead": 0, "filtered": 0})
        if status_ in d:
            d[status_] += n
    items = []
    for s in sources:
        d = deliveries.get(s.id, {"completed": 0, "failed": 0, "dead": 0, "filtered": 0})
        d = dict(d)
        d["filtered"] = int(ev_filtered.get(s.id, 0))
        items.append({
            "sourceId": s.id, "name": s.name, "kind": s.kind, "status": s.status,
            "lastPollAt": s.last_poll_at.isoformat() if s.last_poll_at else None,
            "lastPollOk": bool(s.last_poll_ok), "lastPollError": s.last_poll_error or "",
            "lastPollCount": int(s.last_poll_count or 0),
            "events24h": int(ev_total.get(s.id, 0)),
            "deliveries24h": d,
            "routeCount": int(rt_count.get(s.id, 0)),
        })
    return {"items": items}


@ingress_router.get("/{sid}")
def get_source(sid: str, db: Session = Depends(get_db),
               user: dict = Depends(require_role())):
    """09-14 D3：数据源治理页单源读取。"""
    src = db.get(DataSource, sid)
    if src is None:
        raise HTTPException(404, "source not found")
    return {"id": src.id, "name": src.name, "kind": src.kind,
            "config": src.config, "status": src.status,
            "archived": bool(src.archived), "cursor": src.cursor,
            "last_poll_at": src.last_poll_at.isoformat() if src.last_poll_at else None,
            "has_token": bool(src.auth_token_hash),
            "has_secret": bool(src.secret_ref),
            "connectionId": src.connection_id,
            "assetId": src.asset_id,
            "created_at": src.created_at.isoformat() if src.created_at else None}


@ingress_router.patch("/{sid}")
def patch_source(sid: str, body: SourcePatchBody, db: Session = Depends(get_db),
                 user: dict = Depends(require_operator)):
    """09-14 D3：数据源治理页编辑（名称/config/暂停恢复/解除归档）。"""
    src = db.get(DataSource, sid)
    if src is None:
        raise HTTPException(404, "source not found")
    # 归档源只读，唯一例外：archived=false 解除归档
    if src.archived and body.archived is not False:
        raise HTTPException(404, "source 已归档（仅允许 archived=false 解除归档）")
    if body.name is not None:
        if not body.name.strip():
            raise HTTPException(422, "名称不能为空")
        src.name = body.name.strip()
    if body.config is not None:
        cfg = dict(src.config or {})
        cfg.update(body.config)
        _validate_source_config(src.kind, cfg, connection_id=src.connection_id)
        src.config = cfg
    if body.connection_id is not None:
        src.connection_id = body.connection_id or None
    if body.asset_id is not None:
        src.asset_id = body.asset_id or None
    if body.status is not None:
        if body.status not in ("active", "paused"):
            raise HTTPException(422, "status 只允许 active|paused")
        src.status = body.status
    if body.archived is not None:
        if body.archived:
            raise HTTPException(422, "归档请走 DELETE（归档语义），PATCH 仅可解除归档")
        src.archived = False
    db.commit()
    db.refresh(src)
    return {"id": src.id, "name": src.name, "kind": src.kind,
            "config": src.config, "status": src.status,
            "archived": bool(src.archived)}


@ingress_router.delete("/{sid}")
def delete_source(sid: str, db: Session = Depends(get_db),
                  user: dict = Depends(require_operator)):
    """09-14 D3：删除=归档语义（不物理删，事件/路由流水可追溯）。

    被未归档路由 / legacy trigger / 历史事件引用时 409 并列引用清单。
    """
    src = db.get(DataSource, sid)
    if src is None:
        raise HTTPException(404, "source not found")
    refs: list[dict] = []
    n_routes = db.query(EventRoute).filter(
        EventRoute.source_id == sid, EventRoute.archived.is_(False)).count()
    if n_routes:
        refs.append({"kind": "event_route", "count": n_routes})
    n_trig = db.query(AutomationTrigger).filter(
        AutomationTrigger.kind.in_(("event", "polling")),
        AutomationTrigger.config["data_source_id"].as_string() == sid).count()
    if n_trig:
        refs.append({"kind": "automation_trigger", "count": n_trig})
    n_ev = db.query(DataSourceEvent).filter(DataSourceEvent.source_id == sid).count()
    if n_ev:
        refs.append({"kind": "event", "count": n_ev})
    if refs:
        raise HTTPException(409, {"code": "SOURCE_REFERENCED",
                                  "detail": "数据源被路由/触发器/事件引用，拒绝归档",
                                  "references": refs})
    src.archived = True
    src.status = "paused"
    db.commit()
    return {"id": sid, "archived": True}


@ingress_router.post("/{sid}/secret")
def set_source_secret(sid: str, body: dict[str, Any], db: Session = Depends(get_db),
                      user: dict = Depends(require_operator)):
    """09-14 类型体系：设置/更新非 webhook 类型凭据（加密存储，永不回显）。"""
    from ..secrets import encrypt_secret, serialize_secret
    src = db.get(DataSource, sid)
    if src is None or src.archived:
        raise HTTPException(404, "source not found")
    secret = body.get("secret")
    if isinstance(secret, dict) and secret.get("clear"):
        src.secret_ref = None
    elif secret in (None, ""):
        raise HTTPException(422, "secret 不能为空（清除请传 {\"clear\": true}）")
    else:
        src.secret_ref = encrypt_secret(serialize_secret(secret))
    db.commit()
    return {"id": sid, "has_secret": bool(src.secret_ref)}


@ingress_router.post("/{sid}/regenerate-token")
def regenerate_source_token(sid: str, db: Session = Depends(get_db),
                            user: dict = Depends(require_operator)):
    """09-14 D3：重新生成 webhook token——旧 token 即刻失效，新 token 仅返回一次。"""
    src = db.get(DataSource, sid)
    if src is None or src.kind != "webhook" or src.archived:
        raise HTTPException(404, "webhook source not found")
    token = pysecrets.token_urlsafe(18)
    src.auth_token_hash = hashlib.sha256(token.encode()).hexdigest()
    db.commit()
    return {"id": sid, "webhook_token": token,
            "note": "旧 token 即刻失效；新 token 仅显示一次，关闭后无法再查看"}


def _apply_filter(cfg: dict, payload: dict) -> bool:
    filt = cfg.get("filter") or {}
    if not filt:
        return True
    field, op, value = filt.get("field"), filt.get("op"), filt.get("value")
    cur: Any = payload
    for part in (field or "").split("."):
        if isinstance(cur, dict) and part in cur:
            cur = cur[part]
        else:
            return False
    if op == "eq":
        return cur == value
    if op == "ne":
        return cur != value
    if op == "contains":
        return str(value) in str(cur)
    if op == "gt":
        return cur > value
    if op == "lt":
        return cur < value
    # 09-13 审计修复：未知 op fail-closed（原 fail-open——拼写错误会把
    # 本应过滤的事件全部放行）；保存侧同步校验 op 枚举（event_routes）
    return False


def _apply_mapping(cfg: dict, payload: dict) -> dict:
    mapping = cfg.get("mapping") or {}
    out: dict[str, Any] = {}
    for key, path in mapping.items():
        cur: Any = payload
        ok = True
        for part in path.split("."):
            if isinstance(cur, dict) and part in cur:
                cur = cur[part]
            else:
                ok = False
                break
        out[key] = cur if ok else None
    return out or payload


def _expr_of(cfg: dict | None) -> dict:
    """EventRoute.filter 兼容两种形状：{version,expression:{…}} 或裸 {field,op,value}。"""
    cfg = cfg or {}
    if "expression" in cfg:
        return cfg.get("expression") or {}
    return {k: v for k, v in cfg.items() if k != "version"}


def _fields_of(cfg: dict | None) -> dict:
    """EventRoute.mapping 兼容 {version,fields:{k:path}} 或裸 {k:path}。"""
    cfg = cfg or {}
    if "fields" in cfg:
        return cfg.get("fields") or {}
    return {k: v for k, v in cfg.items() if k != "version"}


def _extract_path(payload: dict, path: str):
    cur: Any = payload
    for part in (path or "").split("."):
        if isinstance(cur, dict) and part in cur:
            cur = cur[part]
        else:
            return None
    return cur


def _dispatch_automation(db: Session, destination_id: str,
                         delivery: EventDelivery, mapped: dict) -> None:
    """EventRoute(automation) → 至多 1 Invocation（Spec §10.1 XOR 左支）。

    目标缺失/停用 = 不可重试错误（§13.1），直接 dead 并给出原因，不进退避循环。
    """
    auto = db.get(AutomationDefinition, destination_id)
    if auto is None:
        delivery.status = "dead"
        delivery.dead_reason = "TARGET_NOT_FOUND"
        return
    if not auto.enabled:
        delivery.status = "dead"
        delivery.dead_reason = "AUTOMATION_DISABLED"
        return
    lg = dispatch(db, auto.created_by or "dev", auto, mapped, source="event")
    delivery.trigger_log_id = lg.id
    delivery.invocation_id = lg.id
    if lg.status == "failed":
        delivery.attempts += 1
        delivery.status = "failed"
        delivery.error = lg.error or "dispatch returned failed"
        _schedule_retry(delivery)
    else:
        # accepted 策略：Invocation 受理即 completed；terminal：等 watcher 结算
        delivery.status = ("running" if delivery.completion_policy == "terminal"
                           else "completed")


def _dispatch_analysis_task(db: Session, destination_id: str,
                            delivery: EventDelivery,
                            event: DataSourceEvent) -> None:
    """EventRoute(analysis_task) → 至多 1 TaskRun（Spec §10.1 XOR 右支）。

    trigger="event"；TaskRun 保存 source_event_id/event_delivery_id 全链路引用；
    冻结 TaskVersion/DataSnapshot 等由 start_task_run 既有路径负责（含 SDD13 §18
    生产触发 target_table 门槛）。不创建无业务价值的 Invocation 包裹。
    """
    from ..models import AnalysisTask
    from ..task_runner import TaskStartError, start_task_run
    task = db.get(AnalysisTask, destination_id)
    if task is None:
        delivery.status = "dead"
        delivery.dead_reason = "TARGET_NOT_FOUND"
        return
    if task.status == "paused":
        delivery.status = "dead"
        delivery.dead_reason = "TASK_PAUSED（INV-10）"
        return
    try:
        tr, _res = start_task_run(db, destination_id, trigger="event",
                                  idempotency_key=f"event-delivery:{delivery.id}")
    except TaskStartError as exc:
        delivery.attempts += 1
        delivery.status = "failed"
        delivery.error = str(exc.args[0]) if exc.args else repr(exc)
        _schedule_retry(delivery)
        return
    tr.source_event_id = event.id
    tr.event_delivery_id = delivery.id
    db.add(tr)
    delivery.task_run_id = tr.id
    delivery.status = ("running" if delivery.completion_policy == "terminal"
                       else "completed")


def ingest(
    db: Session,
    src: DataSource,
    payload: dict,
    dedupe_key: str,
) -> DataSourceEvent:
    # P0-6: per-target delivery model — re-deliver pending/failed deliveries
    # for the same event instead of blindly filtering duplicates.
    existing = (
        db.query(DataSourceEvent)
        .filter_by(source_id=src.id, dedupe_key=dedupe_key)
        .first()
    )
    if existing:
        deliveries = (
            db.query(EventDelivery)
            .filter_by(event_id=existing.id)
            .all()
        )
        any_retried = False
        for d in deliveries:
            if d.status in ("pending", "failed") and d.attempts < d.max_attempts:
                d.attempts += 1
                d.status = "pending"
                d.next_retry_at = datetime.now(timezone.utc)
                any_retried = True
        if any_retried:
            existing.status = "received"  # re-open for retry
            db.commit()
            return existing
        existing.error = "duplicate"
        db.commit()
        return existing

    event = DataSourceEvent(
        source_id=src.id, dedupe_key=dedupe_key, payload=payload, status="received"
    )
    db.add(event)
    db.commit()
    db.refresh(event)

    # resolve matched triggers
    autos = (
        db.query(AutomationTrigger)
        .filter_by(kind="event", enabled=True)
        .all()
    )
    matched = [
        t for t in autos if (t.config or {}).get("data_source_id") == src.id
    ]

    deliveries: list[EventDelivery] = []
    for trig in matched:
        cfg = trig.config or {}
        eff_filter = cfg.get("filter") or (src.config or {}).get("filter")
        eff_mapping = cfg.get("mapping") or (src.config or {}).get("mapping")
        if not _apply_filter({"filter": eff_filter}, payload):
            continue
        mapped = _apply_mapping({"mapping": eff_mapping}, payload)
        auto = db.get(AutomationDefinition, trig.automation_id)
        if auto is None or not auto.enabled:
            continue
        delivery = EventDelivery(
            event_id=event.id,
            trigger_id=trig.id,
            automation_id=auto.id,
            source="event",
            status="pending",
            # F5：legacy trigger 派发同样落 §10.2.1 字段组（统一 DTO/retry 依赖）
            destination_kind="automation",
            destination_id=auto.id,
            completion_policy="accepted",
            mapped_input=mapped,
        )
        db.add(delivery)
        db.commit()
        db.refresh(delivery)
        try:
            lg = dispatch(
                db,
                auto.created_by or "dev",
                auto,
                mapped,
                source="event",
                trigger_id=trig.id,
            )
            delivery.trigger_log_id = lg.id
            delivery.invocation_id = lg.id
            if lg.status == "failed":
                delivery.attempts += 1
                delivery.status = "failed"
                delivery.error = lg.error or "dispatch returned failed"
                _schedule_retry(delivery)
            else:
                delivery.status = "completed"
        except Exception as exc:  # noqa: BLE001
            delivery.attempts += 1
            delivery.status = "failed"
            delivery.error = repr(exc)
            _schedule_retry(delivery)
        db.commit()
        deliveries.append(delivery)

    # F5（Spec §10.0/§10.1）：EventRoute 一等路由匹配——与 legacy trigger 并存，
    # 同一事件可命中多条显式 route（N delivery），一条 route 只有一个目的地（XOR）。
    outcomes: list[dict] = list(event.route_outcomes or [])
    p_type = str(payload.get("type") or payload.get("eventType") or "")
    routes = (db.query(EventRoute)
              .filter(EventRoute.source_id == src.id,
                      EventRoute.archived.is_(False))
              .all())
    for rt in routes:
        if rt.event_type and rt.event_type != p_type:
            continue  # 事件类型不匹配 = route 不适用（非 filtered 证据）
        if not rt.enabled:
            outcomes.append({"routeId": rt.id, "revision": rt.revision,
                             "result": "route_disabled"})
            continue
        if not _apply_filter({"filter": _expr_of(rt.filter)}, payload):
            outcomes.append({"routeId": rt.id, "revision": rt.revision,
                             "result": "filtered"})
            continue
        # route 级去重（dedupe.keyPath + windowSeconds，AC-024 证据）
        ded = rt.dedupe or {}
        scope = None
        if ded.get("keyPath"):
            key_val = _extract_path(payload, ded["keyPath"])
            if key_val is not None:
                scope = f"{rt.id}:{key_val}"[:160]
                window = int(ded.get("windowSeconds") or 86400)
                since = datetime.now(timezone.utc) - timedelta(seconds=window)
                dup = (db.query(EventDelivery)
                       .filter(EventDelivery.dedupe_scope == scope,
                               EventDelivery.created_at >= since)
                       .first())
                if dup:
                    outcomes.append({"routeId": rt.id, "revision": rt.revision,
                                     "result": "deduped", "deliveryId": dup.id})
                    continue
        mapped = _apply_mapping({"mapping": _fields_of(rt.mapping)}, payload)
        delivery = EventDelivery(
            event_id=event.id, source="event", status="pending",
            route_id=rt.id, route_revision=rt.revision,
            destination_kind=rt.destination_kind,
            destination_id=rt.destination_id,
            completion_policy=rt.completion_policy or "accepted",
            mapped_input=mapped, dedupe_scope=scope,
            max_attempts=int((rt.retry_policy or {}).get("maxAttempts") or 3),
        )
        db.add(delivery)
        db.commit()
        db.refresh(delivery)
        try:
            if rt.destination_kind == "analysis_task":
                _dispatch_analysis_task(db, rt.destination_id, delivery, event)
            else:
                _dispatch_automation(db, rt.destination_id, delivery, mapped)
        except Exception as exc:  # noqa: BLE001
            delivery.attempts += 1
            delivery.status = "failed"
            delivery.error = repr(exc)
            _schedule_retry(delivery)
        db.commit()
        deliveries.append(delivery)
        outcomes.append({
            "routeId": rt.id, "revision": rt.revision, "deliveryId": delivery.id,
            "result": {"completed": "delivered", "running": "delivered"}.get(
                delivery.status, delivery.status)})

    if outcomes:
        event.route_outcomes = outcomes

    # aggregate event status from deliveries
    if not deliveries:
        event.status = "filtered"
        results = {o.get("result") for o in outcomes}
        event.error = ("deduped" if results and results <= {"deduped", "filtered"}
                       and "deduped" in results
                       else "no matching triggers/routes")
    elif all(d.status == "dead" for d in deliveries):
        event.status = "dead"
        event.error = "all deliveries dead"
    elif any(d.status == "completed" for d in deliveries):
        # 09-13 审计修复（P2）：部分投递失败不再被 dispatched 掩盖——
        # 明细仍在 delivery 层，列表级状态如实标 partial_failed
        bad = [d for d in deliveries if d.status in ("failed", "dead")]
        event.status = "partial_failed" if bad else "dispatched"
        if bad:
            event.error = next((d.error or d.dead_reason for d in bad
                                if (d.error or d.dead_reason)), "partial deliveries failed")
        if deliveries:
            event.dispatch_ref = deliveries[0].id
    else:
        # honest observability: matched triggers whose dispatch FAILED are not
        # "filtered" — surface the failure (retries/dead-letter keep running)
        event.status = "failed"
        event.error = next(
            (d.error for d in deliveries if d.error), "all deliveries failed"
        )
    db.commit()
    return event


def _schedule_retry(delivery: EventDelivery) -> None:
    """Exponential backoff: 30s, 120s, 600s."""
    delays = {1: 30, 2: 120, 3: 600}
    delay = delays.get(delivery.attempts, 600) if delivery.attempts < delivery.max_attempts else 0
    if delay:
        # 09-13 审计修复：原实现先截到整分钟再加 delay——当前秒数 > delay 时
        # next_retry_at 落在过去，首次重试立即到期（退避失真）
        delivery.next_retry_at = datetime.now(timezone.utc) + timedelta(seconds=delay)
    else:
        delivery.status = "dead"
        delivery.dead_reason = (
            f"max_attempts ({delivery.max_attempts}) reached; last error: {delivery.error}"
        )
        delivery.next_retry_at = None


def _retry_dead_deliveries(db: Session) -> int:
    """Retry failed deliveries whose next_retry_at has arrived (called by watcher).

    F5：route 投递用创建时冻结的 mapped_input/destination 重发（XOR 分支，
    不随 route 编辑漂移）；legacy trigger 投递保留按 trigger config 重算的原逻辑。
    """
    now = datetime.now(timezone.utc)
    stale_cutoff = now - timedelta(minutes=10)
    due = (
        db.query(EventDelivery)
        .filter(
            or_(
                # 常规：failed 且退避到期
                and_(EventDelivery.status == "failed",
                     EventDelivery.next_retry_at.isnot(None),
                     EventDelivery.next_retry_at <= now),
                # F5：进程中断遗留的陈旧 pending（ingest 派发半途而废，
                # 永不进入退避轨道）——同样纳入到期重发
                and_(EventDelivery.status == "pending",
                     EventDelivery.updated_at <= stale_cutoff),
            ),
            EventDelivery.attempts < EventDelivery.max_attempts,
        )
        .all()
    )
    # 陈旧 pending 且重试额度耗尽 → dead（不再无限滞留，层3 审计可证）
    exhausted = (
        db.query(EventDelivery)
        .filter(EventDelivery.status == "pending",
                EventDelivery.updated_at <= stale_cutoff,
                EventDelivery.attempts >= EventDelivery.max_attempts)
        .all()
    )
    for d in exhausted:
        d.status = "dead"
        d.dead_reason = "stale pending, attempts exhausted"
    if exhausted:
        db.commit()
    retried = 0
    for d in due:
        if d.route_id:
            try:
                event = db.get(DataSourceEvent, d.event_id)
                if event is None:
                    d.status = "dead"
                    d.dead_reason = "event deleted"
                    db.commit()
                    continue
                if d.destination_kind == "analysis_task":
                    _dispatch_analysis_task(db, d.destination_id or "", d, event)
                else:
                    mapped = (d.mapped_input if d.mapped_input is not None
                              else event.payload or {})
                    _dispatch_automation(db, d.destination_id or "", d, mapped)
                # _dispatch_* 自管 attempts/failed 退避/dead；成功收尾清退避
                if d.status != "failed":
                    d.next_retry_at = None
                    d.error = ""
                db.commit()
                retried += 1
            except Exception as exc:  # noqa: BLE001
                d.attempts += 1
                d.status = "failed"
                d.error = repr(exc)
                _schedule_retry(d)
                db.commit()
                retried += 1  # 到期即计入"已重试"，结果以 delivery 状态为准
            continue
        try:
            auto = db.get(AutomationDefinition, d.automation_id)
            if auto is None or not auto.enabled:
                d.status = "dead"
                d.dead_reason = "automation deleted or disabled"
                db.commit()
                continue
            event = db.get(DataSourceEvent, d.event_id)
            if event is None:
                d.status = "dead"
                d.dead_reason = "event deleted"
                db.commit()
                continue
            trig = db.get(AutomationTrigger, d.trigger_id)
            cfg = (trig.config or {}) if trig else {}
            eff_mapping = cfg.get("mapping") or {}
            mapped = _apply_mapping({"mapping": eff_mapping}, event.payload or {})
            lg = dispatch(
                db,
                auto.created_by or "dev",
                auto,
                mapped,
                source="event",
                trigger_id=d.trigger_id,
            )
            d.attempts += 1
            d.trigger_log_id = lg.id
            if lg.status == "failed":
                d.status = "failed"
                d.error = lg.error or "dispatch returned failed"
                _schedule_retry(d)
            else:
                d.status = "completed"
                d.next_retry_at = None
            db.commit()
            retried += 1
        except Exception as exc:  # noqa: BLE001
            d.attempts += 1
            d.status = "failed"
            d.error = repr(exc)
            _schedule_retry(d)
            db.commit()
    return retried


def tick_pull_source(db: Session, src) -> dict:
    """拉取源单 tick（watcher 与手动端点共用）：分类型适配器分页拉取→ingest 管线。

    09-14 类型体系：api_pull / feishu_bitable / maxcompute 走 source_adapters；
    背压：单 tick 最多 5 页、页大小适配器内封顶 200；游标存 src.cursor。
    """
    from ..source_adapters import PULL_KINDS, SourceFetchError, fetch_page, row_dedupe_key

    if src.kind not in PULL_KINDS:
        raise HTTPException(409, f"类型 {src.kind} 为推送/测试型，不支持拉取")
    cfg = dict(src.config or {})
    secret_ref = src.secret_ref
    # D5：connection_id/asset_id 优先（凭据/端点/表目录归 Connection/DataAsset）
    if src.connection_id:
        conn = db.get(Connection, src.connection_id)
        if conn is None:
            raise HTTPException(409, "源引用的 Connection 已不存在")
        ep = conn.endpoint or {}
        cfg.setdefault("endpoint", ep.get("endpoint") or ep.get("base_url") or "")
        cfg.setdefault("project", ep.get("project") or "")
        secret_ref = conn.secret_ref or secret_ref
    if src.asset_id:
        asset = db.get(DataAsset, src.asset_id)
        if asset is None:
            raise HTTPException(409, "源引用的 DataAsset 已不存在")
        if src.kind == "sls":
            cfg.setdefault("logstore", asset.location or "")
        else:
            cfg.setdefault("table", asset.location or "")
    cursor = (src.cursor or {}).get("last")
    pages = 0
    polled = 0
    dispatched = 0
    while pages < 5:
        try:
            rows, next_cursor = fetch_page(src.kind, cfg, secret_ref, cursor)
        except SourceFetchError as exc:
            src.status = "error"
            # g061：失败留证（概览带 inline 展示），不再随 502 丢弃
            src.last_poll_ok = False
            src.last_poll_error = str(exc)[:500]
            db.commit()
            raise HTTPException(502, f"拉取失败：{exc}") from exc
        polled += len(rows)
        for row in rows:
            key = row_dedupe_key(row, cfg)
            ev = ingest(db, src, row, dedupe_key=f"{src.id}:{key}")
            if ev.status in ("dispatched", "partial_failed"):
                dispatched += 1
        pages += 1
        if not next_cursor:
            cursor = None
            break
        cursor = next_cursor
    src.cursor = {**(src.cursor or {}), "last": cursor} if cursor else (src.cursor or {})
    src.status = "active"
    src.last_poll_at = datetime.now(timezone.utc)
    # g061：成功清零留证
    src.last_poll_ok = True
    src.last_poll_error = ""
    src.last_poll_count = polled
    db.commit()
    return {"polled": polled, "dispatched": dispatched, "pages": pages,
            "cursor": cursor}


# 兼容旧名（watcher/测试既有引用）
tick_poll_source = tick_pull_source


@ingress_router.post("/{sid}/poll")
def poll_source(sid: str, db: Session = Depends(get_db), user: dict = Depends(require_operator)):
    src = db.get(DataSource, sid)
    if src is None or src.archived:
        raise HTTPException(404, "source not found")
    try:
        return tick_pull_source(db, src)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        src.status = "error"
        src.last_poll_ok = False
        src.last_poll_error = repr(exc)[:500]
        db.commit()
        raise HTTPException(502, f"poll failed: {exc!r}") from exc


@ingress_router.post("/{sid}/test-event")
def test_event(sid: str, payload: dict[str, Any], db: Session = Depends(get_db), user: dict = Depends(require_operator)):
    src = db.get(DataSource, sid)
    if src is None:
        raise HTTPException(404, "source not found")
    event = ingest(db, src, payload, dedupe_key=f"test-{pysecrets.token_hex(6)}")
    return {"event_id": event.id, "status": event.status, "dispatch_ref": event.dispatch_ref}


webhook_router = APIRouter(prefix="/api/v2/ingress", tags=["ingress"])

# 09-13 审计加固：请求体上限 + per-source 滑动窗口限速。
# 诚实边界：content-length 预检拦不住 chunked 无长度请求——网关级兜底属部署项；
# 限速为进程内存实现，多 worker/多实例须升级共享存储（归 EventBridge 切片）。
WEBHOOK_MAX_BYTES = 256 * 1024
WEBHOOK_RATE_WINDOW_S = 60.0
_webhook_hits: dict[str, list[float]] = {}


@webhook_router.post("/webhook/{sid}")
def webhook(
    sid: str,
    request: Request,
    payload: dict[str, Any] = {},
    x_source_token: str = Header(default=""),
    db: Session = Depends(get_db),
):
    src = db.get(DataSource, sid)
    if src is None or src.kind != "webhook":
        raise HTTPException(404, "source not found")
    if not src.auth_token_hash or not hmac.compare_digest(
        hashlib.sha256(x_source_token.encode()).hexdigest(), src.auth_token_hash
    ):
        raise HTTPException(401, "invalid source token")
    clen = request.headers.get("content-length")
    if clen and clen.isdigit() and int(clen) > WEBHOOK_MAX_BYTES:
        raise HTTPException(413, f"payload 超过上限 {WEBHOOK_MAX_BYTES // 1024}KB")
    limit = int((src.config or {}).get("rate_limit_per_min") or 60)
    now = time.monotonic()
    hits = [t for t in _webhook_hits.get(sid, [])
            if now - t < WEBHOOK_RATE_WINDOW_S]
    if len(hits) >= limit:
        _webhook_hits[sid] = hits
        raise HTTPException(429, f"source 限速 {limit} 次/分钟，请稍后重发")
    hits.append(now)
    _webhook_hits[sid] = hits
    dedupe = str(payload.get("id") or payload.get("eventId") or pysecrets.token_hex(8))
    event = ingest(db, src, payload, dedupe_key=dedupe)
    return {"status": "received", "event_id": event.id}
