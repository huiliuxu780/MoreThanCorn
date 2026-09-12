"""F3 分析批跑可靠性回归（2026-09-12，Spec §9/§12.4/§19 F3）。

- AC-030/031：total 尽早 exact + processed 单调 + 计数恒等；
- AC-033：取消=不再派发新项，未派发项落 cancelled，批次 cancelled；
- AC-034/035/035A：retry-failed = Recovery TaskRun（血缘/作用域/轮次），原批次保持终态；
- AC-038：空数据集成功结束 + outcome_code=NO_ELIGIBLE_ITEMS（非系统失败）；
- summary 端点：计数/速率/ETA/topErrors/执行与投递状态分离；
- 有界并发：sampling.concurrency 上限生效。
"""
from __future__ import annotations

import threading
import time

import pytest

from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.models import JobQueue, Run, TaskRun
from tests.test_p0_taskrun import (_mk_valid_task, _rows_score_risk, _wait_task_run,
                                   client)


@pytest.fixture(autouse=True)
def _cleanup_batch_rows():
    """同会话共享测试库：F3 产生的批次行不得污染看板类测试（列计数断言）。"""
    from datetime import datetime, timezone

    from app.models import QualityResult, TaskRun, TaskRunErrorAgg

    baseline = datetime.now(timezone.utc)
    yield
    db = SessionLocal()
    try:
        trs = [tr.id for tr in
               db.query(TaskRun).filter(TaskRun.created_at >= baseline).all()]
        if trs:
            run_ids = [r[0] for r in
                       db.query(Run.id).filter(Run.task_run_id.in_(trs)).all()]
            if run_ids:
                db.query(QualityResult).filter(
                    QualityResult.run_id.in_(run_ids)).delete(
                        synchronize_session=False)
            db.query(Run).filter(Run.task_run_id.in_(trs)).delete(
                synchronize_session=False)
            db.query(TaskRunErrorAgg).filter(
                TaskRunErrorAgg.task_run_id.in_(trs)).delete(
                    synchronize_session=False)
            db.query(TaskRun).filter(TaskRun.id.in_(trs)).delete(
                synchronize_session=False)
            db.commit()
    finally:
        db.close()


def _drain_job(trid: str) -> None:
    """移除队列 job 后同步执行（确定性，避开内嵌 worker 竞态）。"""
    from app import task_runner

    db = SessionLocal()
    try:
        for j in db.query(JobQueue).filter(JobQueue.payload["task_run_id"].astext == trid).all():
            db.delete(j)
        db.commit()
    finally:
        db.close()
    task_runner.execute_task_run(trid)


def test_ac030_031_processed_and_counts_identity():
    task = _mk_valid_task(_rows_score_risk(4))
    start = client.post(f"/api/tasks/{task['id']}/runs", json={})
    assert start.status_code == 202
    trid = start.json()["taskRunId"]
    _drain_job(trid)
    tr = _wait_task_run(trid)
    assert tr["total"] == 4
    assert tr["processedCount"] == 4, tr
    assert tr["totalState"] == "exact"
    assert tr["processedCount"] == (tr["succeeded"] + tr["failed"]
                                    + tr["skipped"] + tr["cancelled"])


def test_ac033_cancel_stops_new_dispatch():
    task = _mk_valid_task(_rows_score_risk(3))
    start = client.post(f"/api/tasks/{task['id']}/runs", json={})
    trid = start.json()["taskRunId"]
    canc = client.post(f"/api/task-runs/{trid}/cancel")
    assert canc.status_code == 202, canc.text
    assert canc.json()["cancelRequested"] is True
    _drain_job(trid)
    tr = _wait_task_run(trid)
    assert tr["status"] == "cancelled", tr
    assert tr["cancelled"] == 3, tr
    db = SessionLocal()
    try:
        runs = db.query(Run).filter(Run.task_run_id == trid).all()
        assert runs and all(r.status == "cancelled" for r in runs)
    finally:
        db.close()
    # 终态后取消 409
    again = client.post(f"/api/task-runs/{trid}/cancel")
    assert again.status_code == 409


