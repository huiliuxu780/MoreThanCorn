"""MTC-002B-R2：WorkItemProjection —— 统一任务读模型（只投影，不建表、不双写）。

对象关系：

    AnalysisTask（analysis_task，分析任务定义；F1 前旧称「自主任务」）
              │  手动 / Schedule / API / Backfill
              ▼
    WorkItem（读模型，无表）←── TaskRun（一次批次） 或 未触发 ScheduleOccurrence（一次计划）
              │
              ▼
    Run（单条交互执行） → QualityResult / ResultDelivery

R2 轮修正（MTC-002B-R2 指令）：
- P1-03 窗口规则：queued 以 created_at < 区间结束且仍 queued 纳入（保留期
  QUEUE_RETENTION_DAYS=7 天，见领域文档 §9）；running 以 started_at 或 created_at
  跨日纳入；终态仅按其 created/started/ended 落入区间显示；多日窗口不重复（行级唯一）。
- P1-02 agent 跨版本：已触发 occurrence 完全跟随关联 TaskRun 的冻结版本成员资格；
  未触发 occurrence 才按定义 current_version 筛选；删除“补拉绕过 agentId”的路径
  （关联 Run 行缺失的损坏 occurrence 才走 OCCURRENCE_RUN_MISSING）。
- P1-04 data scope 真下推：team 范围以 task_id IN (scope 子查询) 进入 occurrence/run SQL；
  by-task-runs 走真批量投影（常量级 SQL，顺序与输入一致）。
- P1-01 digest 复用投影输入事实集（_load_projection_inputs 的全部事实），1s TTL 共享缓存。
"""
from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .auth import data_scope_members
from .models import (Agent, AgentFlowNodeRun, AgentFlowRun, AgentSessionIndex,
                     AnalysisTask,
                     AnalysisTaskVersion, AutomationDefinition,
                     AutomationTriggerLog, Release, Run,
                     ScheduleOccurrence, TaskRun, Workflow)

#: 用户可见主状态（固定五组，顺序即看板泳道顺序）
STATUS_ORDER = ("needs_action", "running", "completed", "queued", "failed_cancelled")
# 09-07 任务工作台汇总带：聚合状态别名（ended = 已结束两态），单态筛选仍走 STATUS_ORDER
STATUS_ALIASES = {"ended": ("completed", "failed_cancelled")}

#: 长期 queued 的保留期（天）：超过该期限的 queued 批次不再进入当前看板（领域文档 §9）
QUEUE_RETENTION_DAYS = 7

_KNOWN_RUN_STATUS = {"queued", "running", "partial", "succeeded", "failed", "cancelled"}
_ACTIVE_RUN_STATUS = ("queued", "running")
_DELIVERY_PROCESSING = ("pending", "running", "retrying")
_DELIVERY_DONE = ("succeeded", "not_configured")
_DELIVERY_BAD = ("failed", "partial", "dead_letter")
#: occurrence 声称已触发/触发中但找不到 TaskRun = 调度断链
_BROKEN_OCC_STATUS = ("started", "firing")
ORIGINS = ("manual", "schedule", "api", "backfill", "unknown")


def _runtime_agent_of(db: Session, agent_id: str | None) -> str | None:
    if not agent_id:
        return None
    rel = (db.query(Release).filter_by(agent_id=agent_id, status="active")
           .order_by(Release.created_at.desc()).first())
    return (rel.runtime_binding_snapshot or {}).get("agentscope_agent_id") if rel else None


def _attention(code: str, message: str, severity: str) -> dict:
    return {"required": True, "code": code, "message": message, "severity": severity}


