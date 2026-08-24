"""Phase B（SDD 02）验收：Agent 聚合根与发布闭环。
发布不可变版本 / 部署与回滚 / 运行认版本 / 依赖冻结 / CommonConfig 真消费 / 422 无版本拦截。"""
import time
import uuid

from fastapi.testclient import TestClient

from app.main import app
from app.runner import start_worker

client = TestClient(app)
start_worker()  # 独立运行本文件时保证有 worker；重复启动无害


def u(p: str) -> str:
    return f"{p}-{uuid.uuid4().hex[:6]}"


def wait_terminal(aid: str, run_id: str, timeout: float = 30.0) -> dict:
    deadline = time.time() + timeout
    d = {}
    while time.time() < deadline:
        d = client.get(f"/api/agents/{aid}/runs/{run_id}").json()
        if d["status"] in ("succeeded", "failed", "cancelled"):
            return d
        time.sleep(0.2)
    raise AssertionError(f"run {run_id} 未到终态：{d.get('status')}")


def mk_autonomous(name: str, **cfg_extra) -> dict:
    # 动态取一个启用中的模型（测试库状态可能被其他用例 toggle 过）
    r = client.get("/api/registry/models").json()
    models = r["items"] if isinstance(r, dict) else r
    model_key = models[0]["modelKey"] if models else "qwen-plus"
    cfg = {"rolePrompt": "# 角色：测试", "modelRef": {"modelId": model_key},
           "skills": [], "tools": [], "workflows": [], "knowledges": []}
    cfg.update(cfg_extra)
    r = client.post("/api/agents", json={"name": name, "type": "autonomous", "config": cfg})
    assert r.status_code == 201, r.text
    return r.json()


# ---------- 发布版本 ----------

def test_b_publish_creates_immutable_version():
    a = mk_autonomous(u("发版"))
    r = client.post(f"/api/agents/{a['id']}/versions", json={"note": "第一次"})
    assert r.status_code == 201, r.text
    v1 = r.json()
    assert v1["versionNo"] == 1 and len(v1["artifactHash"]) == 64
    # 版本号递增；内容不变则哈希稳定
    r2 = client.post(f"/api/agents/{a['id']}/versions", json={})
    assert r2.json()["versionNo"] == 2
    assert r2.json()["artifactHash"] == v1["artifactHash"]
    # 列表与详情
    lst = client.get(f"/api/agents/{a['id']}/versions").json()
    assert [x["versionNo"] for x in lst] == [2, 1]
    det = client.get(f"/api/agents/{a['id']}/versions/{v1['versionId']}").json()
    assert det["definition"]["rolePrompt"] and det["dependencySnapshot"]["items"]


def test_b_publish_validation_blocks():
    a = mk_autonomous(u("空提示"), rolePrompt="   ")
    r = client.post(f"/api/agents/{a['id']}/versions", json={})
    assert r.status_code == 409
    codes = {i["code"] for i in r.json()["detail"]["issues"]}
    assert "PROMPT_REQUIRED" in codes
    b = mk_autonomous(u("无模型"), modelRef={"modelId": ""})
    r2 = client.post(f"/api/agents/{b['id']}/versions", json={})
    assert r2.status_code == 409
    assert "MODEL_REQUIRED" in {i["code"] for i in r2.json()["detail"]["issues"]}


def test_b_publish_memory_schema_duplicate_blocked():
    a = mk_autonomous(u("记忆重复"), memoriesSchema=[
        {"name": "city", "dataType": "STRING", "duration": "LONG_TERM"},
        {"name": "city", "dataType": "STRING", "duration": "LONG_TERM"}])
    r = client.post(f"/api/agents/{a['id']}/versions", json={})
    assert r.status_code == 409
    assert "MEMORY_DUPLICATE" in {i["code"] for i in r.json()["detail"]["issues"]}


# ---------- 部署与回滚 ----------

