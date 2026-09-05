"""MTC-002B：WorkItemProjection 验收测试。

- 15 个状态映射样本（含全部 needs_action 的 attention/conflictCodes 断言）；
- 对象关系：投影一次/ID 稳定/去重/旧 API 保留/历史不变/筛选分页 counts/数据范围/无新表。
"""
import uuid
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import inspect

from app.auth import hash_password
from app.db import SessionLocal, engine
from app.main import app
from app.models import (AnalysisTask, AnalysisTaskVersion, AppUser, Run, Schedule,
                        ScheduleOccurrence, TaskRun)

client = TestClient(app)


def _task(name: str, with_target: bool = True, created_by: str = "dev") -> str:
    db = SessionLocal()
    try:
        t = AnalysisTask(name=name, created_by=created_by, updated_by=created_by,
                         data_asset_id="da-002b", workflow_id="wf-002b", status="active")
        db.add(t)
        db.flush()
        if with_target:
            v = AnalysisTaskVersion(task_id=t.id, version_no=1, data_asset_id="da-002b",
                                    workflow_id="wf-002b")
            db.add(v)
            db.flush()
            t.current_version_id = v.id
        db.commit()
        return t.id
    finally:
        db.close()


def _run(task_id: str, status: str, delivery: str = "not_configured",
         trigger: str = "manual", **kw) -> str:
    db = SessionLocal()
    try:
        v = db.execute(
            __import__("sqlalchemy").select(AnalysisTaskVersion)
            .where(AnalysisTaskVersion.task_id == task_id)).scalars().first()
        tr = TaskRun(task_id=task_id, task_version_id=v.id if v else None,
                     status=status, delivery_status=delivery, trigger=trigger,
                     total=kw.get("total", 4), succeeded_count=kw.get("succeeded", 0),
                     failed_count=kw.get("failed", 0), skipped_count=0, cancelled_count=0,
                     started_at=kw.get("started_at"), ended_at=kw.get("ended_at"))
        db.add(tr)
        db.commit()
        return tr.id
    finally:
        db.close()


def _child_runs(task_run_id: str, statuses: list[str]) -> None:
    db = SessionLocal()
    try:
        for i, st in enumerate(statuses):
            db.add(Run(task_run_id=task_run_id, interaction_ref=f"I{i}", attempt=1,
                       status=st))
        db.commit()
    finally:
        db.close()


def _occurrence(task_id: str, status: str = "planned", minutes_ahead: int = 120) -> str:
    """planned_at 固定为上海时区当日 12:00——避免跨天跑出业务日期窗口（测试时间无关）。"""
    db = SessionLocal()
    try:
        from datetime import datetime
        from zoneinfo import ZoneInfo
        sh = ZoneInfo("Asia/Shanghai")
        noon = datetime.now(sh).replace(hour=12, minute=0, second=0, microsecond=0)
        s = Schedule(task_id=task_id, workflow_id=None, name="s-002b",
                     cron_expr="0 * * * *", timezone="Asia/Shanghai", enabled=True)
        db.add(s)
        db.flush()
        occ = ScheduleOccurrence(
            schedule_id=s.id, task_id=task_id, status=status,
            planned_at=noon.astimezone(__import__("datetime").timezone.utc),
            timezone="Asia/Shanghai", fire_key=f"fk-{uuid.uuid4().hex[:10]}")
        db.add(occ)
        db.commit()
        return occ.id
    finally:
        db.close()


def _items(**params) -> dict:
    params.setdefault("pageSize", 200)
    return client.get("/api/work-items", params=params).json()


def _find(items: list[dict], wid: str) -> dict:
    return next(w for w in items if w["id"] == wid)


# ---------- 状态映射 15 样本 ----------

def test_01_unfired_occurrence_queued():
    tid = _task(f"002B-s01-{uuid.uuid4().hex[:6]}")
    oid = _occurrence(tid)
    w = _find(_items(automationId=tid)["items"], f"occurrence:{oid}")
    assert w["status"] == "queued" and w["phase"] == "scheduled"
    assert w["kind"] == "schedule_occurrence" and w["taskRunId"] is None
    assert w["scheduledAt"] is not None


