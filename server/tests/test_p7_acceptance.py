"""07-SDD 验收 A4/A5/A6：workflow-fixed 映射+钉版本 / workflow-exec 动态 / workflow-select 路由。"""
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.runner import create_run, execute_run

client = TestClient(app)


def _mk_sub():
    wid = client.post("/api/workflows", json={"name": "P7-sub"}).json()["id"]
    g = client.get(f"/api/workflows/{wid}").json()
    defn = g["definition"]
    defn["graph"]["nodes"] = [
        {"id": "s", "type": "input", "name": "开始", "config": {}, "inputs": []},
        {"id": "e", "type": "end", "name": "结束", "config": {"outputKey": "quality_result"},
         "inputs": [{"name": "output", "type": "string",
                     "source": {"kind": "upstream", "nodeId": "s", "path": "outputs.userQuery"}}]}]
    defn["graph"]["edges"] = [{"id": "e1", "source": "s", "target": "e"}]
    client.put(f"/api/workflows/{wid}/draft", json={"definition": defn, "baseRevision": g["draftRevision"]})
    return wid


def _mk_parent(nodes, edges):
    wid = client.post("/api/workflows", json={"name": "P7-parent"}).json()["id"]
    g = client.get(f"/api/workflows/{wid}").json()
    defn = g["definition"]
    defn["graph"]["nodes"] = [{"id": "s", "type": "input", "name": "开始", "config": {}, "inputs": []}] + nodes
    defn["graph"]["edges"] = edges
    client.put(f"/api/workflows/{wid}/draft", json={"definition": defn, "baseRevision": g["draftRevision"]})
    return wid


def _run_sync(wid, inp):
    db = SessionLocal()
    run = create_run(db, wid, "test", inp, enqueue=False)
    db.close()
    execute_run(run.id)
    return client.get(f"/api/runs/{run.id}").json()


def test_a4_workflow_fixed_mapping_and_pinned_version():
    sub = _mk_sub()
    # 发布 v1
    p = client.post(f"/api/workflows/{sub}/publish")
    assert p.status_code in (200, 201), p.text
    v1 = client.get(f"/api/workflows/{sub}/versions").json()[0]["versionId"]
    # 改草稿：end 输出固定值 CHANGED
    g = client.get(f"/api/workflows/{sub}").json()
    defn = g["definition"]
    for n in defn["graph"]["nodes"]:
        if n["id"] == "e":
            n["inputs"] = [{"name": "output", "type": "string", "source": {"kind": "fixed", "value": "CHANGED"}}]
    client.put(f"/api/workflows/{sub}/draft", json={"definition": defn, "baseRevision": g["draftRevision"]})
    # 父：钉 v1 + 输入映射
    parent = _mk_parent(
        [{"id": "f", "type": "workflow-fixed", "name": "固定", "config": {
            "workflowId": sub, "versionPolicy": "pinned", "pinnedVersionId": v1,
            "inputMapping": {"userQuery": "{{s.outputs.userQuery}}"}}, "inputs": []},
         {"id": "e2", "type": "end", "name": "结束", "config": {"outputKey": "quality_result"},
          "inputs": [{"name": "output", "type": "string",
                      "source": {"kind": "upstream", "nodeId": "f", "path": "outputs.output"}}]}],
        [{"id": "x1", "source": "s", "target": "f"}, {"id": "x2", "source": "f", "target": "e2"}])
    d = _run_sync(parent, {"userQuery": "hello-mapping"})
    assert d["status"] == "succeeded", d
    # 钉 v1 → 子输出取 v1 语义（透传父映射的 userQuery），而非草稿 CHANGED
    assert d["output"]["output"] == "hello-mapping"


def test_a5_workflow_exec_dynamic_mode():
    sub = _mk_sub()
    parent = _mk_parent(
        [{"id": "x", "type": "workflow-exec", "name": "动态", "config": {"mode": "dynamic"},
          "inputs": [{"name": "workflowCode", "type": "string", "source": {"kind": "fixed", "value": sub}}]},
         {"id": "e2", "type": "end", "name": "结束", "config": {"outputKey": "quality_result"},
          "inputs": [{"name": "output", "type": "string",
                      "source": {"kind": "upstream", "nodeId": "x", "path": "outputs.output"}}]}],
        [{"id": "x1", "source": "s", "target": "x"}, {"id": "x2", "source": "x", "target": "e2"}])
    d = _run_sync(parent, {"userQuery": "dyn"})
    assert d["status"] == "succeeded", d
    assert d["output"]["output"] == "dyn"


def test_a6_workflow_select_routes_and_else():
    sub = _mk_sub()
    parent = _mk_parent(
        [{"id": "w", "type": "workflow-select", "name": "选择", "config": {"candidates": [sub]}, "inputs": []},
         {"id": "h", "type": "transform", "name": "命中", "config": {"template": "HIT:{{w.outputs.workflowName}}"}, "inputs": []},
         {"id": "m", "type": "transform", "name": "未命中", "config": {"template": "MISS"}, "inputs": []},
         {"id": "e2", "type": "end", "name": "结束", "config": {"outputKey": "quality_result"},
          "inputs": [{"name": "output", "type": "string",
                      "source": {"kind": "upstream", "nodeId": "h", "path": "outputs.output"}}]}],
        [{"id": "x1", "source": "s", "target": "w"},
         {"id": "x2", "source": "w", "sourceHandle": sub, "target": "h"},
         {"id": "x3", "source": "w", "sourceHandle": "miss", "target": "m"},
         {"id": "x4", "source": "h", "target": "e2"}])
    d = _run_sync(parent, {"userQuery": "route-me"})
    assert d["status"] == "succeeded", d
    assert str(d["output"]["output"]).startswith("HIT:")
