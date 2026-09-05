"""MTC-002B-R2 反例测试。

- P1-01 digest 完整性：child Run / ended_at / progress / occurrence / 冻结版本 assignee /
  范围外数据 / 日期切换 七组变化断言；
- P1-02 agent 跨版本筛选与稳定 ID；
- P1-03 跨午夜 queued/running 漏卡与多日窗口去重；
- P1-04 by-task-runs SQL query budget（常量级）+ 顺序 + 跳过语义 + 与单条投影一致；
- P1-05 seed 安全门控（拒绝路径无写入 / 非 marker 不删 / 失败回滚无半完成态）；
- P2 日期严格校验（YYYY-MM-DD、dateFrom>dateTo、时区）。
"""
import os
import subprocess
import sys
import uuid
from datetime import datetime, timedelta, timezone as _tz
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import event, select

from app.db import SessionLocal, engine
from app.main import app
from app.models import (AnalysisTask, AnalysisTaskVersion, Run, ScheduleOccurrence,
                        TaskRun)
from app.routers.work_items import compute_stream_digest
from tests.test_mtc002b_r_fixes import _occ, _run, _task, _version

client = TestClient(app)
REPO = Path(__file__).resolve().parent.parent.parent
TZ = "Asia/Shanghai"
ADMIN = {"role": "admin", "username": "admin", "data_scope": "all"}


def _today():
    from zoneinfo import ZoneInfo
    return datetime.now(ZoneInfo(TZ)).date().isoformat()


def _digest(user=ADMIN, d=None):
    d = d or _today()
    return compute_stream_digest(SessionLocal(), user, d, d, TZ, use_cache=False)


def _mutate(run_id, **fields):
    db = SessionLocal()
    try:
        tr = db.get(TaskRun, run_id)
        for k, v in fields.items():
            setattr(tr, k, v)
        db.commit()
    finally:
        db.close()


# ---------- P1-01 digest 完整性 ----------

def test_digest_child_run_terminal_flip():
    tid = _task(f"R2-dg1-{uuid.uuid4().hex[:6]}")
    rid = _run(tid, None, "running", total=2)
    db = SessionLocal()
    try:
        db.add(Run(task_run_id=rid, interaction_ref="I1", attempt=1, status="running"))
        db.commit()
    finally:
        db.close()
    before = _digest()
    db = SessionLocal()
    try:
        r = db.execute(select(Run).where(Run.task_run_id == rid)).scalars().first()
        r.status = "succeeded"
        db.commit()
    finally:
        db.close()
    assert _digest() != before, "child Run running→succeeded 必须改变 digest"


def test_digest_ended_at_and_progress_and_occ_and_assignee():
    tid = _task(f"R2-dg2-{uuid.uuid4().hex[:6]}")
    rid = _run(tid, None, "queued")
    oid = _occ(tid, status="planned")
    base = _digest()
    _mutate(rid, ended_at=datetime.now(_tz.utc))
    assert _digest() != base, "ended_at 出现必须改变 digest"
    base = _digest()
    _mutate(rid, succeeded_count=3)
    assert _digest() != base, "progress 计数变化必须改变 digest"
    base = _digest()
    db = SessionLocal()
    try:
        o = db.get(ScheduleOccurrence, oid)
        o.status = "missed"
        o.error = {"code": "SCHEDULE_MISSED", "message": "x"}
        db.commit()
    finally:
        db.close()
    assert _digest() != base, "occurrence.status/error 变化必须改变 digest"
    base = _digest()
    db = SessionLocal()
    try:
        v = db.get(AnalysisTask, tid).current_version_id
        ver = db.get(AnalysisTaskVersion, v)
        ver.execution_target_type = "agent"
        ver.agent_id = "agent-r2-digest"
        ver.workflow_id = None
        db.commit()
    finally:
        db.close()
    assert _digest() != base, "冻结/当前版本 assignee 变化必须改变 digest"


