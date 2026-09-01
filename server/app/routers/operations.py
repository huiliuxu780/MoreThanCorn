"""SDD 13 §8.8/§10：运行中心 API（全局 TaskRun 查询，不要求先知道 taskId）。

- GET  /api/operations/task-runs            批次历史（服务端分页+筛选+排序白名单）
- GET  /api/operations/task-runs/today       今日看板（occurrence 与 TaskRun 合并分栏）
- GET  /api/operations/task-runs/stream      SSE（Last-Event-ID 续接/回拉 snapshot）
- GET  /api/operations/task-runs/{id}        批次详情（execution+delivery+冻结快照）
- GET  /api/operations/task-runs/{id}/deliveries     结果投递 Tab
- GET  /api/operations/task-runs/{id}/failure-analysis 失败分析 Tab（分类聚合）
"""
from __future__ import annotations

import asyncio
import hashlib
import json
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from zoneinfo import ZoneInfo

from ..db import get_db
from ..models import (AnalysisTask, AnalysisTaskVersion, DataSnapshot, Run,
                      ResultDelivery, ScheduleOccurrence, TaskRun)

router = APIRouter(prefix="/api/operations", tags=["operations"])

COLUMNS = ("upcoming", "queued", "running", "delivering", "attention", "completed")
_SORT_WHITELIST = {"createdAt", "-createdAt", "durationMs", "-durationMs",
                   "startedAt", "-startedAt"}


def _duration_ms(tr: TaskRun | None) -> int | None:
    if tr is None:
        return None
    if tr.started_at and tr.ended_at:
        return int((tr.ended_at - tr.started_at).total_seconds() * 1000)
    if tr.started_at:
        return int((datetime.now(timezone.utc) - tr.started_at).total_seconds() * 1000)
    return None


def _env_of(tr: TaskRun) -> str:
    snap = tr.runtime_binding_snapshot or {}
    if snap.get("environment"):
        return str(snap["environment"])
    return "sandbox"


def _stage_of(tr: TaskRun | None, occ: ScheduleOccurrence | None) -> tuple[str, dict | None]:
    """§10.4 优先级：需关注 > 结果投递 > 执行中 > 排队中 > 已完成 > 即将运行。"""
    attention = None
    if occ is not None and occ.status == "missed" and (tr is None or tr.id != occ.task_run_id):
        return "attention", {"code": "SCHEDULE_MISSED",
                             "message": (occ.error or {}).get("message", "计划未触发")}
    if tr is None:
        return "upcoming", None
    if tr.status in ("partial", "failed", "cancelled"):
        attention = {"code": "EXECUTION_" + tr.status.upper(),
                     "message": ((tr.error_summary or {}).get("errors") or [{}])[0].get(
                         "error", tr.status)}
    elif tr.delivery_status in ("partial", "failed"):
        attention = {"code": "DELIVERY_" + tr.delivery_status.upper(),
                     "message": f"投递 {tr.delivery_status}（成功 {tr.delivery_succeeded_count}"
                                f" / 失败 {tr.delivery_failed_count}）"}
    if attention:
        return "attention", attention
    if tr.status == "succeeded" and tr.delivery_status in ("pending", "running"):
        return "delivering", None
    if tr.status == "running":
        return "running", None
    if tr.status == "queued":
        return "queued", None
    if tr.status == "succeeded" and tr.delivery_status in ("succeeded", "not_configured"):
        return "completed", None
    return "running", None


