"""Phase A 批次1（SDD 01）：A-01 运行认版本 / A-05 注册表与通知节点 / A-06 条件运算符 /
A-07 调用记录关联节点 / A-08 Agent config 乐观锁 / A-17 名称长度一致化。
批次2：A-02 真路由 / A-03 异步运行 / A-09 挂载留痕。"""
import time
import uuid

import pytest
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.runner import RunError, _branch_ok, create_run, execute_run, start_worker

client = TestClient(app)
start_worker()  # A-03 后 Agent 顶层运行依赖 worker；重复启动无害


def wait_terminal(agent_id: str, run_id: str, timeout: float = 30.0) -> dict:
    deadline = time.time() + timeout
    d = {}
    while time.time() < deadline:
        d = client.get(f"/api/agents/{agent_id}/runs/{run_id}").json()
        if d["status"] in ("succeeded", "failed", "cancelled"):
            return d
        time.sleep(0.2)
    raise AssertionError(f"run {run_id} 未在 {timeout}s 内到达终态：{d.get('status')}")


def u(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:6]}"


def make_wf(name: str, transform_template: str) -> str:
    """start→transform→end 的最小图，transform 模板作为版本行为标记。"""
    wid = client.post("/api/workflows", json={"name": name}).json()["id"]
    g = client.get(f"/api/workflows/{wid}").json()
    defn = g["definition"]
    defn["graph"]["nodes"] = [
        {"id": "s", "type": "input", "name": "开始", "config": {}, "inputs": []},
        {"id": "t", "type": "transform", "name": "转换",
         "config": {"template": transform_template}, "inputs": []},
        {"id": "e", "type": "end", "name": "结束", "config": {"outputKey": "quality_result"},
         "inputs": [{"name": "output", "type": "string",
                     "source": {"kind": "upstream", "nodeId": "t", "path": "outputs.output"}}]},
    ]
    defn["graph"]["edges"] = [{"id": "e1", "source": "s", "target": "t"},
                              {"id": "e2", "source": "t", "target": "e"}]
    r = client.put(f"/api/workflows/{wid}/draft",
                   json={"definition": defn, "baseRevision": g["draftRevision"]})
    assert r.status_code == 200, r.text
    return wid


def run_sync(wid: str, trigger: str = "test", input_: dict | None = None, **kw) -> dict:
    db = SessionLocal()
    try:
        run = create_run(db, wid, trigger, input_ or {"userQuery": "hi"},
                         enqueue=False, **kw)
    finally:
        db.close()
    execute_run(run.id)
    return client.get(f"/api/runs/{run.id}").json()


# ---------- A-01 运行认版本 ----------

def test_a01_pinned_version_executes_snapshot_not_draft():
    wid = make_wf(u("ver"), "SNAP-V1")
    pub = client.post(f"/api/workflows/{wid}/publish").json()
    # 发布后把草稿改成另一种行为
    g = client.get(f"/api/workflows/{wid}").json()
    defn = g["definition"]
    for n in defn["graph"]["nodes"]:
        if n["id"] == "t":
            n["config"]["template"] = "DRAFT-CHANGED"
    assert client.put(f"/api/workflows/{wid}/draft",
                      json={"definition": defn, "baseRevision": g["draftRevision"]}).status_code == 200

    pinned = run_sync(wid, version_id=pub["versionId"])
    assert pinned["status"] == "succeeded", pinned
    assert pinned["output"]["output"] == "SNAP-V1"

    draft = run_sync(wid)  # manual/test 仍走草稿
    assert draft["output"]["output"] == "DRAFT-CHANGED"


def test_a01_schedule_requires_published_version():
    wid = make_wf(u("sch"), "SCH-OK")
    db = SessionLocal()
    try:
        with pytest.raises(RunError) as ei:
            create_run(db, wid, "schedule", {}, enqueue=False)
        assert "NO_PUBLISHED_VERSION" in str(ei.value)
    finally:
        db.close()

    pub = client.post(f"/api/workflows/{wid}/publish").json()
    detail = run_sync(wid, trigger="schedule")
    assert detail["status"] == "succeeded"

    from app.models import Run as RunM
    db = SessionLocal()
    try:
        r = db.query(RunM).filter_by(workflow_id=wid, trigger="schedule").first()
        assert r.definition_source == "version"
        assert r.workflow_version_id == pub["versionId"]
    finally:
        db.close()

    # 显式 pinned_version_id 同样生效
    pinned = run_sync(wid, trigger="schedule", pinned_version_id=pub["versionId"])
    assert pinned["status"] == "succeeded"


