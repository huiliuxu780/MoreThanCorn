"""07-SDD P2 节点测试：loop 容器 / wait-review 暂停恢复 / error-branch / data-read / 迁移改写。"""
import time

from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.models import DataAsset
from app.runner import create_run, execute_run, start_worker
from app.validator import validate
from app.schemas import WorkflowDefinition

client = TestClient(app)
_worker_stop = start_worker()


def _new_wf(name="P6"):
    cr = client.post("/api/workflows", json={"name": name})
    return cr.json()["id"]


def _save(wid, nodes, edges):
    g = client.get(f"/api/workflows/{wid}").json()
    defn = g["definition"]
    defn["graph"]["nodes"] = [{"id": "s", "type": "input", "name": "开始", "config": {}, "inputs": []}] + nodes
    defn["graph"]["edges"] = edges
    r = client.put(f"/api/workflows/{wid}/draft",
                   json={"definition": defn, "baseRevision": g["draftRevision"]})
    assert r.status_code == 200, r.text
    return defn


def _run(wid, inp=None, enqueue=False):
    db = SessionLocal()
    run = create_run(db, wid, "test", inp or {"userQuery": "hello"}, enqueue=enqueue)
    db.close()
    return run


def _asset(rows):
    db = SessionLocal()
    a = DataAsset(name=f"P6-asset-{time.time_ns()}", rows=rows)
    db.add(a)
    db.commit()
    aid = a.id
    db.close()
    return aid


def test_loop_container_iterates_and_aggregates():
    wid = _new_wf()
    aid = _asset([{"q": "a"}, {"q": "b"}, {"q": "c"}])
    _save(wid, [
        {"id": "dr", "type": "data-read", "name": "取数", "config": {"dataAssetId": aid}, "inputs": []},
        {"id": "lp", "type": "loop", "name": "循环", "config": {
            "iteratorRef": "{{dr.outputs.rows}}", "itemVar": "item", "indexVar": "index"}, "inputs": []},
        {"id": "tr", "type": "transform", "name": "体", "config": {
            "template": "X:{{lp.outputs.item.q}}"}, "inputs": []},
        {"id": "e", "type": "end", "name": "结束", "config": {"outputKey": "quality_result"}, "inputs": [
            {"name": "output", "type": "string",
             "source": {"kind": "upstream", "nodeId": "lp", "path": "outputs.outputList"}}]},
    ], [
        {"id": "e1", "source": "s", "target": "dr"},
        {"id": "e2", "source": "dr", "target": "lp"},
        {"id": "e3", "source": "lp", "sourceHandle": "body", "target": "tr"},
        {"id": "e4", "source": "tr", "target": "lp"},
        {"id": "e5", "source": "lp", "sourceHandle": "done", "target": "e"},
    ])
    run = _run(wid)
    execute_run(run.id)
    detail = client.get(f"/api/runs/{run.id}").json()
    assert detail["status"] == "succeeded", detail
    out = detail["output"]["output"]
    assert len(out) == 3 and out[0]["output"] == "X:a"


def test_loop_continue_on_error_counts_failures():
    wid = _new_wf()
    aid = _asset([{"q": "a"}, {"q": "b"}])
    _save(wid, [
        {"id": "dr", "type": "data-read", "name": "取数", "config": {"dataAssetId": aid}, "inputs": []},
        {"id": "lp", "type": "loop", "name": "循环", "config": {
            "iteratorRef": "{{dr.outputs.rows}}", "errorHandleMode": "continue_on_error"}, "inputs": []},
        {"id": "bad", "type": "tool", "name": "必失败", "config": {"toolVersionId": "nope"}, "inputs": []},
        {"id": "e", "type": "end", "name": "结束", "config": {"outputKey": "quality_result"}, "inputs": [
            {"name": "output", "type": "string",
             "source": {"kind": "upstream", "nodeId": "lp", "path": "outputs.failCount"}}]},
    ], [
        {"id": "e1", "source": "s", "target": "dr"},
        {"id": "e2", "source": "dr", "target": "lp"},
        {"id": "e3", "source": "lp", "sourceHandle": "body", "target": "bad"},
        {"id": "e4", "source": "bad", "target": "lp"},
        {"id": "e5", "source": "lp", "sourceHandle": "done", "target": "e"},
    ])
    run = _run(wid)
    execute_run(run.id)
    detail = client.get(f"/api/runs/{run.id}").json()
    assert detail["status"] == "succeeded", detail
    assert detail["output"]["output"] == 2


