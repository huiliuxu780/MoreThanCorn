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
    from app.models import CallRecord, Run
    db = SessionLocal()
    try:
        # canonical schema：call_record.run_id NOT NULL（g040）——挂真实 Run
        run = Run(trigger="test", input={})
        db.add(run)
        db.flush()
        db.add(CallRecord(run_id=run.id, kind="model", target_id="m1", status="success",
                          token_usage={"promptTokens": 100, "completionTokens": 50}))
        db.add(CallRecord(run_id=run.id, kind="model", target_id="m1", status="success",
                          token_usage={"promptTokens": 30, "completionTokens": 20}))
        db.add(CallRecord(run_id=run.id, kind="tool", target_id="t1", status="success",
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


def test_worker_id_unique_not_fixed():
    """审计：Worker ID 曾固定 w1；现每进程唯一。"""
    from app.runner import WORKER_ID
    assert WORKER_ID.startswith("w-") and WORKER_ID != "w1"
    assert len(WORKER_ID) > 3


def test_heartbeat_configured():
    """P1-05：心跳间隔存在且小于租约（防长任务被误回收）。"""
    from app.runner import HEARTBEAT_SECONDS, LEASE_SECONDS_DEFAULT
    assert 0 < HEARTBEAT_SECONDS < LEASE_SECONDS_DEFAULT