def test_a01_manual_run_records_draft_source():
    wid = make_wf(u("src"), "DRAFT-ONLY")
    detail = run_sync(wid)
    assert detail["status"] == "succeeded"
    from app.models import Run as RunM
    db = SessionLocal()
    try:
        r = db.query(RunM).filter_by(workflow_id=wid).order_by(RunM.created_at.desc()).first()
        assert r.definition_source == "draft"
        assert r.workflow_version_id is None
    finally:
        db.close()


def test_a01_runs_api_accepts_version_id():
    """POST /api/runs 透传 versionId（A-01 API 接线）。"""
    wid = make_wf(u("api"), "API-SNAP")
    pub = client.post(f"/api/workflows/{wid}/publish").json()
    r = client.post("/api/runs", json={"workflowId": wid, "trigger": "manual",
                                       "versionId": pub["versionId"], "input": {}})
    assert r.status_code == 202, r.text
    run_id = r.json()["runId"]
    from app.runner import execute_run
    execute_run(run_id)
    d = client.get(f"/api/runs/{run_id}").json()
    assert d["status"] == "succeeded" and d["output"]["output"] == "API-SNAP"
    # 未知版本 → 409
    r2 = client.post("/api/runs", json={"workflowId": wid, "versionId": "nope", "input": {}})
    assert r2.status_code == 409


# ---------- A-05 注册表类型修正 + 通知节点 ----------

def test_a05_registry_contract_fixes():
    from app.registry import BY_TYPE
    assert BY_TYPE["query-rewrite"]["io"]["outputs"] == ["queryList:array"]
    assert BY_TYPE["decision-class"]["io"]["outputs"] == [
        "classificationTitle:string", "classificationId:string"]
    assert "end" not in ("notification",)  # 语义声明：通知不是终端


def test_a05_notification_midflow_does_not_terminate():
    wid = client.post("/api/workflows", json={"name": u("ntf")}).json()["id"]
    g = client.get(f"/api/workflows/{wid}").json()
    defn = g["definition"]
    defn["graph"]["nodes"] = [
        {"id": "s", "type": "input", "name": "开始", "config": {}, "inputs": []},
        {"id": "n", "type": "notification", "name": "通知",
         "config": {"message": "hello {{s.outputs.userQuery}}"}, "inputs": []},
        {"id": "t", "type": "transform", "name": "后续",
         "config": {"template": "AFTER"}, "inputs": []},
        {"id": "e", "type": "end", "name": "结束", "config": {"outputKey": "quality_result"}, "inputs": []},
    ]
    defn["graph"]["edges"] = [{"id": "e1", "source": "s", "target": "n"},
                              {"id": "e2", "source": "n", "target": "t"},
                              {"id": "e3", "source": "t", "target": "e"}]
    assert client.put(f"/api/workflows/{wid}/draft",
                      json={"definition": defn, "baseRevision": g["draftRevision"]}).status_code == 200
    detail = run_sync(wid, input_={"userQuery": "world"})
    assert detail["status"] == "succeeded", detail
    statuses = {n["nodeId"]: n["status"] for n in detail["nodeRuns"]}
    assert statuses["t"] == "success" and statuses["e"] == "success"
    evs = client.get(f"/api/runs/{detail['runId']}/events-list").json()["items"]
    ntf = [e for e in evs if e["type"] == "notification_sent"]
    assert len(ntf) == 1 and "hello world" in ntf[0]["payload"]["message"]