def test_digest_scope_isolation():
    from app.auth import hash_password
    from app.models import AppUser
    db = SessionLocal()
    try:
        alice = AppUser(username=f"r2-a-{uuid.uuid4().hex[:6]}",
                        password_hash=hash_password("pass12345"),
                        role="operator", team="R2A", data_scope="team")
        bob = AppUser(username=f"r2-b-{uuid.uuid4().hex[:6]}",
                      password_hash=hash_password("pass12345"),
                      role="viewer", team="R2B", data_scope="team")
        db.add_all([alice, bob])
        db.commit()
        alice_name, bob_name = alice.username, bob.username
    finally:
        db.close()
    tid = _task(f"R2-dg3-{uuid.uuid4().hex[:6]}", created_by=alice_name)
    rid = _run(tid, None, "queued")
    bob_user = {"role": "viewer", "username": bob_name, "team": "R2B", "data_scope": "team"}
    alice_user = {"role": "operator", "username": alice_name, "team": "R2A", "data_scope": "team"}
    bob_before = _digest(bob_user)
    alice_before = _digest(alice_user)
    _mutate(rid, succeeded_count=2)
    assert _digest(bob_user) == bob_before, "不可见数据变化不得改变该用户 digest"
    assert _digest(alice_user) != alice_before


def test_digest_date_switch():
    """隔离窗口法：终态批次锚定 2020-01-01（该窗口仅本测试数据，免受环境背景数据干扰）。"""
    tid = _task(f"R2-dg4-{uuid.uuid4().hex[:6]}")
    anchor = datetime(2020, 1, 1, 10, 0, tzinfo=_tz.utc)
    rid = _run(tid, None, "succeeded", delivery="succeeded", succeeded=2,
               created_at=anchor, started_at=anchor, ended_at=anchor)
    from zoneinfo import ZoneInfo as _ZI
    anchor_day = anchor.astimezone(_ZI(TZ)).date().isoformat()
    today = _today()
    anchored_before, today_before = _digest(ADMIN, anchor_day), _digest(ADMIN, today)
    _mutate(rid, succeeded_count=1)
    assert _digest(ADMIN, anchor_day) != anchored_before, "锚定日变化必须改变该日 digest"
    assert _digest(ADMIN, today) == today_before, "锚定日变化不得影响其他日期 digest"


# ---------- P1-02 agent 跨版本 ----------

def test_agent_filter_follows_frozen_version_for_triggered_occurrence():
    tid = _task(f"R2-ag-{uuid.uuid4().hex[:6]}", wf="wf-r2-a")
    db = SessionLocal()
    try:
        v1 = db.get(AnalysisTask, tid).current_version_id
        ver1 = db.get(AnalysisTaskVersion, v1)
        ver1.execution_target_type = "agent"
        ver1.agent_id = "agent-r2-a"
        ver1.workflow_id = None
        db.commit()
    finally:
        db.close()
    rid = _run(tid, v1, "running")
    oid = _occ(tid, status="started", task_run_id=rid)
    # 当前版本改为 Agent B
    v2 = _version(tid, 2, wf=None, agent="agent-r2-b")
    db = SessionLocal()
    try:
        t = db.get(AnalysisTask, tid)
        t.current_version_id = v2
        db.commit()
    finally:
        db.close()

    a = client.get("/api/work-items", params={"agentId": "agent-r2-a", "pageSize": 200}).json()
    ids_a = [w["id"] for w in a["items"] if w["automationId"] == tid]
    assert ids_a == [f"occurrence:{oid}"], f"筛 Agent A 应仅返回稳定 occurrence 卡：{ids_a}"
    card = next(w for w in a["items"] if w["id"] == f"occurrence:{oid}")
    assert card["assignee"]["id"] == "agent-r2-a"

    b = client.get("/api/work-items", params={"agentId": "agent-r2-b", "pageSize": 200}).json()
    ids_b = [w["id"] for w in b["items"] if w["automationId"] == tid]
    assert ids_b == [], f"筛 Agent B 不得返回历史执行卡：{ids_b}"

    # 不带 agentId（以 automationId 观察，避免 wf_test 海量未来 occurrence 占据第一页）
    allr = client.get("/api/work-items",
                      params={"automationId": tid, "pageSize": 200}).json()
    mine = [w["id"] for w in allr["items"] if w["automationId"] == tid]
    assert mine == [f"occurrence:{oid}"], f"无筛选时稳定单卡：{mine}"