def _card(db: Session, tr: TaskRun | None, occ: ScheduleOccurrence | None,
          task_name: str, task_id: str) -> dict:
    stage, attention = _stage_of(tr, occ)
    running_count = 0
    if tr is not None:
        running_count = db.execute(select(func.count(Run.id)).where(
            Run.task_run_id == tr.id, Run.status.in_(("queued", "running")))).scalar() or 0
    return {
        "kind": "task_run" if tr is not None else "schedule_occurrence",
        "id": tr.id if tr is not None else occ.id,
        "occurrenceId": occ.id if occ is not None else None,
        "taskRunId": tr.id if tr is not None else None,
        "task": {"id": task_id, "name": task_name},
        "plannedAt": occ.planned_at.isoformat() if occ is not None else None,
        "startedAt": tr.started_at.isoformat() if tr and tr.started_at else None,
        "trigger": tr.trigger if tr else "schedule",
        "environment": _env_of(tr) if tr else "sandbox",
        "stage": stage,
        "execution": {"total": tr.total or 0, "succeeded": tr.succeeded_count or 0,
                      "failed": tr.failed_count or 0, "running": running_count} if tr else
                     {"total": 0, "succeeded": 0, "failed": 0, "running": 0},
        "delivery": {"status": tr.delivery_status if tr else "not_configured",
                     "succeeded": tr.delivery_succeeded_count if tr else 0,
                     "failed": tr.delivery_failed_count if tr else 0},
        "durationMs": _duration_ms(tr),
        "attention": attention,
    }


def _day_bounds(date_s: str, tz_s: str) -> tuple[datetime, datetime]:
    try:
        zone = ZoneInfo(tz_s)
    except Exception:  # noqa: BLE001
        zone = ZoneInfo("Asia/Shanghai")
    day = datetime.fromisoformat(date_s)
    start = zone.localize(day) if hasattr(zone, "localize") else \
        day.replace(tzinfo=zone)
    return start.astimezone(timezone.utc), (start + timedelta(days=1)).astimezone(timezone.utc)


def _today_rows(db: Session, date_s: str, tz_s: str):
    start, end = _day_bounds(date_s, tz_s)
    occs = db.execute(select(ScheduleOccurrence).where(
        ScheduleOccurrence.planned_at >= start,
        ScheduleOccurrence.planned_at < end)).scalars().all()
    active = ("queued", "running", "partial")
    runs = db.execute(select(TaskRun).where(
        (TaskRun.created_at >= start) & (TaskRun.created_at < end)
        | (TaskRun.started_at >= start) & (TaskRun.started_at < end)
        | (TaskRun.started_at < start) & (TaskRun.status.in_(active))
        | (TaskRun.ended_at >= start) & (TaskRun.ended_at < end))).scalars().all()
    return start, end, occs, runs


def _board(db: Session, date_s: str, tz_s: str, filters: dict) -> dict:
    start, end, occs, runs = _today_rows(db, date_s, tz_s)
    task_ids = {t.id for t in db.execute(select(AnalysisTask)).scalars().all()}
    names = {t.id: t.name for t in db.execute(select(AnalysisTask)).scalars().all()}
    del task_ids
    runs_by_id = {r.id: r for r in runs}
    occ_by_run = {o.task_run_id: o for o in occs if o.task_run_id}
    cards: list[dict] = []
    for occ in occs:
        tr = runs_by_id.get(occ.task_run_id) if occ.task_run_id else None
        if tr is None and occ.status in ("cancelled", "skipped") :
            continue
        if tr is None and occ.status == "started":
            continue  # 已关联但 run 不在当日集合（边界）：以 run 卡呈现
        card = _card(db, tr, occ if tr is None or occ.status == "missed" else occ,
                     names.get(occ.task_id or "", ""), occ.task_id or "")
        cards.append(card)
    seen_occ_run = {o.task_run_id for o in occs if o.task_run_id}
    for tr in runs:
        if tr.id in seen_occ_run:
            continue
        cards.append(_card(db, tr, None, names.get(tr.task_id, ""), tr.task_id))
    # 筛选
    if filters.get("taskId"):
        cards = [c for c in cards if c["task"]["id"] == filters["taskId"]]
    if filters.get("trigger"):
        cards = [c for c in cards if c["trigger"] == filters["trigger"]]
    if filters.get("environment"):
        cards = [c for c in cards if c["environment"] == filters["environment"]]
    if filters.get("q"):
        q = filters["q"].lower()
        cards = [c for c in cards if q in (c["task"]["name"] or "").lower()
                 or q in (c["taskRunId"] or "").lower()]
    if filters.get("attention") == "only":
        cards = [c for c in cards if c["stage"] == "attention"]
    columns: dict[str, list] = {c: [] for c in COLUMNS}
    for card in cards:
        columns[card["stage"]].append(card)
    completed_truncated = False
    if len(columns["completed"]) > 20:
        columns["completed"].sort(key=lambda c: c["startedAt"] or "", reverse=True)
        columns["completed"] = columns["completed"][:20]
        completed_truncated = True
    return {"date": date_s, "timezone": tz_s,
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "summary": {c: len(columns[c]) for c in COLUMNS},
            "completedTruncated": completed_truncated,
            "columns": columns}