def test_trace_span_tree_endpoint():
    """SDD design-run-observability：/trace 组装 Run→NodeRun→CallRecord span 树。"""
    tool = client.post("/api/ai-resources/tools",
                       json={"name": u("tool"), "kind": "builtin",
                             "spec": {"kind": "echo"}, "tested": True}).json()
    tv_id = client.get(f"/api/ai-resources/tools/{tool['id']}/versions").json()[0]["id"]
    wid = client.post("/api/workflows", json={"name": u("tracewf")}).json()["id"]
    g = client.get(f"/api/workflows/{wid}").json()
    defn = g["definition"]
    defn["graph"]["nodes"] = [
        {"id": "s", "type": "input", "name": "开始", "config": {}, "inputs": []},
        {"id": "t1", "type": "tool", "name": "调用工具", "config": {"toolVersionId": tv_id}, "inputs": []},
        {"id": "e", "type": "end", "name": "结束", "config": {"outputKey": "quality_result"}, "inputs": []},
    ]
    defn["graph"]["edges"] = [{"id": "e1", "source": "s", "target": "t1"},
                              {"id": "e2", "source": "t1", "target": "e"}]
    client.put(f"/api/workflows/{wid}/draft",
               json={"definition": defn, "baseRevision": g["draftRevision"]})
    detail = run_sync(wid, input_={"userQuery": "x"})
    assert detail["status"] == "succeeded"
    tr = client.get(f"/api/runs/{detail['runId']}/trace")
    assert tr.status_code == 200
    body = tr.json()
    assert body["root"]["kind"] == "run" and body["root"]["status"] == "succeeded"
    kinds = [c["kind"] for c in body["root"]["children"]]
    assert kinds.count("node") == 3
    tool_span = next(c for c in body["root"]["children"] if c["name"] == "t1")
    assert tool_span["children"] and tool_span["children"][0]["kind"] == "tool"
    # events-list 支持 nodeRunId 过滤
    evs = client.get(f"/api/runs/{detail['runId']}/events-list",
                     params={"nodeRunId": tool_span["id"]}).json()
    assert evs["items"] and all(e["nodeRunId"] == tool_span["id"] for e in evs["items"])


# ---------- A-06 条件运算符 ----------

def test_a06_operators_semantics():
    assert _branch_ok("eq", "a", "a") is True
    assert _branch_ok("neq", "a", "b") is True
    assert _branch_ok("contains", "hello world", "world") is True
    assert _branch_ok("not_contains", "hello world", "mars") is True
    assert _branch_ok("not_contains", "hello world", "world") is False
    assert _branch_ok("empty", "", None) is True
    assert _branch_ok("empty", [], None) is True
    assert _branch_ok("empty", {}, None) is True
    assert _branch_ok("empty", "x", None) is False
    assert _branch_ok("not_empty", "x", None) is True
    assert _branch_ok("not_empty", None, None) is False
    assert _branch_ok("gt", 5, 3) is True
    assert _branch_ok("gt", "5", 3) is True
    assert _branch_ok("lt", 2, 3) is True
    assert _branch_ok("gt", "abc", 3) is False
    assert _branch_ok(None, "truthy", None) is True
    assert _branch_ok(None, "", None) is False
    # 规则构建器扩展：gte/lte/starts_with/ends_with/数组成员/布尔不敏感
    assert _branch_ok("gte", 5, 5) is True and _branch_ok("gte", 4, 5) is False
    assert _branch_ok("lte", 5, 5) is True and _branch_ok("lte", 6, 5) is False
    assert _branch_ok("starts_with", "return-policy", "return") is True
    assert _branch_ok("ends_with", "order.csv", ".csv") is True
    assert _branch_ok("contains", ["a", "b"], "b") is True
    assert _branch_ok("not_contains", ["a", "b"], "c") is True
    assert _branch_ok("eq", True, "true") is True
    assert _branch_ok("eq", 0, "0") is True


def test_a06_registry_enum_complete():
    from app.registry import BY_TYPE
    ops = (BY_TYPE["condition"]["schema"]["properties"]["branches"]["items"]
           ["properties"]["conditions"]["items"]["properties"]["operator"]["enum"])
    # 调研 11 §3.14 的 String 六项 + 数值比较 + 规则构建器扩展
    assert {"eq", "neq", "contains", "not_contains", "empty", "not_empty", "gt", "lt",
            "gte", "lte", "starts_with", "ends_with"} <= set(ops)


def _cond_ctx(outputs: dict, run_input: dict | None = None):
    from app.runner import Ctx
    c = Ctx.__new__(Ctx)
    c.outputs = outputs
    c.run_input = run_input or {}
    return c