# ---------- P1-03 跨午夜 ----------

def test_cross_midnight_queued_and_running():
    tid = _task(f"R2-mid-{uuid.uuid4().hex[:6]}")
    from zoneinfo import ZoneInfo
    sh_now = datetime.now(ZoneInfo(TZ))
    yest_2359 = (sh_now - timedelta(days=1)).replace(
        hour=23, minute=59, second=0, microsecond=0).astimezone(_tz.utc)
    yest_2300 = yest_2359 - timedelta(minutes=59)
    rid_q = _run(tid, None, "queued", created_at=yest_2359, started_at=None)
    rid_r = _run(tid, None, "running", created_at=yest_2300, started_at=yest_2300)
    rid_done = _run(tid, None, "succeeded", delivery="succeeded",
                    created_at=yest_2300, started_at=yest_2300,
                    ended_at=yest_2300 + timedelta(minutes=5))
    items = client.get("/api/work-items",
                       params={"automationId": tid, "pageSize": 200}).json()["items"]
    ids = {w["taskRunId"] for w in items if w["automationId"] == tid}
    assert rid_q in ids, "昨日 23:59 创建的 queued 今日必须可见"
    assert rid_r in ids, "昨日开始的 running 今日必须可见"
    assert rid_done not in ids, "昨日终态批次不得误入今日看板"
    # 多日窗口不重复
    yest = yest_2359.date().isoformat()
    multi = client.get("/api/work-items",
                       params={"automationId": tid, "dateFrom": yest,
                               "pageSize": 200}).json()["items"]
    dup = [w["id"] for w in multi if w["automationId"] == tid]
    assert len(dup) == len(set(dup)), "多日窗口不得重复投影"


# ---------- P1-04 query budget ----------

def test_by_task_runs_query_budget_and_order():
    tid = _task(f"R2-bud-{uuid.uuid4().hex[:6]}")
    ids = [_run(tid, None, "queued") for _ in range(6)]
    counter = {"n": 0}

    def cb(conn, cursor, statement, parameters, context, executemany):
        counter["n"] += 1

    event.listen(engine, "before_cursor_execute", cb)
    try:
        counter["n"] = 0
        r5 = client.get("/api/work-items/by-task-runs", params={"ids": ",".join(ids[:5])})
        n5 = counter["n"]
        counter["n"] = 0
        fake = [uuid.uuid4().hex for _ in range(194)]
        r200 = client.get("/api/work-items/by-task-runs",
                          params={"ids": ",".join(ids + fake)})
        n200 = counter["n"]
    finally:
        event.remove(engine, "before_cursor_execute", cb)
    assert r5.status_code == 200 and r200.status_code == 200
    assert len(r5.json()["items"]) == 5
    assert len(r200.json()["items"]) == 6, "不存在 ID 静默跳过"
    assert [w["taskRunId"] for w in r200.json()["items"]] == ids, "顺序与输入一致"
    assert n200 <= n5 + 5, f"查询量不得随 N 线性增长：n5={n5} n200={n200}"
    assert n200 <= 40, f"200 ID 的常量级 budget 超标：{n200}"
    # 批量与单条投影字段一致
    single = client.get(f"/api/work-items/taskrun:{ids[0]}").json()
    batch = next(w for w in r5.json()["items"] if w["taskRunId"] == ids[0])
    assert single == batch


# ---------- P1-05 seed 安全 ----------

def _seed_env(**extra):
    # 显式把子进程目标库指到 wf_test（与 pytest 断言同一目标，单一一致目标）
    env = {**os.environ, "WF_ENV": "development", "ALLOW_DEMO_SEED": "1",
           "WF_DATABASE_URL": "postgresql+psycopg://rivers@127.0.0.1:5432/wf_test",
           "MTC_SEED_EXPECT_DB": "wf_test", **extra}
    return env


def _run_seed(env=None, args=()):
    return subprocess.run(
        [sys.executable, str(REPO / "scripts" / "seed_workitems_demo.py"), *args],
        capture_output=True, text=True, timeout=120, env=env)


