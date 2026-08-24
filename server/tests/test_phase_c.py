"""Phase C（SDD 03）验收：事件通道/新节点执行器/记忆持久化/系统变量/节点单测。"""
import json
import time
import uuid

from fastapi.testclient import TestClient

from app.main import app
from app.runner import execute_run, create_run, start_worker
from app.db import SessionLocal

client = TestClient(app)
start_worker()


def u(p: str) -> str:
    return f"{p}-{uuid.uuid4().hex[:6]}"


def make_wf(nodes, edges):
    cr = client.post("/api/workflows", json={"name": u("c")})
    wid = cr.json()["id"]
    g = client.get(f"/api/workflows/{wid}").json()
    defn = g["definition"]
    defn["graph"]["nodes"] = nodes
    defn["graph"]["edges"] = edges
    r = client.put(f"/api/workflows/{wid}/draft",
                   json={"definition": defn, "baseRevision": g["draftRevision"]})
    assert r.status_code == 200, r.text
    return wid


def run_sync(wid, run_input=None):
    db = SessionLocal()
    try:
        run = create_run(db, wid, "test", run_input or {"userQuery": "hi"}, enqueue=False)
    finally:
        db.close()
    execute_run(run.id)
    return client.get(f"/api/runs/{run.id}").json()


BASE_NODES = [
    {"id": "s", "type": "input", "name": "开始", "config": {}, "inputs": []},
    {"id": "e", "type": "end", "name": "结束", "config": {"outputKey": "quality_result"},
     "inputs": [{"name": "output", "type": "string", "source": {"kind": "fixed", "value": ""}}]},
]


# ---------- C-1 事件通道 ----------

def test_c1_event_channels_and_trace_ids():
    wid = make_wf([
        {"id": "s", "type": "input", "name": "开始", "config": {}, "inputs": []},
        {"id": "t", "type": "transform", "name": "转换", "config": {"template": "X"}, "inputs": []},
        {"id": "e", "type": "end", "name": "结束", "config": {"outputKey": "quality_result"},
         "inputs": [{"name": "output", "type": "string",
                     "source": {"kind": "upstream", "nodeId": "t", "path": "outputs.output"}}]},
    ], [{"id": "e1", "source": "s", "target": "t"}, {"id": "e2", "source": "t", "target": "e"}])
    d = run_sync(wid)
    assert d["status"] == "succeeded"
    from app.models import RunEvent
    db = SessionLocal()
    try:
        evs = db.query(RunEvent).filter_by(run_id=d["runId"]).all()
        assert all(ev.trace_id == d["runId"] for ev in evs)
        ctrl = [ev for ev in evs if ev.type == "node_completed"]
        assert ctrl and all(ev.channel == "CONTROL" for ev in ctrl)
        nc = [ev for ev in evs if ev.type == "node_completed" and ev.node_id == "t"][0]
        assert nc.span_id == nc.node_run_id and nc.parent_span_id == d["runId"]
        assert nc.duration_ms is not None
    finally:
        db.close()


def test_c1_reply_node_emits_content_channel():
    wid = make_wf([
        BASE_NODES[0],
        {"id": "r", "type": "reply", "name": "回复",
         "config": {"content": "你好 {{s.outputs.userQuery}}"}, "inputs": []},
        BASE_NODES[1],
    ], [{"id": "e1", "source": "s", "target": "r"}, {"id": "e2", "source": "r", "target": "e"}])
    d = run_sync(wid, {"userQuery": "世界"})
    assert d["status"] == "succeeded", d
    from app.models import RunEvent
    db = SessionLocal()
    try:
        ev = db.query(RunEvent).filter_by(run_id=d["runId"], type="reply_sent").first()
        assert ev and ev.channel == "CONTENT" and "你好 世界" in ev.payload["content"]
    finally:
        db.close()


# ---------- C-4 记忆变量持久化 ----------

