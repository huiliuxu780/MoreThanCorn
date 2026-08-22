"""P1 Runner 测试：分支/转换/mock-llm/事件序列/SSE/跳过语义。"""
import json

from fastapi.testclient import TestClient

from app.main import app
from app.runner import execute_run, create_run
from app.db import SessionLocal

client = TestClient(app)


def make_wf(nodes_extra, edges_extra, branches=None):
    cr = client.post("/api/workflows", json={"name": "RUN-T"})
    wid = cr.json()["id"]
    g = client.get(f"/api/workflows/{wid}").json()
    defn = g["definition"]
    defn["graph"]["nodes"] = [
        {"id": "s", "type": "input", "name": "开始", "config": {}, "inputs": []},
        {"id": "l", "type": "llm", "name": "大模型",
         "config": {"modelRef": {"modelId": "deepseek-r1-distill-qwen-14b"},
                    "prompt": "输入：{{s.outputs.userQuery}}"}, "inputs": []},
        {"id": "c", "type": "condition", "name": "条件",
         "config": {"branches": [{"handle": "yes", "variable": "{{l.outputs.answer}}",
                                  "operator": "contains", "value": "mock"}]},
         "inputs": [], "branches": ["yes", "no"]},
        {"id": "t1", "type": "transform", "name": "转换命中",
         "config": {"template": "HIT:{{l.outputs.answer}}"}, "inputs": []},
        {"id": "t2", "type": "transform", "name": "转换未命中",
         "config": {"template": "MISS"}, "inputs": []},
        {"id": "e", "type": "end", "name": "结束",
         "config": {"outputKey": "quality_result"},
         "inputs": [{"name": "output", "type": "string",
                     "source": {"kind": "upstream", "nodeId": "t1", "path": "outputs.output"}}]},
    ] + nodes_extra
    defn["graph"]["edges"] = [
        {"id": "e1", "source": "s", "target": "l"},
        {"id": "e2", "source": "l", "target": "c"},
        {"id": "e3", "source": "c", "sourceHandle": "yes", "target": "t1"},
        {"id": "e4", "source": "c", "sourceHandle": "no", "target": "t2"},
        {"id": "e5", "source": "t1", "target": "e"},
    ] + edges_extra
    client.put(f"/api/workflows/{wid}/draft",
               json={"definition": defn, "baseRevision": g["draftRevision"]})
    return wid


def test_branch_yes_and_skip_downstream():
    wid = make_wf([], [])
    db = SessionLocal()
    run = create_run(db, wid, "test", {"userQuery": "hello"})
    db.close()
    execute_run(run.id)
    detail = client.get(f"/api/runs/{run.id}").json()
    assert detail["status"] == "succeeded", detail
    statuses = {n["nodeId"]: n["status"] for n in detail["nodeRuns"]}
    assert statuses["t1"] == "success"
    assert statuses["t2"] == "skipped"
    assert statuses["e"] == "success"
    assert "HIT:" in (detail["output"].get("output") or "")
    # mock llm 输出含 [mock:]，prompt 变量已替换
    llm = [n for n in detail["nodeRuns"] if n["nodeId"] == "l"][0]
    assert "[mock:deepseek-r1-distill-qwen-14b]" in llm["output"]["answer"]
    assert "hello" in json.dumps(llm["output"], ensure_ascii=False)


def test_event_sequence_monotonic_and_terminal():
    wid = make_wf([], [])
    db = SessionLocal()
    run = create_run(db, wid, "test", {"userQuery": "x"})
    db.close()
    execute_run(run.id)
    with client.stream("GET", f"/api/runs/{run.id}/events") as r:
        body = ""
        for chunk in r.iter_text():
            body += chunk
            if "workflow_completed" in body or "workflow_failed" in body:
                break
    ids = [int(line.split(": ")[1]) for line in body.splitlines() if line.startswith("id: ")]
    assert ids == sorted(ids) and len(ids) >= 6
    assert "workflow_started" in body and "workflow_completed" in body
    assert "node_completed" in body and "node_skipped" in body


def test_validation_blocks_run():
    cr = client.post("/api/workflows", json={"name": "BAD"})
    wid = cr.json()["id"]
    g = client.get(f"/api/workflows/{wid}").json()
    defn = g["definition"]
    defn["graph"]["nodes"].append({"id": "lonely", "type": "llm", "name": "孤",
                                   "config": {}, "inputs": []})
    client.put(f"/api/workflows/{wid}/draft",
               json={"definition": defn, "baseRevision": g["draftRevision"]})
    r = client.post("/api/runs", json={"workflowId": wid, "trigger": "test", "input": {}})
    assert r.status_code == 409


def test_run_list_and_cancel_404():
    r = client.get("/api/runs?workflowId=nope")
    assert r.status_code == 200 and r.json() == []
    assert client.post("/api/runs/nope/cancel").status_code == 404
