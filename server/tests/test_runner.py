"""P1 Runner 测试：分支/转换/mock-llm/事件序列/SSE/跳过语义。"""
import json

from fastapi.testclient import TestClient

from app.main import app
from app.runner import execute_run, create_run, start_worker
from app.db import SessionLocal

client = TestClient(app)
_worker_stop = start_worker()


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
    run = create_run(db, wid, "test", {"userQuery": "hello"}, enqueue=False)
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


def test_workflow_exec_recursion_guard():
    c = client
    wf = c.post("/api/workflows", json={"name": "rec-self"}).json()
    d = c.get(f"/api/workflows/{wf['id']}").json()["definition"]
    d["graph"]["nodes"].append({"id": "n_we", "type": "workflow-exec", "name": "自调用",
                                "config": {"workflowCode": wf["id"]}, "inputs": []})
    d["graph"]["edges"].append({"id": "e_w", "source": d["graph"]["nodes"][0]["id"], "target": "n_we"})
    c.put(f"/api/workflows/{wf['id']}/draft", json={"definition": d, "baseRevision": d["workflow"]["draftRevision"]})
    r = c.post("/api/runs", json={"workflowId": wf["id"], "trigger": "test", "input": {}})  # via API enqueues; worker consumes
    run = _poll_terminal(c, r.json()["runId"])
    assert run["status"] == "failed"
    assert "递归" in run["error"]["message"]


def _poll_terminal(c, run_id: str, timeout: float = 20.0) -> dict:
    """确定性等待终态（替代固定 sleep；全套件下 worker 负载会拉长执行）。"""
    import time
    deadline = time.time() + timeout
    while time.time() < deadline:
        run = c.get(f"/api/runs/{run_id}").json()
        if run.get("status") in ("succeeded", "failed", "cancelled"):
            return run
        time.sleep(0.2)
    raise AssertionError(f"run {run_id} 未在 {timeout}s 内到终态")


def test_create_record_sink_persists_quality_result():
    c = client
    from app.db import SessionLocal
    from app.models import ResultRuleSet
    _db = SessionLocal()
    _db.query(ResultRuleSet).delete()
    _db.commit()
    _db.close()
    wf = c.post("/api/workflows", json={"name": "sink-wf"}).json()
    d = c.get(f"/api/workflows/{wf['id']}").json()["definition"]
    start = next(n for n in d["graph"]["nodes"] if n["type"] == "input")
    end = next(n for n in d["graph"]["nodes"] if n["type"] == "end")
    d["graph"]["nodes"].append({"id": "n_cr", "type": "create-record", "name": "落质检",
                                "config": {}, "inputs": [
                                    {"name": "score", "type": "number", "source": {"kind": "fixed", "value": 88}},
                                    {"name": "risk", "type": "string", "source": {"kind": "fixed", "value": "High"}},
                                    {"name": "evidence", "type": "array", "source": {"kind": "fixed", "value": [
                                        {"kind": "transcript_span", "text": "我们一定会当天给您回电", "locator": {"start": 0, "end": 12}}]}}]})
    d["graph"]["edges"] = [e for e in d["graph"]["edges"] if not (e["source"] == start["id"] and e["target"] == end["id"])]
    d["graph"]["edges"] += [{"id": "e1", "source": start["id"], "target": "n_cr"},
                            {"id": "e2", "source": "n_cr", "target": end["id"]}]
    c.put(f"/api/workflows/{wf['id']}/draft", json={"definition": d, "baseRevision": d["workflow"]["draftRevision"]})
    r = c.post("/api/runs", json={"workflowId": wf["id"], "trigger": "test", "input": {"interactionId": "IX-1"}})
    run = _poll_terminal(c, r.json()["runId"])
    assert run["status"] == "succeeded"
    # 按 run_id 精确取结果（共享测试库累积后列表首页假设不再成立）
    from app.models import QualityResult
    _db2 = SessionLocal()
    try:
        q = _db2.query(QualityResult).filter_by(run_id=run["runId"]).first()
        assert q is not None
        row = {"id": q.id, "runId": q.run_id, "score": q.score, "risk": q.risk}
    finally:
        _db2.close()
    assert row["score"] == 88 and row["risk"] == "High"
    det = c.get(f"/api/quality-results/{row['id']}").json()
    assert det["evidence"][0]["text"] == "我们一定会当天给您回电"
