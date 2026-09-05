"""MTC-002B-R 反例测试（验收报告 P1-01/02/03/04 + P2-01）。

- SSE：首事件可达、鉴权 401/持 token 200、digest 继承用户数据范围（不硬编码 admin）；
- 冻结版本：V1 Workflow 运行后编辑为 V2 Agent，旧卡仍 V1 Workflow、新计划 V2 Agent；
- 断链 occurrence（started/firing 无 TaskRun）→ needs_action OCCURRENCE_RUN_MISSING，
  详情 200；跨团队详情 403；cancelled 空计划详情 404；
- 205 条完整性：分页不静默漏卡、五泳道都不消失、counts 基于全集；
- 参数契约：dateFrom/timezone/status/origin/attentionOnly 非法 → 422；
- by-task-runs 批量端点 + 数据范围。
"""
import uuid
from datetime import datetime, timedelta, timezone as _tz

import pytest
from fastapi.testclient import TestClient

from app.auth import hash_password
from app.db import SessionLocal
from app.main import app
from app.models import (AnalysisTask, AnalysisTaskVersion, AppUser, Run, Schedule,
                        ScheduleOccurrence, TaskRun)
from app.routers.work_items import compute_stream_digest

client = TestClient(app)


def _task(name: str, created_by: str = "dev", wf: str = "wf-002br") -> str:
    db = SessionLocal()
    try:
        t = AnalysisTask(name=name, created_by=created_by, updated_by=created_by,
                         data_asset_id="da-002br", workflow_id=wf, status="active")
        db.add(t)
        db.flush()
        v = AnalysisTaskVersion(task_id=t.id, version_no=1, data_asset_id="da-002br",
                                workflow_id=wf)
        db.add(v)
        db.flush()
        t.current_version_id = v.id
        db.commit()
        return t.id
    finally:
        db.close()


def _version(task_id: str, no: int, wf: str | None, agent: str | None) -> str:
    db = SessionLocal()
    try:
        v = AnalysisTaskVersion(
            task_id=task_id, version_no=no, data_asset_id="da-002br",
            execution_target_type="agent" if agent else "workflow",
            workflow_id=wf, agent_id=agent)
        db.add(v)
        db.commit()
        return v.id
    finally:
        db.close()


def _run(task_id: str, version_id: str | None, status: str, delivery: str = "not_configured",
         trigger: str = "manual", **kw) -> str:
    db = SessionLocal()
    try:
        if version_id is None:
            version_id = db.execute(
                __import__("sqlalchemy").select(AnalysisTaskVersion)
                .where(AnalysisTaskVersion.task_id == task_id)).scalars().first().id
        tr = TaskRun(task_id=task_id, task_version_id=version_id, status=status,
                     delivery_status=delivery, trigger=trigger,
                     total=kw.get("total", 4), succeeded_count=kw.get("succeeded", 0),
                     failed_count=kw.get("failed", 0), skipped_count=0, cancelled_count=0)
        db.add(tr)
        db.flush()
        rid = tr.id
        db.commit()
        return rid
    finally:
        db.close()


def _occ(task_id: str, status: str = "planned", task_run_id: str | None = None) -> str:
    db = SessionLocal()
    try:
        from zoneinfo import ZoneInfo
        sh = ZoneInfo("Asia/Shanghai")
        noon = datetime.now(sh).replace(hour=12, minute=0, second=0, microsecond=0)
        s = Schedule(task_id=task_id, workflow_id=None, name="s-002br",
                     cron_expr="0 * * * *", timezone="Asia/Shanghai", enabled=True)
        db.add(s)
        db.flush()
        occ = ScheduleOccurrence(schedule_id=s.id, task_id=task_id, status=status,
                                 task_run_id=task_run_id,
                                 planned_at=noon.astimezone(_tz.utc),
                                 timezone="Asia/Shanghai",
                                 fire_key=f"fkr-{uuid.uuid4().hex[:10]}")
        db.add(occ)
        db.commit()
        return occ.id
    finally:
        db.close()


def _items(**params) -> dict:
    params.setdefault("pageSize", 200)
    return client.get("/api/work-items", params=params).json()


# ---------- P1-01 SSE ----------

