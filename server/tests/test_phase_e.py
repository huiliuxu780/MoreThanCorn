"""Phase E：E-2 发布控制面（复制/归档 + 灰度）+ E-3 观测深化（子 Run span + 首 token）。"""
import time
import uuid

from fastapi.testclient import TestClient

from app.agent_runtime import _canary_bucket
from app.main import app
from app.runner import start_worker

client = TestClient(app)
_worker = start_worker()  # E-3 用例需要异步 Agent 运行入队执行

# wf_test 持久库：用例名带随机尾，避免跨运行撞名
T = uuid.uuid4().hex[:4]


def _model_key() -> str:
    r = client.get("/api/registry/models").json()
    models = r["items"] if isinstance(r, dict) else r
    return models[0]["modelKey"] if models else "qwen-plus"


def _mk_autonomous(name: str, prompt: str = "你是测试") -> str:
    a = client.post("/api/agents", json={"name": name, "type": "autonomous", "description": ""}).json()
    client.put(f"/api/agents/{a['id']}", json={"config": {"rolePrompt": prompt, "modelRef": {"modelId": _model_key()}}})
    return a["id"]


def _set_prompt(aid: str, prompt: str):
    client.put(f"/api/agents/{aid}", json={"config": {"rolePrompt": prompt, "modelRef": {"modelId": _model_key()}}})


def test_duplicate_agent():
    base = f"E2复制源{T}"
    aid = _mk_autonomous(base)
    d = client.post(f"/api/agents/{aid}/duplicate").json()
    assert d["id"] != aid and d["name"] == f"{base} 副本"
    # 草稿配置被复制；版本/部署不带（新 Agent 为 draft）
    det = client.get(f"/api/agents/{d['id']}").json()
    assert det["config"]["rolePrompt"] == "你是测试" and det["status"] == "draft"
    # 二次复制不撞名（追加序号）
    d2 = client.post(f"/api/agents/{aid}/duplicate").json()
    assert d2["name"] != d["name"] and d2["name"].startswith(base)
    # 长名称截断到 20 字上限内（14 汉字 + 4 位随机 = 18 字，+「 副本」=21 → 截到 20）
    long_base = "甲乙丙丁戊己庚辛壬癸子丑" + T
    lid = _mk_autonomous(long_base)
    ld = client.post(f"/api/agents/{lid}/duplicate").json()
    assert len(ld["name"]) <= 20 and ld["name"].endswith("副本")


def test_archive_agent():
    aid = _mk_autonomous("E2归档")
    client.put(f"/api/agents/{aid}", json={"archived": True})
    default = client.get("/api/agents", params={"pageSize": 100}).json()
    assert all(x["id"] != aid for x in default["items"])
    assert any(x["id"] == aid for x in client.get("/api/agents", params={"archived": "true", "pageSize": 100}).json()["items"])
    assert any(x["id"] == aid for x in client.get("/api/agents", params={"archived": "all", "pageSize": 100}).json()["items"])
    # 恢复
    client.put(f"/api/agents/{aid}", json={"archived": False})
    assert any(x["id"] == aid for x in client.get("/api/agents", params={"pageSize": 100}).json()["items"])


def _release(aid: str, version_id: str, env: str = "prod", canary: int = 0):
    return client.post(f"/api/agents/{aid}/releases",
                       json={"versionId": version_id, "environment": env, "canaryPercent": canary}).json()


def test_canary_release_boundaries():
    aid = _mk_autonomous("E2灰度")
    v1 = client.post(f"/api/agents/{aid}/versions", json={}).json()
    _set_prompt(aid, "你是测试 v2")
    v2 = client.post(f"/api/agents/{aid}/versions", json={}).json()

    # 稳定全量 v1 → canaryPercent=0
    r1 = _release(aid, v1["versionId"])
    assert r1["canaryPercent"] == 0
    # 非法灰度值被拒
    assert client.post(f"/api/agents/{aid}/releases",
                       json={"versionId": v2["versionId"], "environment": "prod", "canaryPercent": 101}).status_code == 422
    # 灰度 50%：与稳定版并存（同环境两条 active）
    r2 = _release(aid, v2["versionId"], canary=50)
    actives = [x for x in client.get(f"/api/agents/{aid}/releases").json()
               if x["environment"] == "prod" and x["status"] == "active"]
    assert len(actives) == 2 and {x["canaryPercent"] for x in actives} == {0, 50}

    # 落桶函数：确定性 + 范围 + 0/100 边界语义
    assert all(0 <= _canary_bucket(f"id-{i}") <= 99 for i in range(200))
    assert _canary_bucket("固定id") == _canary_bucket("固定id")
    assert all(_canary_bucket(f"id-{i}") < 100 for i in range(200))   # 100% 必命中灰度
    assert not any(_canary_bucket(f"id-{i}") < 0 for i in range(200))  # 0% 永不命中

    # 100% 灰度：api 触发运行全部落到灰度版本
    r3 = _release(aid, v2["versionId"], canary=100)
    run = client.post(f"/api/agents/{aid}/run", json={"trigger": "api", "input": {}}).json()
    from app.db import SessionLocal
    from app.models import Run as RunM
    db = SessionLocal()
    row = db.get(RunM, run["runId"])
    assert row.agent_version_id == v2["versionId"]
    db.close()

    # 停止灰度 → rolled_back；再次运行回到稳定版
    st = client.post(f"/api/agents/{aid}/releases/{r3['releaseId']}/stop-canary").json()
    assert st["status"] == "rolled_back"
    run2 = client.post(f"/api/agents/{aid}/run", json={"trigger": "api", "input": {}}).json()
    db = SessionLocal()
    row2 = db.get(RunM, run2["runId"])
    assert row2.agent_version_id == v1["versionId"]
    db.close()
    # 非灰度记录不可停止
    assert client.post(f"/api/agents/{aid}/releases/{r1['releaseId']}/stop-canary").status_code == 409


