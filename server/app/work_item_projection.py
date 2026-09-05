"""MTC-002B：WorkItemProjection —— 统一任务读模型（只投影，不建表、不双写）。

对象关系：

    AutomationDefinition（analysis_task）
              │ 手动 / Schedule / API / Backfill
              ▼
    WorkItem（读模型）←── TaskRun 或 未触发 ScheduleOccurrence
              │
              ▼
    Run → QualityResult / ResultDelivery

设计约束：
- 状态映射唯一入口 ``project_work_item_status``；路由/前端/看板组件禁止各自映射；
- Delivery 是结果处理的技术状态，不是一级工作状态（见 docs/product-domain/work-item-projection.md）；
- 关联对象（task/version/agent/workflow/活跃 Run 计数）一律批量加载，禁止逐卡查询；
- ID 稳定：手动/API/Backfill 的 TaskRun = ``taskrun:{id}``；
  ScheduleOccurrence 触发前后均为 ``occurrence:{id}``（触发后补 taskRunId）。
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .auth import data_scope_members
from .models import (Agent, AnalysisTask, AnalysisTaskVersion, Run,
                     ScheduleOccurrence, TaskRun, Workflow)

#: 用户可见主状态（固定五组，顺序即看板泳道顺序）
STATUS_ORDER = ("needs_action", "running", "completed", "queued", "failed_cancelled")

_KNOWN_RUN_STATUS = {"queued", "running", "partial", "succeeded", "failed", "cancelled"}
_ACTIVE_RUN_STATUS = ("queued", "running")
_TERMINAL_RUN_STATUS = ("succeeded", "failed", "cancelled", "partial")
_DELIVERY_PROCESSING = ("pending", "running", "retrying")
_DELIVERY_DONE = ("succeeded", "not_configured")
_DELIVERY_BAD = ("failed", "partial", "dead_letter")


def _attention(code: str, message: str, severity: str) -> dict:
    return {"required": True, "code": code, "message": message, "severity": severity}


def project_work_item_status(tr: TaskRun | None, occ: ScheduleOccurrence | None,
                             has_target: bool, child_active: int, child_total: int) -> dict:
    """集中状态映射。返回 {status, phase, attention, conflict_codes}。

    优先级：缺失关联 > 调度错过 > 未知状态 > 生命周期/执行-投递冲突 >
    排队 > 执行 > partial > 失败/取消 > succeeded×delivery 组合。
    矛盾数据一律 needs_action，禁止静默归入 completed。
    ``child_active/child_total`` 为子 Run 活跃数/总数（批量统计传入）。
    """
    conflicts: list[str] = []

    def _diag_conflict(code: str) -> None:
        conflicts.append(code)

    if not has_target:
        return {"status": "needs_action", "phase": "attention",
                "attention": _attention("MISSING_EXECUTION_TARGET",
                                        "缺少自主任务或配置版本/执行目标，无法执行", "critical"),
                "conflict_codes": ["MISSING_EXECUTION_TARGET"]}

    if tr is None:
        if occ is not None and occ.status == "missed":
            return {"status": "needs_action", "phase": "attention",
                    "attention": _attention("SCHEDULE_MISSED",
                                            (occ.error or {}).get("message", "计划时间已到但未触发批次"),
                                            "critical"),
                    "conflict_codes": ["SCHEDULE_MISSED"]}
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
        _diag_conflict("EXECUTION_DELIVERY_CONFLICT")
        return {"status": "needs_action", "phase": "attention",
                "attention": _attention("EXECUTION_DELIVERY_CONFLICT",
                                        "执行仍显示运行中，但结果已成功处理，状态矛盾，需人工确认",
                                        "critical"),
                "conflict_codes": conflicts}
    if tr.ended_at is not None and tr.status in _ACTIVE_RUN_STATUS:
        _diag_conflict("LIFECYCLE_CONFLICT")
        return {"status": "needs_action", "phase": "attention",
                "attention": _attention("LIFECYCLE_CONFLICT",
                                        "批次已有结束时间但状态仍为 queued/running，需人工确认",
                                        "critical"),
                "conflict_codes": conflicts}
    if tr.status == "running" and child_total > 0 and child_active == 0:
        _diag_conflict("RUNS_TERMINAL_TASKRUN_RUNNING")
        return {"status": "needs_action", "phase": "attention",
                "attention": _attention("RUNS_TERMINAL_TASKRUN_RUNNING",
                                        "所有子 Run 已终态但批次仍显示运行中，需人工确认",
                                        "critical"),
                "conflict_codes": conflicts}

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


def day_bounds(date_s: str, tz_s: str) -> tuple[datetime, datetime]:
    try:
        zone = ZoneInfo(tz_s)
    except Exception:  # noqa: BLE001
        zone = ZoneInfo("Asia/Shanghai")
    day = datetime.fromisoformat(date_s)
    start = day.replace(tzinfo=zone)
    return start.astimezone(timezone.utc), (start + timedelta(days=1)).astimezone(timezone.utc)


def _duration_ms(tr: TaskRun | None) -> int | None:
    if tr is None or tr.started_at is None:
        return None
    end = tr.ended_at or datetime.now(timezone.utc)
    return int((end - tr.started_at).total_seconds() * 1000)


def build_work_items(db: Session, user: dict, *, date_from: str, date_to: str,
                     tz_s: str) -> list[dict]:
    """投影当日（或日期区间）全部 WorkItem。批量加载关联，服务端数据范围过滤。"""
    start, _ = day_bounds(date_from, tz_s)
    _, end = day_bounds(date_to, tz_s)

    occs = db.execute(select(ScheduleOccurrence).where(
        ScheduleOccurrence.planned_at >= start,
        ScheduleOccurrence.planned_at < end)).scalars().all()
    runs = db.execute(select(TaskRun).where(
        (TaskRun.created_at >= start) & (TaskRun.created_at < end)
        | (TaskRun.started_at >= start) & (TaskRun.started_at < end)
        | (TaskRun.started_at < start) & (TaskRun.status.in_(_ACTIVE_RUN_STATUS))
        | (TaskRun.ended_at >= start) & (TaskRun.ended_at < end))).scalars().all()
    runs_by_id = {r.id: r for r in runs}

    # occurrence 已关联但 run 不在窗口集合：补拉，避免丢卡
    missing = {o.task_run_id for o in occs if o.task_run_id} - set(runs_by_id)
    if missing:
        for r in db.execute(select(TaskRun).where(TaskRun.id.in_(missing))).scalars().all():
            runs_by_id[r.id] = r

    # 数据范围：按所属 AutomationDefinition 的 created_by 过滤（服务端强制）
    task_ids = {o.task_id for o in occs if o.task_id} | {r.task_id for r in runs_by_id.values()}
    tasks = {t.id: t for t in db.execute(
        select(AnalysisTask).where(AnalysisTask.id.in_(task_ids or {"-"}))).scalars().all()}
    members = data_scope_members(db, user)
    if members is not None:
        allowed = {tid for tid, t in tasks.items() if (t.created_by or "") in members}
        occs = [o for o in occs if (o.task_id or "") in allowed]
        runs_by_id = {rid: r for rid, r in runs_by_id.items() if r.task_id in allowed}
        tasks = {tid: t for tid, t in tasks.items() if tid in allowed}

    # 批量：配置版本 / Agent / Workflow 名称 / 活跃子 Run 计数
    versions = {v.id: v for v in db.execute(select(AnalysisTaskVersion).where(
        AnalysisTaskVersion.id.in_(
            {t.current_version_id for t in tasks.values() if t.current_version_id}
            or {"-"}))).scalars().all()}
    agent_ids = {v.agent_id for v in versions.values() if v.execution_target_type == "agent" and v.agent_id}
    wf_ids = {v.workflow_id for v in versions.values() if v.execution_target_type == "workflow" and v.workflow_id}
    agents = {a.id: a.name for a in db.execute(
        select(Agent).where(Agent.id.in_(agent_ids or {"-"}))).scalars().all()}
    wfs = {w.id: w.name for w in db.execute(
        select(Workflow).where(Workflow.id.in_(wf_ids or {"-"}))).scalars().all()}
    active_counts = dict(db.execute(
        select(Run.task_run_id, func.count(Run.id)).where(
            Run.status.in_(_ACTIVE_RUN_STATUS)).group_by(Run.task_run_id)).all())
    child_totals = dict(db.execute(
        select(Run.task_run_id, func.count(Run.id)).group_by(Run.task_run_id)).all())

    occ_by_run = {o.task_run_id: o for o in occs if o.task_run_id}
    items: list[dict] = []
    seen_run_ids: set[str] = set()

    def _assignee(task: AnalysisTask | None) -> dict | None:
        v = versions.get(task.current_version_id) if task and task.current_version_id else None
        if v is None or task is None:
            return None
        if v.execution_target_type == "agent" and v.agent_id:
            return {"type": "agent", "id": v.agent_id,
                    "name": agents.get(v.agent_id, v.agent_id), "avatarUrl": None}
        if v.workflow_id:
            return {"type": "workflow", "id": v.workflow_id,
                    "name": wfs.get(v.workflow_id, v.workflow_id), "avatarUrl": None}
        return None

    def _make(tr: TaskRun | None, occ: ScheduleOccurrence | None, task: AnalysisTask | None) -> dict:
        has_target = bool(versions.get(task.current_version_id)) if task and task.current_version_id else False
        st = project_work_item_status(tr, occ, has_target,
                                      child_active=active_counts.get(tr.id, 0) if tr else 0,
                                      child_total=child_totals.get(tr.id, 0) if tr else 0)
        total = tr.total or 0 if tr else 0
        succeeded = tr.succeeded_count or 0 if tr else 0
        failed = tr.failed_count or 0 if tr else 0
        skipped = tr.skipped_count or 0 if tr else 0
        cancelled = tr.cancelled_count or 0 if tr else 0
        completed_n = succeeded + failed + skipped + cancelled
        if occ is not None and (tr is None or occ.id is not None):
            wid = f"occurrence:{occ.id}"
        else:
            wid = f"taskrun:{tr.id}"
        created_dt = tr.created_at if tr is not None else getattr(occ, "created_at", None)
        updated_dt = ((tr.ended_at or tr.started_at or tr.created_at) if tr is not None
                      else getattr(occ, "updated_at", None))
        return {
            "id": wid,
            "kind": "schedule_occurrence" if occ is not None else "task_run",
            "automationId": (tr.task_id if tr else occ.task_id) if (tr or occ) else "",
            "taskRunId": tr.id if tr is not None else None,
            "scheduleOccurrenceId": occ.id if occ is not None else None,
            "title": task.name if task else "(缺失自主任务)",
            "description": (task.description or None) if task else None,
            "status": st["status"],
            "phase": st["phase"],
            "origin": tr.trigger if tr is not None else "schedule",
            "assignee": _assignee(task),
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
                           else f"/autonomous-tasks/{occ.task_id if occ else ''}",
                "automation": f"/autonomous-tasks/{(tr.task_id if tr else occ.task_id) if (tr or occ) else ''}",
                "taskRun": f"/operations/task-runs/{tr.id}" if tr is not None else None,
            },
        }

    # 1) occurrence 卡（触发后沿用 occurrence ID 并补 taskRunId；去重见 seen_run_ids）
    for occ in occs:
        tr = runs_by_id.get(occ.task_run_id) if occ.task_run_id else None
        if tr is None and occ.status in ("cancelled", "skipped"):
            continue  # 取消/跳过的空 occurrence 不投影（领域文档记录）
        if tr is None and occ.status == "started":
            continue  # 关联中但 run 缺失的边界：以 run 卡呈现（若 run 存在）
        task = tasks.get(occ.task_id or "")
        items.append(_make(tr, occ, task))
        if tr is not None:
            seen_run_ids.add(tr.id)
    # 2) 无 occurrence 归属的 TaskRun 卡
    for rid, tr in runs_by_id.items():
        if rid in seen_run_ids or rid in occ_by_run:
            continue
        items.append(_make(tr, None, tasks.get(tr.task_id)))
        seen_run_ids.add(rid)

    items.sort(key=lambda w: (STATUS_ORDER.index(w["status"]),
                              -(datetime.fromisoformat(w["scheduledAt"] or w["startedAt"]
                                                       or w["createdAt"] or "1970-01-01T00:00:00+00:00")
                                .timestamp())))
    return items


def filter_work_items(items: list[dict], *, status: str = "", automation_id: str = "",
                      agent_id: str = "", q: str = "", origin: str = "",
                      attention_only: bool = False) -> list[dict]:
    out = items
    if status:
        out = [w for w in out if w["status"] == status]
    if automation_id:
        out = [w for w in out if w["automationId"] == automation_id]
    if agent_id:
        out = [w for w in out if (w["assignee"] or {}).get("id") == agent_id]
    if origin:
        out = [w for w in out if w["origin"] == origin]
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