def test_stream_iter_first_event_and_refresh_on_change():
    """生成器单测：首事件立即 refresh(id:1)；流中途数据变化 → refresh(id:2)。"""
    import asyncio
    from app.routers.work_items import work_items_stream_iter
    today = datetime.now(_tz.utc).date().isoformat()
    user = {"role": "admin", "username": "admin", "data_scope": "all"}
    tid = _task(f"002BR-sse-{uuid.uuid4().hex[:6]}")

    async def _flow():
        it = work_items_stream_iter(user, today, today, "Asia/Shanghai")
        first = await asyncio.wait_for(it.__anext__(), timeout=10)
        _run(tid, None, "queued")  # 流中途制造一次允许范围内的变化
        second = await asyncio.wait_for(it.__anext__(), timeout=10)
        await it.aclose()
        return first, second

    first, second = asyncio.run(_flow())
    assert "event: refresh" in first and "id: 1" in first
    assert "event: refresh" in second and "id: 2" in second


@pytest.fixture
def auth_on(monkeypatch):
    monkeypatch.setenv("WF_AUTH", "on")
    monkeypatch.setenv("WF_SECRET_KEY", "mtc002br-key-0123456789")
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


def test_stream_auth_and_scope_digest(auth_on):
    # 匿名 401（依赖层拦截，先于生成器）
    assert client.get("/api/work-items/stream").status_code == 401
    alice = _mk_user("operator", team="A", scope="team")
    bob = _mk_user("viewer", team="B", scope="team")
    tid = _task(f"002BR-sc-{uuid.uuid4().hex[:6]}", created_by=alice)
    _run(tid, None, "queued")
    # digest 继承数据范围：admin 与 bob 对同一窗口摘要不同（alice 的任务对 bob 不可见）；
    # 持 token 的 200/首事件由 verify-mtc002b.mjs 对真实服务器断言（TestClient 无法消费 SSE）
    db = SessionLocal()
    try:
        today = datetime.now(_tz.utc).date().isoformat()
        d_admin = compute_stream_digest(db, {"role": "admin", "username": "admin",
                                             "data_scope": "all"}, today, today, "Asia/Shanghai")
        d_bob = compute_stream_digest(db, {"role": "viewer", "username": bob, "team": "B",
                                           "data_scope": "team"}, today, today, "Asia/Shanghai")
        assert d_admin != d_bob
    finally:
        db.close()


# ---------- P1-02 冻结版本 ----------

def test_frozen_version_no_drift():
    tid = _task(f"002BR-fz-{uuid.uuid4().hex[:6]}", wf="wf-frozen-a")
    db = SessionLocal()
    try:
        v1 = db.get(AnalysisTask, tid).current_version_id
    finally:
        db.close()
    rid = _run(tid, v1, "queued")
    # 编辑定义：V2 改为 Agent 目标
    v2 = _version(tid, 2, wf=None, agent="agent-frozen-b")
    db = SessionLocal()
    try:
        t = db.get(AnalysisTask, tid)
        t.current_version_id = v2
        db.commit()
    finally:
        db.close()
    items = _items(automationId=tid)["items"]
    run_item = next(w for w in items if w["id"] == f"taskrun:{rid}")
    assert run_item["assignee"]["type"] == "workflow"
    assert run_item["assignee"]["id"] == "wf-frozen-a", "历史卡不得漂移到当前版本"
    oid = _occ(tid)
    occ_item = next(w for w in _items(automationId=tid)["items"] if w["id"] == f"occurrence:{oid}")
    assert occ_item["assignee"]["type"] == "agent"
    assert occ_item["assignee"]["id"] == "agent-frozen-b", "未触发计划用当前版本"


# ---------- P1-03 断链 occurrence ----------

def test_broken_occurrence_projects_needs_action():
    tid = _task(f"002BR-br-{uuid.uuid4().hex[:6]}")
    oid = _occ(tid, status="started")  # 声称已触发但无 TaskRun
    w = next(w for w in _items(automationId=tid)["items"] if w["id"] == f"occurrence:{oid}")
    assert w["status"] == "needs_action"
    assert w["attention"]["code"] == "OCCURRENCE_RUN_MISSING"
    assert w["attention"]["required"] and w["attention"]["severity"] == "critical"
    assert "OCCURRENCE_RUN_MISSING" in w["diagnostics"]["conflictCodes"]
    # 详情 200（同团队），不再误报 403
    d = client.get(f"/api/work-items/occurrence:{oid}")
    assert d.status_code == 200
    assert d.json()["attention"]["code"] == "OCCURRENCE_RUN_MISSING"