def test_b_release_and_rollback():
    a = mk_autonomous(u("部署"))
    v1 = client.post(f"/api/agents/{a['id']}/versions", json={}).json()
    g0 = client.get(f"/api/agents/{a['id']}").json()
    cfg = dict(g0["config"])
    cfg["rolePrompt"] = "改过"
    client.put(f"/api/agents/{a['id']}", json={"config": cfg, "expectedRevision": g0["configRevision"]})
    v2 = client.post(f"/api/agents/{a['id']}/versions", json={}).json()
    r1 = client.post(f"/api/agents/{a['id']}/releases", json={"versionId": v2["versionId"], "environment": "sandbox"})
    assert r1.status_code == 201 and r1.json()["status"] == "active"
    g = client.get(f"/api/agents/{a['id']}").json()
    # 回滚 = 把旧版本再部署一次
    r2 = client.post(f"/api/agents/{a['id']}/releases", json={"versionId": v1["versionId"], "environment": "sandbox"})
    assert r2.status_code == 201
    rels = client.get(f"/api/agents/{a['id']}/releases").json()
    statuses = {(x["versionNo"], x["status"]) for x in rels if x["environment"] == "sandbox"}
    assert (2, "rolled_back") in statuses and (1, "active") in statuses
    # 历史版本本身不被修改
    assert client.get(f"/api/agents/{a['id']}/versions/{v2['versionId']}").json()["versionNo"] == 2


# ---------- 运行认版本（核心闭环） ----------

def test_b_run_executes_version_snapshot_not_draft():
    """闲聊兜底提示词作为版本行为标记：发布后改草稿，版本运行仍复现快照。"""
    a = mk_autonomous(u("认版本"), conversation={
        "chitchatFallback": {"enabled": True, "modelId": "", "prompt": "CHITCHAT-V1"}})
    v1 = client.post(f"/api/agents/{a['id']}/versions", json={}).json()
    # 漂移草稿
    g = client.get(f"/api/agents/{a['id']}").json()
    cfg = g["config"]
    cfg["conversation"]["chitchatFallback"]["prompt"] = "CHITCHAT-V2"
    assert client.put(f"/api/agents/{a['id']}", json={"config": cfg, "expectedRevision": g["configRevision"]}).status_code == 200

    # 指定版本运行（无 userQuery 触发闲聊兜底）
    r = client.post(f"/api/agents/{a['id']}/run", json={"input": {}, "trigger": "test", "versionId": v1["versionId"]})
    assert r.status_code == 202
    d = wait_terminal(a["id"], r.json()["runId"])
    assert d["status"] == "succeeded", d
    assert d["output"]["fallback"] == "chitchat"
    assert "CHITCHAT-V1" in d["output"]["content"]

    # 草稿运行拿到新行为
    r2 = client.post(f"/api/agents/{a['id']}/run", json={"input": {}, "trigger": "test"})
    d2 = wait_terminal(a["id"], r2.json()["runId"])
    assert "CHITCHAT-V2" in d2["output"]["content"]

    # api 触发 → 环境解析（已发布沙箱版本）；未发布时 422
    rel = client.post(f"/api/agents/{a['id']}/releases", json={"versionId": v1["versionId"], "environment": "sandbox"})
    assert rel.status_code == 201
    r3 = client.post(f"/api/agents/{a['id']}/run", json={"input": {}, "trigger": "api"})
    d3 = wait_terminal(a["id"], r3.json()["runId"])
    assert "CHITCHAT-V1" in d3["output"]["content"]


def test_b_api_trigger_without_release_422():
    a = mk_autonomous(u("未发布"))
    r = client.post(f"/api/agents/{a['id']}/run", json={"input": {}, "trigger": "api"})
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "NO_RELEASED_VERSION"


# ---------- CommonConfig：记忆声明约束 + 自动续问 ----------