def test_c4_memory_write_read_persists_across_runs():
    nodes = [
        BASE_NODES[0],
        {"id": "w", "type": "memory-variable", "name": "写记忆", "config": {"mode": "write"},
         "inputs": [{"name": "city", "type": "string", "source": {"kind": "fixed", "value": "杭州"}}]},
        {"id": "r", "type": "memory-variable", "name": "读记忆",
         "config": {"mode": "read", "keys": ["city"]}, "inputs": []},
        {"id": "e", "type": "end", "name": "结束", "config": {"outputKey": "quality_result"},
         "inputs": [{"name": "output", "type": "string",
                     "source": {"kind": "upstream", "nodeId": "r", "path": "outputs.city"}}]},
    ]
    edges = [{"id": "e1", "source": "s", "target": "w"}, {"id": "e2", "source": "w", "target": "r"},
             {"id": "e3", "source": "r", "target": "e"}]
    wid = make_wf(nodes, edges)
    d1 = run_sync(wid)
    assert d1["status"] == "succeeded", d1
    # 第二次运行（新 Run）仍能读到——证明持久化而非 run 内临时态
    d2 = run_sync(wid)
    assert d2["status"] == "succeeded"
    assert d2["output"]["output"] == "杭州"


# ---------- C-4 代码沙箱 ----------

def test_c4_code_write_sandbox_executes_and_times_out():
    code_ok = "def main(args):\n    return {\"output\": args.params.get(\"input\", \"\") + \"-OK\"}\n"
    wid = make_wf([
        BASE_NODES[0],
        {"id": "c", "type": "code-write", "name": "代码", "config": {"code": code_ok},
         "inputs": [{"name": "input", "type": "string", "source": {"kind": "fixed", "value": "V"}}]},
        {"id": "e", "type": "end", "name": "结束", "config": {"outputKey": "quality_result"},
         "inputs": [{"name": "output", "type": "string",
                     "source": {"kind": "upstream", "nodeId": "c", "path": "outputs.output"}}]},
    ], [{"id": "e1", "source": "s", "target": "c"}, {"id": "e2", "source": "c", "target": "e"}])
    d = run_sync(wid)
    assert d["status"] == "succeeded", d
    assert d["output"]["output"] == "V-OK"

    code_loop = "def main(args):\n    while True:\n        pass\n"
    wid2 = make_wf([
        BASE_NODES[0],
        {"id": "c", "type": "code-write", "name": "死循环", "config": {"code": code_loop}, "inputs": []},
        BASE_NODES[1],
    ], [{"id": "e1", "source": "s", "target": "c"}, {"id": "e2", "source": "c", "target": "e"}])
    d2 = run_sync(wid2)
    assert d2["status"] == "failed" and "超时" in d2["error"]["message"]


# ---------- C-4 决策分类 / Query改写 / 工作流选择（mock 路径） ----------

def test_c4_decision_class_routes_first_branch_in_mock():
    wid = make_wf([
        BASE_NODES[0],
        {"id": "dc", "type": "decision-class", "name": "分类",
         "config": {"branches": [{"handle": "c0", "title": "安装"}, {"handle": "c1", "title": "售后"}]},
         "inputs": []},
        {"id": "t0", "type": "transform", "name": "安装路径", "config": {"template": "PATH-安装"}, "inputs": []},
        {"id": "t1", "type": "transform", "name": "售后路径", "config": {"template": "PATH-售后"}, "inputs": []},
        {"id": "e", "type": "end", "name": "结束", "config": {"outputKey": "quality_result"},
         "inputs": [{"name": "output", "type": "string",
                     "source": {"kind": "upstream", "nodeId": "t0", "path": "outputs.output"}}]},
    ], [{"id": "e1", "source": "s", "target": "dc"},
        {"id": "e2", "source": "dc", "sourceHandle": "c0", "target": "t0"},
        {"id": "e3", "source": "dc", "sourceHandle": "c1", "target": "t1"},
        {"id": "e4", "source": "t0", "target": "e"}])
    d = run_sync(wid, {"userQuery": "怎么安装"})
    assert d["status"] == "succeeded", d
    statuses = {n["nodeId"]: n["status"] for n in d["nodeRuns"]}
    assert statuses["t0"] == "success" and statuses["t1"] == "skipped"
    assert d["output"]["output"] == "PATH-安装"