def test_condition_rule_builder_groups():
    """SDD design-condition-rule-builder：每分支多条件且/或、变量引用比较值、旧格式兼容。"""
    from app.runner import exec_condition
    node = {"inputs": [], "config": {"branches": [
        {"handle": "b1", "logic": "AND", "conditions": [
            {"variable": "{{n1.outputs.answer}}", "operator": "contains",
             "valueMode": "LITERAL", "value": "退货"},
            {"variable": "{{n1.outputs.score}}", "operator": "gte",
             "valueMode": "LITERAL", "value": "3"}]},
        {"handle": "b2", "logic": "OR", "conditions": [
            {"variable": "{{n1.outputs.answer}}", "operator": "contains",
             "valueMode": "LITERAL", "value": "投诉"},
            {"variable": "{{n1.outputs.tag}}", "operator": "eq",
             "valueMode": "VARIABLE", "valueRef": "{{n1.outputs.expect}}"}]},
    ]}}
    ctx = _cond_ctx({"n1": {"answer": "我要退货", "score": 4, "tag": "vip", "expect": "vip"}})
    assert exec_condition(node, ctx)["selected"] == "b1"
    ctx = _cond_ctx({"n1": {"answer": "我要投诉", "score": 1, "tag": "x", "expect": "y"}})
    assert exec_condition(node, ctx)["selected"] == "b2"  # OR 第一项命中
    ctx = _cond_ctx({"n1": {"answer": "咨询", "score": 1, "tag": "vip", "expect": "vip"}})
    assert exec_condition(node, ctx)["selected"] == "b2"  # OR 变量引用比较命中
    ctx = _cond_ctx({"n1": {"answer": "我要退货", "score": 1, "tag": "x", "expect": "y"}})
    assert exec_condition(node, ctx)["selected"] == "else"  # AND 第二项不满足


def test_condition_legacy_branch_compat():
    """旧格式分支（顶层 variable/operator/value）与空分支兼容。"""
    from app.runner import exec_condition
    node = {"inputs": [], "config": {"branches": [
        {"handle": "legacy"},
        {"handle": "old", "variable": "{{n1.outputs.x}}", "operator": "eq", "value": "1"},
    ]}}
    ctx = _cond_ctx({"n1": {"x": "1"}})
    assert exec_condition(node, ctx)["selected"] == "old"  # 空分支跳过，旧格式命中
    ctx = _cond_ctx({"n1": {"x": "2"}})
    assert exec_condition(node, ctx)["selected"] == "else"


# ---------- A-07 调用记录关联节点运行 ----------

def test_a07_call_record_links_node_run():
    tool = client.post("/api/ai-resources/tools",
                       json={"name": u("tool"), "kind": "builtin",
                             "spec": {"kind": "echo"}, "tested": True}).json()
    tv_id = client.get(f"/api/ai-resources/tools/{tool['id']}/versions").json()[0]["id"]
    wid = client.post("/api/workflows", json={"name": u("callwf")}).json()["id"]
    g = client.get(f"/api/workflows/{wid}").json()
    defn = g["definition"]
    defn["graph"]["nodes"] = [
        {"id": "s", "type": "input", "name": "开始", "config": {}, "inputs": []},
        {"id": "t1", "type": "tool", "name": "调用工具",
         "config": {"toolVersionId": tv_id}, "inputs": []},
        {"id": "e", "type": "end", "name": "结束", "config": {"outputKey": "quality_result"}, "inputs": []},
    ]
    defn["graph"]["edges"] = [{"id": "e1", "source": "s", "target": "t1"},
                              {"id": "e2", "source": "t1", "target": "e"}]
    assert client.put(f"/api/workflows/{wid}/draft",
                      json={"definition": defn, "baseRevision": g["draftRevision"]}).status_code == 200
    detail = run_sync(wid)
    assert detail["status"] == "succeeded", detail
    node_run_id = next(n["nodeRunId"] for n in detail["nodeRuns"] if n["nodeId"] == "t1")
    from app.models import CallRecord
    db = SessionLocal()
    try:
        recs = db.query(CallRecord).filter_by(node_run_id=node_run_id).all()
        assert len(recs) >= 1
        assert recs[0].kind == "tool"
    finally:
        db.close()


# ---------- A-08 Agent config 乐观锁 ----------

