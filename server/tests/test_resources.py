"""资源管理 P1/P2：六类资源 CRUD / 分域筛选 / toggle / 删除防护链 / test executor / connections 升级。"""
import uuid

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def u(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:6]}"


def test_connection_protocol_endpoint():
    name = u("conn")
    r = client.post("/api/connections", json={"name": name, "protocol": "mysql",
                                              "endpoint": {"host": "db.internal", "port": 3306},
                                              "kind": "basic", "secret": "pw"})
    assert r.status_code == 201, r.text
    cid = r.json()["id"]
    items = client.get("/api/connections", params={"type": "mysql"}).json()["items"]
    hit = [c for c in items if c["id"] == cid][0]
    assert hit["protocol"] == "mysql" and hit["endpoint"]["host"] == "db.internal"
    assert hit["secretConfigured"] is True
    t = client.post(f"/api/connections/{cid}/test")
    assert t.json()["ok"] is True


def test_wizard_gate_untested_disabled():
    r = client.post("/api/data-resources/datasources",
                    json={"name": u("ds"), "type": "mysql", "location": "db1"})
    assert r.status_code == 201
    assert r.json()["status"] == "disabled"  # 未测试不能 Enabled


def test_datasource_type_filter_and_toggle():
    a = u("ds")
    b = u("ds")
    ra = client.post("/api/data-resources/datasources",
                     json={"name": a, "type": "mysql", "location": "db_a", "tested": True})
    rb = client.post("/api/data-resources/datasources",
                     json={"name": b, "type": "oss", "location": "oss://b", "tested": True})
    assert ra.json()["status"] == "enabled" and rb.json()["status"] == "enabled"
    items = client.get("/api/data-resources/datasources", params={"type": "mysql", "search": a}).json()["items"]
    assert len(items) == 1 and items[0]["metadata"]["dsType"] == "mysql"
    # toggle
    t = client.post(f"/api/data-resources/datasources/{rb.json()['id']}/toggle", json={"enabled": False})
    assert t.json()["enabled"] is False
    d = client.get(f"/api/data-resources/datasources/{rb.json()['id']}").json()
    assert d["status"] == "disabled"
    assert any(c["action"] == "disable" for c in d["changeLog"])
    # picker 只列 enabled
    picker = client.get("/api/registry/resources", params={"types": "datasource", "enabledOnly": True}).json()["items"]
    assert all(p["status"] == "enabled" for p in picker)
    assert not [p for p in picker if p["id"] == rb.json()["id"]]


def test_delete_protection_chain():
    ds = client.post("/api/data-resources/datasources",
                     json={"name": u("ds"), "type": "mysql", "location": "dbx", "tested": True}).json()
    asset = client.post("/api/data-resources/assets",
                        json={"name": u("asset"), "datasourceId": ds["id"],
                              "location": "t_x", "recordMeaning": "一通对话", "tested": True}).json()
    defn = client.post("/api/data-definitions", json={"name": u("def"), "assetId": asset["id"]}).json()

    r = client.delete(f"/api/data-resources/datasources/{ds['id']}")
    assert r.status_code == 409
    assert any(ref["kind"] == "data_asset" for ref in r.json()["detail"]["refs"])

    r = client.delete(f"/api/data-resources/assets/{asset['id']}")
    assert r.status_code == 409
    assert any(ref["kind"] == "data_definition" for ref in r.json()["detail"]["refs"])

    assert client.delete(f"/api/data-definitions/{defn['id']}").json()["ok"] is True
    assert client.delete(f"/api/data-resources/assets/{asset['id']}").json()["ok"] is True
    assert client.delete(f"/api/data-resources/datasources/{ds['id']}").json()["ok"] is True


def test_mcp_test_executor_and_health():
    m = client.post("/api/ai-resources/mcp-servers",
                    json={"name": u("mcp"), "transport": "stdio", "command": "npx -y demo-mcp",
                          "tested": True}).json()
    t = client.post(f"/api/ai-resources/mcp-servers/{m['id']}/test", json={})
    body = t.json()
    assert body["ok"] is True and body["output"]["tools"]
    d = client.get(f"/api/ai-resources/mcp-servers/{m['id']}").json()
    assert d["health"] == "healthy" and d["metadata"]["tools"] >= 1


def test_model_knowledge_test_executors():
    prov = client.get("/api/model-providers").json()["items"][0]
    m = client.post("/api/ai-resources/models",
                    json={"name": u("model"), "providerId": prov["id"], "modelKey": "qwen-test",
                          "capabilities": ["text"], "tested": True}).json()
    t = client.post(f"/api/ai-resources/models/{m['id']}/test", json={})
    assert t.json()["ok"] is True
    k = client.post("/api/ai-resources/knowledge-sources",
                    json={"name": u("ks"), "kind": "vector", "tested": True}).json()
    assert client.post(f"/api/ai-resources/knowledge-sources/{k['id']}/test",
                       json={"query": "hello"}).json()["ok"] is True


def test_tool_versions_and_workflow_ref_protection():
    tool = client.post("/api/ai-resources/tools",
                       json={"name": u("tool"), "kind": "builtin", "spec": {"kind": "echo"},
                             "tested": True}).json()
    vs = client.get(f"/api/ai-resources/tools/{tool['id']}/versions").json()
    assert vs[0]["version"] == 1
    assert client.post(f"/api/ai-resources/tools/{tool['id']}/versions").json()["version"] == 2

    wf = client.post("/api/workflows", json={"name": u("wf"), "description": ""}).json()
    wid = wf["id"]
    detail = client.get(f"/api/workflows/{wid}").json()
    defn = detail["definition"]
    defn["graph"]["nodes"] = [
        {"id": "s", "type": "input", "name": "开始", "config": {}, "inputs": []},
        {"id": "t1", "type": "tool", "name": "调用工具", "config": {"toolVersionId": tool["id"]}, "inputs": []},
        {"id": "e", "type": "end", "name": "结束", "config": {}, "inputs": []},
    ]
    defn["graph"]["edges"] = [{"id": "e1", "source": "s", "target": "t1"},
                              {"id": "e2", "source": "t1", "target": "e"}]
    r = client.put(f"/api/workflows/{wid}/draft",
                   json={"definition": defn, "baseRevision": detail["draftRevision"]})
    assert r.status_code == 200, r.text

    r = client.delete(f"/api/ai-resources/tools/{tool['id']}")
    assert r.status_code == 409
    usage = client.get(f"/api/ai-resources/tools/{tool['id']}/usage").json()
    assert any(ref["kind"] == "workflow_node" for ref in usage["refs"])


def test_asset_test_executor_inline_rows():
    a = client.post("/api/data-resources/assets",
                    json={"name": u("asset"), "recordMeaning": "一通对话",
                          "timeField": "interactionTime",
                          "rows": [{"interactionId": "S1", "interactionTime": "2026-08-01T00:00:00Z"}],
                          "tested": True}).json()
    t = client.post(f"/api/data-resources/assets/{a['id']}/test", json={})
    assert t.json()["ok"] is True
