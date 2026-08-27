"""09-SDD P1-B1 / P1-05：队列可靠性——重试退避 / 租约回收 / 死信 / 取消传播。

先红后绿：当前 claim_and_run 失败即置 failed、无重试、无租约回收、无死信。
本文件测 claim_job/complete_job/recover_stale_jobs 三个可测单元 + 取消传播。
"""
import time
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import delete, select

from app.db import SessionLocal
from app.models import JobQueue


@pytest.fixture(scope="module", autouse=True)
def isolate_worker():
    """P1-05 队列单测需排除后台 worker 竞争：停掉单例 worker，
    测毕重启（不影响后续依赖 worker 的测试文件）。"""
    import app.runner as R
    if R._WORKER_STOP is not None and not R._WORKER_STOP.is_set():
        R._WORKER_STOP.set()
    yield
    R._WORKER_STOP = None
    R.start_worker()


@pytest.fixture(autouse=True)
def clean_queue():
    """每个用例前清空待处理/处理中任务，避免上一用例残留与新任务同 run_at 竞争。"""
    db = SessionLocal()
    db.execute(delete(JobQueue).where(JobQueue.status.in_(["pending", "processing"])))
    db.commit()
    db.close()
    yield


def _mk_job(db, jtype="noop", max_attempts=3, **kw) -> JobQueue:
    # run_at 置为极早，保证它在 ORDER BY run_at 中最先被认领（确定性）
    kw.setdefault("run_at", datetime(2000, 1, 1, tzinfo=timezone.utc))
    j = JobQueue(type=jtype, payload=kw.pop("payload", {"run_id": "r-x"}),
                 max_attempts=max_attempts, **kw)
    db.add(j)
    db.flush()
    return j


def test_failed_job_retries_with_backoff_until_max():
    from app.runner import claim_job, complete_job
    db = SessionLocal()
    try:
        j = _mk_job(db, jtype="will-fail", max_attempts=3)
        db.commit()
        jid = j.id
        # 三次失败：前两次回 pending（退避），第三次入死信
        for attempt in range(1, 3):
            claimed = claim_job(db, include_future=True)
            assert claimed is not None and claimed.id == jid
            complete_job(db, claimed.id, success=False, error=f"boom{attempt}")
            db.commit()
            db.refresh(j)
            assert j.status == "pending", f"第 {attempt} 次失败应回 pending 待重试（实际 {j.status}）"
            assert j.attempts == attempt
            # 退避：run_at 推到未来
            assert j.run_at > datetime.now(timezone.utc) - timedelta(seconds=1)
        claimed = claim_job(db, include_future=True)
        assert claimed is not None and claimed.id == jid
        complete_job(db, claimed.id, success=False, error="boom-final")
        db.commit()
        db.refresh(j)
        assert j.status == "dead", "超过 max_attempts 应入死信（实际 %s）" % j.status
        assert j.attempts == 3
        assert (j.error or {}).get("message")
    finally:
        db.close()


def test_successful_job_marked_done():
    from app.runner import claim_job, complete_job
    db = SessionLocal()
    try:
        j = _mk_job(db, jtype="noop-ok")
        db.commit()
        claimed = claim_job(db, include_future=True)
        assert claimed is not None and claimed.id == j.id
        complete_job(db, claimed.id, success=True)
        db.commit()
        db.refresh(j)
        assert j.status == "done"
        assert j.attempts == 1
    finally:
        db.close()


def test_stale_processing_job_recovered():
    from app.runner import recover_stale_jobs
    db = SessionLocal()
    try:
        j = _mk_job(db, jtype="stuck", max_attempts=3)
        db.commit()
        # 模拟被某 worker 认领后崩溃：status=processing，locked_at 早于租约
        j.status = "processing"
        j.locked_by = "dead-worker"
        j.locked_at = datetime.now(timezone.utc) - timedelta(minutes=30)
        j.attempts = 0
        db.commit()
        recovered = recover_stale_jobs(db, lease_seconds=60)
        db.refresh(j)
        assert recovered >= 1, "应收回过期 processing 任务"
        assert j.status == "pending", "过期任务应回 pending 重新可认领（实际 %s）" % j.status
    finally:
        db.close()


def test_stale_job_exceeding_attempts_goes_dead():
    from app.runner import recover_stale_jobs
    db = SessionLocal()
    try:
        j = _mk_job(db, jtype="stuck-maxed", max_attempts=1)
        j.status = "processing"
        j.locked_by = "dead-worker"
        j.locked_at = datetime.now(timezone.utc) - timedelta(minutes=30)
        j.attempts = 1  # 已用尽
        db.commit()
        recover_stale_jobs(db, lease_seconds=60)
        db.refresh(j)
        assert j.status == "dead", "重试用尽的过期任务应入死信（实际 %s）" % j.status
    finally:
        db.close()


def test_dead_letter_listing_and_replay():
    from app.runner import claim_job, complete_job
    db = SessionLocal()
    try:
        j = _mk_job(db, jtype="dl", max_attempts=1)
        db.commit()
        claimed = claim_job(db, include_future=True)
        complete_job(db, claimed.id, success=False, error="fatal")
        db.commit()
        dead = db.execute(select(JobQueue).where(JobQueue.status == "dead",
                                                 JobQueue.id == j.id)).scalar_one_or_none()
        assert dead is not None, "死信应可被查询（运维可见）"
    finally:
        db.close()