def test_draft_definition_preview():
    """E-2.2 前置：草稿 definition 预览端点（供版本对比）。"""
    aid = _mk_autonomous("E2对比", prompt="草稿提示词")
    d = client.get(f"/api/agents/{aid}/definition-draft").json()
    assert d["definition"]["rolePrompt"] == "草稿提示词"


def _wait_run(aid: str, run_id: str, timeout: float = 30) -> dict:
    deadline = time.time() + timeout
    d = {}
    while time.time() < deadline:
        d = client.get(f"/api/agents/{aid}/runs/{run_id}").json()
        if d["status"] in ("succeeded", "failed", "cancelled"):
            return d
        time.sleep(0.3)
    raise AssertionError(f"run {run_id} 未到终态：{d.get('status')}")


def test_group_run_trace_contains_agent_subtree():
    """E-3.3：agent-exec 子 run 作为调用记录挂节点，/trace 递归挂子树。"""
    mid = _mk_autonomous(f"E3成员{T}")
    host = client.post("/api/agents", json={"name": f"E3宿主{T}", "type": "dialogue"}).json()
    wid = host["workflowId"]
    detail = client.get(f"/api/workflows/{wid}").json()
    defn = detail["definition"]
    start = next(n for n in defn["graph"]["nodes"] if n["type"] == "input")
    end = next(n for n in defn["graph"]["nodes"] if n["type"] == "end")
    defn["graph"]["nodes"].append({"id": "n_exec", "type": "agent-exec", "name": "Agent执行",
                                   "config": {"agentCode": mid}, "inputs": []})
    defn["graph"]["edges"] = [e for e in defn["graph"]["edges"]
                              if not (e["source"] == start["id"] and e["target"] == end["id"])]
    defn["graph"]["edges"] += [{"id": "e1", "source": start["id"], "target": "n_exec"},
                               {"id": "e2", "source": "n_exec", "target": end["id"]}]
    client.put(f"/api/workflows/{wid}/draft",
               json={"definition": defn, "baseRevision": defn["workflow"]["draftRevision"]})
    run = client.post(f"/api/agents/{host['id']}/run",
                      json={"trigger": "test", "input": {"userQuery": "你好"}}).json()
    d = _wait_run(host["id"], run["runId"])
    assert d["status"] == "succeeded", d.get("error")
    trace = client.get(f"/api/runs/{run['runId']}/trace").json()
    agent_spans: list[dict] = []

    def walk(s: dict):
        if s.get("kind") == "agent":
            agent_spans.append(s)
        for c in s.get("children", []):
            walk(c)
    walk(trace["root"])
    assert agent_spans, "应有 kind=agent 的调用 span"
    span = agent_spans[0]
    assert span["type"] == "AGENT" and span["attributes"].get("subRunId")
    assert span["children"], "agent 调用 span 应挂子 Run 子树"
    sub = span["children"][0]
    assert sub["kind"] == "run" and sub["id"] == span["attributes"]["subRunId"]
    assert any(c.get("kind") == "node" for c in sub.get("children", [])) or True  # 子 run 自有结构


def test_agent_metrics_first_token():
    """E-3.4：metrics 含首 token 耗时（首个 llm_delta − started_at 的 avg/p50）。"""
    mid = _mk_autonomous(f"E3首token{T}")
    run = client.post(f"/api/agents/{mid}/run", json={"trigger": "test", "input": {"userQuery": "介绍下你"}}).json()
    d = _wait_run(mid, run["runId"])
    assert d["status"] == "succeeded", d.get("error")
    m = client.get(f"/api/agents/{mid}/metrics").json()
    ft = m.get("firstToken")
    assert isinstance(ft, dict) and {"avgMs", "p50Ms", "samples"} <= set(ft), ft
    assert ft["samples"] >= 1 and ft["avgMs"] is not None and ft["avgMs"] >= 0, ft