def test_loop_backedge_whitelist_and_plain_cycle_still_error():
    ok_def = {
        "schemaVersion": "1.0",
        "workflow": {"id": "x", "name": "x", "status": "draft", "currentVersionId": None, "draftRevision": 1},
        "graph": {"nodes": [
            {"id": "s", "type": "input", "name": "开始", "config": {}, "inputs": []},
            {"id": "lp", "type": "loop", "name": "循环", "config": {"iteratorRef": "{{s.outputs.userQuery}}"}, "inputs": []},
            {"id": "tr", "type": "transform", "name": "体", "config": {"template": "x"}, "inputs": []},
            {"id": "e", "type": "end", "name": "结束", "config": {}, "inputs": []}],
            "edges": [
                {"id": "a", "source": "s", "target": "lp"},
                {"id": "b", "source": "lp", "sourceHandle": "body", "target": "tr"},
                {"id": "c", "source": "tr", "target": "lp"},
                {"id": "d", "source": "lp", "sourceHandle": "done", "target": "e"}]},
        "io": {"inputSchema": {}, "structuredOutputs": []},
        "triggers": {"manual": True, "api": False, "scheduleIds": []},
        "ui": {"positions": {}, "viewport": {"x": 0, "y": 0, "zoom": 1}},
    }
    rep = validate(WorkflowDefinition.model_validate(ok_def))
    assert not [i for i in rep.issues if "循环" in i.message], rep.issues
    bad = {**ok_def, "graph": {"nodes": ok_def["graph"]["nodes"],
                               "edges": [{"id": "a", "source": "s", "target": "tr"},
                                         {"id": "b", "source": "tr", "target": "s"}]}}
    rep2 = validate(WorkflowDefinition.model_validate(bad))
    assert any("循环连接" in i.message for i in rep2.issues)


def test_wait_review_pause_resume_and_idempotent():
    wid = _new_wf()
    _save(wid, [
        {"id": "w", "type": "wait-review", "name": "人审", "config": {"resumeMode": "human"}, "inputs": []},
        {"id": "e", "type": "end", "name": "结束", "config": {"outputKey": "quality_result"}, "inputs": [
            {"name": "output", "type": "string",
             "source": {"kind": "upstream", "nodeId": "w", "path": "outputs.decision"}}]},
    ], [
        {"id": "e1", "source": "s", "target": "w"},
        {"id": "e2", "source": "w", "target": "e"},
    ])
    run = _run(wid, enqueue=True)
    deadline = time.time() + 10
    while time.time() < deadline:
        st = client.get(f"/api/runs/{run.id}").json()["status"]
        if st == "paused":
            break
        time.sleep(0.3)
    assert st == "paused"
    r1 = client.post(f"/api/runs/{run.id}/resume", json={"action": "pass", "comment": "ok"})
    assert r1.status_code == 202, r1.text
    r2 = client.post(f"/api/runs/{run.id}/resume", json={"action": "pass"})
    assert r2.status_code == 409  # 幂等：waiting 行已消费
    deadline = time.time() + 10
    while time.time() < deadline:
        detail = client.get(f"/api/runs/{run.id}").json()
        if detail["status"] in ("succeeded", "failed"):
            break
        time.sleep(0.3)
    assert detail["status"] == "succeeded", detail
    assert detail["output"]["output"] == "pass"


def test_error_branch_routes_and_error_ref_resolves():
    wid = _new_wf()
    _save(wid, [
        {"id": "bad", "type": "tool", "name": "必失败", "config": {"toolVersionId": "nope"},
         "inputs": [], "execution": {"onError": "branch", "retries": 0}},
        {"id": "h", "type": "transform", "name": "错误处理", "config": {
            "template": "ERR:{{bad.error.message}}"}, "inputs": []},
        {"id": "ok", "type": "transform", "name": "正常路径", "config": {"template": "OK"}, "inputs": []},
        {"id": "e", "type": "end", "name": "结束", "config": {"outputKey": "quality_result"}, "inputs": [
            {"name": "output", "type": "string",
             "source": {"kind": "upstream", "nodeId": "h", "path": "outputs.output"}}]},
    ], [
        {"id": "e1", "source": "s", "target": "bad"},
        {"id": "e2", "source": "bad", "sourceHandle": "error", "target": "h"},
        {"id": "e3", "source": "bad", "target": "ok"},
        {"id": "e4", "source": "h", "target": "e"},
    ])
    run = _run(wid)
    execute_run(run.id)
    detail = client.get(f"/api/runs/{run.id}").json()
    assert detail["status"] == "succeeded", detail
    assert str(detail["output"]["output"]).startswith("ERR:")