def test_seed_refuses_without_gates_and_writes_nothing():
    base_env = {k: v for k, v in os.environ.items()
                if k not in ("WF_ENV", "ALLOW_DEMO_SEED", "MTC_SEED_EXPECT_DB")}
    r1 = _run_seed(env=base_env)
    assert r1.returncode != 0 and "REFUSE" in r1.stderr
    r2 = _run_seed(env={**base_env, "WF_ENV": "development"})
    assert r2.returncode != 0 and "ALLOW_DEMO_SEED" in r2.stderr
    r3 = _run_seed(env={**base_env, "WF_ENV": "development", "ALLOW_DEMO_SEED": "1",
                        "MTC_SEED_EXPECT_DB": "wf_test"})
    assert r3.returncode != 0 and "REFUSE" in r3.stderr, "期望库错配必须被拒绝"
    db = SessionLocal()
    try:
        before = list(db.execute(select(AnalysisTask.id).where(
            AnalysisTask.name.like("DEMO002B-%"))).scalars().all())
        runs_before = db.execute(
            __import__("sqlalchemy").func.count(TaskRun.id)).scalar()
    finally:
        db.close()
    for env in (base_env, {**base_env, "WF_ENV": "development"},
                {**base_env, "WF_ENV": "development", "ALLOW_DEMO_SEED": "1",
                 "MTC_SEED_EXPECT_DB": "wf_test"}):  # 子进程实连 wf_dev ≠ 期望 wf_test → 拒绝
        rr = _run_seed(env=env)
        assert rr.returncode != 0 and "REFUSE" in rr.stderr
    db = SessionLocal()
    try:
        after = list(db.execute(select(AnalysisTask.id).where(
            AnalysisTask.name.like("DEMO002B-%"))).scalars().all())
        runs_after = db.execute(
            __import__("sqlalchemy").func.count(TaskRun.id)).scalar()
        assert before == after and runs_before == runs_after, "拒绝路径不得写入"
    finally:
        db.close()


def test_seed_marker_scoped_cleanup_and_rollback():
    # 非 marker 数据保护样本
    tid_keep = _task(f"R2-keep-{uuid.uuid4().hex[:6]}")
    rid_keep = _run(tid_keep, None, "queued")
    r1 = _run_seed(env=_seed_env())
    assert r1.returncode == 0, r1.stderr
    ns1 = r1.stdout.split("namespace: ")[1].split()[0]
    r2 = _run_seed(env=_seed_env())
    assert r2.returncode == 0
    ns2 = r2.stdout.split("namespace: ")[1].split()[0]
    assert ns1 != ns2
    db = SessionLocal()
    try:
        names = [t.name for t in db.execute(select(AnalysisTask).where(
            AnalysisTask.name.like("DEMO002B-%"))).scalars().all()]
        assert names == [ns2], f"旧 namespace 应被精确清理：{names}"
        assert db.get(TaskRun, rid_keep) is not None, "非 marker TaskRun 绝不被删除"
    finally:
        db.close()
    # 注入失败 → 整体回滚，旧 namespace 保留（无半完成态）
    r3 = _run_seed(env=_seed_env(MTC_SEED_INJECT_ERROR="1"))
    assert r3.returncode != 0 and "rolled back" in r3.stderr
    db = SessionLocal()
    try:
        names = [t.name for t in db.execute(select(AnalysisTask).where(
            AnalysisTask.name.like("DEMO002B-%"))).scalars().all()]
        assert names == [ns2], f"失败回滚后旧 namespace 必须完整：{names}"
    finally:
        db.close()


# ---------- P2 日期严格校验 ----------

def test_strict_date_validation():
    assert client.get("/api/work-items",
                      params={"dateFrom": "2026-09-06T10:00:00"}).status_code == 422
    assert client.get("/api/work-items",
                      params={"dateFrom": "2026-09-10", "dateTo": "2026-09-06"}).status_code == 422
    assert client.get("/api/work-items", params={"timezone": "Not/AZone"}).status_code == 422
    ok = client.get("/api/work-items", params={"dateFrom": "2026-09-01",
                                               "dateTo": "2026-09-05", "timezone": "UTC"})
    assert ok.status_code == 200