def test_02_run_queued():
    tid = _task(f"002B-s02-{uuid.uuid4().hex[:6]}")
    rid = _run(tid, "queued")
    w = _find(_items(automationId=tid)["items"], f"taskrun:{rid}")
    assert w["status"] == "queued" and w["phase"] == "queued"


def test_03_run_running():
    tid = _task(f"002B-s03-{uuid.uuid4().hex[:6]}")
    rid = _run(tid, "running")
    _child_runs(rid, ["running"])
    w = _find(_items(automationId=tid)["items"], f"taskrun:{rid}")
    assert w["status"] == "running" and w["phase"] == "executing"


def test_04_succeeded_delivery_pending_result_processing():
    tid = _task(f"002B-s04-{uuid.uuid4().hex[:6]}")
    rid = _run(tid, "succeeded", delivery="pending", succeeded=4)
    w = _find(_items(automationId=tid)["items"], f"taskrun:{rid}")
    assert w["status"] == "running" and w["phase"] == "result_processing"


def test_05_succeeded_delivery_succeeded_completed():
    tid = _task(f"002B-s05-{uuid.uuid4().hex[:6]}")
    rid = _run(tid, "succeeded", delivery="succeeded", succeeded=4)
    w = _find(_items(automationId=tid)["items"], f"taskrun:{rid}")
    assert w["status"] == "completed" and w["phase"] == "done"


def test_06_succeeded_not_configured_completed():
    tid = _task(f"002B-s06-{uuid.uuid4().hex[:6]}")
    rid = _run(tid, "succeeded", delivery="not_configured", succeeded=4)
    w = _find(_items(automationId=tid)["items"], f"taskrun:{rid}")
    assert w["status"] == "completed"


def test_07_failed():
    tid = _task(f"002B-s07-{uuid.uuid4().hex[:6]}")
    rid = _run(tid, "failed", failed=4)
    w = _find(_items(automationId=tid)["items"], f"taskrun:{rid}")
    assert w["status"] == "failed_cancelled" and w["phase"] == "failed"


def test_08_cancelled():
    tid = _task(f"002B-s08-{uuid.uuid4().hex[:6]}")
    rid = _run(tid, "cancelled", cancelled=4)
    w = _find(_items(automationId=tid)["items"], f"taskrun:{rid}")
    assert w["status"] == "failed_cancelled" and w["phase"] == "cancelled"


def _assert_attention(w: dict, code: str) -> None:
    assert w["status"] == "needs_action"
    assert w["attention"]["required"] is True
    assert w["attention"]["code"] == code
    assert w["attention"]["message"]
    assert w["attention"]["severity"] in ("warning", "critical")
    assert code in w["diagnostics"]["conflictCodes"] or w["diagnostics"]["conflictCodes"]


def test_09_partial_needs_action():
    tid = _task(f"002B-s09-{uuid.uuid4().hex[:6]}")
    rid = _run(tid, "partial", succeeded=2, failed=2)
    _assert_attention(_find(_items(automationId=tid)["items"], f"taskrun:{rid}"), "EXECUTION_PARTIAL")


def test_10_delivery_failed_needs_action():
    tid = _task(f"002B-s10-{uuid.uuid4().hex[:6]}")
    rid = _run(tid, "succeeded", delivery="failed", succeeded=4)
    _assert_attention(_find(_items(automationId=tid)["items"], f"taskrun:{rid}"), "DELIVERY_FAILED")


def test_11_delivery_dead_letter_needs_action():
    tid = _task(f"002B-s11-{uuid.uuid4().hex[:6]}")
    rid = _run(tid, "succeeded", delivery="dead_letter", succeeded=4)
    w = _find(_items(automationId=tid)["items"], f"taskrun:{rid}")
    _assert_attention(w, "DELIVERY_DEAD_LETTER")
    assert w["attention"]["severity"] == "critical"


