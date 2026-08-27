"""09-SDD P1-B4 / P1-08：告警——规则配置 + 阈值评估 + 告警事件留痕。

先红后绿：当前无告警模型/端点。
"""
from datetime import datetime, timezone

from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.models import AlertEvent, AlertRule, JobQueue

client = TestClient(app)


def _cleanup_rules():
    db = SessionLocal()
    db.query(AlertEvent).delete()
    db.query(AlertRule).delete()
    db.commit()
    db.close()


def test_alert_rule_crud():
    _cleanup_rules()
    r = client.post("/api/alerts/rules", json={
        "name": "队列积压告警", "metric": "queue_backlog",
        "operator": "gt", "threshold": 0, "severity": "warning"})
    assert r.status_code == 201, r.text
    rid = r.json()["id"]
    rules = client.get("/api/alerts/rules").json()["items"]
    assert any(x["id"] == rid for x in rules)
    _cleanup_rules()


def test_alert_evaluation_fires_on_threshold():
    _cleanup_rules()
    # 制造积压：1 个 pending 任务；阈值 0 → 触发
    db = SessionLocal()
    j = JobQueue(type="alert-probe", payload={}, status="pending",
                 run_at=datetime.now(timezone.utc))
    db.add(j)
    db.flush()
    rule = AlertRule(name="积压", metric="queue_backlog", operator="gt",
                     threshold=0, severity="warning", enabled=True)
    db.add(rule)
    db.commit()
    jid, rule_id = j.id, rule.id
    db.close()
    try:
        ev = client.post("/api/alerts/evaluate")
        assert ev.status_code == 200, ev.text
        fired = ev.json()["fired"]
        assert fired >= 1, "应触发至少一条告警事件"
        events = client.get("/api/alerts/events").json()["items"]
        assert any(e["ruleId"] == rule_id for e in events), "告警事件应留痕"
    finally:
        db = SessionLocal()
        db.query(AlertEvent).delete()
        db.query(AlertRule).filter_by(id=rule_id).delete()
        db.query(JobQueue).filter_by(id=jid).delete()
        db.commit()
        db.close()


def test_alert_not_fired_below_threshold():
    _cleanup_rules()
    db = SessionLocal()
    # 阈值极高（999999）→ 不触发
    rule = AlertRule(name="不触发", metric="queue_backlog", operator="gt",
                     threshold=999999, severity="critical", enabled=True)
    db.add(rule)
    db.commit()
    rule_id = rule.id
    db.close()
    try:
        before = len(client.get("/api/alerts/events").json()["items"])
        client.post("/api/alerts/evaluate")
        after = len(client.get("/api/alerts/events").json()["items"])
        assert after == before, "低于阈值不应新增告警事件"
    finally:
        db = SessionLocal()
        db.query(AlertEvent).delete()
        db.query(AlertRule).filter_by(id=rule_id).delete()
        db.commit()
        db.close()


def test_disabled_rule_not_evaluated():
    _cleanup_rules()
    db = SessionLocal()
    rule = AlertRule(name="停用", metric="queue_backlog", operator="gt",
                     threshold=0, severity="warning", enabled=False)
    db.add(rule)
    db.commit()
    rule_id = rule.id
    db.close()
    try:
        client.post("/api/alerts/evaluate")
        events = client.get("/api/alerts/events").json()["items"]
        assert not any(e["ruleId"] == rule_id for e in events), "停用规则不应评估"
    finally:
        db = SessionLocal()
        db.query(AlertEvent).delete()
        db.query(AlertRule).filter_by(id=rule_id).delete()
        db.commit()
        db.close()