@router.get("/task-runs/today")
def today_board(date: str = "", timezone: str = "Asia/Shanghai",
                taskId: str = "", trigger: str = "", environment: str = "",
                attention: str = "", q: str = "",
                db: Session = Depends(get_db)):
    if not date:
        try:
            zone = ZoneInfo(timezone)
        except Exception:  # noqa: BLE001
            zone = ZoneInfo("Asia/Shanghai")
        date = datetime.now(zone).date().isoformat()
    return _board(db, date, timezone, {"taskId": taskId, "trigger": trigger,
                                       "environment": environment,
                                       "attention": attention, "q": q})


@router.get("/task-runs/stream")
async def task_runs_stream(request: Request,
                           date: str = "", timezone: str = "Asia/Shanghai"):
    """SSE：board upsert 与 summary 更新；事件带递增 sequence/serverTime。

    断线重连用 Last-Event-ID；无法续接时直接下发完整 snapshot（客户端无需另拉）。"""
    last_id = request.headers.get("Last-Event-ID", "0")
    try:
        seq = int(last_id)
    except ValueError:
        seq = 0

    async def gen():
        nonlocal seq
        last_hash = ""
        idle = 0
        while idle < 300:
            if await request.is_disconnected():
                return
            db = next(get_db())
            try:
                if not date:
                    d = datetime.now(ZoneInfo(timezone)).date().isoformat()
                else:
                    d = date
                board = _board(db, d, timezone, {})
            finally:
                db.close()
            digest = hashlib.sha256(
                json.dumps(board, sort_keys=True, default=str).encode()).hexdigest()
            if digest != last_hash or idle == 0:
                seq += 1
                last_hash = digest
                data = json.dumps({"sequence": seq,
                                   "serverTime": datetime.now(timezone.utc).isoformat(),
                                   "board": board}, ensure_ascii=False, default=str)
                yield f"id: {seq}\nevent: board\ndata: {data}\n\n"
                idle = 0
            else:
                idle += 1
            await asyncio.sleep(2)
    return StreamingResponse(gen(), media_type="text/event-stream")


@router.get("/task-runs")
def task_run_history(page: int = 1, pageSize: int = 50, q: str = "", taskId: str = "",
                     status: str = "", deliveryStatus: str = "", trigger: str = "",
                     startedFrom: str = "", startedTo: str = "", environment: str = "",
                     sort: str = "-createdAt", db: Session = Depends(get_db)):
    """§8.8 批次历史：服务端分页；所有筛选由调用方写入 URL Query（前端负责）。"""
    pageSize = min(max(pageSize, 1), 200)
    if sort not in _SORT_WHITELIST:
        raise HTTPException(422, f"sort 必须是 {sorted(_SORT_WHITELIST)} 之一")
    names = {t.id: t.name for t in db.execute(select(AnalysisTask)).scalars().all()}
    query = db.query(TaskRun)
    if taskId:
        query = query.filter(TaskRun.task_id == taskId)
    if status:
        query = query.filter(TaskRun.status == status)
    if deliveryStatus:
        query = query.filter(TaskRun.delivery_status == deliveryStatus)
    if trigger:
        query = query.filter(TaskRun.trigger == trigger)
    if startedFrom:
        query = query.filter(TaskRun.started_at >= datetime.fromisoformat(startedFrom))
    if startedTo:
        query = query.filter(TaskRun.started_at <= datetime.fromisoformat(startedTo))
    if q:
        like = f"%{q}%"
        match_ids = [t.id for t in db.execute(select(AnalysisTask).where(
            AnalysisTask.name.ilike(like))).scalars().all()]
        query = query.filter((TaskRun.id.ilike(like)) | (TaskRun.task_id.in_(match_ids or ["-"])))
    order = {"createdAt": TaskRun.created_at.asc(), "-createdAt": TaskRun.created_at.desc(),
             "durationMs": TaskRun.ended_at - TaskRun.started_at,
             "-durationMs": (TaskRun.ended_at - TaskRun.started_at).desc(),
             "startedAt": TaskRun.started_at.asc(),
             "-startedAt": TaskRun.started_at.desc()}[sort]
    total = query.count()
    rows = query.order_by(order).offset((page - 1) * pageSize).limit(pageSize).all()
    items = []
    for tr in rows:
        if environment and _env_of(tr) != environment:
            continue
        items.append({
            "id": tr.id, "taskId": tr.task_id, "taskName": names.get(tr.task_id, ""),
            "trigger": tr.trigger, "environment": _env_of(tr),
            "startedAt": tr.started_at.isoformat() if tr.started_at else None,
            "endedAt": tr.ended_at.isoformat() if tr.ended_at else None,
            "createdAt": tr.created_at.isoformat(),
            "durationMs": _duration_ms(tr),
            "execution": {"status": tr.status, "total": tr.total,
                          "succeeded": tr.succeeded_count, "failed": tr.failed_count,
                          "skipped": tr.skipped_count, "cancelled": tr.cancelled_count},
            "delivery": {"status": tr.delivery_status,
                         "pending": tr.delivery_pending_count,
                         "succeeded": tr.delivery_succeeded_count,
                         "failed": tr.delivery_failed_count},
        })
    return {"items": items, "total": total, "page": page, "pageSize": pageSize}