def project_work_item_status(tr: TaskRun | None, occ: ScheduleOccurrence | None,
                             has_target: bool, child_active: int, child_total: int) -> dict:
    """集中状态映射。返回 {status, phase, attention, conflict_codes}。

    优先级：缺失关联 > 调度断链/错过 > 未知状态 > 生命周期/执行-投递冲突 >
    排队 > 执行 > partial > 失败/取消 > succeeded×delivery 组合。
    矛盾数据一律 needs_action，禁止静默归入 completed。
    """
    conflicts: list[str] = []

    if not has_target:
        return {"status": "needs_action", "phase": "attention",
                "attention": _attention("MISSING_EXECUTION_TARGET",
                                        "缺少分析任务或配置版本/执行目标，无法执行", "critical"),
                "conflict_codes": ["MISSING_EXECUTION_TARGET"]}

    if tr is None:
        if occ is not None and occ.status == "missed":
            return {"status": "needs_action", "phase": "attention",
                    "attention": _attention("SCHEDULE_MISSED",
                                            (occ.error or {}).get("message", "计划时间已到但未触发批次"),
                                            "critical"),
                    "conflict_codes": ["SCHEDULE_MISSED"]}
        if occ is not None and occ.status in _BROKEN_OCC_STATUS:
            return {"status": "needs_action", "phase": "attention",
                    "attention": _attention("OCCURRENCE_RUN_MISSING",
                                            "调度已标记触发但批次记录缺失，需人工确认调度链路",
                                            "critical"),
                    "conflict_codes": ["OCCURRENCE_RUN_MISSING"]}
        # 未触发 occurrence → 排队中（不再单列“即将运行”泳道）
        return {"status": "queued", "phase": "scheduled", "attention": None,
                "conflict_codes": []}

    if tr.status not in _KNOWN_RUN_STATUS:
        return {"status": "needs_action", "phase": "attention",
                "attention": _attention("UNKNOWN_EXECUTION_STATUS",
                                        f"无法识别的执行状态：{tr.status}", "warning"),
                "conflict_codes": ["UNKNOWN_EXECUTION_STATUS"]}

    # 生命周期 / 执行-投递 冲突（先于一切终态判定）
    if tr.status == "running" and tr.delivery_status == "succeeded":
        return {"status": "needs_action", "phase": "attention",
                "attention": _attention("EXECUTION_DELIVERY_CONFLICT",
                                        "执行仍显示运行中，但结果已成功处理，状态矛盾，需人工确认",
                                        "critical"),
                "conflict_codes": ["EXECUTION_DELIVERY_CONFLICT"]}
    if tr.ended_at is not None and tr.status in _ACTIVE_RUN_STATUS:
        return {"status": "needs_action", "phase": "attention",
                "attention": _attention("LIFECYCLE_CONFLICT",
                                        "批次已有结束时间但状态仍为 queued/running，需人工确认",
                                        "critical"),
                "conflict_codes": ["LIFECYCLE_CONFLICT"]}
    if tr.status == "running" and child_total > 0 and child_active == 0:
        return {"status": "needs_action", "phase": "attention",
                "attention": _attention("RUNS_TERMINAL_TASKRUN_RUNNING",
                                        "所有子 Run 已终态但批次仍显示运行中，需人工确认",
                                        "critical"),
                "conflict_codes": ["RUNS_TERMINAL_TASKRUN_RUNNING"]}

    if tr.status == "queued":
        return {"status": "queued", "phase": "queued", "attention": None,
                "conflict_codes": conflicts}
    if tr.status == "running":
        return {"status": "running", "phase": "executing", "attention": None,
                "conflict_codes": conflicts}
    if tr.status == "partial":
        return {"status": "needs_action", "phase": "attention",
                "attention": _attention("EXECUTION_PARTIAL",
                                        f"批次部分成功（成功 {tr.succeeded_count} / 失败 {tr.failed_count}），需处理失败交互",
                                        "warning"),
                "conflict_codes": conflicts or ["EXECUTION_PARTIAL"]}
    if tr.status in ("failed", "cancelled"):
        return {"status": "failed_cancelled",
                "phase": "failed" if tr.status == "failed" else "cancelled",
                "attention": None, "conflict_codes": conflicts}

    # succeeded：delivery 只决定 phase 与异常，不产生一级投递状态
    if tr.delivery_status in _DELIVERY_PROCESSING:
        return {"status": "running", "phase": "result_processing", "attention": None,
                "conflict_codes": conflicts}
    if tr.delivery_status in _DELIVERY_DONE:
        return {"status": "completed", "phase": "done", "attention": None,
                "conflict_codes": conflicts}
    if tr.delivery_status in _DELIVERY_BAD:
        code = "DELIVERY_" + tr.delivery_status.upper()
        sev = "critical" if tr.delivery_status == "dead_letter" else "warning"
        msg = {"failed": "批次结果未能写出，需人工处理",
               "partial": "批次结果部分写出失败，需人工处理",
               "dead_letter": "存在无法写出的死信结果，需人工恢复"}.get(tr.delivery_status, "结果处理异常")
        return {"status": "needs_action", "phase": "attention",
                "attention": _attention(code, msg, sev),
                "conflict_codes": conflicts or [code]}
    return {"status": "needs_action", "phase": "attention",
            "attention": _attention("UNKNOWN_DELIVERY_STATUS",
                                    f"无法识别的结果处理状态：{tr.delivery_status}", "warning"),
            "conflict_codes": conflicts or ["UNKNOWN_DELIVERY_STATUS"]}


_DATE_RE = __import__("re").compile(r"^\d{4}-\d{2}-\d{2}$")


def parse_work_item_date_range(date_from: str, date_to: str, tz: str, default_date_fn):
    """MTC-002B-R3 P2：list 与 stream 共享的日期范围契约。

    规则：只接受 YYYY-MM-DD；非法/带时间字符串 422；无效 IANA 时区 422；
    dateFrom > dateTo 422；默认 dateTo = dateFrom。返回 (date_from, date_to, tz_s, start, end)。
    """
    from fastapi import HTTPException
    try:
        ZoneInfo(tz)
    except Exception:  # noqa: BLE001
        raise HTTPException(422, f"timezone 必须是有效 IANA 时区（收到：{tz}）")

    def _check(v: str, field: str) -> str:
        if not _DATE_RE.match(v):
            raise HTTPException(422, f"{field} 必须是 YYYY-MM-DD（收到：{v}）")
        try:
            datetime.fromisoformat(v)
        except ValueError:
            raise HTTPException(422, f"{field} 不是真实日期（收到：{v}）")
        return v

    d_from = _check(date_from, "dateFrom") if date_from else default_date_fn(tz)
    d_to = _check(date_to, "dateTo") if date_to else d_from
    if d_from > d_to:
        raise HTTPException(422, f"dateFrom 不能晚于 dateTo（{d_from} > {d_to}）")
    start, _ = day_bounds(d_from, tz)
    _, end = day_bounds(d_to, tz)
    return d_from, d_to, tz, start, end


