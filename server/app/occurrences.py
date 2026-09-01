"""SDD 13 §4.6：ScheduleOccurrence 滚动物化 / 触发关联 / missed 判定。

- 调度器维护滚动 48 小时窗口：按 Schedule 与业务时区预生成 occurrence；
- UNIQUE(schedule_id, planned_at) 防重复计划；
- 到点以 fire_key 幂等创建 TaskRun 并回填 task_run_id（status=started）；
- 超宽限（默认 5 分钟）仍无 TaskRun → missed；
- Schedule 停用后未触发 → cancelled（不静默删除）；
- manual/backfill/API TaskRun 不要求 occurrence，但仍进今日看板。
前端不得仅凭当前 cron 推算历史计划。"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from croniter import croniter
from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Schedule, ScheduleOccurrence, TaskRun, new_id

HORIZON_HOURS = 48
MISS_GRACE_MINUTES = 5


def fire_key_for(schedule_id: str, planned_at: datetime) -> str:
    """与 runner.schedule_tick 的 schedule_fire_key 同构（{schedule_id}:{iso}）。

    统一归一 UTC isoformat：PG timestamptz 回读时区随进程 TZ 变化，
    不归一会导致同一时刻的 fire_key 字符串不一致。"""
    return f"{schedule_id}:{planned_at.astimezone(timezone.utc).isoformat()}"


def materialize_occurrences(db: Session, now: datetime | None = None) -> int:
    """滚动预生成未来 48h 的 planned occurrence；停用 Schedule 的未触发项 cancelled。"""
    now = now or datetime.now(timezone.utc)
    horizon = now + timedelta(hours=HORIZON_HOURS)
    created = cancelled = 0
    schedules = db.execute(select(Schedule)).scalars().all()
    for sch in schedules:
        if not sch.task_id:
            continue
        if not sch.enabled:
            for occ in db.execute(select(ScheduleOccurrence).where(
                    ScheduleOccurrence.schedule_id == sch.id,
                    ScheduleOccurrence.status == "planned")).scalars().all():
                occ.status = "cancelled"
                occ.error = {"code": "SCHEDULE_DISABLED", "message": "Schedule 已停用，未触发计划项取消"}
                cancelled += 1
            continue
        last_planned = db.execute(
            select(ScheduleOccurrence.planned_at)
            .where(ScheduleOccurrence.schedule_id == sch.id)
            .order_by(ScheduleOccurrence.planned_at.desc())).scalars().first()
        try:
            base = max(last_planned or now, now - timedelta(minutes=1))
            it = croniter(sch.cron_expr, base)
        except Exception:  # noqa: BLE001 —— 非法 cron 不阻断其他 Schedule
            continue
        while True:
            nxt = it.get_next(datetime)
            if nxt.tzinfo is None:
                nxt = nxt.replace(tzinfo=timezone.utc)
            if nxt > horizon:
                break
            if nxt <= now - timedelta(minutes=MISS_GRACE_MINUTES):
                continue  # 已过期窗口不补计划
            # 与并发 materializer（scheduler 线程/测试直调）竞态安全：DB 侧去重。
            # rowcount 在 DO NOTHING 跳过时驱动可能报 -1，故以预检计数、冲突兜底。
            from sqlalchemy.dialects.postgresql import insert as pg_insert
            exists = db.execute(select(ScheduleOccurrence.id).where(
                ScheduleOccurrence.schedule_id == sch.id,
                ScheduleOccurrence.planned_at == nxt)).first()
            if exists is None:
                created += 1
            stmt = pg_insert(ScheduleOccurrence).values(
                id=new_id(), schedule_id=sch.id, task_id=sch.task_id, planned_at=nxt,
                timezone=sch.timezone or "Asia/Shanghai",
                fire_key=fire_key_for(sch.id, nxt), status="planned",
                schedule_snapshot={"cron": sch.cron_expr, "timezone": sch.timezone,
                                   "taskId": sch.task_id},
                created_at=now, updated_at=now)
            db.execute(stmt.on_conflict_do_nothing(
                constraint="uq_occurrence_schedule_planned"))
    if created or cancelled:
        db.commit()
    return created


def mark_missed(db: Session, now: datetime | None = None) -> int:
    """超过宽限期仍无 TaskRun 的 occurrence 标记 missed（进入需关注列）。"""
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(minutes=MISS_GRACE_MINUTES)
    rows = db.execute(select(ScheduleOccurrence).where(
        ScheduleOccurrence.status.in_(("planned", "firing")),
        ScheduleOccurrence.task_run_id.is_(None),
        ScheduleOccurrence.planned_at < cutoff)).scalars().all()
    for occ in rows:
        occ.status = "missed"
        occ.error = {"code": "SCHEDULE_MISSED",
                     "message": f"计划 {occ.planned_at.isoformat()} 超宽限未触发"}
    if rows:
        db.commit()
    return len(rows)


def associate_fire(db: Session, schedule_id: str, planned_at: datetime,
                   task_run_id: str) -> None:
    """触发成功后把 occurrence 与 TaskRun 幂等关联（同一卡不双显）。"""
    occ = db.execute(select(ScheduleOccurrence).where(
        ScheduleOccurrence.schedule_id == schedule_id,
        ScheduleOccurrence.fire_key == fire_key_for(schedule_id, planned_at))
    ).scalars().first()
    if occ and occ.task_run_id is None:
        occ.status = "started"
        occ.task_run_id = task_run_id
        db.commit()


def occurrence_dto(occ: ScheduleOccurrence) -> dict:
    return {"id": occ.id, "scheduleId": occ.schedule_id, "taskId": occ.task_id,
            "plannedAt": occ.planned_at.isoformat(), "timezone": occ.timezone,
            "fireKey": occ.fire_key, "status": occ.status,
            "taskRunId": occ.task_run_id, "error": occ.error}
