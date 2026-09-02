"""P2 测试：schedule 计算/tick、tool test、retry、connection 引用阻断、metrics。"""
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.main import app
from app.runner import compute_next, schedule_tick
from app.db import SessionLocal
from app.models import Schedule

client = TestClient(app)


def _wf():
    return client.post("/api/workflows", json={"name": "P2"}).json()["id"]


def test_schedule_next_run_computed_and_tick_fires():
    wid = _wf()
    # SDD A-01：定时任务只运行已发布版本——先发布再挂调度
    assert client.post(f"/api/workflows/{wid}/publish").status_code == 201
    r = client.post("/api/schedules", json={"workflowId": wid, "cron": "* * * * *",
                                            "timezone": "Asia/Shanghai", "enabled": False})
    assert r.status_code == 201
    sid = r.json()["id"]
    assert r.json()["nextRunAt"]
    # 强制到期并 tick
    db = SessionLocal()
    sch = db.get(Schedule, sid)
    sch.enabled = True
    sch.next_run_at = datetime.now(timezone.utc) - timedelta(seconds=5)
    db.commit()
    db.close()
    # worker 线程的 scheduler 可能并发 tick 抢先触发：不断言本线程 fired 次数，
    # 以"调度确实产生了 run"为事实（SDD 13 后 occurrence 物化亦在 tick 内）。
    schedule_tick()
    import time as _t
    deadline = _t.time() + 10
    runs = []
    while _t.time() < deadline:
        runs = client.get(f"/api/schedules/{sid}/runs").json()
        if runs:
            break
        _t.sleep(0.3)
    assert len(runs) >= 1 and runs[0]["status"] in ("queued", "running", "succeeded", "failed")


def test_schedule_invalid_cron_rejected():
    wid = _wf()
    try:
        compute_next("not a cron", "Asia/Shanghai")
        raised = False
    except Exception:
        raised = True
    assert raised


def test_tool_create_and_test_echo():
    t = client.post("/api/tools", json={"name": "echo-tool", "kind": "builtin",
                                        "spec": {"kind": "echo"}}).json()
    r = client.post(f"/api/tools/{t['id']}/test", json={"input": "hello"})
    assert r.json()["ok"] is True
    assert "hello" in r.json()["output"]["result"]


def test_tool_version_increment():
    t = client.post("/api/tools", json={"name": "ver-tool", "spec": {"kind": "echo"}}).json()
    u = client.put(f"/api/tools/{t['id']}", json={"spec": {"kind": "echo"}}).json()
    assert u["newVersion"] == 2


def test_connection_referenced_delete_blocked_with_refs():
    """SDD-12 P0-03 / B-05（取代 08-27"先解绑再删"决策，见规格 §0/§1.2）：
    有引用 Connection 删除 → 409 + 完整 refs；引用方不被静默解绑。"""
    from app.models import Connection, Tool
    c = client.post("/api/connections", json={"name": "conn1", "secret": "sk"}).json()
    t = client.post("/api/tools", json={"name": "bound-tool", "connectionId": c["id"],
                                        "spec": {"kind": "echo"}}).json()
    r = client.delete(f"/api/connections/{c['id']}")
    assert r.status_code == 409, r.text
    detail = r.json()["detail"]
    assert detail["code"] == "REFERENCE_CONFLICT"
    assert any(ref.get("kind") == "tool" and ref.get("id") == t["id"] for ref in detail["refs"])
    db = SessionLocal()
    try:
        assert db.get(Connection, c["id"]) is not None  # 连接仍在
        assert db.get(Tool, t["id"]).connection_id == c["id"]  # 未被解绑
    finally:
        db.close()


def test_connection_free_delete_archives():
    """SDD-12 B-07：无引用连接默认删除=归档（软删除），不做物理删除。"""
    c = client.post("/api/connections", json={"name": "free", "secret": "x"}).json()
    t = client.post(f"/api/connections/{c['id']}/test").json()
    assert t["ok"] is False, "缺 endpoint 的连接测试应失败关闭"
    r = client.delete(f"/api/connections/{c['id']}")
    assert r.status_code == 200 and r.json().get("lifecycle") == "archived"
    g = client.get(f"/api/connections/{c['id']}").json()
    assert g["lifecycle"] == "archived"
    # 硬删除仅限无引用 draft：draft 连接可硬删
    c2 = client.post("/api/connections", json={"name": "draft-hard", "secret": "x"}).json()
    r2 = client.delete(f"/api/connections/{c2['id']}?hard=true")
    assert r2.status_code == 200 and r2.json().get("hardDeleted") is True
    assert client.get(f"/api/connections/{c2['id']}").status_code == 404
    # 归档连接不可硬删
    r3 = client.delete(f"/api/connections/{c['id']}?hard=true")
    assert r3.status_code == 422


def test_run_retry_creates_origin_link():
    wid = _wf()
    r1 = client.post("/api/runs", json={"workflowId": wid, "trigger": "test", "input": {}})
    assert r1.status_code == 202
    run1 = r1.json()["runId"]
    # 09 P0-B4：POST /api/runs 已入队（唯一 worker 执行）；不再手动 execute_run 造成并发双跑。
    import time as _t
    deadline = _t.time() + 30
    while _t.time() < deadline:
        st = client.get(f"/api/runs/{run1}").json()["status"]
        if st in ("succeeded", "failed", "cancelled"):
            break
        _t.sleep(0.2)
    r2 = client.post(f"/api/runs/{run1}/retry")
    assert r2.status_code == 202
    assert r2.json()["originRunId"] == run1


def test_metrics_endpoint():
    r = client.get("/metrics")
    assert r.status_code == 200
    assert "wf_runs_total" in r.text


def test_models_registry_roundtrip():
    p = client.post("/api/model-providers", json={"name": "mock-prov", "baseUrl": "mock://"}).json()
    client.post("/api/models", json={"providerId": p["id"], "modelKey": "qwen-test",
                                     "capabilities": ["text"]})
    models = client.get("/api/registry/models").json()
    assert any(m["modelKey"] == "qwen-test" for m in models["items"])


def test_auth_middleware_optional():
    """09 P0-10：鉴权改为身份登录（静态 WF_API_TOKEN 契约已废止）。
    WF_AUTH=on → 未登录 401、登录后 200；关闭后匿名可用。"""
    import os
    from fastapi.testclient import TestClient as TC
    from app.main import app
    os.environ["WF_AUTH"] = "on"
    os.environ["WF_SECRET_KEY"] = "p2-auth-key"
    c = TC(app)
    try:
        assert c.get("/api/workflows").status_code == 401
        tok = c.post("/api/auth/login",
                     json={"username": "admin", "password": "admin"}).json()["token"]
        assert c.get("/api/workflows",
                     headers={"Authorization": f"Bearer {tok}"}).status_code == 200
    finally:
        del os.environ["WF_AUTH"]
        del os.environ["WF_SECRET_KEY"]
    assert c.get("/api/workflows").status_code == 200
