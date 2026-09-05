"""MTC-002B：WorkItem canonical 只读 API。

- GET /api/work-items            列表（服务端筛选/分页/counts）
- GET /api/work-items/{id}       详情（taskrun:{id} / occurrence:{id}）
- GET /api/work-items/stream     SSE 变更通知（只发 refresh 信号，不复制执行状态逻辑）

权限继承自主任务数据范围（build_work_items 内服务端强制）；
状态映射唯一入口在 work_item_projection.project_work_item_status。
"""
from __future__ import annotations

import asyncio
import hashlib
import json
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..auth import require_role
from ..db import get_db
from ..models import ScheduleOccurrence, TaskRun
from ..work_item_projection import (build_work_items, count_by_status, day_bounds,
                                    filter_work_items)

router = APIRouter(prefix="/api/work-items", tags=["work-items"])

_DEFAULT_TZ = "Asia/Shanghai"


def _business_date(tz_s: str) -> str:
    try:
        zone = ZoneInfo(tz_s)
    except Exception:  # noqa: BLE001
        zone = ZoneInfo(_DEFAULT_TZ)
    return datetime.now(zone).date().isoformat()


@router.get("")
def list_work_items(dateFrom: str = "", dateTo: str = "", timezone: str = _DEFAULT_TZ,
                    status: str = "", automationId: str = "", agentId: str = "",
                    q: str = "", origin: str = "", attentionOnly: str = "",
                    page: int = 1, pageSize: int = 50,
                    db: Session = Depends(get_db),
                    user: dict = Depends(require_role())):
    tz_s = timezone or _DEFAULT_TZ
    date_from = dateFrom or _business_date(tz_s)
    date_to = dateTo or date_from
    page = max(page, 1)
    pageSize = min(max(pageSize, 1), 200)

    items = build_work_items(db, user, date_from=date_from, date_to=date_to, tz_s=tz_s)
    filtered = filter_work_items(
        items, status=status, automation_id=automationId, agent_id=agentId,
        q=q, origin=origin, attention_only=attentionOnly == "only")
    counts = count_by_status(filtered)
    total = len(filtered)
    paged = filtered[(page - 1) * pageSize: page * pageSize]
    return {"items": paged, "total": total, "page": page, "pageSize": pageSize,
            "businessDate": date_from, "timezone": tz_s, "counts": counts}


@router.get("/stream")
async def work_items_stream(request: Request, dateFrom: str = "", dateTo: str = "",
                            timezone: str = _DEFAULT_TZ):
    """SSE：投影摘要 digest 变化时发 ``refresh`` 信号；前端重新拉取 /api/work-items。

    不随事件下发执行状态（避免第二套状态逻辑）；断线/失败时前端降级轮询或手动刷新。
    """
    tz_s = timezone or _DEFAULT_TZ

    async def gen():
        seq = 0
        last_hash = ""
        idle = 0
        while idle < 300:
            if await request.is_disconnected():
                return
            db = next(get_db())
            try:
                date_from = dateFrom or _business_date(tz_s)
                items = build_work_items(db, {"role": "admin", "username": "system",
                                              "data_scope": "all"},
                                         date_from=date_from,
                                         date_to=dateTo or date_from, tz_s=tz_s)
                digest_src = [(w["id"], w["status"], w["phase"],
                               w["progress"]["succeeded"], w["progress"]["failed"])
                              for w in items]
            finally:
                db.close()
            digest = hashlib.sha256(json.dumps(digest_src, sort_keys=True,
                                               default=str).encode()).hexdigest()
            if digest != last_hash or idle == 0:
                seq += 1
                last_hash = digest
                data = json.dumps({"sequence": seq,
                                   "serverTime": datetime.now(timezone.utc).isoformat()},
                                  ensure_ascii=False)
                yield f"id: {seq}\nevent: refresh\ndata: {data}\n\n"
                idle = 0
            else:
                idle += 1
            await asyncio.sleep(2)

    return StreamingResponse(gen(), media_type="text/event-stream")


@router.get("/{work_item_id}")
def get_work_item(work_item_id: str, timezone: str = _DEFAULT_TZ,
                  db: Session = Depends(get_db),
                  user: dict = Depends(require_role())):
    """支持 taskrun:{id} 与 occurrence:{id}；不存在 404；跨团队 403（build 内强制）。"""
    tz_s = timezone or _DEFAULT_TZ
    if work_item_id.startswith("taskrun:"):
        tr = db.get(TaskRun, work_item_id[len("taskrun:"):])
        if tr is None:
            raise HTTPException(404, "WorkItem 不存在")
        day = (tr.created_at or tr.started_at or datetime.now(timezone.utc))
    elif work_item_id.startswith("occurrence:"):
        occ = db.get(ScheduleOccurrence, work_item_id[len("occurrence:"):])
        if occ is None:
            raise HTTPException(404, "WorkItem 不存在")
        day = occ.planned_at or datetime.now(timezone.utc)
    else:
        raise HTTPException(422, "WorkItem ID 必须带 taskrun: 或 occurrence: 前缀")

    try:
        zone = ZoneInfo(tz_s)
    except Exception:  # noqa: BLE001
        zone = ZoneInfo(_DEFAULT_TZ)
    date_s = day.astimezone(zone).date().isoformat()
    items = build_work_items(db, user, date_from=date_s, date_to=date_s, tz_s=tz_s)
    for w in items:
        if w["id"] == work_item_id:
            return w
    # 存在但被数据范围过滤 → 403（与 runs/schedules 门禁语义一致）
    raise HTTPException(403, "权限不足：数据范围限定为本团队")