def test_ac035a_retry_creates_recovery_taskrun():
    rows = _rows_score_risk(2)
    rows.append({"interactionId": "BAD1", "score": "not-a-number", "risk": "High",
                 "issues": [], "summary": "schema-invalid"})
    task = _mk_valid_task(rows)
    start = client.post(f"/api/tasks/{task['id']}/runs", json={})
    trid = start.json()["taskRunId"]
    _drain_job(trid)
    tr = _wait_task_run(trid)
    assert tr["failed"] >= 1, tr
    original_status = tr["status"]

    retry = client.post(f"/api/tasks/{task['id']}/runs/{trid}/retry-failed")
    assert retry.status_code == 202, retry.text
    body = retry.json()
    rec_id = body["recoveryTaskRunId"]
    assert rec_id and rec_id != trid
    db = SessionLocal()
    try:
        rec = db.get(TaskRun, rec_id)
        assert rec.retry_of_task_run_id == trid
        assert rec.run_scope == "failed_items"
        assert rec.retry_round == 1
        assert rec.total == tr["failed"]
        orig = db.get(TaskRun, trid)
        assert orig.status == original_status, "原批次必须保持终态（AC-035A）"
        # 仅失败项被预置进 Recovery 批次
        refs = {r.interaction_ref for r in
                db.query(Run).filter(Run.task_run_id == rec_id).all()}
        failed_refs = {r.interaction_ref for r in
                       db.query(Run).filter(Run.task_run_id == trid,
                                            Run.status == "failed").all()}
        assert refs == failed_refs
    finally:
        db.close()
    # 无失败项时幂等返回 0
    db = SessionLocal()
    try:
        for r in db.query(Run).filter(Run.task_run_id == rec_id).all():
            r.status = "succeeded"
        rec = db.get(TaskRun, rec_id)
        rec.status = "partial"  # partial 但无失败项 → 重试为幂等空操作
        db.commit()
    finally:
        db.close()
    again = client.post(f"/api/tasks/{task['id']}/runs/{rec_id}/retry-failed")
    assert again.status_code == 202
    assert again.json()["retried"] == 0


def test_ac038_empty_dataset_success_with_outcome_code():
    task = _mk_valid_task(_rows_score_risk(2),
                          scope={"op": "and",
                                 "conditions": [{"field": "score", "op": "gt",
                                                 "value": 9999}]})
    start = client.post(f"/api/tasks/{task['id']}/runs", json={})
    trid = start.json()["taskRunId"]
    _drain_job(trid)
    tr = _wait_task_run(trid)
    assert tr["status"] == "succeeded", tr
    assert tr["outcomeCode"] == "NO_ELIGIBLE_ITEMS", tr


def test_summary_endpoint_shape():
    rows = _rows_score_risk(2)
    rows.append({"interactionId": "BAD2", "score": "not-a-number", "risk": "High",
                 "issues": [], "summary": "schema-invalid"})
    task = _mk_valid_task(rows)
    start = client.post(f"/api/tasks/{task['id']}/runs", json={})
    trid = start.json()["taskRunId"]
    _drain_job(trid)
    _wait_task_run(trid)
    s = client.get(f"/api/task-runs/{trid}/summary")
    assert s.status_code == 200, s.text
    body = s.json()
    assert body["id"] == trid
    assert body["total"] == 3
    assert body["processed"] == 3
    assert set(body["counts"]) == {"succeeded", "failed", "skipped", "cancelled"}
    assert body["counts"]["succeeded"] + body["counts"]["failed"] == 3
    assert body["executionStatus"] == body["status"]
    assert "deliveryStatus" in body
    assert isinstance(body["topErrors"], list)


def test_bounded_concurrency_respected(monkeypatch):
    from app import task_runner

    peak = {"cur": 0, "max": 0}
    lock = threading.Lock()
    real = task_runner._dispatch_interaction_run

    def slow(db, run, agent_version):
        with lock:
            peak["cur"] += 1
            peak["max"] = max(peak["max"], peak["cur"])
        try:
            time.sleep(0.25)
            return real(db, run, agent_version)
        finally:
            with lock:
                peak["cur"] -= 1

    monkeypatch.setattr(task_runner, "_dispatch_interaction_run", slow)
    task = _mk_valid_task(_rows_score_risk(6), sampling={"mode": "all",
                                                        "concurrency": 2})
    start = client.post(f"/api/tasks/{task['id']}/runs", json={})
    trid = start.json()["taskRunId"]
    _drain_job(trid)
    tr = _wait_task_run(trid, timeout=60)
    assert tr["total"] == 6
    assert peak["max"] <= 2, f"并发上限被突破：{peak['max']}"
    assert peak["max"] >= 1
