"""MTC-002B-R3 反例测试。

P1-01：已触发调度 occurrence 的 DTO 语义——kind=schedule_occurrence 不等于“尚未执行”；
  taskRunId != null 为唯一权威执行判断；稳定 ID 保持 occurrence:{id}。
P2：list 与 stream 共用日期契约（parse_work_item_date_range）矩阵。
"""
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone as _tz
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent.parent

from fastapi.testclient import TestClient

from app.main import app
from tests.test_mtc002b_r_fixes import _occ, _run, _task

client = TestClient(app)


import atexit  # noqa: E402
atexit.register(client.close)  # 回收守护线程残留流，保证解释器退出


def _fired_occ_with_run(status, delivery="not_configured", **kw):
    tid = _task(f"R3-f-{uuid.uuid4().hex[:6]}")
    rid = _run(tid, None, status, delivery=delivery, **kw)
    oid = _occ(tid, status="started", task_run_id=rid)
    return tid, rid, oid


def _get_occ(oid, tid):
    items = client.get("/api/work-items",
                       params={"automationId": tid, "pageSize": 200}).json()["items"]
    return [w for w in items if w["id"] == f"occurrence:{oid}"]


def test_fired_occurrence_running_shows_execution():
    tid, rid, oid = _fired_occ_with_run(
        "running", total=4, succeeded=1,
        started_at=datetime.now(_tz.utc) - timedelta(hours=1))
    mine = _get_occ(oid, tid)
    assert len(mine) == 1, f"稳定 ID 唯一卡：{mine}"
    w = mine[0]
    assert w["kind"] == "schedule_occurrence"
    assert w["taskRunId"] == rid, "已触发 occurrence 必须携带 taskRunId"
    assert w["status"] == "running"
    assert w["progress"]["total"] == 4 and w["progress"]["succeeded"] == 1
    assert w["startedAt"] is not None


def test_fired_occurrence_completed():
    ended = datetime.now(_tz.utc) - timedelta(minutes=5)
    tid, rid, oid = _fired_occ_with_run("succeeded", delivery="not_configured",
                                        succeeded=2, total=2, ended_at=ended)
    w = _get_occ(oid, tid)[0]
    assert w["taskRunId"] == rid and w["status"] == "completed"
    assert w["finishedAt"] is not None


def test_fired_occurrence_failed_and_cancelled():
    for st in ("failed", "cancelled"):
        tid, rid, oid = _fired_occ_with_run(st, failed=2 if st == "failed" else 0,
                                            cancelled=2 if st == "cancelled" else 0)
        w = _get_occ(oid, tid)[0]
        assert w["taskRunId"] == rid and w["status"] == "failed_cancelled"


def test_fired_occurrence_missing_run_is_needs_action_not_queued():
    tid = _task(f"R3-br-{uuid.uuid4().hex[:6]}")
    oid = _occ(tid, status="started", task_run_id=None)
    w = _get_occ(oid, tid)[0]
    assert w["taskRunId"] is None
    assert w["status"] == "needs_action"
    assert w["attention"]["code"] == "OCCURRENCE_RUN_MISSING"
    assert w["diagnostics"]["occurrenceStatus"] == "started"


def test_unfired_occurrence_still_queued_with_null_taskrun():
    tid = _task(f"R3-uf-{uuid.uuid4().hex[:6]}")
    oid = _occ(tid, status="planned")
    w = _get_occ(oid, tid)[0]
    assert w["taskRunId"] is None and w["status"] == "queued"
    assert w["phase"] == "scheduled"


# ---------- P2：list 与 stream 日期契约一致 ----------

BAD_CASES = [
    {"dateFrom": "2026-09-06T10:00:00"},
    {"dateFrom": "2026-02-30"},
    {"timezone": "Not/AZone"},
    {"dateFrom": "2026-09-10", "dateTo": "2026-09-06"},
]


def test_list_date_contract():
    for params in BAD_CASES:
        r = client.get("/api/work-items", params=params)
        assert r.status_code == 422, (params, r.status_code)
    assert client.get("/api/work-items", params={"dateFrom": "2026-09-05",
                                                 "timezone": "UTC"}).status_code == 200
    assert client.get("/api/work-items", params={"dateFrom": "2026-09-01",
                                                 "dateTo": "2026-09-05",
                                                 "timezone": "Asia/Shanghai"}).status_code == 200


def _live_stream_statuses():
    """对真实 uvicorn 子进程断言 stream 200（TestClient 的 is_disconnected 限制不适用）。"""
    import socket
    import subprocess
    import time
    import urllib.request
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1",
         "--port", "8122"],
        cwd=str(REPO / "server"), env={**os.environ},
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        deadline = time.time() + 20
        while time.time() < deadline:
            try:
                socket.create_connection(("127.0.0.1", 8122), timeout=1).close()
                break
            except OSError:
                time.sleep(0.3)
        else:
            raise RuntimeError("临时 uvicorn 8122 未就绪")
        out = []
        for qs in ("dateFrom=2026-09-05&timezone=UTC",
                   "dateFrom=2026-09-01&dateTo=2026-09-05&timezone=Asia/Shanghai"):
            with urllib.request.urlopen(
                    f"http://127.0.0.1:8122/api/work-items/stream?{qs}", timeout=30) as r:
                out.append(r.status)
        return out
    finally:
        proc.terminate()
        proc.wait(timeout=10)


def test_stream_date_contract():
    for params in BAD_CASES:
        r = client.get("/api/work-items/stream", params=params)
        assert r.status_code == 422, (params, r.status_code)
    assert _live_stream_statuses() == [200, 200]
