"""09-SDD P1-B4 / P1-04：数据治理基础——Eligibility / 增量水位 / 保留删除。

审计缺口：checkpoint 从未写入、保留/删除策略不存在、Eligibility 无验收测试。
"""
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.runner import start_worker
from tests._quality_setup import (MAPPING, make_asset, make_definition_version,
                                  make_quality_workflow, make_rule_version)

client = TestClient(app)
start_worker()


def test_eligibility_hit_unit():
    """P1-04：Eligibility 条件过滤（AND 列表，元素 {field,op,value}）。"""
    from app.task_runner import _eligibility_hit
    row = {"score": 80, "risk": "Low", "channel": "web"}
    assert _eligibility_hit(row, []) is True  # 空=通过
    assert _eligibility_hit(row, [{"field": "score", "op": "gt", "value": 50}]) is True
    assert _eligibility_hit(row, [{"field": "score", "op": "gt", "value": 90}]) is False
    assert _eligibility_hit(row, [{"field": "channel", "op": "eq", "value": "web"}]) is True
    # AND：全部满足才通过
    assert _eligibility_hit(row, [{"field": "score", "op": "gt", "value": 50},
                                  {"field": "channel", "op": "eq", "value": "web"}]) is True
    assert _eligibility_hit(row, [{"field": "score", "op": "gt", "value": 50},
                                  {"field": "channel", "op": "eq", "value": "app"}]) is False


def _wait_task_run(trid, timeout=40):
    import time
    deadline = time.time() + timeout
    while time.time() < deadline:
        t = client.get(f"/api/task-runs/{trid}").json()
        if t["status"] in ("succeeded", "partial", "failed", "cancelled"):
            return t
        time.sleep(0.3)
    raise AssertionError(f"task-run {trid} 未到终态")


def test_watermark_written_to_snapshot():
    """P1-04（审计：checkpoint 从未写入）：批次执行后快照写入增量水位。"""
    rows = [
        {"interactionId": "W1", "interactionTime": "2026-08-01T10:00:00Z",
         "score": 90, "risk": "Low", "issues": [], "summary": "a"},
        {"interactionId": "W2", "interactionTime": "2026-08-03T12:00:00Z",
         "score": 85, "risk": "Low", "issues": [], "summary": "b"},
    ]
    asset_id = make_asset(client, rows)
    wf_id, wv_id = make_quality_workflow(client, "wm-wf")
    defv = make_definition_version(client, asset_id)
    rpv = make_rule_version(client)
    task = client.post("/api/tasks", json={
        "name": "水位任务", "workflowId": wf_id, "workflowVersionPolicy": "pinned",
        "pinnedWorkflowVersionId": wv_id, "dataAssetId": asset_id,
        "dataDefinitionVersionId": defv, "resultRuleVersionId": rpv,
        "inputMapping": MAPPING, "sampling": {"mode": "all"},
        "dataWindow": {"mode": "all"}}).json()
    start = client.post(f"/api/tasks/{task['id']}/runs", json={})
    _wait_task_run(start.json()["taskRunId"])
    snap = client.get(f"/api/task-runs/{start.json()['taskRunId']}/snapshot").json()["dataSnapshot"]
    assert snap["checkpoint"], "快照应写入增量水位（最大交互时间）"
    assert snap["checkpoint"] >= "2026-08-03"


def test_retention_purge_requires_explicit_days():
    """P1-04：保留删除必须显式传 retentionDays（禁止隐式删除）。"""
    r = client.post("/api/quality-results/retention-purge", json={})
    assert r.status_code == 422
    r2 = client.post("/api/quality-results/retention-purge", json={"retentionDays": 0})
    assert r2.status_code == 422


def test_retention_purge_deletes_old_results():
    """P1-04：超过保留期的质检结果被删除（受控、留痕）。"""
    from app.models import QualityResult
    db = SessionLocal()
    try:
        old = QualityResult(interaction_ref="RETAIN-OLD",
                            created_at=datetime.now(timezone.utc) - timedelta(days=120),
                            score=50)
        db.add(old)
        db.commit()
        old_id = old.id
    finally:
        db.close()
    r = client.post("/api/quality-results/retention-purge", json={"retentionDays": 90})
    assert r.status_code == 200, r.text
    assert r.json()["deleted"] >= 1
    db = SessionLocal()
    try:
        assert db.get(QualityResult, old_id) is None, "超期结果应被删除"
    finally:
        db.close()