def test_c4_query_rewrite_returns_list():
    wid = make_wf([
        BASE_NODES[0],
        {"id": "qr", "type": "query-rewrite", "name": "改写", "config": {}, "inputs": []},
        BASE_NODES[1],
    ], [{"id": "e1", "source": "s", "target": "qr"}, {"id": "e2", "source": "qr", "target": "e"}])
    d = run_sync(wid, {"userQuery": "安装问题"})
    assert d["status"] == "succeeded", d
    ev = [e for e in client.get(f"/api/runs/{d['runId']}/events-list").json()["items"]
          if e["type"] == "node_completed" and e["nodeId"] == "qr"]
    assert ev and ev[0]["payload"]["output"]["queryList"] == ["安装问题"]


def test_c4_workflow_select_routes_and_select_node_can_execute():
    sub = make_wf(BASE_NODES, [{"id": "e1", "source": "s", "target": "e"}])
    wid = make_wf([
        BASE_NODES[0],
        {"id": "ws", "type": "workflow-select", "name": "选择",
         "config": {"candidates": [sub]}, "inputs": []},
        {"id": "wf", "type": "workflow-fixed", "name": "固定",
         "config": {"workflowId": sub}, "inputs": []},
        BASE_NODES[1],
    ], [{"id": "e1", "source": "s", "target": "ws"},
        {"id": "e2", "source": "ws", "sourceHandle": sub, "target": "wf"},
        {"id": "e3", "source": "wf", "target": "e"}])
    d = run_sync(wid, {"userQuery": "任意"})
    assert d["status"] == "succeeded", d
    items = client.get(f"/api/runs/{d['runId']}/events-list").json()["items"]
    sel = [e for e in items if e["type"] == "node_completed" and e["nodeId"] == "ws"]
    assert sel[0]["payload"]["output"]["workflowCode"] == sub


# ---------- C-5 系统变量 ----------

def test_c5_system_variables_registry_and_resolution():
    items = client.get("/api/registry/system-variables").json()["items"]
    names = {i["name"] for i in items}
    assert {"tenantId", "userId", "userName", "sysTime", "initContext"} <= names and len(items) == 14

    wid = make_wf([
        BASE_NODES[0],
        {"id": "t", "type": "transform", "name": "取系统变量",
         "config": {"template": "U={{system.outputs.userId}}|T={{system.outputs.sysTime}}"}, "inputs": []},
        {"id": "e", "type": "end", "name": "结束", "config": {"outputKey": "quality_result"},
         "inputs": [{"name": "output", "type": "string",
                     "source": {"kind": "upstream", "nodeId": "t", "path": "outputs.output"}}]},
    ], [{"id": "e1", "source": "s", "target": "t"}, {"id": "e2", "source": "t", "target": "e"}])
    d = run_sync(wid, {"userQuery": "x", "__system": {"userId": "U-42"}})
    assert d["status"] == "succeeded", d
    assert d["output"]["output"].startswith("U=U-42|T=")


# ---------- C-6 节点单测 ----------

def test_c6_node_test_endpoint():
    code = "def main(args):\n    return {\"output\": \"T-\" + str(args.params.get(\"input\", \"\"))}\n"
    wid = make_wf([
        BASE_NODES[0],
        {"id": "c", "type": "code-write", "name": "代码", "config": {"code": code},
         "inputs": [{"name": "input", "type": "string", "source": {"kind": "fixed", "value": ""}}]},
        BASE_NODES[1],
    ], [{"id": "e1", "source": "s", "target": "c"}, {"id": "e2", "source": "c", "target": "e"}])
    r = client.post(f"/api/workflows/{wid}/node-test",
                    json={"nodeId": "c", "input": {"input": "Z"}})
    assert r.status_code == 200 and r.json()["ok"] is True
    assert r.json()["output"]["output"] == "T-Z"
    # 失败路径
    r2 = client.post(f"/api/workflows/{wid}/node-test", json={"nodeId": "nope", "input": {}})
    assert r2.status_code == 404