def day_bounds(date_s: str, tz_s: str) -> tuple[datetime, datetime]:
    zone = ZoneInfo(tz_s)
    day = datetime.fromisoformat(date_s)
    start = day.replace(tzinfo=zone)
    return start.astimezone(timezone.utc), (start + timedelta(days=1)).astimezone(timezone.utc)


def _duration_ms(tr: TaskRun | None) -> int | None:
    if tr is None or tr.started_at is None:
        return None
    end = tr.ended_at or datetime.now(timezone.utc)
    return int((end - tr.started_at).total_seconds() * 1000)


def _window_run_clause(start: datetime, end: datetime):
    """P1-03：queued 看 created_at（保留期内）；running 跨日保留；终态按三个生命周期时间落窗。"""
    retention_start = end - timedelta(days=QUEUE_RETENTION_DAYS)
    queued = ((TaskRun.status == "queued") & (TaskRun.created_at < end)
              & (TaskRun.created_at >= retention_start))
    running = (TaskRun.status == "running") & (TaskRun.created_at < end)
    terminal = (TaskRun.status.notin_(("queued", "running"))) & (
        ((TaskRun.created_at >= start) & (TaskRun.created_at < end))
        | ((TaskRun.started_at >= start) & (TaskRun.started_at < end))
        | ((TaskRun.ended_at >= start) & (TaskRun.ended_at < end)))
    return queued | running | terminal


@dataclass
class ProjectionInputs:
    """投影与 digest 共用的批量事实集合（单一事实源）。"""
    occs: list
    runs_by_id: dict
    tasks: dict
    versions: dict
    active_counts: dict
    child_totals: dict
    agent_names: dict
    workflow_names: dict
    # F4（Spec §11.2）：新增来源（Invocation/手工 Session/手工 FlowRun/手工 WorkflowRun）
    invocations: list
    sessions: list
    flow_runs: list
    workflow_runs: list
    auto_names: dict
    session_status: dict
    flow_node_counts: dict
    known_targets: set


