"""SDD-12 P0-03/P0-04：Connection 生命周期——Draft 创建、真实 CheckRun 启用门禁、
配置变化即 stale、失败关闭与禁用。

验收映射：C-01、C-02、C-03、C-06、B-05～B-07（连接侧）。
"""
import http.server
import json
import threading
import uuid

import pytest
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.models import CheckRun, Connection

client = TestClient(app)


def u(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:6]}"


@pytest.fixture(scope="module")
def live_endpoint():
    """真实可达的本机 HTTP 端点（连接探测的正向路径）。"""
    class H(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok": true}')

        def log_message(self, *a):
            pass

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()


def _mk(base_url: str, **extra) -> dict:
    body = {"name": u("conn"), "kind": "none", "protocol": "http-api",
            "endpoint": {"base_url": base_url}}
    body.update(extra)
    r = client.post("/api/connections", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def test_c01_create_is_draft_without_client_tested():
    c = _mk("https://unreachable.invalid/", tested=True)  # 客户端自报无效
    assert c["lifecycle"] == "draft"
    # 未检查直接启用 → 拒绝（CONNECTION_UNCHECKED）
    r = client.post(f"/api/connections/{c['id']}:enable")
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "CONNECTION_UNCHECKED"
    # 列表健康度=untested（H-02：不得显示 healthy）
    row = client.get("/api/connections", params={"search": c["name"]}).json()["items"][0]
    assert row["health"] == "untested"


def test_c02_c06_enable_requires_real_checkrun(live_endpoint):
    c = _mk(live_endpoint)
    t = client.post(f"/api/connections/{c['id']}/test", json={})
    assert t.status_code == 200 and t.json()["ok"] is True, t.text
    body = t.json()
    # C-06：阶段/耗时/脱敏诊断/指纹/traceId
    assert body["checkRunId"] and body["traceId"] and body["latencyMs"] >= 0
    assert body["diagnostics"]["stage"] == "capability"
    assert body["diagnostics"]["statusCode"] == 200
    assert "configFingerprint" in body

    db = SessionLocal()
    try:
        run = db.get(CheckRun, body["checkRunId"])
        assert run.scope == "connection" and run.purpose == "connectivity"
        assert run.status == "succeeded" and run.config_fingerprint
        assert run.trace_id == body["traceId"]
    finally:
        db.close()

    r = client.post(f"/api/connections/{c['id']}:enable")
    assert r.status_code == 200 and r.json()["lifecycle"] == "active"
    g = client.get(f"/api/connections/{c['id']}").json()
    assert g["lifecycle"] == "active" and g["health"] == "healthy"


def test_c03_config_change_marks_stale_and_blocks_enable(live_endpoint):
    c = _mk(live_endpoint)
    assert client.post(f"/api/connections/{c['id']}/test", json={}).json()["ok"] is True
    # 改 endpoint（未重新检查）→ stale
    r = client.put(f"/api/connections/{c['id']}", json={"endpoint": {"base_url": f"{live_endpoint}/v2"}})
    assert r.status_code == 200
    g = client.get(f"/api/connections/{c['id']}").json()
    assert g["health"] == "stale"
    e = client.post(f"/api/connections/{c['id']}:enable")
    assert e.status_code == 409
    assert e.json()["detail"]["code"] == "RESOURCE_HEALTH_STALE"
    # 重新检查后可启用
    assert client.post(f"/api/connections/{c['id']}/test", json={}).json()["ok"] is True
    assert client.post(f"/api/connections/{c['id']}:enable").status_code == 200


def test_secret_rotate_marks_connection_stale(live_endpoint):
    """§11.2：Secret revision 变化同样置 stale。"""
    c = _mk(live_endpoint, kind="api_key", secret="k0")
    assert client.post(f"/api/connections/{c['id']}/test", json={}).json()["ok"] is True
    r = client.post(f"/api/connections/{c['id']}/secret:rotate", json={"secret": "k1"})
    assert r.status_code == 200
    assert client.get(f"/api/connections/{c['id']}").json()["health"] == "stale"


def test_failed_check_blocks_enable_and_reports_stage():
    c = _mk("http://127.0.0.1:1/")  # 拒绝连接端口
    t = client.post(f"/api/connections/{c['id']}/test", json={}).json()
    assert t["ok"] is False and t["error"]
    assert t["diagnostics"]["stage"] in ("connect", "egress")
    e = client.post(f"/api/connections/{c['id']}:enable")
    assert e.status_code == 409
    # 生命周期未受探测结果污染（AR-07：健康与生命周期分离）
    assert client.get(f"/api/connections/{c['id']}").json()["lifecycle"] == "draft"


def test_disable_and_reenable(live_endpoint):
    c = _mk(live_endpoint)
    assert client.post(f"/api/connections/{c['id']}/test", json={}).json()["ok"] is True
    assert client.post(f"/api/connections/{c['id']}:enable").status_code == 200
    assert client.post(f"/api/connections/{c['id']}:disable").json()["lifecycle"] == "disabled"
    # 停用不抹掉检查结果：重新启用仍依据既有成功 CheckRun
    assert client.post(f"/api/connections/{c['id']}:enable").status_code == 200


def test_delete_409_refs_and_archive_flow(live_endpoint):
    c = _mk(live_endpoint)
    t = client.post("/api/tools", json={"name": u("tool"), "connectionId": c["id"],
                                        "spec": {"kind": "echo", "fixture": True}})
    assert t.status_code == 201
    # 有引用 → 409 + refs，且不解绑
    d = client.delete(f"/api/connections/{c['id']}")
    assert d.status_code == 409
    detail = d.json()["detail"]
    assert detail["code"] == "REFERENCE_CONFLICT"
    assert any(r["kind"] == "tool" and r["id"] == t.json()["id"] for r in detail["refs"])
    db = SessionLocal()
    try:
        from app.models import Tool
        assert db.get(Tool, t.json()["id"]).connection_id == c["id"]
    finally:
        db.close()
    # 清理引用后：默认删除=归档
    assert client.delete(f"/api/tools/{t.json()['id']}").status_code == 200
    d2 = client.delete(f"/api/connections/{c['id']}")
    assert d2.status_code == 200 and d2.json()["lifecycle"] == "archived"
    g = client.get(f"/api/connections/{c['id']}").json()
    assert g["lifecycle"] == "archived" and g["status"] == "archived"
    # 归档连接：不可编辑/启用/轮换
    assert client.put(f"/api/connections/{c['id']}", json={"name": "x"}).status_code == 409
    assert client.post(f"/api/connections/{c['id']}:enable").status_code == 409
    assert client.post(f"/api/connections/{c['id']}/secret:rotate",
                       json={"secret": "z"}).status_code == 409
    # 归档行不可硬删；无引用 draft 可硬删
    assert client.delete(f"/api/connections/{c['id']}?hard=true").status_code == 422
    draft = _mk("http://127.0.0.1:1/")
    hd = client.delete(f"/api/connections/{draft['id']}?hard=true")
    assert hd.status_code == 200 and hd.json()["hardDeleted"] is True
    assert client.get(f"/api/connections/{draft['id']}").status_code == 404


def test_audit_trail_for_lifecycle_events():
    c = _mk("http://127.0.0.1:1/")
    client.delete(f"/api/connections/{c['id']}")  # 归档
    items = client.get("/api/audit", params={"limit": 50}).json()["items"]
    actions = [a["action"] for a in items if a.get("targetId") == c["id"]]
    assert "connection.created" in actions
    assert "connection.archived" in actions
