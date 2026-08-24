"""Phase D-1（SDD 04 §0）验收：Agent 级观测指标 / 评测闭环 / Prompt 生成 / 成员冻结摘要。"""
import uuid

from fastapi.testclient import TestClient

from app.main import app
from app.runner import start_worker

client = TestClient(app)
start_worker()


def u(p: str) -> str:
    return f"{p}-{uuid.uuid4().hex[:6]}"


def mk_autonomous(name: str) -> dict:
    r = client.get("/api/registry/models").json()
    models = r["items"] if isinstance(r, dict) else r
    cfg = {"rolePrompt": "# 角色：测试", "modelRef": {"modelId": models[0]["modelKey"]},
           "skills": [], "tools": [], "workflows": [], "knowledges": []}
    resp = client.post("/api/agents", json={"name": name, "type": "autonomous", "config": cfg})
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_d1_agent_metrics_after_runs():
    import time
    a = mk_autonomous(u("指标"))
    run_ids = []
    for _ in range(2):
        r = client.post(f"/api/agents/{a['id']}/run", json={"input": {"userQuery": "hi"}, "trigger": "test"})
        assert r.status_code == 202
        run_ids.append(r.json()["runId"])
    # 等待异步运行到终态再取指标
    deadline = time.time() + 30
    while time.time() < deadline:
        states = [client.get(f"/api/agents/{a['id']}/runs/{rid}").json()["status"] for rid in run_ids]
        if all(s in ("succeeded", "failed", "cancelled") for s in states):
            break
        time.sleep(0.3)
    m = client.get(f"/api/agents/{a['id']}/metrics").json()
    assert m["total"] >= 2 and m["succeeded"] >= 2
    assert m["successRate"] == 1.0 or m["total"] > m["succeeded"]
    client.delete(f"/api/agents/{a['id']}")


def test_d1_agent_eval_full_loop():
    """样本 → 真实运行 → 成功率汇总（评测闭环）。"""
    a = mk_autonomous(u("评测"))
    s1 = client.post(f"/api/agents/{a['id']}/eval-samples",
                     json={"name": "问好了", "input": {"userQuery": "你好"}})
    assert s1.status_code == 201
    s2 = client.post(f"/api/agents/{a['id']}/eval-samples",
                     json={"name": "问天气", "input": {"userQuery": "天气如何"}})
    assert s2.status_code == 201
    lst = client.get(f"/api/agents/{a['id']}/eval-samples").json()
    assert len(lst["items"]) == 2
    run = client.post(f"/api/agents/{a['id']}/eval-run")
    assert run.status_code == 201
    body = run.json()
    assert body["total"] == 2 and body["succeeded"] == 2
    assert all(r["status"] == "succeeded" and r["runId"] for r in body["results"])
    client.delete(f"/api/eval-samples/{s1.json()['id']}")
    assert len(client.get(f"/api/agents/{a['id']}/eval-samples").json()["items"]) == 1
    client.delete(f"/api/agents/{a['id']}")


def test_d1_generate_prompt_endpoint():
    r = client.post("/api/agents/generate-prompt", json={"name": "测试助手", "hint": "客服"})
    assert r.status_code == 201
    assert isinstance(r.json()["prompt"], str) and len(r.json()["prompt"]) > 0


def test_d1_versions_carry_frozen_members():
    """专家组成员冻结摘要随版本返回（D-1 成员冻结可视化）。"""
    member = client.post("/api/agents", json={"name": u("成员"), "type": "dialogue"}).json()
    mv = client.post(f"/api/agents/{member['id']}/versions", json={}).json()
    client.post(f"/api/agents/{member['id']}/releases",
                json={"versionId": mv["versionId"], "environment": "sandbox"})
    eg = client.post("/api/agents", json={"name": u("组"), "type": "expert-group",
                                          "config": {"members": [member["id"]]}}).json()
    wf_id = eg["workflowId"]
    det = client.get(f"/api/workflows/{wf_id}").json()
    defn = det["definition"]
    defn["graph"]["nodes"] = [
        {"id": "s", "type": "input", "name": "开始", "config": {}, "inputs": []},
        {"id": "e", "type": "end", "name": "结束", "config": {"outputKey": "quality_result"},
         "inputs": [{"name": "output", "type": "string", "source": {"kind": "fixed", "value": ""}}]},
    ]
    defn["graph"]["edges"] = [{"id": "e1", "source": "s", "target": "e"}]
    assert client.put(f"/api/workflows/{wf_id}/draft",
                      json={"definition": defn, "baseRevision": det["draftRevision"]}).status_code == 200
    gv = client.post(f"/api/agents/{eg['id']}/versions", json={}).json()
    versions = client.get(f"/api/agents/{eg['id']}/versions").json()
    assert versions[0]["versionNo"] == gv["versionNo"]
    fm = versions[0]["frozenMembers"]
    assert len(fm) == 1 and fm[0]["ref"] == member["id"] and fm[0]["version"] == mv["versionId"]
    client.delete(f"/api/agents/{eg['id']}")
    client.delete(f"/api/agents/{member['id']}")
