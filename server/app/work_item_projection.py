"""MTC-002B-R：WorkItemProjection —— 统一任务读模型（只投影，不建表、不双写）。

对象关系：

    AutomationDefinition（analysis_task，自主任务定义）
              │  手动 / Schedule / API / Backfill
              ▼
    WorkItem（读模型，无表）←── TaskRun（一次批次） 或 未触发 ScheduleOccurrence（一次计划）
              │
              ▼
    Run（单条交互执行） → QualityResult / ResultDelivery

R 轮修正（MTC-002B-ACCEPTANCE P1-02/03/04）：
- 历史 TaskRun 的执行目标/assignee/has_target 一律读**冻结的** ``task_version_id``；
  仅未触发 occurrence 使用定义当前版本；
- ``started/firing`` 却无 TaskRun 的 occurrence 不再静默丢弃 → needs_action
  （code=OCCURRENCE_RUN_MISSING）；
- 可下推筛选（日期/automationId/origin/agentId/数据范围）放入 SQL；
  子 Run 聚合仅针对本次候选 TaskRun ID 集合；
- 默认排序改为时间倒序（时间切片分页），避免状态排序导致后置泳道整页消失。
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
_DELIVERY_PROCESSING = ("pending", "running", "retrying")
_DELIVERY_DONE = ("succeeded", "not_configured")
_DELIVERY_BAD = ("failed", "partial", "dead_letter")
#: occurrence 声称已触发/触发中但找不到 TaskRun = 调度断链
_BROKEN_OCC_STATUS = ("started", "firing")
ORIGINS = ("manual", "schedule", "api", "backfill", "unknown")


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
                                        "缺少自主任务或配置版本/执行目标，无法执行", "critical"),
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


def _build_item(tr: TaskRun | None, occ: ScheduleOccurrence | None,
                task: AnalysisTask | None, version: AnalysisTaskVersion | None,
                child_active: int, child_total: int) -> dict:
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
                        "name": version.agent_id, "avatarUrl": None}
        elif version.workflow_id:
            assignee = {"type": "workflow", "id": version.workflow_id,
                        "name": version.workflow_id, "avatarUrl": None}
    created_dt = tr.created_at if tr is not None else getattr(occ, "created_at", None)
    updated_dt = ((tr.ended_at or tr.started_at or tr.created_at) if tr is not None
                  else getattr(occ, "updated_at", None))
    task_id = (tr.task_id if tr is not None else (occ.task_id if occ is not None else None))
    return {
        "id": wid,
        "kind": "schedule_occurrence" if occ is not None else "task_run",
        "automationId": task_id or "",
        "taskRunId": tr.id if tr is not None else None,
        "scheduleOccurrenceId": occ.id if occ is not None else None,
        "title": task.name if task else "(缺失自主任务)",
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


def _resolve_names(db: Session, items: list[dict]) -> None:
    """批量回填 assignee 名称（agent/workflow），避免逐卡查询。"""
    agent_ids = {a["assignee"]["id"] for a in items
                 if a["assignee"] and a["assignee"]["type"] == "agent"}
    wf_ids = {a["assignee"]["id"] for a in items
              if a["assignee"] and a["assignee"]["type"] == "workflow"}
    if not agent_ids and not wf_ids:
        return
    agents = {a.id: a.name for a in db.execute(
        select(Agent).where(Agent.id.in_(agent_ids or {"-"}))).scalars().all()}
    wfs = {w.id: w.name for w in db.execute(
        select(Workflow).where(Workflow.id.in_(wf_ids or {"-"}))).scalars().all()}
    for a in items:
        if not a["assignee"]:
            continue
        if a["assignee"]["type"] == "agent":
            a["assignee"]["name"] = agents.get(a["assignee"]["id"], a["assignee"]["id"])
        else:
            a["assignee"]["name"] = wfs.get(a["assignee"]["id"], a["assignee"]["id"])


def build_work_items(db: Session, user: dict, *, date_from: str, date_to: str,
                     tz_s: str, automation_id: str = "", origin: str = "",
                     agent_id: str = "") -> list[dict]:
    """投影日期区间内全部 WorkItem。

    可下推筛选（automation_id/origin/agent_id/数据范围/日期）在 SQL 完成；
    status/attentionOnly/q 为投影后计算筛选（由路由层应用）。
    子 Run 聚合仅针对候选 TaskRun ID 集合（不扫全表）。
    """
    start, _ = day_bounds(date_from, tz_s)
    _, end = day_bounds(date_to, tz_s)

    occ_q = select(ScheduleOccurrence).where(
        ScheduleOccurrence.planned_at >= start, ScheduleOccurrence.planned_at < end)
    run_q = select(TaskRun).where(
        (TaskRun.created_at >= start) & (TaskRun.created_at < end)
        | (TaskRun.started_at >= start) & (TaskRun.started_at < end)
        | (TaskRun.started_at < start) & (TaskRun.status.in_(_ACTIVE_RUN_STATUS))
        | (TaskRun.ended_at >= start) & (TaskRun.ended_at < end))
    if automation_id:
        occ_q = occ_q.where(ScheduleOccurrence.task_id == automation_id)
        run_q = run_q.where(TaskRun.task_id == automation_id)
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
        tids = {r[0] for r in db.execute(
            select(AnalysisTask.id).where(
                AnalysisTask.current_version_id.in_(vids or {"-"}))).all()}
        occ_q = occ_q.where(ScheduleOccurrence.task_id.in_(tids or {"-"}))

    occs = db.execute(occ_q).scalars().all()
    runs = db.execute(run_q).scalars().all()
    runs_by_id = {r.id: r for r in runs}

    # occurrence 已关联但 run 不在窗口集合：补拉，避免丢卡
    missing = {o.task_run_id for o in occs if o.task_run_id} - set(runs_by_id)
    if missing:
        for r in db.execute(select(TaskRun).where(TaskRun.id.in_(missing))).scalars().all():
            runs_by_id[r.id] = r

    # 数据范围：按所属 AutomationDefinition 的 created_by 服务端过滤
    task_ids = {o.task_id for o in occs if o.task_id} | {r.task_id for r in runs_by_id.values()}
    tasks = {t.id: t for t in db.execute(
        select(AnalysisTask).where(AnalysisTask.id.in_(task_ids or {"-"}))).scalars().all()}
    members = data_scope_members(db, user)
    if members is not None:
        allowed = {tid for tid, t in tasks.items() if (t.created_by or "") in members}
        occs = [o for o in occs if (o.task_id or "") in allowed]
        runs_by_id = {rid: r for rid, r in runs_by_id.items() if r.task_id in allowed}
        tasks = {tid: t for tid, t in tasks.items() if tid in allowed}

    # 冻结版本优先：TaskRun 用 task_version_id；occurrence-only 用定义当前版本
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

    def _version_for(tr: TaskRun | None, task: AnalysisTask | None):
        if tr is not None:
            return versions.get(tr.task_version_id) if tr.task_version_id else None
        return versions.get(task.current_version_id) if task and task.current_version_id else None

    items: list[dict] = []
    seen_run_ids: set[str] = set()
    for occ in occs:
        tr = runs_by_id.get(occ.task_run_id) if occ.task_run_id else None
        if tr is None and occ.status in ("cancelled", "skipped"):
            continue  # 取消/跳过的空 occurrence 不投影（领域文档记录）
        task = tasks.get(occ.task_id or "")
        items.append(_build_item(tr, occ, task, _version_for(tr, task),
                                 active_counts.get(tr.id, 0) if tr else 0,
                                 child_totals.get(tr.id, 0) if tr else 0))
        if tr is not None:
            seen_run_ids.add(tr.id)
    for rid, tr in runs_by_id.items():
        if rid in seen_run_ids:
            continue
        items.append(_build_item(tr, None, tasks.get(tr.task_id), _version_for(tr, None),
                                 active_counts.get(rid, 0), child_totals.get(rid, 0)))
        seen_run_ids.add(rid)

    _resolve_names(db, items)
    # 时间倒序（时间切片分页）：避免状态排序使后置泳道整页消失
    items.sort(key=lambda w: (
        datetime.fromisoformat(w["scheduledAt"] or w["startedAt"] or w["createdAt"]
                               or "1970-01-01T00:00:00+00:00").timestamp(),
        w["id"]), reverse=True)
    return items


def project_single(db: Session, tr: TaskRun | None, occ: ScheduleOccurrence | None) -> dict | None:
    """单条投影（详情/by-task-runs 用）。cancelled/skipped 空 occurrence 返回 None（不投影）。"""
    if tr is None and occ is None:
        return None
    if tr is None and occ is not None and occ.status in ("cancelled", "skipped"):
        return None
    task_id = tr.task_id if tr is not None else (occ.task_id if occ is not None else None)
    task = db.get(AnalysisTask, task_id) if task_id else None
    version = None
    if tr is not None and tr.task_version_id:
        version = db.get(AnalysisTaskVersion, tr.task_version_id)
    elif tr is None and task is not None and task.current_version_id:
        version = db.get(AnalysisTaskVersion, task.current_version_id)
    child_active = child_total = 0
    if tr is not None:
        child_total = db.execute(select(func.count(Run.id)).where(
            Run.task_run_id == tr.id)).scalar() or 0
        child_active = db.execute(select(func.count(Run.id)).where(
            Run.task_run_id == tr.id, Run.status.in_(_ACTIVE_RUN_STATUS))).scalar() or 0
    item = _build_item(tr, occ, task, version, child_active, child_total)
    _resolve_names(db, [item])
    return item


def filter_work_items(items: list[dict], *, status: str = "", q: str = "",
                      attention_only: bool = False) -> list[dict]:
    """投影后计算筛选（status/attentionOnly/q）。automationId/origin/agentId 已下推 SQL。"""
    out = items
    if status:
        out = [w for w in out if w["status"] == status]
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