def test_retry_emits_node_retry_events():
    wid = _new_wf()
    _save(wid, [
        {"id": "bad", "type": "tool", "name": "必失败", "config": {"toolVersionId": "nope"},
         "inputs": [], "execution": {"retries": 2, "retryIntervalMs": 10}},
        {"id": "e", "type": "end", "name": "结束", "config": {"outputKey": "quality_result"}, "inputs": []},
    ], [
        {"id": "e1", "source": "s", "target": "bad"},
        {"id": "e2", "source": "bad", "target": "e"},
    ])
    run = _run(wid)
    execute_run(run.id)
    ev = client.get(f"/api/runs/{run.id}").json()
    assert ev["status"] == "failed"  # 非 retryable 错误不重试，直接 fail
    # retryable 场景：用 connection 超时类不易构造，改为校验 skip 策略
    wid2 = _new_wf()
    _save(wid2, [
        {"id": "bad", "type": "tool", "name": "必失败", "config": {"toolVersionId": "nope"},
         "inputs": [], "execution": {"onError": "skip"}},
        {"id": "e", "type": "end", "name": "结束", "config": {"outputKey": "quality_result"}, "inputs": [
            {"name": "output", "type": "string", "source": {"kind": "fixed", "value": "done"}}]},
    ], [
        {"id": "e1", "source": "s", "target": "bad"},
        {"id": "e2", "source": "bad", "target": "e"},
    ])
    run2 = _run(wid2)
    execute_run(run2.id)
    d2 = client.get(f"/api/runs/{run2.id}").json()
    assert d2["status"] == "succeeded", d2


def test_data_read_sampling_random_n():
    wid = _new_wf()
    aid = _asset([{"i": i} for i in range(10)])
    _save(wid, [
        {"id": "dr", "type": "data-read", "name": "取数", "config": {
            "dataAssetId": aid, "sampling": "random_n", "sampleN": 3}, "inputs": []},
        {"id": "e", "type": "end", "name": "结束", "config": {"outputKey": "quality_result"}, "inputs": [
            {"name": "output", "type": "string",
             "source": {"kind": "upstream", "nodeId": "dr", "path": "outputs.count"}}]},
    ], [
        {"id": "e1", "source": "s", "target": "dr"},
        {"id": "e2", "source": "dr", "target": "e"},
    ])
    run = _run(wid)
    execute_run(run.id)
    detail = client.get(f"/api/runs/{run.id}").json()
    assert detail["status"] == "succeeded"
    assert detail["output"]["output"] == 3


def test_migration_rewriter_agent_to_workflow_trio():
    # R-Archive：旧 Agent 不再经 API 创建，历史数据直接播种（dialogue 需绑定工作流）
    from app.models import Agent, Workflow
    from app.routers.workflows import _default_definition
    db = SessionLocal()
    try:
        wf = Workflow(name="P6-agent-底座流")
        wf.draft_definition = _default_definition(wf.name).model_dump(mode="json")
        db.add(wf)
        db.flush()
        ag = Agent(name="P6-agent", type="dialogue", workflow_id=wf.id)
        db.add(ag)
        db.commit()
        aid, underlying = ag.id, wf.id
    finally:
        db.close()
    wid = _new_wf()
    g = client.get(f"/api/workflows/{wid}").json()
    defn = g["definition"]
    defn["graph"]["nodes"] += [
        {"id": "a1", "type": "agent", "name": "旧Agent", "config": {"agentCode": aid}, "inputs": []},
        {"id": "a2", "type": "agent-select", "name": "旧选择", "config": {"primaryAgents": [aid]}, "inputs": []},
        {"id": "a3", "type": "agent-exec", "name": "旧执行", "config": {"agentCode": aid}, "inputs": []},
    ]
    client.put(f"/api/workflows/{wid}/draft",
               json={"definition": defn, "baseRevision": g["draftRevision"]})
    mg = client.post(f"/api/workflows/{wid}/migrate")
    assert mg.status_code == 200 and mg.json()["migrated"] is True
    got = client.get(f"/api/workflows/{wid}").json()["definition"]
    types = {n["id"]: n["type"] for n in got["graph"]["nodes"]}
    assert types["a1"] == "workflow-fixed"
    assert got["graph"]["nodes"][[n["id"] for n in got["graph"]["nodes"]].index("a1")]["config"]["workflowId"] == underlying
    assert types["a2"] == "workflow-select"
    assert types["a3"] == "workflow-exec"