def _delivery_dto(d: ResultDelivery) -> dict:
    return {"id": d.id, "runId": d.run_id, "interactionRef": d.interaction_ref,
            "status": d.status, "writeMode": d.write_mode, "attempts": d.attempts,
            "maxAttempts": d.max_attempts,
            "nextAttemptAt": d.next_attempt_at.isoformat() if d.next_attempt_at else None,
            "error": d.error, "targetReference": d.target_reference,
            "payloadSha256": d.payload_sha256,
            "outputAssetId": d.output_asset_id,
            "createdAt": d.created_at.isoformat(),
            "endedAt": d.ended_at.isoformat() if d.ended_at else None}


@router.get("/task-runs/{trid}")
def task_run_detail(trid: str, db: Session = Depends(get_db)):
    tr = db.get(TaskRun, trid)
    if not tr:
        raise HTTPException(404, "TaskRun 不存在")
    task = db.get(AnalysisTask, tr.task_id)
    tv = db.get(AnalysisTaskVersion, tr.task_version_id)
    occ = db.execute(select(ScheduleOccurrence).where(
        ScheduleOccurrence.task_run_id == tr.id)).scalars().first()
    snap = db.get(DataSnapshot, tr.data_snapshot_id) if tr.data_snapshot_id else None
    binding = tr.output_binding_snapshot or {}
    return {
        "id": tr.id, "taskId": tr.task_id, "taskName": task.name if task else "",
        "taskVersionId": tr.task_version_id, "versionNo": tv.version_no if tv else None,
        "trigger": tr.trigger, "environment": _env_of(tr),
        "scheduleFireKey": tr.schedule_fire_key,
        "plannedAt": occ.planned_at.isoformat() if occ else None,
        "occurrence": {"id": occ.id, "status": occ.status, "error": occ.error} if occ else None,
        "startedAt": tr.started_at.isoformat() if tr.started_at else None,
        "endedAt": tr.ended_at.isoformat() if tr.ended_at else None,
        "durationMs": _duration_ms(tr),
        "execution": {"status": tr.status, "total": tr.total,
                      "succeeded": tr.succeeded_count, "failed": tr.failed_count,
                      "skipped": tr.skipped_count, "cancelled": tr.cancelled_count},
        "delivery": {"status": tr.delivery_status, "pending": tr.delivery_pending_count,
                     "succeeded": tr.delivery_succeeded_count,
                     "failed": tr.delivery_failed_count,
                     "targetAssetId": binding.get("assetId"),
                     "targetTable": (f"{binding.get('schemaName')}.{binding.get('table')}"
                                     if binding.get("table") else None),
                     "writeMode": binding.get("writeMode"),
                     "keyFields": binding.get("keyFields"),
                     "schemaFingerprint": binding.get("schemaFingerprint"),
                     "outputSchemaRef": binding.get("outputSchemaRef")},
        "frozen": {
            "agentVersionId": tr.resolved_agent_version_id,
            "workflowVersionId": tr.resolved_workflow_version_id,
            "releaseId": tr.resolved_release_id,
            "ruleVersionId": tr.resolved_rule_version_id,
            "runtimeBinding": tr.runtime_binding_snapshot,
            "outputBinding": binding,
            "dataSnapshot": {"id": snap.id, "assetId": snap.asset_id,
                             "readCount": snap.read_count, "expectedCount": snap.expected_count,
                             "checksum": snap.checksum,
                             "resolvedWindow": snap.resolved_window} if snap else None,
        },
        "errorSummary": tr.error_summary,
    }