def _load_projection_inputs(db: Session, user: dict, start: datetime, end: datetime,
                            automation_id: str = "", origin: str = "",
                            agent_id: str = "") -> ProjectionInputs:
    occ_q = select(ScheduleOccurrence).where(
        ScheduleOccurrence.planned_at >= start, ScheduleOccurrence.planned_at < end)
    run_q = select(TaskRun).where(_window_run_clause(start, end))

    # P1-04A：data scope 真下推（子查询进入 occurrence/run SQL）
    members = data_scope_members(db, user)
    if members is not None:
        scope_ids = select(AnalysisTask.id).where(AnalysisTask.created_by.in_(members))
        occ_q = occ_q.where(ScheduleOccurrence.task_id.in_(scope_ids))
        run_q = run_q.where(TaskRun.task_id.in_(scope_ids))
    if automation_id:
        occ_q = occ_q.where(ScheduleOccurrence.task_id == automation_id)
        run_q = run_q.where(TaskRun.task_id == automation_id)
    vids: set[str] | None = None
    if origin:
        if origin == "schedule":
            run_q = run_q.where(TaskRun.trigger == "schedule")
        else:
            occ_q = occ_q.where(ScheduleOccurrence.id == "-")
            run_q = run_q.where(TaskRun.trigger == origin)
    if agent_id:
        vids = {r[0] for r in db.execute(
            select(AnalysisTaskVersion.id).where(
                AnalysisTaskVersion.agent_id == agent_id)).all()}
        run_q = run_q.where(TaskRun.task_version_id.in_(vids or {"-"}))
        # 未触发 occurrence 才按 current_version 的 agent 归属；已触发的跟随关联 Run（后置判定）
        tids_cur = {r[0] for r in db.execute(
            select(AnalysisTask.id).where(
                AnalysisTask.current_version_id.in_(vids or {"-"}))).all()}
        occ_q = occ_q.where(
            (ScheduleOccurrence.task_run_id.is_(None)
             & ScheduleOccurrence.task_id.in_(tids_cur or {"-"}))
            | ScheduleOccurrence.task_run_id.isnot(None))

    occs = list(db.execute(occ_q).scalars().all())
    runs_by_id = {r.id: r for r in db.execute(run_q).scalars().all()}

    # P1-02：已触发 occurrence 的成员资格完全由关联 Run 决定；
    # 关联 Run 行整体缺失（损坏）才保留为断链卡；Run 存在但被窗口/范围/agent 排除则 occ 一并排除。
    triggered_missing = {o.task_run_id for o in occs
                         if o.task_run_id and o.task_run_id not in runs_by_id}
    broken_run_ids: set[str] = set()
    if triggered_missing:
        broken_run_ids = triggered_missing - {r[0] for r in db.execute(
            select(TaskRun.id).where(TaskRun.id.in_(triggered_missing))).all()}
    occs = [o for o in occs
            if (not o.task_run_id) or (o.task_run_id in runs_by_id)
            or (o.task_run_id in broken_run_ids)]

    task_ids = {o.task_id for o in occs if o.task_id} | {r.task_id for r in runs_by_id.values()}
    tasks = {t.id: t for t in db.execute(
        select(AnalysisTask).where(AnalysisTask.id.in_(task_ids or {"-"}))).scalars().all()}

    version_ids = {r.task_version_id for r in runs_by_id.values() if r.task_version_id}
    version_ids |= {t.current_version_id for t in tasks.values() if t.current_version_id}
    versions = {v.id: v for v in db.execute(
        select(AnalysisTaskVersion).where(
            AnalysisTaskVersion.id.in_(version_ids or {"-"}))).scalars().all()}

    run_ids = set(runs_by_id)
    active_counts = dict(db.execute(
        select(Run.task_run_id, func.count(Run.id)).where(
            Run.task_run_id.in_(run_ids or {"-"}),
            Run.status.in_(_ACTIVE_RUN_STATUS)).group_by(Run.task_run_id)).all())
    child_totals = dict(db.execute(
        select(Run.task_run_id, func.count(Run.id)).where(
            Run.task_run_id.in_(run_ids or {"-"})).group_by(Run.task_run_id)).all())

    agent_ids = {v.agent_id for v in versions.values()
                 if v.execution_target_type == "agent" and v.agent_id}
    wf_ids = {v.workflow_id for v in versions.values()
              if v.execution_target_type == "workflow" and v.workflow_id}
    agent_names = {a.id: a.name for a in db.execute(
        select(Agent).where(Agent.id.in_(agent_ids or {"-"}))).scalars().all()}
    workflow_names = {w.id: w.name for w in db.execute(
        select(Workflow).where(Workflow.id.in_(wf_ids or {"-"}))).scalars().all()}

    # F4：Invocation（全部来源）+ 无 Invocation 的手工执行三源
    inv_q = select(AutomationTriggerLog).where(
        AutomationTriggerLog.created_at >= start,
        AutomationTriggerLog.created_at < end)
    ses_q = select(AgentSessionIndex).where(
        AgentSessionIndex.created_at >= start,
        AgentSessionIndex.created_at < end,
        AgentSessionIndex.trigger_log_id.is_(None),
        AgentSessionIndex.trigger_kind.in_(("manual", "chat")))
    flow_q = select(AgentFlowRun).where(
        AgentFlowRun.started_at >= start, AgentFlowRun.started_at < end,
        AgentFlowRun.automation_id.is_(None))
    wfr_q = select(Run).where(
        Run.created_at >= start, Run.created_at < end,
        Run.task_run_id.is_(None), Run.trigger != "batch")
    if members is not None:
        scope_auto = select(AutomationDefinition.id).where(
            AutomationDefinition.created_by.in_(members))
        inv_q = inv_q.where(AutomationTriggerLog.automation_id.in_(scope_auto))
        ses_q = ses_q.where(AgentSessionIndex.user_id.in_(members))
    if automation_id:
        inv_q = inv_q.where(AutomationTriggerLog.automation_id == automation_id)
        # 手工三源不隶属任何自动任务：automationId 筛选下整体排除
        ses_q = ses_q.where(AgentSessionIndex.id == "-")
        flow_q = flow_q.where(AgentFlowRun.id == "-")
        wfr_q = wfr_q.where(Run.id == "-")
    if agent_id:
        ses_q = ses_q.where(AgentSessionIndex.agent_id == agent_id)
        flow_q = flow_q.where(AgentFlowRun.id == "-")
        wfr_q = wfr_q.where(Run.id == "-")
    if origin:
        inv_q = inv_q.where(AutomationTriggerLog.source == origin)
        ses_q = ses_q.where(AgentSessionIndex.trigger_kind == origin)
    invocations = list(db.execute(inv_q).scalars().all())
    sessions = list(db.execute(ses_q).scalars().all())
    flow_runs = list(db.execute(flow_q).scalars().all())
    workflow_runs = list(db.execute(wfr_q).scalars().all())

    # AC-043：Invocation target 存在性（跨窗口批量查，禁止逐卡查询）
    t_session_ids = {i.target_ref for i in invocations
                     if i.target_kind == "agent_session" and i.target_ref}
    t_session_ids |= {i.session_id for i in invocations if i.session_id}
    t_flow_ids = {i.target_ref for i in invocations
                  if i.target_kind == "agentflow_run" and i.target_ref}
    t_flow_ids |= {i.agentflow_run_id for i in invocations if i.agentflow_run_id}
    known_targets: set[tuple[str, str]] = set()
    if t_session_ids:
        known_targets |= {("agent_session", r[0]) for r in db.execute(
            select(AgentSessionIndex.session_id).where(
                AgentSessionIndex.session_id.in_(t_session_ids))).all()}
    if t_flow_ids:
        known_targets |= {("agentflow_run", r[0]) for r in db.execute(
            select(AgentFlowRun.id).where(
                AgentFlowRun.id.in_(t_flow_ids))).all()}

    auto_ids = {i.automation_id for i in invocations if i.automation_id}
    auto_names = {a.id: a.name for a in db.execute(
        select(AutomationDefinition).where(
            AutomationDefinition.id.in_(auto_ids or {"-"}))).scalars().all()}
    # session 状态批量取（单次批调用，禁止逐卡查询，Spec §11.5）
    session_status: dict[str, str] = {}
    if sessions:
        try:
            from . import agentscope_client as _rt
            triples = [{"user_id": s.user_id,
                        "agent_id": s.runtime_agent_id or _runtime_agent_of(db, s.agent_id),
                        "session_id": s.session_id} for s in sessions]
            triples = [t for t in triples if t["agent_id"]]
            for row in _rt.sessions_status(user.get("username", "dev"), triples):
                session_status[row["session_id"]] = row.get("status") or "running"
        except Exception:  # noqa: BLE001 —— 运行时不可达：卡片标 needs_action+info
            session_status = {}
    flow_node_counts = list(db.execute(
        select(AgentFlowNodeRun.run_id, AgentFlowNodeRun.status, func.count(AgentFlowNodeRun.id))
        .where(AgentFlowNodeRun.run_id.in_({f.id for f in flow_runs} or {"-"}))
        .group_by(AgentFlowNodeRun.run_id, AgentFlowNodeRun.status)).all())

    return ProjectionInputs(occs=occs, runs_by_id=runs_by_id, tasks=tasks, versions=versions,
                            active_counts=active_counts, child_totals=child_totals,
                            agent_names=agent_names, workflow_names=workflow_names,
                            invocations=invocations, sessions=sessions,
                            flow_runs=flow_runs, workflow_runs=workflow_runs,
                            auto_names=auto_names, session_status=session_status,
                            flow_node_counts=flow_node_counts,
                            known_targets=known_targets)