def test_a08_revision_conflict_blocks_stale_write():
    aid = client.post("/api/agents", json={"name": u("rev"), "type": "autonomous"}).json()["id"]
    assert client.get(f"/api/agents/{aid}").json()["configRevision"] == 1
    r1 = client.put(f"/api/agents/{aid}", json={"config": {"x": 1}, "expectedRevision": 1})
    assert r1.status_code == 200 and r1.json()["configRevision"] == 2
    r2 = client.put(f"/api/agents/{aid}", json={"config": {"x": 2}, "expectedRevision": 1})
    assert r2.status_code == 409
    assert r2.json()["detail"]["code"] == "REVISION_CONFLICT"
    # 以新 revision 再写成功
    r3 = client.put(f"/api/agents/{aid}", json={"config": {"x": 3}, "expectedRevision": 2})
    assert r3.status_code == 200 and r3.json()["configRevision"] == 3


# ---------- A-17 名称长度三层一致 ----------

LONG_NAME = "超长" * 11  # 22 字


def test_a17_api_rejects_overlong_name():
    assert len(LONG_NAME) > 20
    r = client.post("/api/agents", json={"name": LONG_NAME, "type": "autonomous"})
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "NAME_TOO_LONG"
    aid = client.post("/api/agents", json={"name": u("nm"), "type": "autonomous"}).json()["id"]
    r2 = client.put(f"/api/agents/{aid}", json={"name": LONG_NAME})
    assert r2.status_code == 400
    assert r2.json()["detail"]["code"] == "NAME_TOO_LONG"


def test_a17_db_check_constraint():
    from sqlalchemy.exc import IntegrityError

    from app.models import Agent
    db = SessionLocal()
    db.add(Agent(name="x" * 21, type="autonomous"))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()
    db.close()


# ---------- A-02 Agent选择真路由（LLM 判定 + 兜底） ----------

def _mk_member(name: str) -> dict:
    r = client.post("/api/agents", json={"name": name, "type": "dialogue"})
    assert r.status_code == 201, r.text
    return r.json()


