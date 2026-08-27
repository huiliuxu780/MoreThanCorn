"""09-SDD P1-B3 / P1-07：全链路可观测——运行统计/队列积压/调度延误/成本端点。

先红后绿：当前无统一观测统计端点（仅零散 /metrics 计数）。
"""
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.models import JobQueue, Run

client = TestClient(app)


def test_run_stats_by_status_and_latency():
    r = client.get("/api/observability/run-stats")
    assert r.status_code == 200, r.text
    body = r.json()
    assert "byStatus" in body and "total" in body
    assert isinstance(body["byStatus"], dict)
    assert body["total"] >= 0
    # byStatus 各键计数之和 == total
    assert sum(body["byStatus"].values()) == body["total"]


def test_queue_backlog_metric():
    # 制造一个 pending 任务（run_at 置未来，worker 不会认领），积压应 >= 1
    from datetime import timedelta
    db = SessionLocal()
    try:
        j = JobQueue(type="obs-probe", payload={}, status="pending",
                     run_at=datetime.now(timezone.utc) + timedelta(hours=1))
        db.add(j)
        db.commit()
        jid = j.id
    finally:
        db.close()
    try:
        r = client.get("/api/observability/queue-stats")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["pending"] >= 1, "积压应统计 pending 任务"
        assert "dead" in body
    finally:
        db = SessionLocal()
        db.query(JobQueue).filter_by(id=jid).delete()
        db.commit()
        db.close()


def test_schedule_delay_metric():
    """到期未触发的调度延误（next_run_at 已过但仍在未来时刻）应可度量。"""
    r = client.get("/api/observability/schedule-stats")
    assert r.status_code == 200, r.text
    body = r.json()
    assert "enabled" in body and "overdue" in body
    assert body["enabled"] >= 0 and body["overdue"] >= 0


def test_token_cost_aggregation():
    r = client.get("/api/observability/cost-stats")
    assert r.status_code == 200, r.text
    body = r.json()
    assert "totalPromptTokens" in body and "totalCompletionTokens" in body
    assert body["totalPromptTokens"] >= 0