def _build_item(tr: TaskRun | None, occ: ScheduleOccurrence | None,
                task: AnalysisTask | None, version: AnalysisTaskVersion | None,
                child_active: int, child_total: int,
                agent_names: dict | None = None, workflow_names: dict | None = None) -> dict:
    """单对 (tr, occ) → WorkItemDTO dict。version 语义：有 TaskRun 用冻结版本，否则当前版本。"""
    has_target = version is not None
    st = project_work_item_status(tr, occ, has_target, child_active, child_total)
    total = tr.total or 0 if tr else 0
    succeeded = tr.succeeded_count or 0 if tr else 0
    failed = tr.failed_count or 0 if tr else 0
    skipped = tr.skipped_count or 0 if tr else 0
    cancelled = tr.cancelled_count or 0 if tr else 0
    completed_n = succeeded + failed + skipped + cancelled
    if occ is not None:
        wid = f"occurrence:{occ.id}"
    else:
        wid = f"taskrun:{tr.id}"
    assignee = None
    if version is not None:
        if version.execution_target_type == "agent" and version.agent_id:
            assignee = {"type": "agent", "id": version.agent_id,
                        "name": (agent_names or {}).get(version.agent_id, version.agent_id),
                        "avatarUrl": None}
        elif version.workflow_id:
            assignee = {"type": "workflow", "id": version.workflow_id,
                        "name": (workflow_names or {}).get(version.workflow_id, version.workflow_id),
                        "avatarUrl": None}
    created_dt = tr.created_at if tr is not None else getattr(occ, "created_at", None)
    updated_dt = ((tr.ended_at or tr.started_at or tr.created_at) if tr is not None
                  else getattr(occ, "updated_at", None))
    task_id = (tr.task_id if tr is not None else (occ.task_id if occ is not None else None))
    return {
        "id": wid,
        "kind": "schedule_occurrence" if occ is not None else "analysis_batch",
        "automationId": task_id or "",
        "taskRunId": tr.id if tr is not None else None,
        "scheduleOccurrenceId": occ.id if occ is not None else None,
        "title": task.name if task else "(缺失分析任务)",
        "description": (task.description or None) if task else None,
        "status": st["status"],
        "phase": st["phase"],
        "origin": tr.trigger if tr is not None else "schedule",
        "assignee": assignee,
        "progress": {
            "total": total, "completed": completed_n, "succeeded": succeeded,
            "failed": failed, "skipped": skipped, "cancelled": cancelled,
            "percent": round(completed_n / total * 100, 1) if total else None,
        },
        "attention": st["attention"] or {"required": False, "code": None,
                                         "message": None, "severity": None},
        "scheduledAt": occ.planned_at.isoformat() if occ is not None else None,
        "createdAt": created_dt.isoformat() if created_dt else None,
        "updatedAt": updated_dt.isoformat() if updated_dt else None,
        "startedAt": tr.started_at.isoformat() if tr is not None and tr.started_at else None,
        "finishedAt": tr.ended_at.isoformat() if tr is not None and tr.ended_at else None,
        "durationMs": _duration_ms(tr),
        "diagnostics": {
            "executionStatus": tr.status if tr is not None else None,
            "deliveryStatus": tr.delivery_status if tr is not None else None,
            "occurrenceStatus": occ.status if occ is not None else None,
            "conflictCodes": st["conflict_codes"],
        },
        "links": {
            "primary": f"/operations/task-runs/{tr.id}" if tr is not None
                       else f"/autonomous-tasks/{task_id or ''}",
            "automation": f"/autonomous-tasks/{task_id or ''}",
            "taskRun": f"/operations/task-runs/{tr.id}" if tr is not None else None,
        },
    }


_UNIFIED_QUEUED = ("received", "accepted", "queued", "planned", "pending")
_UNIFIED_RUNNING = ("running", "cancelling", "result_processing")
_UNIFIED_DONE = ("succeeded", "completed", "done")
_UNIFIED_BAD = ("failed", "cancelled", "timed_out", "dead", "timeout")


