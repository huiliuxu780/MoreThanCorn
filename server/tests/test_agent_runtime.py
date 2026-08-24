"""Agent 运行层（05 设计）验收：三型运行 / 挂载消费 / 护栏 / 发布同步 / mounts-health。"""
import json

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _create_agent(name, atype, config=None):
    r = client.post("/api/agents", json={"name": name, "type": atype, "config": config or {}})
    assert r.status_code == 201, r.text
    return r.json()


def test_autonomous_run_with_tool_mount():
    tool = client.post("/api/tools", json={"name": "echo-tool-rt", "kind": "builtin",
                                           "spec": {"kind": "echo"}}).json()
    a = _create_agent("autonomous-rt", "autonomous", {
        "rolePrompt": "# 角色：测试", "modelRef": {"modelId": "qwen-plus"},
        "skills": ["技能A"], "tools": ["echo-tool-rt", "ghost-tool"], "workflows": [], "knowledges": []})
    r = client.post(f"/api/agents/{a['id']}/run", json={"input": {"userQuery": "你好"}})
    assert r.status_code == 200, r.text
    run_id = r.json()["runId"]
    d = client.get(f"/api/agents/{a['id']}/runs/{run_id}").json()
    assert d["status"] == "succeeded", d
    types = [e["type"] for e in d["events"]]
    assert "agent_started" in types and "agent_completed" in types
    # mock LLM 首轮触发挂载工具调用，验证 function-call 循环
    assert "tool_call" in types and "tool_result" in types
    assert d["output"]["content"]


def test_mounts_health():
    a = _create_agent("mounts-rt", "autonomous", {
        "rolePrompt": "", "modelRef": {"modelId": ""}, "skills": ["s1"],
        "tools": ["echo-tool-rt", "ghost-tool"], "workflows": ["不存在的流"], "knowledges": []})
    items = client.get(f"/api/agents/{a['id']}/mounts-health").json()["items"]
    by = {(i["kind"], i["name"]): i["valid"] for i in items}
    assert by[("tool", "echo-tool-rt")] is True
    assert by[("tool", "ghost-tool")] is False
    assert by[("workflow", "不存在的流")] is False
    assert by[("skill", "s1")] is True


def test_expert_group_run_with_agent_exec():
    member = _create_agent("member-dialogue-rt", "dialogue")
    eg = _create_agent("expert-rt", "expert-group")
    wf_id = eg["workflowId"]
    det = client.get(f"/api/workflows/{wf_id}").json()
    defn = det["definition"]
    defn["graph"]["nodes"] = [
        {"id": "s", "type": "input", "name": "开始", "config": {}, "inputs": []},
        {"id": "sel", "type": "agent-select", "name": "Agent选择",
         "config": {"primaryAgents": [member["id"]], "fallbackAgent": member["id"]}, "inputs": []},
        {"id": "ex", "type": "agent-exec", "name": "Agent执行",
         "config": {}, "inputs": [
             {"name": "agentCode", "type": "string",
              "source": {"kind": "upstream", "nodeId": "sel", "path": "outputs.agentCode"}}]},
        {"id": "e", "type": "end", "name": "结束", "config": {"outputKey": "quality_result"},
         "inputs": [{"name": "output", "type": "string",
                     "source": {"kind": "upstream", "nodeId": "ex", "path": "outputs.content"}}]},
    ]
    defn["graph"]["edges"] = [
        {"id": "e1", "source": "s", "target": "sel"},
        {"id": "e2", "source": "sel", "target": "ex"},
        {"id": "e3", "source": "ex", "target": "e"},
    ]
    sv = client.put(f"/api/workflows/{wf_id}/draft",
                    json={"definition": defn, "baseRevision": det["draftRevision"]})
    assert sv.status_code == 200, sv.text
    r = client.post(f"/api/agents/{eg['id']}/run", json={"input": {"userQuery": "hi"}})
    assert r.status_code == 200, r.text
    d = client.get(f"/api/agents/{eg['id']}/runs/{r.json()['runId']}").json()
    assert d["status"] == "succeeded", d
    # 成员 dialogue 产生独立 Run（agent_id=member）
    member_runs = client.get(f"/api/agents/{member['id']}/runs").json()["items"]
    assert len(member_runs) >= 1


def test_publish_syncs_agent_status():
    a = _create_agent("pub-sync-rt", "dialogue")
    assert a["workflowId"]
    p = client.post(f"/api/workflows/{a['workflowId']}/publish?note=rt")
    assert p.status_code == 201, p.text
    g = client.get(f"/api/agents/{a['id']}").json()
    assert g["status"] == "published"


def test_run_unknown_agent_404():
    r = client.post("/api/agents/nope/run", json={"input": {}})
    assert r.status_code == 404
