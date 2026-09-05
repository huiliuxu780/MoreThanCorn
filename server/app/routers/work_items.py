"""MTC-002B-R：WorkItem canonical 只读 API。

- GET /api/work-items                列表（筛选下推 SQL / 服务端分页 / truncated 标记）
- GET /api/work-items/by-task-runs   按 taskRunId 批量取（自主任务详情用，避免 90 天全投影）
- GET /api/work-items/{id}           详情（taskrun:{id} / occurrence:{id}；404/403/200 三态区分）
- GET /api/work-items/stream         SSE（fetch+Bearer 授权；digest 用当前用户数据范围）

R 轮修正：参数校验 422（date/timezone/status/origin）；stream 不再遮蔽 datetime.timezone、
不再硬编码 admin/all；详情不再把关系损坏误报 403。
"""
from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone as dt_timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import assert_task_readable, require_role
from ..db import get_db
from ..models import AnalysisTask, ScheduleOccurrence, TaskRun
from ..work_item_projection import (ORIGINS, STATUS_ORDER, build_work_items,
                                    count_by_status, day_bounds, filter_work_items,
                                    project_single)  # noqa: F401  (project_single 供详情使用)

router = APIRouter(prefix="/api/work-items", tags=["work-items"])

_DEFAULT_TZ = "Asia/Shanghai"


_DATE_RE = __import__("re").compile(r"^\d{4}-\d{2}-\d{2}$")


def _valid_date(value: str, field: str) -> str:
    """P2：只接受 YYYY-MM-DD；带时间/非法格式一律 422。"""
    if not _DATE_RE.match(value):
        raise HTTPException(422, f"{field} 必须是 YYYY-MM-DD（收到：{value}）")
    try:
        datetime.fromisoformat(value)
    except ValueError:
        raise HTTPException(422, f"{field} 不是真实日期（收到：{value}）")
    return value


def _valid_tz(value: str) -> str:
    try:
        ZoneInfo(value)
    except Exception:  # noqa: BLE001
        raise HTTPException(422, f"timezone 必须是有效 IANA 时区（收到：{value}）")
    return value


def _business_date(tz_s: str) -> str:
    return datetime.now(ZoneInfo(tz_s)).date().isoformat()


@router.get("")
def list_work_items(dateFrom: str = "", dateTo: str = "", timezone: str = _DEFAULT_TZ,
                    status: str = "", automationId: str = "", agentId: str = "",
                    q: str = "", origin: str = "", attentionOnly: str = "",
                    page: int = 1, pageSize: int = 50,
                    db: Session = Depends(get_db),
                    user: dict = Depends(require_role())):
    tz_s = _valid_tz(timezone or _DEFAULT_TZ)
    date_from = _valid_date(dateFrom, "dateFrom") if dateFrom else _business_date(tz_s)
    date_to = _valid_date(dateTo, "dateTo") if dateTo else date_from
    if date_from > date_to:
        raise HTTPException(422, f"dateFrom 不能晚于 dateTo（{date_from} > {date_to}）")
    if status and status not in STATUS_ORDER:
        raise HTTPException(422, f"status 必须是 {list(STATUS_ORDER)} 之一")
    if origin and origin not in ORIGINS:
        raise HTTPException(422, f"origin 必须是 {list(ORIGINS)} 之一")
    if attentionOnly and attentionOnly != "only":
        raise HTTPException(422, "attentionOnly 只接受 'only'")
    page = max(page, 1)
    pageSize = min(max(pageSize, 1), 200)

    items = build_work_items(db, user, date_from=date_from, date_to=date_to, tz_s=tz_s,
                             automation_id=automationId, origin=origin, agent_id=agentId)
    filtered = filter_work_items(items, status=status, q=q,
                                 attention_only=attentionOnly == "only")
    counts = count_by_status(filtered)
    total = len(filtered)
    paged = filtered[(page - 1) * pageSize: page * pageSize]
    return {"items": paged, "total": total, "page": page, "pageSize": pageSize,
            "businessDate": date_from, "timezone": tz_s, "counts": counts,
            "truncated": total > page * pageSize}