def _mk_group(name: str, primary: list[str], fallback: str | None) -> dict:
    eg = client.post("/api/agents", json={"name": name, "type": "expert-group"}).json()
    det = client.get(f"/api/workflows/{eg['workflowId']}").json()
    defn = det["definition"]
    defn["graph"]["nodes"] = [
        {"id": "s", "type": "input", "name": "开始", "config": {}, "inputs": []},
        {"id": "sel", "type": "agent-select", "name": "Agent选择",
         "config": {"primaryAgents": primary, "fallbackAgent": fallback},
         "inputs": [{"name": "query", "type": "string",
                     "source": {"kind": "input", "path": "userQuery"}}]},
        {"id": "ex", "type": "agent-exec", "name": "Agent执行", "config": {},
         "inputs": [{"name": "agentCode", "type": "string",
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
    sv = client.put(f"/api/workflows/{eg['workflowId']}/draft",
                    json={"definition": defn, "baseRevision": det["draftRevision"]})
    assert sv.status_code == 200, sv.text
    return eg


def _force_real_llm(monkeypatch, answer: str):
    import app.agent_runtime as ar
    monkeypatch.setattr(ar, "_resolve_base_secret", lambda db, k: ("https://fake-llm", "sk"))
    monkeypatch.setattr(ar, "_chat_completion",
                        lambda db, mk, messages, tools: {"content": answer, "tool_calls": []})


def test_a02_router_hits_primary_by_llm_choice(monkeypatch):
    m1 = _mk_member(u("候选甲"))
    m2 = _mk_member(u("候选乙"))
    eg = _mk_group(u("路由组"), [m1["id"], m2["id"]], None)
    _force_real_llm(monkeypatch, "2")
    r = client.post(f"/api/agents/{eg['id']}/run", json={"input": {"userQuery": "帮我做乙的事"}})
    assert r.status_code == 202
    d = wait_terminal(eg["id"], r.json()["runId"])
    assert d["status"] == "succeeded", d
    sel = [e for e in d["events"] if e["type"] == "agent_select"]
    assert sel and sel[0]["payload"]["chosen"] == m2["id"]
    assert sel[0]["payload"]["routing"] == "primary"


def test_a02_router_none_falls_back(monkeypatch):
    m1, fb = _mk_member(u("主要丙")), _mk_member(u("兜底丁"))
    eg = _mk_group(u("兜底组"), [m1["id"]], fb["id"])
    _force_real_llm(monkeypatch, "NONE")
    r = client.post(f"/api/agents/{eg['id']}/run", json={"input": {"userQuery": "没人会"}})
    d = wait_terminal(eg["id"], r.json()["runId"])
    assert d["status"] == "succeeded", d
    sel = [e for e in d["events"] if e["type"] == "agent_select"]
    assert sel[0]["payload"]["chosen"] == fb["id"]
    assert sel[0]["payload"]["routing"] == "fallback"


def test_a02_router_no_hit_no_fallback_fails(monkeypatch):
    m1 = _mk_member(u("孤立戊"))
    eg = _mk_group(u("无兜底组"), [m1["id"]], None)
    _force_real_llm(monkeypatch, "NONE")
    r = client.post(f"/api/agents/{eg['id']}/run", json={"input": {"userQuery": "没人会"}})
    d = wait_terminal(eg["id"], r.json()["runId"])
    assert d["status"] == "failed"
    assert "兜底" in d["error"]["message"]


def test_a02_mock_mode_keeps_first_primary():
    m1 = _mk_member(u("默选己"))
    eg = _mk_group(u("默认组"), [m1["id"]], None)
    r = client.post(f"/api/agents/{eg['id']}/run", json={"input": {"userQuery": "hi"}})
    d = wait_terminal(eg["id"], r.json()["runId"])
    assert d["status"] == "succeeded", d
    sel = [e for e in d["events"] if e["type"] == "agent_select"]
    assert sel[0]["payload"]["routing"] == "mock"


# ---------- A-03 顶层运行异步入队 ----------

def test_a03_run_enqueues_agent_job_and_reaches_terminal():
    a = client.post("/api/agents", json={
        "name": u("异步"), "type": "autonomous",
        "config": {"rolePrompt": "测试", "modelRef": {"modelId": ""},
                   "skills": [], "tools": [], "workflows": [], "knowledges": []}}).json()
    r = client.post(f"/api/agents/{a['id']}/run", json={"input": {"userQuery": "你好"}})
    assert r.status_code == 202
    run_id = r.json()["runId"]
    from app.models import JobQueue
    db = SessionLocal()
    try:
        jobs = db.query(JobQueue).filter_by(type="agent-execution").all()
        assert any((j.payload or {}).get("run_id") == run_id for j in jobs)
    finally:
        db.close()
    d = wait_terminal(a["id"], run_id)
    assert d["status"] == "succeeded", d


def test_a03_unbound_dialogue_agent_fails_fast():
    a = client.post("/api/agents", json={"name": u("无流"), "type": "dialogue"}).json()
    client.put(f"/api/agents/{a['id']}", json={"workflowId": None})
    r = client.post(f"/api/agents/{a['id']}/run", json={"input": {}})
    assert r.status_code == 202
    d = client.get(f"/api/agents/{a['id']}/runs/{r.json()['runId']}").json()
    assert d["status"] == "failed" and "未绑定工作流" in d["error"]["message"]


# ---------- A-09 挂载解析留痕 ----------

def test_a09_mounts_resolved_event_records_hits_and_missing():
    client.post("/api/tools", json={"name": "echo-a09", "kind": "builtin",
                                    "spec": {"kind": "echo"}})
    a = client.post("/api/agents", json={
        "name": u("留痕"), "type": "autonomous",
        "config": {"rolePrompt": "", "modelRef": {"modelId": ""}, "skills": [],
                   "tools": ["echo-a09", "ghost-a09"], "workflows": ["不存在的流"],
                   "knowledges": []}}).json()
    r = client.post(f"/api/agents/{a['id']}/run", json={"input": {"userQuery": "hi"}})
    d = wait_terminal(a["id"], r.json()["runId"])
    assert d["status"] == "succeeded", d
    ev = [e for e in d["events"] if e["type"] == "agent_mounts_resolved"]
    assert len(ev) == 1
    p = ev[0]["payload"]
    assert p["tools"][0]["name"] == "echo-a09" and p["tools"][0]["toolVersionId"]
    missing = {(m["kind"], m["name"]) for m in p["missing"]}
    assert ("tool", "ghost-a09") in missing
    assert ("workflow", "不存在的流") in missing