def _unified_status(raw: str, extra_bad: bool = False) -> str:
    """Spec §11.3：原始状态 → 产品一级状态；关系损坏/投递失败优先 needs_action。"""
    if extra_bad:
        return "needs_action"
    r = (raw or "").lower()
    if r in _UNIFIED_QUEUED:
        return "queued"
    if r in _UNIFIED_RUNNING:
        return "running"
    if r in _UNIFIED_DONE:
        return "needs_action" if extra_bad else "completed"
    if r == "partial" or extra_bad:
        return "needs_action"
    if r in _UNIFIED_BAD:
        return "failed_cancelled"
    return "queued"


def _target_of_inv(log) -> tuple[str | None, str | None]:
    if log.target_kind and log.target_ref:
        return log.target_kind, log.target_ref
    if log.session_id:
        return "agent_session", log.session_id
    if log.agentflow_run_id:
        return "agentflow_run", log.agentflow_run_id
    if log.workflow_run_id:
        return "workflow_run", log.workflow_run_id
    return None, None


def _exec_item(kind: str, wid: str, title: str, raw_status: str, origin: str,
               started, ended, target, detail_link: str, extra_bad: bool = False,
               progress=None, counts=None, attention=None, phase=None,
               diagnostics=None) -> dict:
    return {
        "id": wid,
        "kind": kind,
        "title": title,
        "status": _unified_status(raw_status, extra_bad),
        "phase": phase or (raw_status or ""),
        "rawStatus": raw_status,
        "origin": origin,
        "startedAt": started.isoformat() if started else None,
        "endedAt": ended.isoformat() if ended else None,
        "durationMs": int(((ended - started).total_seconds()) * 1000)
        if started and ended else None,
        "target": {"kind": target[0], "id": target[1]} if target and target[0] else None,
        "progress": progress,
        "counts": counts,
        "attention": attention or {"required": bool(extra_bad), "severity": "info",
                                   "code": None, "message": None},
        "diagnostics": diagnostics,
        "links": {"detail": f"/tasks/{wid}",
                  "target": f"/{target[0]}/{target[1]}" if target and target[0] else None},
        "automationId": "", "taskRunId": None, "scheduleOccurrenceId": None,
        "assignee": None, "scheduledAt": None, "createdAt":
        started.isoformat() if started else None,
    }


def _items_from_inputs(inp: ProjectionInputs) -> list[dict]:
    items: list[dict] = []
    seen_run_ids: set[str] = set()
    for occ in inp.occs:
        tr = inp.runs_by_id.get(occ.task_run_id) if occ.task_run_id else None
        if tr is None and occ.status in ("cancelled", "skipped"):
            continue  # 取消/跳过的空 occurrence 不投影（领域文档记录）
        task = inp.tasks.get(occ.task_id or "")
        version = (inp.versions.get(tr.task_version_id) if tr is not None and tr.task_version_id
                   else (inp.versions.get(task.current_version_id)
                         if task is not None and task.current_version_id else None))
        items.append(_build_item(tr, occ, task, version,
                                 inp.active_counts.get(tr.id, 0) if tr else 0,
                                 inp.child_totals.get(tr.id, 0) if tr else 0,
                                 inp.agent_names, inp.workflow_names))
        if tr is not None:
            seen_run_ids.add(tr.id)
    for rid, tr in inp.runs_by_id.items():
        if rid in seen_run_ids:
            continue
        task = inp.tasks.get(tr.task_id)
        version = inp.versions.get(tr.task_version_id) if tr.task_version_id else None
        items.append(_build_item(tr, None, task, version,
                                 inp.active_counts.get(rid, 0), inp.child_totals.get(rid, 0),
                                 inp.agent_names, inp.workflow_names))
        seen_run_ids.add(rid)

    # F4（Spec §11.2）：Invocation 卡片 + target 去重；手工三源直接投影
    referenced: set[tuple[str, str]] = set()
    for log in inp.invocations:
        tk, ref = _target_of_inv(log)
        if tk and ref:
            referenced.add((tk, ref))
    known_targets = set(inp.known_targets)
    known_targets |= {("agent_session", s.session_id) for s in inp.sessions}
    known_targets |= {("agentflow_run", f.id) for f in inp.flow_runs}
    known_targets |= {("workflow_run", r.id) for r in inp.workflow_runs}
    for log in inp.invocations:
        if (log.status or "") == "deduped":
            continue
        tk, ref = _target_of_inv(log)
        extra_bad = tk is None and log.status in ("running", "accepted", "queued")
        # AC-043：关系缺失（target 引用指向不存在的执行体）→ needs_action
        if tk and ref and (tk, ref) not in known_targets:
            extra_bad = True
        att = None
        if extra_bad:
            att = _attention("TARGET_EXECUTION_MISSING",
                             "Invocation 目标执行体缺失或关系损坏", "warning")
        items.append(_exec_item(
            "automation_invocation", f"invocation:{log.id}",
            inp.auto_names.get(log.automation_id or "", "(缺失自动任务)"),
            log.status or "received", log.source or "manual",
            log.started_at or log.created_at, log.ended_at,
            (tk, ref) if tk else None,
            f"/tasks/invocation:{log.id}",
            extra_bad=extra_bad, attention=att))
    for s in inp.sessions:
        if ("agent_session", s.session_id) in referenced:
            continue
        raw = inp.session_status.get(s.session_id)
        att = None
        if raw is None:
            raw, att = "running", _attention(
                "RUNTIME_UNREACHABLE", "运行时不可达，Session 状态未知", "info")
        items.append(_exec_item(
            "agent_session", f"session:{s.session_id}",
            f"会话 {s.session_id[:8]}", raw, s.trigger_kind or "manual",
            s.created_at, None, ("agent_session", s.session_id),
            f"/agents/{s.agent_id}/chat?session={s.session_id}",
            attention=att, phase=raw))
    flow_nodes: dict[str, dict] = {}
    for run_id, status, cnt in inp.flow_node_counts:
        agg = flow_nodes.setdefault(run_id, {"total": 0, "done": 0})
        agg["total"] += cnt
        if status in ("succeeded", "failed", "cancelled"):
            agg["done"] += cnt
    for f in inp.flow_runs:
        if ("agentflow_run", f.id) in referenced:
            continue
        agg = flow_nodes.get(f.id, {"total": 0, "done": 0})
        items.append(_exec_item(
            "agentflow_run", f"agentflow:{f.id}", f"AgentFlow {f.id[:8]}",
            f.status or "queued", f.trigger_kind or "manual",
            f.started_at, f.ended_at, ("agentflow_run", f.id),
            f"/agentflows/runs/{f.id}",
            progress={"processed": agg["done"], "total": agg["total"],
                      "percent": int(agg["done"] * 100 / agg["total"])
                      if agg["total"] else None},
            counts=agg, phase=f.status))
    for r in inp.workflow_runs:
        if ("workflow_run", r.id) in referenced:
            continue
        items.append(_exec_item(
            "workflow_run", f"workflow:{r.id}", f"Workflow {r.id[:8]}",
            r.status or "queued", r.trigger or "manual",
            r.started_at or r.created_at, r.ended_at,
            ("workflow_run", r.id), f"/operations/runs/{r.id}", phase=r.status))
    # 时间倒序（时间切片分页）：避免状态排序使后置泳道整页消失
    items.sort(key=lambda w: (
        datetime.fromisoformat(w["scheduledAt"] or w["startedAt"] or w["createdAt"]
                               or "1970-01-01T00:00:00+00:00").timestamp(),
        w["id"]), reverse=True)
    return items