def test_12_running_delivery_succeeded_conflict():
    tid = _task(f"002B-s12-{uuid.uuid4().hex[:6]}")
    rid = _run(tid, "running", delivery="succeeded")
    _child_runs(rid, ["running"])
    w = _find(_items(automationId=tid)["items"], f"taskrun:{rid}")
    _assert_attention(w, "EXECUTION_DELIVERY_CONFLICT")
    assert w["diagnostics"]["executionStatus"] == "running"
    assert w["diagnostics"]["deliveryStatus"] == "succeeded"


def test_13_runs_terminal_taskrun_running():
    tid = _task(f"002B-s13-{uuid.uuid4().hex[:6]}")
    rid = _run(tid, "running", total=2)
    _child_runs(rid, ["succeeded", "failed"])
    _assert_attention(_find(_items(automationId=tid)["items"], f"taskrun:{rid}"),
                      "RUNS_TERMINAL_TASKRUN_RUNNING")


def test_14_unknown_status_needs_action():
    tid = _task(f"002B-s14-{uuid.uuid4().hex[:6]}")
    rid = _run(tid, "weird-state")
    _assert_attention(_find(_items(automationId=tid)["items"], f"taskrun:{rid}"), "UNKNOWN_EXECUTION_STATUS")


def test_15_missing_target_needs_action():
    # 悬空 occurrence：task_id 指向不存在的自主任务（TaskRun 因 NOT NULL 版本外键不可能无版本）
    oid = _occurrence("task-missing-002b")
    r = client.get(f"/api/work-items/occurrence:{oid}")
    assert r.status_code == 200, r.text
    w = r.json()
    _assert_attention(w, "MISSING_EXECUTION_TARGET")
    assert w["title"] == "(缺失自主任务)"


# ---------- 对象关系 ----------

def test_each_run_and_occurrence_projected_once():
    tid = _task(f"002B-r1-{uuid.uuid4().hex[:6]}")
    r1, r2 = _run(tid, "queued"), _run(tid, "failed", failed=1)
    oid = _occurrence(tid)
    ids = [w["id"] for w in _items(automationId=tid)["items"]]
    assert ids.count(f"taskrun:{r1}") == 1
    assert ids.count(f"taskrun:{r2}") == 1
    assert ids.count(f"occurrence:{oid}") == 1


def test_occurrence_id_stable_across_trigger_and_no_double_card():
    tid = _task(f"002B-r3-{uuid.uuid4().hex[:6]}")
    oid = _occurrence(tid)
    before = _find(_items(automationId=tid)["items"], f"occurrence:{oid}")
    assert before["status"] == "queued" and before["taskRunId"] is None
    # 触发：产生 TaskRun 并关联 occurrence
    rid = _run(tid, "running", trigger="schedule")
    db = SessionLocal()
    try:
        occ = db.get(ScheduleOccurrence, oid)
        occ.task_run_id = rid
        occ.status = "started"
        db.commit()
    finally:
        db.close()
    items = _items(automationId=tid)["items"]
    after = _find(items, f"occurrence:{oid}")
    assert after["taskRunId"] == rid
    assert after["status"] == "running"
    assert not any(w["id"] == f"taskrun:{rid}" for w in items), "触发后不得出现第二张卡"


def test_manual_vs_scheduled_id_prefix():
    tid = _task(f"002B-r5-{uuid.uuid4().hex[:6]}")
    rid_manual = _run(tid, "queued", trigger="manual")
    rid_sched = _run(tid, "queued", trigger="schedule")
    oid = _occurrence(tid, minutes_ahead=300)
    db = SessionLocal()
    try:
        occ = db.get(ScheduleOccurrence, oid)
        occ.task_run_id = rid_sched
        occ.status = "firing"
        db.commit()
    finally:
        db.close()
    ids = {w["id"] for w in _items(automationId=tid)["items"]}
    assert f"taskrun:{rid_manual}" in ids
    assert f"occurrence:{oid}" in ids
    assert f"taskrun:{rid_sched}" not in ids


def test_legacy_operations_api_preserved_and_history_unchanged():
    assert client.get("/api/operations/task-runs/today").status_code == 200
    assert client.get("/api/operations/task-runs").status_code == 200
    tid = _task(f"002B-r8-{uuid.uuid4().hex[:6]}")
    rid = _run(tid, "succeeded", delivery="succeeded", succeeded=2)
    db = SessionLocal()
    try:
        tr = db.get(TaskRun, rid)
        assert tr.status == "succeeded" and tr.delivery_status == "succeeded"
        assert tr.succeeded_count == 2
    finally:
        db.close()


