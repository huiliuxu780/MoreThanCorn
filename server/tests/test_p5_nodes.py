"""P5 节点联动：knowledge-retrieval / mcp-call 定义+执行+校验+发布引用快照。"""
import uuid

from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.runner import create_run, execute_run

client = TestClient(app)


def u(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:6]}"


def _build_wf(ks_id: str, mcp_id: str, tool_name: str) -> str:
    wf = client.post("/api/workflows", json={"name": u("wf"), "description": ""}).json()
    detail = client.get(f"/api/workflows/{wf['id']}").json()
    defn = detail["definition"]
    defn["graph"]["nodes"] = [
        {"id": "s", "type": "input", "name": "开始", "config": {}, "inputs": []},
        {"id": "kr", "type": "knowledge-retrieval", "name": "知识检索",
         "config": {"knowledgeSourceId": ks_id, "query": "{{s.outputs.userQuery}}", "topK": 3}, "inputs": []},
        {"id": "mc", "type": "mcp-call", "name": "MCP 工具",
         "config": {"mcpServerId": mcp_id, "toolName": tool_name, "args": {}}, "inputs": []},
        {"id": "e", "type": "end", "name": "结束", "config": {"outputKey": "quality_result"},
         "inputs": [{"name": "output", "type": "string",
                     "source": {"kind": "upstream", "nodeId": "kr", "path": "outputs.slices"}}]},
    ]
    defn["graph"]["edges"] = [{"id": "e1", "source": "s", "target": "kr"},
                              {"id": "e2", "source": "kr", "target": "mc"},
                              {"id": "e3", "source": "mc", "target": "e"}]
    r = client.put(f"/api/workflows/{wf['id']}/draft",
                   json={"definition": defn, "baseRevision": detail["draftRevision"]})
    assert r.status_code == 200, r.text
    return wf["id"]


def test_knowledge_mcp_end_to_end():
    ks = client.post("/api/ai-resources/knowledge-sources",
                     json={"name": u("ks"), "kind": "vector", "tested": True}).json()
    mcp = client.post("/api/ai-resources/mcp-servers",
                      json={"name": u("mcp"), "transport": "stdio", "command": "npx -y x",
                            "tested": True}).json()
    t = client.post(f"/api/ai-resources/mcp-servers/{mcp['id']}/test", json={}).json()
    tool_name = t["output"]["tools"][0]

    wid = _build_wf(ks["id"], mcp["id"], tool_name)
    rep = client.get(f"/api/workflows/{wid}/validation").json()
    assert rep["ok"], rep

    pub = client.post(f"/api/workflows/{wid}/publish")
    assert pub.status_code == 201, pub.text

    db = SessionLocal()
    try:
        run = create_run(db, wid, "test", {"userQuery": "退款政策"}, enqueue=False)
    finally:
        db.close()
    execute_run(run.id)

    db = SessionLocal()
    try:
        from app.models import Run, WorkflowVersion
        r = db.get(Run, run.id)
        assert r.status == "succeeded", r.error
        assert "mock" in (r.output or {}).get("output", "")
        ver = db.query(WorkflowVersion).filter_by(workflow_id=wid).first()
        assert ver.knowledge_refs and ver.knowledge_refs[0]["ref"] == ks["id"]
        assert ver.mcp_refs and ver.mcp_refs[0]["ref"] == mcp["id"]
    finally:
        db.close()


def test_validator_blocks_disabled_resource():
    ks = client.post("/api/ai-resources/knowledge-sources",
                     json={"name": u("ks"), "kind": "vector", "tested": True}).json()
    mcp = client.post("/api/ai-resources/mcp-servers",
                      json={"name": u("mcp"), "transport": "stdio", "command": "npx -y x",
                            "tested": True}).json()
    client.post(f"/api/ai-resources/mcp-servers/{mcp['id']}/test", json={})
    wid = _build_wf(ks["id"], mcp["id"], "search_docs")
    # 停用 knowledge source 后校验应报 dependency
    client.post(f"/api/ai-resources/knowledge-sources/{ks['id']}/toggle", json={"enabled": False})
    rep = client.get(f"/api/workflows/{wid}/validation").json()
    assert not rep["ok"]
    assert any(i["kind"] == "dependency" for i in rep["issues"])