@router.get("/by-task-runs")
def work_items_by_task_runs(ids: str = "", db: Session = Depends(get_db),
                            user: dict = Depends(require_role())):
    """按 taskRunId 批量取 WorkItem（≤200）。跨团队/不存在的 id 静默跳过（列表语义）。"""
    wanted = [x for x in (ids or "").split(",") if x][:200]
    if not wanted:
        return {"items": []}
    # P1-04：真批量投影（常量级 SQL；顺序与输入一致；不存在/跨团队静默跳过）
    from ..work_item_projection import project_batch
    return {"items": project_batch(db, user, wanted)}


# P1-01：digest 唯一实现位于 work_item_projection（复用投影事实集 + 1s TTL 共享缓存）
from ..work_item_projection import compute_stream_digest  # noqa: E402


async def work_items_stream_iter(user: dict, d_from: str, d_to: str, tz_s: str,
                                 is_disconnected=None):
    """SSE 事件迭代器（模块级，便于单测首事件/refresh 语义）。

    digest 变化发 ``refresh``（sequence+serverTime）；不下发业务状态。
    ``is_disconnected`` 由端点传入（请求级）；单测可省略。
    """
    seq = 0
    last_hash = ""
    idle = 0
    while idle < 300:
        if is_disconnected is not None and await is_disconnected():
            return
        sdb = next(get_db())
        try:
            digest = compute_stream_digest(sdb, user, d_from, d_to, tz_s)
        finally:
            sdb.close()
        if digest != last_hash or idle == 0:
            seq += 1
            last_hash = digest
            data = json.dumps({"sequence": seq,
                               "serverTime": datetime.now(dt_timezone.utc).isoformat()},
                              ensure_ascii=False)
            yield f"id: {seq}\nevent: refresh\ndata: {data}\n\n"
            idle = 0
        else:
            idle += 1
        await asyncio.sleep(2)


@router.get("/stream")
async def work_items_stream(request: Request, dateFrom: str = "", dateTo: str = "",
                            timezone: str = _DEFAULT_TZ,
                            user: dict = Depends(require_role())):
    """SSE：fetch+Bearer 授权；digest 使用当前用户数据范围（不硬编码 admin/all）。"""
    tz_s = _valid_tz(timezone or _DEFAULT_TZ)
    d_from = _valid_date(dateFrom, "dateFrom") if dateFrom else _business_date(tz_s)
    d_to = _valid_date(dateTo, "dateTo") if dateTo else d_from
    return StreamingResponse(
        work_items_stream_iter(user, d_from, d_to, tz_s,
                               is_disconnected=request.is_disconnected),
        media_type="text/event-stream")


@router.get("/{work_item_id}")
def get_work_item(work_item_id: str, timezone: str = _DEFAULT_TZ,
                  db: Session = Depends(get_db),
                  user: dict = Depends(require_role())):
    """详情三态：实体不存在 404；存在但跨团队 403；其余（含关系损坏）单条投影 200。"""
    _valid_tz(timezone or _DEFAULT_TZ)
    tr: TaskRun | None = None
    occ: ScheduleOccurrence | None = None
    if work_item_id.startswith("taskrun:"):
        tr = db.get(TaskRun, work_item_id[len("taskrun:"):])
        if tr is None:
            raise HTTPException(404, "WorkItem 不存在")
    elif work_item_id.startswith("occurrence:"):
        occ = db.get(ScheduleOccurrence, work_item_id[len("occurrence:"):])
        if occ is None:
            raise HTTPException(404, "WorkItem 不存在")
    else:
        raise HTTPException(422, "WorkItem ID 必须带 taskrun: 或 occurrence: 前缀")

    task_id = tr.task_id if tr is not None else (occ.task_id if occ is not None else None)
    task = db.get(AnalysisTask, task_id) if task_id else None
    if task is not None:
        assert_task_readable(db, user, task)  # 跨团队 → 403（先于投影判定）
    item = project_single(db, tr, occ)
    if item is None:
        raise HTTPException(404, "该 occurrence 不属于投影集合（cancelled/skipped 空计划）")
    return item