def test_b_memory_write_rejects_undeclared_key():
    a = mk_autonomous(u("记忆约束"), memoriesSchema=[
        {"name": "city", "dataType": "STRING", "duration": "LONG_TERM"}])
    r = client.post(f"/api/agents/{a['id']}/run", json={"input": {"userQuery": "hi"}, "trigger": "test"})
    d = wait_terminal(a["id"], r.json()["runId"])
    assert d["status"] == "succeeded", d
    # mock LLM 首轮调用 tools[0]；无挂载时即 memory_write（键为空 → 未声明 → 拒绝）
    tr = [e for e in d["events"] if e["type"] == "tool_result"]
    assert tr and "未在记忆 Schema 中声明" in str(tr[0]["payload"]["result"])


def test_b_auto_follow_up_generates_questions():
    a = mk_autonomous(u("续问"), conversation={"autoFollowUp": {"enabled": True, "count": 2}})
    r = client.post(f"/api/agents/{a['id']}/run", json={"input": {"userQuery": "介绍一下"}, "trigger": "test"})
    d = wait_terminal(a["id"], r.json()["runId"])
    assert d["status"] == "succeeded", d
    assert isinstance(d["output"].get("followUps"), list)


# ---------- 专家组：成员冻结 + 版本图执行 ----------

def test_b_group_freezes_member_versions_and_runs_snapshot():
    member = client.post("/api/agents", json={"name": u("成员"), "type": "dialogue"}).json()
    mv = client.post(f"/api/agents/{member['id']}/versions", json={}).json()
    client.post(f"/api/agents/{member['id']}/releases", json={"versionId": mv["versionId"], "environment": "sandbox"})

    eg = client.post("/api/agents", json={"name": u("组"), "type": "expert-group",
                                          "config": {"members": [member["id"]]}}).json()
    wf_id = eg["workflowId"]
    det = client.get(f"/api/workflows/{wf_id}").json()
    defn = det["definition"]
    defn["graph"]["nodes"] = [
        {"id": "s", "type": "input", "name": "开始", "config": {}, "inputs": []},
        {"id": "ex", "type": "agent-exec", "name": "Agent执行",
         "config": {"agentCode": member["id"]}, "inputs": []},
        {"id": "e", "type": "end", "name": "结束", "config": {"outputKey": "quality_result"},
         "inputs": [{"name": "output", "type": "string",
                     "source": {"kind": "upstream", "nodeId": "ex", "path": "outputs.content"}}]},
    ]
    defn["graph"]["edges"] = [{"id": "e1", "source": "s", "target": "ex"},
                              {"id": "e2", "source": "ex", "target": "e"}]
    assert client.put(f"/api/workflows/{wf_id}/draft",
                      json={"definition": defn, "baseRevision": det["draftRevision"]}).status_code == 200

    gv = client.post(f"/api/agents/{eg['id']}/versions", json={}).json()
    assert gv["versionNo"] == 1
    gdet = client.get(f"/api/agents/{eg['id']}/versions/{gv['versionId']}").json()
    agent_items = [i for i in gdet["dependencySnapshot"]["items"] if i["type"] == "AGENT"]
    assert agent_items and agent_items[0]["version"] == mv["versionId"]

    # 破坏草稿图（去掉终端节点）：草稿运行应失败，版本运行仍成功
    det2 = client.get(f"/api/workflows/{wf_id}").json()
    broken = dict(det2["definition"])
    broken["graph"]["nodes"] = [n for n in broken["graph"]["nodes"] if n["id"] != "e"]
    broken["graph"]["edges"] = [e for e in broken["graph"]["edges"] if e["target"] != "e"]
    assert client.put(f"/api/workflows/{wf_id}/draft",
                      json={"definition": broken, "baseRevision": det2["draftRevision"]}).status_code == 200

    rv = client.post(f"/api/agents/{eg['id']}/run", json={"input": {"userQuery": "hi"}, "trigger": "test",
                                                            "versionId": gv["versionId"]})
    dv = wait_terminal(eg["id"], rv.json()["runId"])
    assert dv["status"] == "succeeded", dv
    rd = client.post(f"/api/agents/{eg['id']}/run", json={"input": {"userQuery": "hi"}, "trigger": "test"})
    dd = wait_terminal(eg["id"], rd.json()["runId"])
    assert dd["status"] == "failed"  # 草稿图已破坏
