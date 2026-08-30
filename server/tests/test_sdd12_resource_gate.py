"""SDD-12 P0-04/P0-05：资源启用门禁（不信 tested）与 fixture 显式门控（失败关闭）。

验收映射：C-01（资源侧）、D-07（echo 防护）、J-01/J-02（零 mock 回退）、A-07（健康派生）。
"""
import http.server
import json
import threading
import uuid

import pytest
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.runner import RunError

client = TestClient(app)


def u(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:6]}"


@pytest.fixture(scope="module")
def live_endpoint():
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


def test_tested_flag_never_trusted_on_create():
    """P0-04：payload.tested 对六类资源创建一律无效。"""
    r_tool = client.post("/api/ai-resources/tools", json={
        "name": u("tool"), "kind": "http", "tested": True,
        "spec": {"kind": "http", "request": {"method": "GET", "url": "http://127.0.0.1:1/x"}}})
    assert r_tool.status_code == 201 and r_tool.json()["status"] == "disabled"
    r_mcp = client.post("/api/ai-resources/mcp-servers", json={
        "name": u("mcp"), "transport": "stdio", "command": "npx -y x", "tested": True})
    assert r_mcp.json()["status"] == "disabled"
    r_ks = client.post("/api/ai-resources/knowledge-sources",
                       json={"name": u("ks"), "kind": "vector", "tested": True})
    assert r_ks.json()["status"] == "disabled"
    r_ds = client.post("/api/data-resources/datasources", json={
        "name": u("ds"), "type": "mysql", "location": "db_z", "tested": True})
    assert r_ds.json()["status"] == "disabled"
    r_as = client.post("/api/data-resources/assets", json={
        "name": u("asset"), "location": "t_z", "tested": True,
        "rows": [{"a": 1, "t": "2026-01-01"}], "timeField": "t"})
    assert r_as.json()["status"] == "disabled"  # Draft → 不可被 picker 选用


def test_toggle_enable_requires_real_test():
    """门禁链：创建=disabled → 未测启用 422 → 真实测试通过 → 启用 → 改配置 → stale。

    注：Tool 执行路径的 SSRF 防护恒拦私网地址（§15.2.1，含 127.0.0.1），
    故成功路径使用显式标记的 fixture 工具（测试 profile 下真实执行其配方）。
    """
    tool = client.post("/api/ai-resources/tools", json={
        "name": u("tool"), "kind": "http", "spec": {"kind": "echo"}, "fixture": True}).json()
    rid = tool["id"]
    g = client.get(f"/api/ai-resources/tools/{rid}").json()
    assert g["health"] == "untested"  # H-02：未测试不得 healthy
    e = client.post(f"/api/ai-resources/tools/{rid}/toggle", json={"enabled": True})
    assert e.status_code == 422, "未测试不得启用"
    t = client.post(f"/api/ai-resources/tools/{rid}/test", json={"input": "ping"}).json()
    assert t["ok"] is True and t["checkRunId"], t
    assert client.post(f"/api/ai-resources/tools/{rid}/toggle",
                       json={"enabled": True}).status_code == 200
    assert client.get(f"/api/ai-resources/tools/{rid}").json()["status"] == "enabled"
    # 更新产生新 spec 版本 → 指纹变化 → stale，须重测才能再启用
    client.put(f"/api/ai-resources/tools/{rid}", json={
        "spec": {"kind": "echo", "description": "v2"}, "fixture": True})
    g2 = client.get(f"/api/ai-resources/tools/{rid}").json()
    assert g2["health"] == "stale"
    e2 = client.post(f"/api/ai-resources/tools/{rid}/toggle", json={"enabled": True})
    assert e2.status_code == 409 and e2.json()["detail"]["code"] == "RESOURCE_HEALTH_STALE"