def test_filters_pagination_counts():
    tid = _task(f"002B-r9-{uuid.uuid4().hex[:6]}")
    _run(tid, "queued")
    _run(tid, "failed", failed=1)
    _run(tid, "succeeded", delivery="not_configured", succeeded=1)
    full = _items(automationId=tid)
    n_failed = full["counts"]["failed_cancelled"]
    assert n_failed == 1
    paged = _items(automationId=tid, status="failed_cancelled", pageSize=1)
    assert len(paged["items"]) == 1
    assert paged["total"] == n_failed
    assert sum(paged["counts"].values()) == n_failed, "counts 基于筛选全集而非当前页"
    assert all(w["automationId"] == tid for w in full["items"])
    tid2 = _task(f"002B-r9b-{uuid.uuid4().hex[:6]}")
    _run(tid2, "partial", succeeded=1, failed=1)
    att = _items(automationId=tid2, attentionOnly="only")
    assert len(att["items"]) == 1 and att["items"][0]["attention"]["required"]


def test_no_new_tables():
    tables = set(inspect(engine).get_table_names())
    assert not any(t in ("work_item", "workitem", "task") for t in tables)
    assert not any(t.startswith("work_item") for t in tables)


# ---------- 权限矩阵 ----------

@pytest.fixture
def auth_on(monkeypatch):
    monkeypatch.setenv("WF_AUTH", "on")
    monkeypatch.setenv("WF_SECRET_KEY", "mtc002b-key-0123456789")
    yield


def _mk_user(role: str, team: str = "", scope: str = "all") -> str:
    name = f"{role}-{team or 'x'}-{uuid.uuid4().hex[:8]}"
    db = SessionLocal()
    try:
        u = AppUser(username=name, password_hash=hash_password("pass12345"),
                    role=role, team=team, data_scope=scope)
        db.add(u)
        db.commit()
        return name
    finally:
        db.close()


def _tok(username: str, password: str = "pass12345") -> str:
    return client.post("/api/auth/login", json={"username": username,
                                                "password": password}).json()["token"]


def _hdr(tok: str):
    return {"Authorization": f"Bearer {tok}"}


def test_work_items_scope_matrix(auth_on):
    alice = _mk_user("operator", team="A", scope="team")
    bob = _mk_user("viewer", team="B", scope="team")
    carol = _mk_user("viewer", team="", scope="all")
    tid = _task(f"002B-sc-{uuid.uuid4().hex[:6]}", created_by=alice)
    rid = _run(tid, "queued")
    wid = f"taskrun:{rid}"

    # 未登录 → 401
    assert client.get("/api/work-items").status_code == 401
    assert client.get(f"/api/work-items/{wid}").status_code == 401
    # 跨团队：列表不可见 + 详情 403
    bob_ids = [w["id"] for w in client.get("/api/work-items", headers=_hdr(_tok(bob))).json()["items"]]
    assert wid not in bob_ids
    assert client.get(f"/api/work-items/{wid}", headers=_hdr(_tok(bob))).status_code == 403
    # 同团队 200
    assert client.get("/api/work-items", headers=_hdr(_tok(alice))).status_code == 200
    assert client.get(f"/api/work-items/{wid}", headers=_hdr(_tok(alice))).status_code == 200
    # scope=all 200
    assert client.get(f"/api/work-items/{wid}", headers=_hdr(_tok(carol))).status_code == 200
    # admin 200
    assert client.get(f"/api/work-items/{wid}", headers=_hdr(_tok("admin", "admin"))).status_code == 200


def test_work_item_detail_404_and_bad_prefix(auth_on):
    tok = _hdr(_tok("admin", "admin"))
    assert client.get("/api/work-items/taskrun:does-not-exist", headers=tok).status_code == 404
    assert client.get("/api/work-items/occurrence:does-not-exist", headers=tok).status_code == 404
    assert client.get("/api/work-items/noprefix", headers=tok).status_code == 422
