"""业务深化测试：规则引擎/复核/批量/周期。"""
import time

from fastapi.testclient import TestClient

from app.main import app
from app.runner import start_worker

client = TestClient(app)
_worker = start_worker()


def _wf_with_sink():
    wf = client.post("/api/workflows", json={"name": "biz-wf"}).json()
    d = client.get(f"/api/workflows/{wf['id']}").json()["definition"]
    start = next(n for n in d["graph"]["nodes"] if n["type"] == "input")
    end = next(n for n in d["graph"]["nodes"] if n["type"] == "end")
    d["graph"]["nodes"].append({"id": "n_cr", "type": "create-record", "name": "落质检", "config": {}, "inputs": [
        {"name": "score", "type": "number", "source": {"kind": "fixed", "value": 90}},
        {"name": "promise", "type": "string", "source": {"kind": "fixed", "value": "我们会当天回电"}},
        {"name": "transcript", "type": "array", "source": {"kind": "fixed", "value": [
            {"start": 0, "end": 6, "speaker": "agent", "text": "我们会当天回电"}]}},
    ]})
    d["graph"]["edges"] = [e for e in d["graph"]["edges"] if not (e["source"] == start["id"] and e["target"] == end["id"])]
    d["graph"]["edges"] += [{"id": "e1", "source": start["id"], "target": "n_cr"},
                            {"id": "e2", "source": "n_cr", "target": end["id"]}]
    client.put(f"/api/workflows/{wf['id']}/draft", json={"definition": d, "baseRevision": d["workflow"]["draftRevision"]})
    return wf


def test_rules_engine_derives_and_recalc():
    wf = _wf_with_sink()
    r = client.post("/api/runs", json={"workflowId": wf["id"], "trigger": "test", "input": {}})
    time.sleep(2)
    qrs = client.get("/api/quality-results").json()["items"]
    qr = next(q for q in qrs if q["runId"] == r.json()["runId"])
    # 建规则：issueRule 命中 promise 包含 回电 → Critical；scoreRule 失败扣分
    rules = client.post("/api/result-rules", json={"name": "承诺规则", "rules": {
        "scoreRules": [{"id": "s1", "field": "score", "op": "gt", "value": 80, "weight": 0}],
        "issueRules": [{"id": "i1", "criterion": "承诺未兑现检查", "field": "promise", "op": "contains", "value": "回电", "severity": "High"}]}}).json()
    pub = client.post(f"/api/result-rules/{rules['id']}/publish").json()
    assert pub["version"] == 2 and pub["recalculated"] >= 1
    det = client.get(f"/api/quality-results/{qr['id']}").json()
    assert det["risk"] == "High" and det["issueCount"] == 1


def test_review_flow_history():
    qrs = client.get("/api/quality-results").json()["items"]
    rid = qrs[0]["id"]
    r1 = client.post(f"/api/quality-results/{rid}/review", json={"action": "revise", "score": 60, "note": "降级"}).json()
    assert r1["review"] == "REVIEWED" and r1["history"][-1]["action"] == "revise"
    r2 = client.post(f"/api/quality-results/{rid}/review", json={"action": "effective"}).json()
    assert r2["review"] == "EFFECTIVE"
    r3 = client.post(f"/api/quality-results/{rid}/review", json={"action": "reopen"}).json()
    assert r3["review"] == "AI" and len(r3["history"]) == 3


def test_batch_run_and_schedule():
    wf = _wf_with_sink()
    asset = client.post("/api/data-assets", json={"name": "资产A", "rows": [
        {"interactionId": "IX1", "userQuery": "a"}, {"interactionId": "IX2", "userQuery": "b"}]}).json()
    task = client.post("/api/tasks", json={"name": "任务T", "workflowId": wf["id"], "dataAssetId": asset["id"]}).json()
    br = client.post(f"/api/tasks/{task['id']}/batch-run", json={}).json()
    assert len(br["runIds"]) == 2
    sch = client.post(f"/api/tasks/{task['id']}/schedule", json={"cron": "0 9 * * *"}).json()
    assert sch["nextRunAt"]