def test_d07_echo_spec_rejected_without_fixture_marker(monkeypatch):
    monkeypatch.delenv("WF_TEST_FIXTURES", raising=False)
    r = client.post("/api/ai-resources/tools", json={
        "name": u("echo"), "kind": "http", "spec": {"kind": "echo"}})
    assert r.status_code == 422, "普通新建不得默认 echo"
    # 显式 fixture 标记允许（测试专用；生产执行仍失败关闭）
    r2 = client.post("/api/ai-resources/tools", json={
        "name": u("echo-fx"), "kind": "http", "spec": {"kind": "echo"}, "fixture": True})
    assert r2.status_code == 201
    # 默认空 spec（{}）同样拒绝
    r3 = client.post("/api/ai-resources/tools", json={"name": u("empty"), "kind": "http", "spec": {}})
    assert r3.status_code == 422


@pytest.mark.parametrize("coll,body,test_body", [
    ("mcp-servers", {"transport": "stdio", "command": "npx -y x"}, {}),
    ("knowledge-sources", {"kind": "vector"}, {"query": "退款"}),
])
def test_j02_dev_without_fixtures_fails_closed(monkeypatch, coll, body, test_body):
    """J-02：普通 dev（无 WF_TEST_FIXTURES）不因缺配置返回成功 mock。"""
    monkeypatch.delenv("WF_TEST_FIXTURES", raising=False)
    res = client.post(f"/api/ai-resources/{coll}", json={"name": u("fc"), **body}).json()
    t = client.post(f"/api/ai-resources/{coll}/{res['id']}/test", json=test_body).json()
    assert t["ok"] is False, t
    assert "fixture" not in json.dumps(t.get("output") or {}) or not t["output"].get("fixture")


def test_j02_datasource_and_runtime_fail_closed(monkeypatch):
    monkeypatch.delenv("WF_TEST_FIXTURES", raising=False)
    ds = client.post("/api/data-resources/datasources", json={
        "name": u("ds"), "type": "mysql", "location": "db_fc"}).json()
    t = client.post(f"/api/data-resources/datasources/{ds['id']}/test", json={}).json()
    assert t["ok"] is False, t
    # 运行时知识检索同样失败关闭
    from app.resource_tests import search_knowledge
    db = SessionLocal()
    try:
        ks_id = _mk_knowledge(db)
        with pytest.raises(RunError):
            search_knowledge(db, ks_id, "q")
    finally:
        db.close()


def _mk_knowledge(db) -> str:
    from app.models import KnowledgeSource
    ks = KnowledgeSource(name=u("ks"), kind="vector", source_config={}, status="enabled")
    db.add(ks)
    db.commit()
    return ks.id


def test_j01_model_call_fail_closed_without_provider(monkeypatch):
    """J-01：生产语义——无真实 Provider 的模型调用失败关闭（任何环境无 fixture）。"""
    monkeypatch.delenv("WF_TEST_FIXTURES", raising=False)
    monkeypatch.delenv("WF_LLM_BASE_URL", raising=False)
    from app.models import Model, ModelProvider
    from app.runner import _call_model
    db = SessionLocal()
    try:
        prov = ModelProvider(name=u("prov"), base_url="mock://")
        db.add(prov)
        db.commit()
        m = Model(provider_id=prov.id, model_key=u("mk"), display_name="fc")
        db.add(m)
        db.commit()
        with pytest.raises(RunError, match="MODEL_UNAVAILABLE"):
            _call_model(db, m.model_key, "ping")
    finally:
        db.close()


def test_fixture_profile_marks_output():
    """显式 fixture profile 下允许样例路径，但输出必须携带 fixture 标记。"""
    import os
    assert os.environ.get("WF_TEST_FIXTURES") == "1"  # conftest 显式开启
    ks = client.post("/api/ai-resources/knowledge-sources",
                     json={"name": u("ks"), "kind": "vector"}).json()
    t = client.post(f"/api/ai-resources/knowledge-sources/{ks['id']}/test",
                    json={"query": "退款"}).json()
    assert t["ok"] is True and t["output"]["fixture"] is True
    mcp = client.post("/api/ai-resources/mcp-servers", json={
        "name": u("mcp"), "transport": "stdio", "command": "npx -y x"}).json()
    mt = client.post(f"/api/ai-resources/mcp-servers/{mcp['id']}/test", json={}).json()
    assert mt["ok"] is True and mt["output"]["fixture"] is True
    assert mt["output"]["tools"], "fixture 发现清单非空"
