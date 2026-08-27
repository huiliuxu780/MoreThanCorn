"""业务深化测试：规则引擎/复核/批量/周期。"""
import time

from fastapi.testclient import TestClient

from app.main import app
from app.runner import start_worker
from tests._quality_setup import make_definition_version, make_rule_version

client = TestClient(app)
_worker = start_worker()


def _wf_with_sink():
    wf = client.post("/api/workflows", json={"name": "biz-wf"}).json()
    d = client.get(f"/api/workflows/{wf['id']}").json()["definition"]
    start = next(n for n in d["graph"]["nodes"] if n["type"] == "input")
    end = next(n for n in d["graph"]["nodes"] if n["type"] == "end")
    # 输出满足 QualityEvaluation Schema（09 P0-06：任务主链强制校验）
    d["graph"]["nodes"].append({"id": "n_cr", "type": "create-record", "name": "落质检", "config": {}, "inputs": [
        {"name": "score", "type": "number", "source": {"kind": "fixed", "value": 90}},
        {"name": "risk", "type": "string", "source": {"kind": "fixed", "value": "Low"}},
        {"name": "issues", "type": "array", "source": {"kind": "fixed", "value": []}},
        {"name": "summary", "type": "string", "source": {"kind": "fixed", "value": "ok"}},
        {"name": "promise", "type": "string", "source": {"kind": "fixed", "value": "我们会当天回电"}},
        {"name": "transcript", "type": "array", "source": {"kind": "fixed", "value": [
            {"start": 0, "end": 6, "speaker": "agent", "text": "我们会当天回电"}]}},
    ]})
    d["graph"]["edges"] = [e for e in d["graph"]["edges"] if not (e["source"] == start["id"] and e["target"] == end["id"])]
    d["graph"]["edges"] += [{"id": "e1", "source": start["id"], "target": "n_cr"},
                            {"id": "e2", "source": "n_cr", "target": end["id"]}]
    client.put(f"/api/workflows/{wf['id']}/draft", json={"definition": d, "baseRevision": d["workflow"]["draftRevision"]})
    return wf


def _wait_run_terminal(run_id: str, timeout: float = 15.0) -> dict:
    """确定性等待 Run 终态（替代固定 sleep；共享测试库下 2s 假设在全套件中不稳定）。"""
    deadline = time.time() + timeout
    while time.time() < deadline:
        r = client.get(f"/api/runs/{run_id}").json()
        if r.get("status") in ("succeeded", "failed", "cancelled"):
            return r
        time.sleep(0.2)
    raise AssertionError(f"run {run_id} 未在 {timeout}s 内到终态")