def build_work_items(db: Session, user: dict, *, date_from: str, date_to: str,
                     tz_s: str, automation_id: str = "", origin: str = "",
                     agent_id: str = "") -> list[dict]:
    start, _ = day_bounds(date_from, tz_s)
    _, end = day_bounds(date_to, tz_s)
    inp = _load_projection_inputs(db, user, start, end, automation_id, origin, agent_id)
    return _items_from_inputs(inp)


def project_batch(db: Session, user: dict, run_ids: list[str]) -> list[dict]:
    """P1-04：真批量投影（常量级 SQL）。返回顺序与 run_ids 输入顺序一致；
    不存在或跨团队 ID 静默跳过（列表语义）。"""
    if not run_ids:
        return []
    runs = {r.id: r for r in db.execute(
        select(TaskRun).where(TaskRun.id.in_(run_ids))).scalars().all()}
    task_ids = {r.task_id for r in runs.values()}
    tasks = {t.id: t for t in db.execute(
        select(AnalysisTask).where(AnalysisTask.id.in_(task_ids or {"-"}))).scalars().all()}
    members = data_scope_members(db, user)
    version_ids = {r.task_version_id for r in runs.values() if r.task_version_id}
    versions = {v.id: v for v in db.execute(
        select(AnalysisTaskVersion).where(
            AnalysisTaskVersion.id.in_(version_ids or {"-"}))).scalars().all()}
    active_counts = dict(db.execute(
        select(Run.task_run_id, func.count(Run.id)).where(
            Run.task_run_id.in_(set(run_ids)),
            Run.status.in_(_ACTIVE_RUN_STATUS)).group_by(Run.task_run_id)).all())
    child_totals = dict(db.execute(
        select(Run.task_run_id, func.count(Run.id)).where(
            Run.task_run_id.in_(set(run_ids))).group_by(Run.task_run_id)).all())
    agent_ids = {v.agent_id for v in versions.values()
                 if v.execution_target_type == "agent" and v.agent_id}
    wf_ids = {v.workflow_id for v in versions.values()
              if v.execution_target_type == "workflow" and v.workflow_id}
    agent_names = {a.id: a.name for a in db.execute(
        select(Agent).where(Agent.id.in_(agent_ids or {"-"}))).scalars().all()}
    workflow_names = {w.id: w.name for w in db.execute(
        select(Workflow).where(Workflow.id.in_(wf_ids or {"-"}))).scalars().all()}

    out: list[dict] = []
    for rid in run_ids:
        tr = runs.get(rid)
        if tr is None:
            continue
        task = tasks.get(tr.task_id)
        if task is None:
            continue
        if members is not None and (task.created_by or "") not in members:
            continue
        version = versions.get(tr.task_version_id) if tr.task_version_id else None
        out.append(_build_item(tr, None, task, version,
                               active_counts.get(rid, 0), child_totals.get(rid, 0),
                               agent_names, workflow_names))
    return out


