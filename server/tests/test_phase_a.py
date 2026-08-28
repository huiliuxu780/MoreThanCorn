"""Phase A 批次1（SDD 01）：A-01 运行认版本 / A-05 注册表与通知节点 / A-06 条件运算符 /
A-07 调用记录关联节点 / A-08 Agent config 乐观锁 / A-17 名称长度一致化。
批次2：A-02 真路由 / A-03 异步运行 / A-09 挂载留痕。

R-Archive（SDD 10）：Agent 写/运行入口整体封存（410 LEGACY_AGENT_ARCHIVED）——
A-02/A-03/A-08/A-09/A-17 的 Agent 用例改写为封存契约断言；原行为由 tag
archive/legacy-agents-20260828 保存。Workflow 部分不受影响。"""
import time
import uuid

import pytest
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.runner import RunError, _branch_ok, create_run, execute_run, start_worker
from tests._legacy_agents import seed_agent

client = TestClient(app)
start_worker()  # A-01 API 运行依赖 worker；重复启动无害


def poll_wf_run_terminal(run_id: str, timeout: float = 30.0) -> dict:
    """轮询工作流 Run 到终态（依赖唯一 worker，避免测试与 worker 并发双跑）。"""
    deadline = time.time() + timeout
    d = {}
    while time.time() < deadline:
        d = client.get(f"/api/runs/{run_id}").json()
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
    # 09 P0-B4：POST /api/runs 已入队，由唯一 worker 执行；此前"再手动 execute_run"
    # 与 worker 并发双跑同一 Run，触发 node_run 唯一约束竞态（全量套件偶发失败）。
    d = poll_wf_run_terminal(run_id)
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


# ---------- A-08 Agent config 乐观锁（机制保留给 R2 Module Agent；旧 Agent 封存门优先） ----------

def test_a08_legacy_agent_write_blocked_by_archive_gate():
    a = seed_agent()
    r = client.put(f"/api/agents/{a['id']}", json={"config": {"x": 1}, "expectedRevision": 1})
    assert r.status_code == 410, r.text
    assert r.json()["code"] == "LEGACY_AGENT_ARCHIVED"


# ---------- A-17 名称长度三层一致 ----------

LONG_NAME = "超长" * 11  # 22 字


def test_a17_legacy_create_blocked_before_name_check():
    """R-Archive：创建入口先撞封存门（410）；名称校验机制保留给 R2 Module Agent。"""
    assert len(LONG_NAME) > 20
    r = client.post("/api/agents", json={"name": LONG_NAME, "type": "autonomous"})
    assert r.status_code == 410
    assert r.json()["code"] == "LEGACY_AGENT_ARCHIVED"


def test_a17_db_check_constraint():
    from sqlalchemy.exc import IntegrityError

    from app.models import Agent
    db = SessionLocal()
    db.add(Agent(name="x" * 21, type="autonomous"))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()
    db.close()


# ---------- A-02 Agent选择真路由（行为封存于 tag archive/legacy-agents-20260828） ----------

def test_a02_legacy_group_run_blocked_by_archive_gate():
    """专家组运行入口封存：410，且不进入路由/成员执行。"""
    eg = seed_agent(atype="expert-group")
    r = client.post(f"/api/agents/{eg['id']}/run", json={"input": {"userQuery": "hi"}})
    assert r.status_code == 410, r.text
    assert r.json()["code"] == "LEGACY_AGENT_ARCHIVED"


# ---------- A-03 顶层运行异步入队（行为封存） ----------

def test_a03_legacy_run_creates_no_job():
    """封存门在入队之前：不创建 agent-execution 任务。"""
    from app.models import JobQueue
    a = seed_agent()
    db = SessionLocal()
    try:
        before = db.query(JobQueue).filter_by(type="agent-execution").count()
    finally:
        db.close()
    r = client.post(f"/api/agents/{a['id']}/run", json={"input": {"userQuery": "你好"}})
    assert r.status_code == 410
    db = SessionLocal()
    try:
        assert db.query(JobQueue).filter_by(type="agent-execution").count() == before
    finally:
        db.close()


def test_a03_unbound_dialogue_agent_blocked_by_archive_gate():
    """未绑定工作流的失败路径也已封存：封存门先于绑定检查。"""
    a = seed_agent(atype="dialogue")
    assert client.post(f"/api/agents/{a['id']}/run", json={"input": {}}).status_code == 410