def _wait_task_run_terminal(trid: str, timeout: float = 30.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        r = client.get(f"/api/task-runs/{trid}").json()
        if r.get("status") in ("succeeded", "partial", "failed", "cancelled"):
            return r
        time.sleep(0.3)
    raise AssertionError(f"task-run {trid} 未在 {timeout}s 内到终态")


def _qr_by_run(run_id: str):
    """按 run_id 精确取结果（共享测试库累积数据后，列表首页假设不再成立）。"""
    from app.db import SessionLocal
    from app.models import QualityResult
    db = SessionLocal()
    try:
        qr = db.query(QualityResult).filter_by(run_id=run_id).first()
        assert qr is not None, f"run {run_id} 没有产生 QualityResult"
        return {"id": qr.id, "runId": qr.run_id}
    finally:
        db.close()


def test_rules_engine_derives_and_recalc():
    """09-P0-07 新语义：发布=冻结不可变 RuleVersion（禁止全库重算）；
    结果在创建时绑定当时的冻结版本并派生（旧"发布即重算全库"已废止）。"""
    rules = client.post("/api/result-rules", json={"name": "承诺规则", "rules": {
        "scoreRules": [{"id": "s1", "field": "score", "op": "gt", "value": 80, "weight": 0}],
        "issueRules": [{"id": "i1", "criterion": "承诺未兑现检查", "field": "promise", "op": "contains", "value": "回电", "severity": "High"}]}}).json()
    pub = client.post(f"/api/result-rules/{rules['id']}/publish").json()
    assert pub["version"] == 1 and pub["ruleVersionId"] and not pub.get("recalculated")
    wf = _wf_with_sink()
    r = client.post("/api/runs", json={"workflowId": wf["id"], "trigger": "test", "input": {}})
    _wait_run_terminal(r.json()["runId"])
    qr = _qr_by_run(r.json()["runId"])
    det = client.get(f"/api/quality-results/{qr['id']}").json()
    assert det["risk"] == "High" and det["issueCount"] == 1
    assert det["ruleVersionId"] == pub["ruleVersionId"]  # 结果记录明确 RuleVersion


def test_review_flow_history():
    qrs = client.get("/api/quality-results").json()["items"]
    rid = qrs[0]["id"]
    r1 = client.post(f"/api/quality-results/{rid}/review", json={"action": "revise", "score": 60, "note": "降级"}).json()
    assert r1["review"] == "REVIEWED" and r1["history"][-1]["action"] == "revise"
    r2 = client.post(f"/api/quality-results/{rid}/review", json={"action": "effective"}).json()
    assert r2["review"] == "EFFECTIVE"
    # 09 §11.4：重开进入 REOPENED（回到待复核池），不再直接置 AI
    r3 = client.post(f"/api/quality-results/{rid}/review", json={"action": "reopen"}).json()
    assert r3["review"] == "REOPENED" and len(r3["history"]) == 3


def test_batch_run_and_schedule():
    """09 P0-B2：batch-run 过渡入口改走 TaskRun 链路（202 + 批次统计）。"""
    wf = _wf_with_sink()
    assert client.post(f"/api/workflows/{wf['id']}/publish").status_code == 201
    asset = client.post("/api/data-assets", json={"name": "资产A", "rows": [
        {"interactionId": "IX1", "userQuery": "a"}, {"interactionId": "IX2", "userQuery": "b"}]}).json()
    defv = make_definition_version(client, asset["id"])
    rpv = make_rule_version(client)
    task = client.post("/api/tasks", json={
        "name": "任务T", "workflowId": wf["id"], "workflowVersionPolicy": "latest_published",
        "dataAssetId": asset["id"], "dataDefinitionVersionId": defv,
        "resultRuleVersionId": rpv}).json()
    r = client.post(f"/api/tasks/{task['id']}/batch-run", json={})
    assert r.status_code == 202
    trid = r.json()["taskRunId"]
    tr = _wait_task_run_terminal(trid)
    assert tr["total"] == 2 and tr["succeeded"] == 2 and tr["failed"] == 0
    runs = client.get(f"/api/task-runs/{trid}/runs").json()["items"]
    assert len(runs) == 2 and sorted(x["interactionRef"] for x in runs) == ["IX1", "IX2"]
    sch = client.post(f"/api/tasks/{task['id']}/schedule", json={"cron": "0 9 * * *"}).json()
    assert sch["nextRunAt"]


def test_quality_results_filters_real():
    """E-1.1：筛选参数真落地（此前前端筛选不进后端）。"""
    # 词表端点：criteria 来自活跃（最新发布）规则。共享库中其他测试会发布规则，
    # 故此处先发布一条含已知 criterion 的规则，确保其为最新，词表可含该条目（自包含）。
    r0 = client.post("/api/result-rules", json={"name": "vocab-rule", "rules": {
        "scoreRules": [], "issueRules": [
            {"id": "v1", "criterion": "承诺未兑现检查", "field": "promise",
             "op": "contains", "value": "回电", "severity": "High"}]}}).json()
    client.post(f"/api/result-rules/{r0['id']}/publish")
    vocab = client.get("/api/quality/vocab").json()
    assert any(c["criterion"] == "承诺未兑现检查" for c in vocab["criteria"])
    # criterion 筛选：命中行全部含该问题摘要；乱填 → 0 行
    hit = client.get("/api/quality-results", params={"criterion": "承诺"}).json()
    assert hit["total"] >= 1 and all("承诺" in (x["issueSummary"] or "") for x in hit["items"])
    miss = client.get("/api/quality-results", params={"criterion": "不存在的问题xyz"}).json()
    assert miss["total"] == 0
    # quality 筛选：有问题 → 行均 issueCount>0
    q = client.get("/api/quality-results", params={"quality": "有问题"}).json()
    assert q["total"] >= 1 and all(x["issueCount"] > 0 for x in q["items"])
    # risk 筛选：High 命中（上面规则发布后存在 High 行）
    hi = client.get("/api/quality-results", params={"risk": "High"}).json()
    assert hi["total"] >= 1 and all(x["risk"] == "High" for x in hi["items"])
    # reviewStatus 与 tab 语义一致。09 §11.4 起状态机扩展（IN_REVIEW/REOPENED），
    # pending(AI)+reviewed(REVIEWED/EFFECTIVE) 覆盖子集，其余为复核中/重开，故为 <=。
    pend = client.get("/api/quality-results", params={"tab": "pending", "pageSize": 1}).json()
    rev = client.get("/api/quality-results", params={"tab": "reviewed", "pageSize": 100}).json()
    assert pend["total"] + rev["total"] <= client.get("/api/quality-results", params={"pageSize": 1}).json()["total"]
    assert all(x["review"] in ("REVIEWED", "EFFECTIVE") for x in rev["items"])
    assert all(x["review"] == "AI" for x in
               client.get("/api/quality-results", params={"tab": "pending", "pageSize": 100}).json()["items"])
    # 排序：score:asc 非降序
    asc = client.get("/api/quality-results", params={"sort": "score:asc", "pageSize": 100}).json()
    scores = [x["score"] for x in asc["items"] if x["score"] is not None]
    assert scores == sorted(scores)