@router.get("/task-runs/{trid}/deliveries")
def task_run_deliveries(trid: str, page: int = 1, pageSize: int = 50,
                        status: str = "", db: Session = Depends(get_db)):
    if not db.get(TaskRun, trid):
        raise HTTPException(404, "TaskRun 不存在")
    pageSize = min(max(pageSize, 1), 200)
    query = db.query(ResultDelivery).filter_by(task_run_id=trid)
    if status:
        query = query.filter(ResultDelivery.status == status)
    total = query.count()
    rows = query.order_by(ResultDelivery.created_at.asc())\
        .offset((page - 1) * pageSize).limit(pageSize).all()
    return {"items": [_delivery_dto(d) for d in rows], "total": total,
            "page": page, "pageSize": pageSize}


@router.get("/task-runs/{trid}/failure-analysis")
def task_run_failure_analysis(trid: str, db: Session = Depends(get_db)):
    """§10.10：分类聚合，禁止把所有失败合并成一条字符串。"""
    tr = db.get(TaskRun, trid)
    if not tr:
        raise HTTPException(404, "TaskRun 不存在")
    cats = {"schedule": [], "runtime": [], "output_schema": [], "mapping": [],
            "target": [], "retry_exhausted": []}
    occ = db.execute(select(ScheduleOccurrence).where(
        ScheduleOccurrence.task_run_id == tr.id)).scalars().first()
    if occ and occ.status == "missed":
        cats["schedule"].append({"id": occ.id, "message": (occ.error or {}).get("message", "")})
    for r in db.execute(select(Run).where(Run.task_run_id == trid,
                                          Run.status == "failed")).scalars().all():
        code = (r.error or {}).get("code") or ""
        msg = (r.error or {}).get("message") or r.status
        item = {"runId": r.id, "interactionRef": r.interaction_ref, "code": code,
                "message": msg}
        if code == "OUTPUT_SCHEMA_ERROR":
            cats["output_schema"].append(item)
        elif code.startswith("MAPPING_") or code == "DELIVERY_RECORD_INVALID":
            cats["mapping"].append(item)
        else:
            cats["runtime"].append(item)
    for d in db.execute(select(ResultDelivery).where(
            ResultDelivery.task_run_id == trid,
            ResultDelivery.status.in_(("failed", "dead_letter")))).scalars().all():
        code = (d.error or {}).get("code") or ""
        item = {"deliveryId": d.id, "interactionRef": d.interaction_ref, "code": code,
                "message": (d.error or {}).get("message") or "", "attempts": d.attempts}
        if d.status == "dead_letter":
            cats["retry_exhausted"].append(item)
        elif code.startswith("TARGET_") or code in ("TARGET_PERMISSION_DENIED",
                                                    "TARGET_TABLE_MISSING",
                                                    "TARGET_COLUMN_MISSING"):
            cats["target"].append(item)
        elif code.startswith("MAPPING_"):
            cats["mapping"].append(item)
        else:
            cats["target"].append(item)
    return {"taskRunId": trid,
            "categories": [{"key": k, "count": len(v), "samples": v[:20]}
                           for k, v in cats.items()]}