def project_single(db: Session, tr: TaskRun | None, occ: ScheduleOccurrence | None) -> dict | None:
    """单条投影（详情用）。cancelled/skipped 空 occurrence 返回 None（不投影）。"""
    if tr is None and occ is None:
        return None
    if tr is None and occ is not None and occ.status in ("cancelled", "skipped"):
        return None
    if tr is not None:
        batch = project_batch(db, {"role": "admin", "username": "system", "data_scope": "all"},
                              [tr.id])
        return batch[0] if batch else None
    task_id = occ.task_id
    task = db.get(AnalysisTask, task_id) if task_id else None
    version = db.get(AnalysisTaskVersion, task.current_version_id) \
        if task is not None and task.current_version_id else None
    agent_names: dict = {}
    workflow_names: dict = {}
    if version is not None:
        if version.execution_target_type == "agent" and version.agent_id:
            a = db.get(Agent, version.agent_id)
            agent_names = {version.agent_id: a.name if a else version.agent_id}
        elif version.workflow_id:
            w = db.get(Workflow, version.workflow_id)
            workflow_names = {version.workflow_id: w.name if w else version.workflow_id}
    item = _build_item(None, occ, task, version, 0, 0, agent_names, workflow_names)
    return item


def filter_work_items(items: list[dict], *, status: str = "", q: str = "",
                      attention_only: bool = False, kind: str = "") -> list[dict]:
    """投影后计算筛选（status/kind/attentionOnly/q）。automationId/origin/agentId/scope 已下推 SQL。"""
    out = items
    if kind:
        kinds = set(kind.split(","))
        if "task_run" in kinds:  # 旧 kind 别名
            kinds.add("analysis_batch")
        out = [w for w in out if w["kind"] in kinds]
    if status:
        allowed = STATUS_ALIASES.get(status, (status,))
        out = [w for w in out if w["status"] in allowed]
    if attention_only:
        out = [w for w in out if w["attention"]["required"]]
    if q:
        ql = q.lower()
        out = [w for w in out if ql in (w["title"] or "").lower()
               or ql in (w["taskRunId"] or "").lower()
               or ql in (w["id"] or "").lower()]
    return out


def count_by_status(items: list[dict]) -> dict:
    counts = {s: 0 for s in STATUS_ORDER}
    for w in items:
        counts[w["status"]] = counts.get(w["status"], 0) + 1
    return counts


# ---------- P1-01：digest 复用投影事实集 + 1s TTL 共享缓存 ----------

_DIGEST_CACHE: dict[tuple, tuple[float, str]] = {}
DIGEST_CACHE_TTL = 1.0


def _facts_digest(inp: ProjectionInputs) -> str:
    """对投影所依赖的全部批量事实取摘要：任何影响 WorkItem 可见 DTO 的字段变化都会改变 digest。"""
    facts: list[tuple] = []
    for r in inp.runs_by_id.values():
        facts.append(("run", r.id, r.status, r.delivery_status, r.total, r.succeeded_count,
                      r.failed_count, r.skipped_count, r.cancelled_count,
                      r.started_at.isoformat() if r.started_at else None,
                      r.ended_at.isoformat() if r.ended_at else None,
                      r.created_at.isoformat() if r.created_at else None,
                      r.task_version_id, r.task_id))
    for o in inp.occs:
        facts.append(("occ", o.id, o.status, o.task_run_id,
                      o.planned_at.isoformat() if o.planned_at else None,
                      json.dumps(o.error, sort_keys=True, default=str) if o.error else None))
    for t in inp.tasks.values():
        facts.append(("task", t.id, t.name, t.description, t.created_by, t.current_version_id))
    for i in inp.invocations:
        facts.append(("inv", i.id, i.status, i.target_kind, i.target_ref,
                      i.created_at.isoformat() if i.created_at else None))
    for s in inp.sessions:
        facts.append(("ses", s.session_id, s.trigger_kind,
                      inp.session_status.get(s.session_id),
                      s.created_at.isoformat() if s.created_at else None))
    for f in inp.flow_runs:
        facts.append(("afr", f.id, f.status,
                      f.started_at.isoformat() if f.started_at else None,
                      f.ended_at.isoformat() if f.ended_at else None))
    for r in inp.workflow_runs:
        facts.append(("wfr", r.id, r.status,
                      r.created_at.isoformat() if r.created_at else None))
    for v in inp.versions.values():
        facts.append(("ver", v.id, v.execution_target_type, v.agent_id, v.workflow_id))
    for k, v in inp.active_counts.items():
        facts.append(("act", k, v))
    for k, v in inp.child_totals.items():
        facts.append(("tot", k, v))
    for k, v in inp.agent_names.items():
        facts.append(("ag", k, v))
    for k, v in inp.workflow_names.items():
        facts.append(("wf", k, v))
    payload = json.dumps(sorted(map(list, facts)), sort_keys=True, default=str)
    return hashlib.sha256(payload.encode()).hexdigest()


def compute_stream_digest(db: Session, user: dict, date_from: str, date_to: str,
                          tz_s: str, use_cache: bool = True) -> str:
    start, _ = day_bounds(date_from, tz_s)
    _, end = day_bounds(date_to, tz_s)
    members = data_scope_members(db, user)
    scope_key = "all" if members is None else hashlib.sha256(
        json.dumps(sorted(members)).encode()).hexdigest()[:16]
    key = (scope_key, start.isoformat(), end.isoformat(), tz_s)
    if use_cache:
        hit = _DIGEST_CACHE.get(key)
        if hit and (time.monotonic() - hit[0]) < DIGEST_CACHE_TTL:
            return hit[1]
    inp = _load_projection_inputs(db, user, start, end)
    digest = _facts_digest(inp)
    _DIGEST_CACHE[key] = (time.monotonic(), digest)
    return digest
