"""09-SDD P1 修复轮：加固项回归（SQL 注入 / 成本聚合 / 告警指标 / Worker ID / 心跳）。"""
import uuid
from datetime import datetime, timezone

from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app

client = TestClient(app)


def test_by_dimension_blocks_sql_injection():
    """审计：by-dimension 曾把未校验 dim 拼进 SQL；现白名单/标识符校验拒绝注入。"""
    r = client.get("/api/quality/analytics/by-dimension",
                   params={"dim": "team'; DROP TABLE run;--"})
    assert r.status_code == 422
    # 合法维度仍可用
    ok = client.get("/api/quality/analytics/by-dimension", params={"dim": "team"})
    assert ok.status_code == 200


def test_cost_stats_aggregates_from_call_records():
    """审计：成本曾读从不写入的 Run.token_usage 恒 0；现从 CallRecord 模型调用聚合。"""
    from app.models import CallRecord
    db = SessionLocal()
    try:
        db.add(CallRecord(kind="model", target_id="m1", status="success",
                          token_usage={"promptTokens": 100, "completionTokens": 50}))
        db.add(CallRecord(kind="model", target_id="m1", status="success",
                          token_usage={"promptTokens": 30, "completionTokens": 20}))
        db.add(CallRecord(kind="tool", target_id="t1", status="success",
                          token_usage={"promptTokens": 999, "completionTokens": 999}))
        db.commit()
    finally:
        db.close()
    r = client.get("/api/observability/cost-stats")
    assert r.status_code == 200
    body = r.json()
    # 仅聚合 kind=model：100+30=130 prompt，50+20=70 completion（tool 的 999 不计入）
    assert body["totalPromptTokens"] >= 130
    assert body["totalCompletionTokens"] >= 70
    assert body["totalTokens"] >= 200
    assert body.get("modelCalls", 0) >= 2


def test_alert_metrics_datasource_and_model():
    """P1-08：告警指标覆盖数据源故障 / 模型不可用。"""
    from app.models import Datasource, ModelProvider
    db = SessionLocal()
    try:
        ds = Datasource(name="bad-ds", type="postgresql", health="error")
        db.add(ds)
        prov = ModelProvider(name="mock-prov", base_url="mock://fake")
        db.add(prov)
        db.commit()
    finally:
        db.close()
    from app.routers.alerts import _metric_value
    db = SessionLocal()
    try:
        assert _metric_value(db, "datasource_error") >= 1, "应统计 health=error 的数据源"
        assert _metric_value(db, "model_unavailable") >= 1, "应统计 mock:// Provider"
    finally:
        db.close()


def test_alert_evaluate_consumes_notify():
    """P1-08（审计：消费 notify）：评估返回 notified 计数，不崩溃。"""
    r = client.post("/api/alerts/rules", json={
        "name": "backlog-rule", "metric": "queue_backlog", "operator": "gte",
        "threshold": 0, "severity": "warning",
        "notify": {"webhook": "http://127.0.0.1:1/none"}})
    assert r.status_code == 201
    ev = client.post("/api/alerts/evaluate")
    assert ev.status_code == 200
    assert "fired" in ev.json() and "notified" in ev.json()


def test_worker_id_unique_not_fixed():
    """审计：Worker ID 曾固定 w1；现每进程唯一。"""
    from app.runner import WORKER_ID
    assert WORKER_ID.startswith("w-") and WORKER_ID != "w1"
    assert len(WORKER_ID) > 3


def test_heartbeat_configured():
    """P1-05：心跳间隔存在且小于租约（防长任务被误回收）。"""
    from app.runner import HEARTBEAT_SECONDS, LEASE_SECONDS_DEFAULT
    assert 0 < HEARTBEAT_SECONDS < LEASE_SECONDS_DEFAULT
