"""F5（Spec §10/§12.6）：EventRoute 统一契约 API + EventDelivery 流水与重试。

存储与兼容（Spec §10.0）：
- ``event_route`` 表 = 新路由唯一物理存储，destination XOR automation|analysis_task；
- ``automation_trigger(kind=event|polling)`` 仍是 destination=automation 的 AS-IS
  存储：统一 DTO 视图只读投影（origin=automation_trigger），修改仍走
  ``/api/v2/automations/{id}`` trigger API，杜绝双写漂移。

语义要点：
- POST/PUT 返回递增后的 revision；DELETE = 归档（enabled=false + archived），
  不物理删除，历史 delivery 仍可追踪；
- delivery 暴露 §10.2 状态机字段与 route/destination/invocation/task_run 关联；
  completion_policy 语义随响应可读（completionMeaning），不让用户猜 completed
  指"已派发"还是"业务已完成"；
- retry 只接受 FAILED/DEAD，重发使用创建时冻结的 mapped_input + route_revision，
  不随 route 编辑漂移；
- sourceEventId 过滤时附 DataSourceEvent.route_outcomes 流水证据
  （AC-023/024：区分 filtered/deduped/dead）。
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import require_operator, require_role
from ..db import get_db
from ..models import (AnalysisTask, AutomationDefinition, AutomationTrigger,
                      AutomationTriggerLog, DataSource, DataSourceEvent,
                      EventDelivery, EventRoute, TaskRun)

router = APIRouter(prefix="/api/v2", tags=["event-routes"])

_COMPLETION_MEANING = {
    "accepted": "派发受理即完成（不等待目标执行终态）",
    "terminal": "目标执行到达终态后才完成（端到端确认）",
}
_DESTINATION_KINDS = ("automation", "analysis_task")
_TERMINAL_TR_STATUSES = ("succeeded", "failed", "cancelled", "partial")
_TERMINAL_INV_STATUSES = ("completed", "failed", "cancelled")


# ---------- DTO ----------

def _iso(v) -> str | None:
    return v.isoformat() if v else None


def _filter_view(cfg: dict | None) -> dict:
    cfg = cfg or {}
    expr = cfg.get("expression") if "expression" in cfg else \
        {k: v for k, v in cfg.items() if k != "version"}
    return {"version": cfg.get("version", 1), "expression": expr or {}}


def _mapping_view(cfg: dict | None) -> dict:
    cfg = cfg or {}
    fields = cfg.get("fields") if "fields" in cfg else \
        {k: v for k, v in cfg.items() if k != "version"}
    return {"version": cfg.get("version", 1), "fields": fields or {}}


def route_dto(r: EventRoute) -> dict:
    return {
        "id": r.id,
        "origin": "event_route",
        "sourceId": r.source_id,
        "eventType": r.event_type or "",
        "destination": {"kind": r.destination_kind, "id": r.destination_id},
        "filter": _filter_view(r.filter),
        "mapping": _mapping_view(r.mapping),
        "dedupe": r.dedupe or {},
        "completionPolicy": r.completion_policy,
        "completionMeaning": _COMPLETION_MEANING.get(r.completion_policy, ""),
        "retryPolicy": r.retry_policy or {},
        "enabled": bool(r.enabled),
        "archived": bool(r.archived),
        "revision": r.revision,
        "createdBy": r.created_by,
        "createdAt": _iso(r.created_at),
        "updatedAt": _iso(r.updated_at),
    }


def legacy_route_dto(trig: AutomationTrigger) -> dict:
    """automation_trigger(kind=event|polling) → 统一 EventRoute DTO（只读投影）。"""
    cfg = trig.config or {}
    return {
        "id": trig.id,
        "origin": "automation_trigger",
        "sourceId": cfg.get("data_source_id") or "",
        "eventType": cfg.get("event_type") or "",
        "destination": {"kind": "automation", "id": trig.automation_id},
        "filter": _filter_view(cfg.get("filter")),
        "mapping": _mapping_view(cfg.get("mapping")),
        "dedupe": {},
        "completionPolicy": "accepted",
        "completionMeaning": _COMPLETION_MEANING["accepted"],
        "retryPolicy": {},
        "enabled": bool(trig.enabled),
        "archived": False,
        "revision": 1,
        "createdBy": None,
        "createdAt": _iso(trig.created_at),
        "updatedAt": None,
    }


def delivery_dto(d: EventDelivery) -> dict:
    kind = d.destination_kind or (
        "automation" if (d.automation_id or d.trigger_log_id) else None)
    policy = d.completion_policy or "accepted"
    return {
        "id": d.id,
        "eventId": d.event_id,
        "source": d.source,
        "status": (d.status or "").upper(),
        "routeId": d.route_id,
        "routeRevision": d.route_revision,
        "destinationKind": kind,
        "destinationId": d.destination_id or d.automation_id,
        "invocationId": d.invocation_id or d.trigger_log_id,
        "taskRunId": d.task_run_id,
        "completionPolicy": policy,
        "completionMeaning": _COMPLETION_MEANING.get(policy, ""),
        "attempts": d.attempts,
        "maxAttempts": d.max_attempts,
        "nextRetryAt": _iso(d.next_retry_at),
        "deadReason": d.dead_reason or None,
        "error": d.error or None,
        # 兼容列（保留至旧 API 零流量，Spec §10.2.1）
        "triggerId": d.trigger_id,
        "automationId": d.automation_id,
        "triggerLogId": d.trigger_log_id,
        "createdAt": _iso(d.created_at),
        "updatedAt": _iso(d.updated_at),
    }


# ---------- EventRoute CRUD ----------

def _validate_route_body(db: Session, body: dict, *, partial: dict | None = None) -> dict:
    """POST/PUT 共用校验；partial 为 PUT 时与现有值合并后的生效值。"""
    eff = dict(partial or {})
    eff.update({k: v for k, v in body.items() if v is not None})
    if "sourceId" in body:
        src = db.get(DataSource, body["sourceId"])
        if src is None:
            raise HTTPException(422, {"code": "SOURCE_NOT_FOUND",
                                      "detail": f"数据源不存在：{body['sourceId']}"})
        eff["sourceId"] = body["sourceId"]
    dest = body.get("destination")
    if dest is not None:
        kind = (dest or {}).get("kind")
        did = (dest or {}).get("id")
        if kind not in _DESTINATION_KINDS or not did:
            raise HTTPException(422, {"code": "DESTINATION_INVALID",
                                      "detail": "destination.kind 只允许 automation|analysis_task 且 id 必填"})
        # 强一致：destination.id 必须指向对应实体类型（Spec §12.6）
        if kind == "automation" and db.get(AutomationDefinition, did) is None:
            raise HTTPException(422, {"code": "DESTINATION_NOT_FOUND",
                                      "detail": f"AutomationDefinition 不存在：{did}"})
        if kind == "analysis_task" and db.get(AnalysisTask, did) is None:
            raise HTTPException(422, {"code": "DESTINATION_NOT_FOUND",
                                      "detail": f"AnalysisTask 不存在：{did}"})
        eff["destination"] = {"kind": kind, "id": did}
    cp = body.get("completionPolicy")
    if cp is not None and cp not in _COMPLETION_MEANING:
        raise HTTPException(422, {"code": "COMPLETION_POLICY_INVALID",
                                  "detail": "completionPolicy 只允许 accepted|terminal"})
    # 09-13 审计修复：filter op 保存时校验枚举（运行时已 fail-closed，
    # 这里把拼写错误挡在配置时刻而不是静默吞事件）
    if body.get("filter") is not None:
        expr = _filter_view(body.get("filter"))["expression"]
        if expr and expr.get("op") not in ("eq", "ne", "contains", "gt", "lt"):
            raise HTTPException(422, {
                "code": "FILTER_OP_INVALID",
                "detail": "filter.expression.op 只允许 eq|ne|contains|gt|lt"})
    return eff


@router.get("/event-routes")
def list_event_routes(sourceId: str = "", destinationKind: str = "",
                      enabled: str = "", includeArchived: str = "",
                      db: Session = Depends(get_db),
                      user: dict = Depends(require_role())):
    """统一 DTO 视图 = event_route 表 + legacy automation_trigger 投影。"""
    q = db.query(EventRoute)
    if includeArchived != "yes":
        q = q.filter(EventRoute.archived.is_(False))
    if sourceId:
        q = q.filter(EventRoute.source_id == sourceId)
    if destinationKind:
        q = q.filter(EventRoute.destination_kind == destinationKind)
    if enabled in ("true", "false"):
        q = q.filter(EventRoute.enabled.is_(enabled == "true"))
    items = [route_dto(r) for r in
             q.order_by(EventRoute.created_at.desc()).all()]
    legacy = db.query(AutomationTrigger).filter(
        AutomationTrigger.kind.in_(("event", "polling"))).all()
    for trig in legacy:
        dto = legacy_route_dto(trig)
        if sourceId and dto["sourceId"] != sourceId:
            continue
        if destinationKind and dto["destination"]["kind"] != destinationKind:
            continue
        if enabled in ("true", "false") and dto["enabled"] != (enabled == "true"):
            continue
        items.append(dto)
    return {"items": items, "total": len(items)}


@router.post("/event-routes", status_code=201)
def create_event_route(body: dict[str, Any], db: Session = Depends(get_db),
                       user: dict = Depends(require_operator)):
    if not body.get("sourceId"):
        raise HTTPException(422, {"code": "SOURCE_REQUIRED",
                                  "detail": "sourceId 必填"})
    eff = _validate_route_body(db, body)
    if "destination" not in eff:
        raise HTTPException(422, {"code": "DESTINATION_REQUIRED",
                                  "detail": "destination 必填"})
    dedupe = body.get("dedupe") or {}
    if dedupe.get("keyPath"):
        dedupe = {"keyPath": dedupe["keyPath"],
                  "windowSeconds": int(dedupe.get("windowSeconds") or 86400)}
    r = EventRoute(
        source_id=eff["sourceId"],
        event_type=str(body.get("eventType") or ""),
        destination_kind=eff["destination"]["kind"],
        destination_id=eff["destination"]["id"],
        filter=body.get("filter") or {},
        mapping=body.get("mapping") or {},
        dedupe=dedupe,
        completion_policy=body.get("completionPolicy") or "accepted",
        retry_policy=body.get("retryPolicy") or {},
        enabled=bool(body.get("enabled", True)),
        revision=1,
        created_by=user.get("username", "dev"),
    )
    db.add(r)
    db.commit()
    db.refresh(r)
    return route_dto(r)


def _get_route_or_legacy_409(db: Session, rid: str) -> EventRoute:
    r = db.get(EventRoute, rid)
    if r is not None:
        return r
    trig = db.get(AutomationTrigger, rid)
    if trig is not None and trig.kind in ("event", "polling"):
        raise HTTPException(409, {
            "code": "LEGACY_TRIGGER_READONLY",
            "detail": "automation_trigger 是 AS-IS 存储（Spec §10.0 兼容条款），"
                      "请通过 /api/v2/automations/{id} 的 trigger API 修改"})
    raise HTTPException(404, "event route not found")


@router.get("/event-routes/{rid}")
def get_event_route(rid: str, db: Session = Depends(get_db),
                    user: dict = Depends(require_role())):
    r = db.get(EventRoute, rid)
    if r is not None:
        return route_dto(r)
    trig = db.get(AutomationTrigger, rid)
    if trig is not None and trig.kind in ("event", "polling"):
        return legacy_route_dto(trig)
    raise HTTPException(404, "event route not found")


@router.put("/event-routes/{rid}")
def update_event_route(rid: str, body: dict[str, Any],
                       db: Session = Depends(get_db),
                       user: dict = Depends(require_operator)):
    r = _get_route_or_legacy_409(db, rid)
    if r.archived:
        raise HTTPException(409, {"code": "ROUTE_ARCHIVED",
                                  "detail": "已归档路由不可编辑"})
    partial = {"sourceId": r.source_id,
               "destination": {"kind": r.destination_kind, "id": r.destination_id},
               "completionPolicy": r.completion_policy}
    eff = _validate_route_body(db, body, partial=partial)
    if "sourceId" in body:
        r.source_id = body["sourceId"]
    if body.get("eventType") is not None:
        r.event_type = str(body.get("eventType") or "")
    if "destination" in eff and body.get("destination") is not None:
        r.destination_kind = eff["destination"]["kind"]
        r.destination_id = eff["destination"]["id"]
    if body.get("filter") is not None:
        r.filter = body["filter"]
    if body.get("mapping") is not None:
        r.mapping = body["mapping"]
    if body.get("dedupe") is not None:
        ded = body["dedupe"] or {}
        r.dedupe = ({"keyPath": ded.get("keyPath"),
                     "windowSeconds": int(ded.get("windowSeconds") or 86400)}
                    if ded.get("keyPath") else {})
    if body.get("completionPolicy") is not None:
        r.completion_policy = body["completionPolicy"]
    if body.get("retryPolicy") is not None:
        r.retry_policy = body["retryPolicy"]
    if body.get("enabled") is not None:
        r.enabled = bool(body["enabled"])
    r.revision += 1  # Spec §12.6：PUT 返回递增后的 revision
    db.commit()
    db.refresh(r)
    return route_dto(r)


@router.delete("/event-routes/{rid}")
def delete_event_route(rid: str, db: Session = Depends(get_db),
                       user: dict = Depends(require_operator)):
    """§10.0 归档语义：enabled=false + archived 标记，不物理删除。"""
    r = _get_route_or_legacy_409(db, rid)
    r.enabled = False
    r.archived = True
    r.revision += 1
    db.commit()
    return {"id": r.id, "archived": True, "enabled": False, "revision": r.revision}


# ---------- EventDelivery 流水 ----------

@router.get("/event-deliveries")
def list_event_deliveries(sourceEventId: str = "", sourceId: str = "",
                          status: str = "",
                          destinationKind: str = "", dateFrom: str = "",
                          dateTo: str = "", page: int = 1, pageSize: int = 50,
                          db: Session = Depends(get_db),
                          user: dict = Depends(require_role())):
    q = db.query(EventDelivery)
    if sourceEventId:
        q = q.filter(EventDelivery.event_id == sourceEventId)
    if sourceId:
        # 09-14 D3：数据源治理页事件流水（event → source 反查）
        ev_ids = select(DataSourceEvent.id).where(
            DataSourceEvent.source_id == sourceId)
        q = q.filter(EventDelivery.event_id.in_(ev_ids))
    if status:
        q = q.filter(EventDelivery.status == status.lower())
    if destinationKind:
        q = q.filter(EventDelivery.destination_kind == destinationKind)
    if dateFrom:
        q = q.filter(EventDelivery.created_at >=
                     datetime.fromisoformat(dateFrom).astimezone(timezone.utc))
    if dateTo:
        q = q.filter(EventDelivery.created_at <
                     datetime.fromisoformat(dateTo).astimezone(timezone.utc))
    page = max(page, 1)
    pageSize = min(max(pageSize, 1), 200)
    total = q.count()
    rows = (q.order_by(EventDelivery.created_at.desc())
            .offset((page - 1) * pageSize).limit(pageSize).all())
    out: dict[str, Any] = {"items": [delivery_dto(d) for d in rows],
                           "total": total, "page": page, "pageSize": pageSize}
    if sourceEventId:
        # AC-023/024：filtered/deduped 不产生 delivery 行，证据在事件 route_outcomes
        ev = db.get(DataSourceEvent, sourceEventId)
        out["sourceEvent"] = ({
            "id": ev.id, "status": ev.status, "error": ev.error or None,
            "dedupeKey": ev.dedupe_key,
            "routeOutcomes": ev.route_outcomes or [],
        } if ev else None)
    return out


@router.get("/event-deliveries/{did}")
def get_event_delivery(did: str, db: Session = Depends(get_db),
                       user: dict = Depends(require_role())):
    d = db.get(EventDelivery, did)
    if d is None:
        raise HTTPException(404, "delivery not found")
    return delivery_dto(d)


@router.post("/event-deliveries/{did}/retry")
def retry_event_delivery(did: str, db: Session = Depends(get_db),
                         user: dict = Depends(require_operator)):
    """只接受 FAILED/DEAD；重发使用创建时冻结的 mapped_input/route_revision。"""
    from .as_automations import _apply_mapping, _schedule_retry, dispatch

    d = db.get(EventDelivery, did)
    if d is None:
        raise HTTPException(404, "delivery not found")
    if d.status not in ("failed", "dead"):
        raise HTTPException(409, {
            "code": "RETRY_STATUS_INVALID",
            "detail": f"retry 只接受 FAILED/DEAD（当前 {d.status.upper()}）"})
    kind = d.destination_kind or (
        "automation" if (d.automation_id or d.trigger_log_id) else None)
    # 409 预检必须先于状态改写：否则 HTTPException 路径会把 pending 状态 commit 落库
    if kind == "analysis_task":
        if db.get(AnalysisTask, d.destination_id) is None:
            raise HTTPException(409, {"code": "DESTINATION_MISSING",
                                      "detail": "AnalysisTask 已不存在，不可重试"})
    else:
        auto_pre = db.get(AutomationDefinition, d.destination_id or d.automation_id)
        if auto_pre is None:
            raise HTTPException(409, {"code": "DESTINATION_MISSING",
                                      "detail": "AutomationDefinition 已不存在，不可重试"})
        if not auto_pre.enabled:
            raise HTTPException(409, {"code": "AUTOMATION_DISABLED",
                                      "detail": "目标自动任务已暂停，先启用再重试"})
    mapped = d.mapped_input
    if mapped is None:
        # 兼容旧行（F5 前无冻结输入）：按原 trigger config 对原事件重算，诚实标注
        ev = db.get(DataSourceEvent, d.event_id)
        trig = db.get(AutomationTrigger, d.trigger_id) if d.trigger_id else None
        mapped = _apply_mapping({"mapping": (trig.config or {}).get("mapping") or {}},
                                (ev.payload if ev else {}) or {})
    if d.status == "dead":
        d.dead_reason = ""
        d.next_retry_at = None
    d.status = "pending"
    try:
        if kind == "analysis_task":
            from ..task_runner import TaskStartError, start_task_run
            tr, _res = start_task_run(
                db, d.destination_id, trigger="event",
                idempotency_key=f"event-delivery:{d.id}")
            if tr.event_delivery_id is None:
                ev = db.get(DataSourceEvent, d.event_id)
                tr.source_event_id = ev.id if ev else None
                tr.event_delivery_id = d.id
            d.task_run_id = tr.id
            d.attempts += 1
            d.status = "running" if d.completion_policy == "terminal" else "completed"
            d.error = ""
        else:
            auto = db.get(AutomationDefinition, d.destination_id or d.automation_id)
            lg = dispatch(db, auto.created_by or "dev", auto, mapped,
                          source="event", trigger_id=d.trigger_id)
            d.attempts += 1
            d.trigger_log_id = lg.id
            d.invocation_id = lg.id
            if lg.status == "failed":
                d.status = "failed"
                d.error = lg.error or "dispatch returned failed"
                _schedule_retry(d)
            else:
                d.status = ("running"
                            if d.completion_policy == "terminal" else "completed")
                d.error = ""
                d.next_retry_at = None
    except HTTPException:
        db.commit()
        raise
    except Exception as exc:  # noqa: BLE001
        from ..task_runner import TaskStartError
        d.attempts += 1
        d.status = "failed"
        d.error = (str(exc.args[0]) if isinstance(exc, TaskStartError) and exc.args
                   else repr(exc))
        _schedule_retry(d)
    db.commit()
    db.refresh(d)
    return delivery_dto(d)


# ---------- watcher：terminal 策略结算 ----------

def reconcile_terminal_deliveries(db: Session) -> int:
    """F5：completion_policy=terminal 的 running delivery 按目标终态结算。

    - automation → Invocation（automation_trigger_log）终态；
    - analysis_task → TaskRun 终态（succeeded|failed|cancelled|partial）；
    - 目标行缺失 → dead（反链损坏，需人工）；
    - 目标业务失败仍算派发契约结算完成（completed），业务结果以目标侧为准，
      不在 delivery 上伪造错误（Spec §10.2 COMPLETED 语义）。
    """
    rows = (db.query(EventDelivery)
            .filter(EventDelivery.status == "running",
                    EventDelivery.completion_policy == "terminal")
            .limit(100).all())
    settled = 0
    for d in rows:
        if d.destination_kind == "analysis_task" and d.task_run_id:
            tr = db.get(TaskRun, d.task_run_id)
            if tr is None:
                d.status = "dead"
                d.dead_reason = "task run missing（反链损坏）"
                settled += 1
            elif tr.status in _TERMINAL_TR_STATUSES:
                d.status = "completed"
                settled += 1
        elif d.invocation_id or d.trigger_log_id:
            lg = db.get(AutomationTriggerLog, d.invocation_id or d.trigger_log_id)
            if lg is None:
                d.status = "dead"
                d.dead_reason = "invocation missing（反链损坏）"
                settled += 1
            elif (lg.status or "") in _TERMINAL_INV_STATUSES:
                d.status = "completed"
                settled += 1
    if settled:
        db.commit()
    return settled
