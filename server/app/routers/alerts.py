"""09-SDD P1-B4 / P1-08：告警——规则配置 + 阈值评估 + 事件留痕。"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import AlertEvent, AlertRule, JobQueue, Run, Schedule

router = APIRouter(tags=["alerts"])


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
    raise HTTPException(422, f"未知指标 {metric}")


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
def create_rule(payload: dict, db: Session = Depends(get_db)):
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
def update_rule(rid: str, payload: dict, db: Session = Depends(get_db)):
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
def delete_rule(rid: str, db: Session = Depends(get_db)):
    r = db.get(AlertRule, rid)
    if not r:
        raise HTTPException(404, "告警规则不存在")
    db.delete(r)
    db.commit()
    return {"ok": True}


@router.post("/api/alerts/evaluate")
def evaluate_alerts(db: Session = Depends(get_db)):
    """评估所有启用规则，超阈值生成告警事件（留痕）。"""
    fired = 0
    for rule in db.query(AlertRule).filter(AlertRule.enabled).all():
        try:
            value = _metric_value(db, rule.metric)
        except HTTPException:
            continue
        op = _OPS.get(rule.operator, _OPS["gt"])
        if op(value, rule.threshold):
            db.add(AlertEvent(rule_id=rule.id, metric=rule.metric, value=value,
                              threshold=rule.threshold, severity=rule.severity,
                              message=f"{rule.name}: {rule.metric}={value} {rule.operator} {rule.threshold}"))
            fired += 1
    db.commit()
    return {"fired": fired}


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
def acknowledge_event(eid: str, db: Session = Depends(get_db)):
    e = db.get(AlertEvent, eid)
    if not e:
        raise HTTPException(404, "告警事件不存在")
    e.acknowledged = True
    db.commit()
    return {"id": e.id, "acknowledged": True}
