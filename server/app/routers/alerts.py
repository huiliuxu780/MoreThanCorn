"""09-SDD P1-B4 / P1-08：告警——规则配置 + 阈值评估 + 事件留痕 + 通知消费。

09 P1（审计：告警只生成事件不通知）：评估超阈值时除留痕外，按规则 notify 配置
分发通知（webhook 尽力投递 + 日志留痕）。指标覆盖队列/调度/运行错误率/数据源/模型。
"""
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import (AlertEvent, AlertRule, Datasource, JobQueue,
                      ModelProvider, Run, Schedule)
from ..auth import require_admin, require_operator

router = APIRouter(tags=["alerts"])
_logger = logging.getLogger("alerts")


def _metric_value(db: Session, metric: str) -> float:
    if metric == "queue_backlog":
        return float(db.query(func.count(JobQueue.id)).filter(JobQueue.status == "pending").scalar() or 0)
    if metric == "dead_letter":
        return float(db.query(func.count(JobQueue.id)).filter(JobQueue.status == "dead").scalar() or 0)
    if metric == "schedule_overdue":
        return float(db.query(func.count(Schedule.id)).filter(
            Schedule.enabled, Schedule.next_run_at.isnot(None),
            Schedule.next_run_at < func.now()).scalar() or 0)
    if metric == "run_error_rate":
        total = db.query(func.count(Run.id)).scalar() or 0
        if not total:
            return 0.0
        failed = db.query(func.count(Run.id)).filter(Run.status == "failed").scalar() or 0
        return round(failed / total * 100, 2)
    if metric == "datasource_error":
        return float(db.query(func.count(Datasource.id)).filter(
            Datasource.health == "error").scalar() or 0)
    if metric == "model_unavailable":
        # base_url 非 http(s)（mock:// 或空）= 生产不可用的 Provider
        rows = db.query(ModelProvider).all()
        return float(sum(1 for p in rows
                         if not str(p.base_url or "").startswith(("http://", "https://"))))
    raise HTTPException(422, f"未知指标 {metric}")


def _dispatch_notification(rule: AlertRule, message: str, value: float) -> dict:
    """09 P1-08（审计：消费 notify）：按规则 notify 配置分发通知。

    支持 webhook（尽力投递，失败仅日志不阻塞）；无配置时仅日志留痕。
    返回 {"dispatched": bool, "channel": str}。"""
    notify = rule.notify or {}
    webhook = notify.get("webhook")
    if webhook:
        try:
            import httpx
            with httpx.Client(timeout=5) as client:
                client.post(webhook, json={"rule": rule.name, "metric": rule.metric,
                                           "severity": rule.severity, "value": value,
                                           "message": message})
            _logger.info("告警已投递 webhook %s: %s", webhook, message)
            return {"dispatched": True, "channel": "webhook"}
        except Exception as exc:  # noqa: BLE001
            _logger.warning("告警 webhook 投递失败 %s: %s", webhook, exc)
            return {"dispatched": False, "channel": "webhook_failed"}
    _logger.info("告警（无外部通道，仅留痕）: %s", message)
    return {"dispatched": False, "channel": "log_only"}


_OPS = {
    "gt": lambda v, t: v > t,
    "gte": lambda v, t: v >= t,
    "lt": lambda v, t: v < t,
    "lte": lambda v, t: v <= t,
}


@router.get("/api/alerts/rules")
def list_rules(db: Session = Depends(get_db)):
    rows = db.query(AlertRule).order_by(AlertRule.created_at.desc()).all()
    return {"items": [{"id": r.id, "name": r.name, "metric": r.metric, "operator": r.operator,
                       "threshold": r.threshold, "severity": r.severity, "enabled": r.enabled,
                       "notify": r.notify, "createdAt": r.created_at.isoformat()} for r in rows]}


@router.post("/api/alerts/rules", status_code=201)
def create_rule(payload: dict, db: Session = Depends(get_db),
                 _user: dict = Depends(require_admin) ):
    metric = payload.get("metric")
    try:
        _metric_value(db, metric)
    except HTTPException:
        raise
    r = AlertRule(name=payload["name"], metric=metric,
                  operator=payload.get("operator", "gt"),
                  threshold=float(payload.get("threshold", 0)),
                  severity=payload.get("severity", "warning"),
                  enabled=payload.get("enabled", True),
                  notify=payload.get("notify", {}))
    db.add(r)
    db.commit()
    return {"id": r.id, "name": r.name}


@router.post("/api/alerts/rules/{rid}")
def update_rule(rid: str, payload: dict, db: Session = Depends(get_db),
                 _user: dict = Depends(require_admin) ):
    r = db.get(AlertRule, rid)
    if not r:
        raise HTTPException(404, "告警规则不存在")
    for k, attr in [("name", "name"), ("operator", "operator"), ("severity", "severity")]:
        if payload.get(k) is not None:
            setattr(r, attr, payload[k])
    if payload.get("threshold") is not None:
        r.threshold = float(payload["threshold"])
    if payload.get("enabled") is not None:
        r.enabled = bool(payload["enabled"])
    db.commit()
    return {"id": r.id, "enabled": r.enabled}


@router.delete("/api/alerts/rules/{rid}")
def delete_rule(rid: str, db: Session = Depends(get_db),
                 _user: dict = Depends(require_admin) ):
    r = db.get(AlertRule, rid)
    if not r:
        raise HTTPException(404, "告警规则不存在")
    db.delete(r)
    db.commit()
    return {"ok": True}


@router.post("/api/alerts/evaluate")
def evaluate_alerts(db: Session = Depends(get_db),
                 _user: dict = Depends(require_operator) ):
    """评估所有启用规则，超阈值生成告警事件（留痕）并按 notify 分发通知。"""
    fired = 0
    notified = 0
    for rule in db.query(AlertRule).filter(AlertRule.enabled).all():
        try:
            value = _metric_value(db, rule.metric)
        except HTTPException:
            continue
        op = _OPS.get(rule.operator, _OPS["gt"])
        if op(value, rule.threshold):
            message = f"{rule.name}: {rule.metric}={value} {rule.operator} {rule.threshold}"
            db.add(AlertEvent(rule_id=rule.id, metric=rule.metric, value=value,
                              threshold=rule.threshold, severity=rule.severity,
                              message=message))
            # 09 P1-08：消费 notify 分发（尽力，不阻塞评估）
            if _dispatch_notification(rule, message, value)["dispatched"]:
                notified += 1
            fired += 1
    db.commit()
    return {"fired": fired, "notified": notified}


@router.get("/api/alerts/events")
def list_events(page: int = 1, pageSize: int = 50, db: Session = Depends(get_db)):
    q = db.query(AlertEvent).order_by(AlertEvent.created_at.desc())
    total = q.count()
    rows = q.offset((page - 1) * pageSize).limit(pageSize).all()
    return {"items": [{"id": e.id, "ruleId": e.rule_id, "metric": e.metric, "value": e.value,
                       "threshold": e.threshold, "severity": e.severity, "message": e.message,
                       "acknowledged": e.acknowledged, "createdAt": e.created_at.isoformat()}
                      for e in rows], "total": total, "page": page, "pageSize": pageSize}


@router.post("/api/alerts/events/{eid}/acknowledge")
def acknowledge_event(eid: str, db: Session = Depends(get_db),
                 _user: dict = Depends(require_operator) ):
    e = db.get(AlertEvent, eid)
    if not e:
        raise HTTPException(404, "告警事件不存在")
    e.acknowledged = True
    db.commit()
    return {"id": e.id, "acknowledged": True}