def test_broken_occurrence_detail_scope_and_404(auth_on):
    alice = _mk_user("operator", team="A", scope="team")
    bob = _mk_user("viewer", team="B", scope="team")
    tid = _task(f"002BR-br2-{uuid.uuid4().hex[:6]}", created_by=alice)
    oid = _occ(tid, status="firing")
    hdr = {"Authorization": f"Bearer {_tok(bob)}"}
    assert client.get(f"/api/work-items/occurrence:{oid}", headers=hdr).status_code == 403
    hdr_a = {"Authorization": f"Bearer {_tok(alice)}"}
    assert client.get(f"/api/work-items/occurrence:{oid}", headers=hdr_a).status_code == 200
    # cancelled 空计划不属于投影 → 404（不是 403）
    oid_c = _occ(tid, status="cancelled")
    assert client.get(f"/api/work-items/occurrence:{oid_c}", headers=hdr_a).status_code == 404


# ---------- P1-04 205 条完整性 ----------

def test_pagination_no_silent_drop():
    tid = _task(f"002BR-pg-{uuid.uuid4().hex[:6]}")
    statuses = ["queued", "running", "succeeded", "failed", "cancelled"]
    ids = []
    db = SessionLocal()
    try:
        v = db.execute(
            __import__("sqlalchemy").select(AnalysisTaskVersion)
            .where(AnalysisTaskVersion.task_id == tid)).scalars().first()
        for i in range(205):
            st = statuses[i % 5]
            tr = TaskRun(task_id=tid, task_version_id=v.id, status=st,
                         delivery_status="not_configured" if st != "succeeded" else "succeeded",
                         trigger="manual", total=2,
                         succeeded_count=2 if st == "succeeded" else 0,
                         failed_count=2 if st == "failed" else 0,
                         skipped_count=0, cancelled_count=2 if st == "cancelled" else 0)
            db.add(tr)
            db.flush()
            ids.append(tr.id)
        db.commit()
    finally:
        db.close()
    p1 = client.get("/api/work-items", params={"automationId": tid, "pageSize": 200, "page": 1}).json()
    assert p1["truncated"] is True
    assert len(p1["items"]) == 200
    p2 = client.get("/api/work-items", params={"automationId": tid, "pageSize": 200, "page": 2}).json()
    assert len(p2["items"]) == 5
    got = {w["taskRunId"] for w in p1["items"]} | {w["taskRunId"] for w in p2["items"]}
    assert got == set(ids), "分页不得静默漏卡"
    seen_status = {w["status"] for w in p1["items"]} | {w["status"] for w in p2["items"]}
    assert seen_status == {"queued", "running", "completed", "failed_cancelled"}
    assert p1["counts"] == p2["counts"] == {
        "needs_action": 0, "running": 41, "completed": 41, "queued": 41, "failed_cancelled": 82}


# ---------- P2-01 参数契约 ----------

def test_param_validation_422():
    assert client.get("/api/work-items", params={"dateFrom": "not-a-date"}).status_code == 422
    assert client.get("/api/work-items", params={"dateTo": "xx"}).status_code == 422
    assert client.get("/api/work-items", params={"timezone": "Not/AZone"}).status_code == 422
    assert client.get("/api/work-items", params={"status": "bogus"}).status_code == 422
    assert client.get("/api/work-items", params={"origin": "bogus"}).status_code == 422
    assert client.get("/api/work-items", params={"attentionOnly": "bogus"}).status_code == 422
    ok = client.get("/api/work-items", params={"timezone": "UTC"})
    assert ok.status_code == 200 and ok.json()["timezone"] == "UTC"


# ---------- by-task-runs ----------

def test_by_task_runs_batch_and_scope(auth_on):
    alice = _mk_user("operator", team="A", scope="team")
    bob = _mk_user("viewer", team="B", scope="team")
    tid = _task(f"002BR-btr-{uuid.uuid4().hex[:6]}", created_by=alice)
    rid = _run(tid, None, "failed", failed=2)
    hdr_a = {"Authorization": f"Bearer {_tok(alice)}"}
    hdr_b = {"Authorization": f"Bearer {_tok(bob)}"}
    r = client.get("/api/work-items/by-task-runs", params={"ids": rid}, headers=hdr_a)
    assert r.status_code == 200
    items = r.json()["items"]
    assert len(items) == 1 and items[0]["status"] == "failed_cancelled"
    assert client.get("/api/work-items/by-task-runs", params={"ids": rid},
                      headers=hdr_b).json()["items"] == []
