"""09-SDD P0-B2：TaskRun 执行链（P0-04/05/06/08 + INV-01..07）。

核心口径（09 §6.4/§13.1）：
- TaskRun=批次、Run=单条 Interaction；输入 N 条 → N Run = N QualityResult（合法样本）；
- 重复/缺 ref/非法输出样本进入可解释的 failed 统计，不得静默丢弃或假成功；
- 任一结果可反查 TaskVersion/WorkflowVersion/DataSnapshot/RuleVersion；
- Idempotency-Key 重复请求返回原 TaskRun；paused Task 不得启动新批次（INV-10）。

先红后绿。
"""
import time

import pytest
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.runner import start_worker

client = TestClient(app)
_worker = start_worker()


def _wait_task_run(trid: str, timeout: float = 30.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        r = client.get(f"/api/task-runs/{trid}").json()
        if r.get("status") in ("succeeded", "partial", "failed", "cancelled"):
            return r
        time.sleep(0.3)
    raise AssertionError(f"task-run {trid} 未在 {timeout}s 内到终态")


def _quality_wf(name="p0-b2-wf") -> tuple[str, str]:
    """input → create-record（结构化输出满足 QualityEvaluation Schema）→ end，并发布。"""
    wf = client.post("/api/workflows", json={"name": name}).json()
    d = client.get(f"/api/workflows/{wf['id']}").json()["definition"]
    start = next(n for n in d["graph"]["nodes"] if n["type"] == "input")
    end = next(n for n in d["graph"]["nodes"] if n["type"] == "end")
    d["graph"]["nodes"].append({"id": "n_cr", "type": "create-record", "name": "落质检",
                                "config": {}, "inputs": [
        {"name": "score", "type": "number", "source": {"kind": "fixed", "value": 88}},
        {"name": "risk", "type": "string", "source": {"kind": "fixed", "value": "Low"}},
        {"name": "issues", "type": "array", "source": {"kind": "fixed", "value": []}},
        {"name": "summary", "type": "string",
         "source": {"kind": "input", "path": "text"}},
        {"name": "transcript", "type": "array", "source": {"kind": "fixed", "value": []}},
    ]})
    d["graph"]["edges"] = [e for e in d["graph"]["edges"]
                           if not (e["source"] == start["id"] and e["target"] == end["id"])]
    d["graph"]["edges"] += [{"id": "e1", "source": start["id"], "target": "n_cr"},
                            {"id": "e2", "source": "n_cr", "target": end["id"]}]
    client.put(f"/api/workflows/{wf['id']}/draft",
               json={"definition": d, "baseRevision": d["workflow"]["draftRevision"]})
    pub = client.post(f"/api/workflows/{wf['id']}/publish").json()
    return wf["id"], pub["versionId"]


def _dataset_asset(name="p0-b2-asset") -> str:
    """§13.1 缩比数据集：4 正常 + 1 重复 interactionId + 1 缺 interactionId。"""
    rows = [{"interactionId": f"B2-{i}", "text": f"样本{i}"} for i in range(4)]
    rows.append({"interactionId": "B2-0", "text": "重复样本"})   # 与首条重复
    rows.append({"text": "缺少 interactionId 的样本"})
    a = client.post("/api/data-assets", json={"name": name, "rows": rows}).json()
    return a["id"]


def _mk_task(name, wid, wvid, asset_id, rule_version_id=None, extra=None) -> dict:
    body = {"name": name, "workflowId": wid, "workflowVersionPolicy": "pinned",
            "pinnedWorkflowVersionId": wvid, "dataAssetId": asset_id,
            "inputMapping": {"interactionId": "interactionId", "text": "text"},
            "sampling": {"mode": "all"}, "dataWindow": {"mode": "all"}}
    if rule_version_id:
        body["resultRuleVersionId"] = rule_version_id
    if extra:
        body.update(extra)
    r = client.post("/api/tasks", json=body)
    assert r.status_code == 201, r.text
    return r.json()


# ---------- P0-05：N 输入 = N Run = N Result ----------

def test_taskrun_n_equals_n_with_explainable_failures():
    wid, wvid = _quality_wf()
    asset_id = _dataset_asset()
    task = _mk_task("B2 主链任务", wid, wvid, asset_id)
    r = client.post(f"/api/tasks/{task['id']}/runs", json={})
    assert r.status_code == 202, r.text
    body = r.json()
    trid = body["taskRunId"]
    assert body["status"] == "queued"
    assert body["resolvedVersions"]["workflowVersionId"] == wvid
    assert body["dataSnapshotId"]

    tr = _wait_task_run(trid)
    # 6 行输入：4 合法成功；重复 ref 与空 ref 进可解释 failed 统计
    assert tr["total"] == 6
    assert tr["succeeded"] == 4
    assert tr["failed"] == 2
    assert tr["status"] == "partial"
    reasons = str(tr.get("errorSummary"))
    assert "duplicate" in reasons.lower() or "重复" in reasons
    assert "interaction_ref" in reasons.lower() or "interactionId" in reasons

    # 批内 Run：4 条，各自绑定单条 Interaction（INV-02）
    runs = client.get(f"/api/task-runs/{trid}/runs").json()["items"]
    assert len(runs) == 4
    refs = sorted(x["interactionRef"] for x in runs)
    assert refs == ["B2-0", "B2-1", "B2-2", "B2-3"]
    assert all(x["workflowVersionId"] == wvid for x in runs)
    assert all(x["taskRunId"] == trid and x["taskId"] == task["id"] for x in runs)

    # 结果：4 条 = 4 个成功 Run 各一条（INV-03），追踪链完整（P0-08）
    qrs = client.get(f"/api/task-runs/{trid}/results").json()["items"]
    assert len(qrs) == 4
    assert len({q["runId"] for q in qrs}) == 4
    assert sorted(q["interactionRef"] for q in qrs) == refs
    for q in qrs:
        assert q["taskId"] == task["id"]
        assert q["taskRunId"] == trid
        assert q["workflowVersionId"] == wvid
        assert q["interactionRef"], "INV-04：interactionRef 非空"
        assert q["score"] is not None
        # AI 原始结构化输出（score 88）冻结在 ai_result；顶层为规则派生生效值（§9.6）
        det = client.get(f"/api/quality-results/{q['id']}").json()
        assert det["aiResult"]["structuredOutput"]["score"] == 88


def test_taskrun_freezes_versions_and_snapshot():
    """INV-05/INV-12：Run 冻结 WorkflowVersion/RuleVersion/DataSnapshot，不依赖草稿。"""
    from app.models import DataSnapshot
    wid, wvid = _quality_wf("p0-b2-wf-snap")
    asset_id = _dataset_asset("p0-b2-asset-snap")
    rules = client.post("/api/result-rules", json={"name": "b2-rules", "rules": {
        "scoreRules": [], "issueRules": [
            {"id": "i1", "criterion": "样本问题", "field": "summary", "op": "contains",
             "value": "样本", "severity": "Low"}]}}).json()
    rpv = client.post(f"/api/result-rules/{rules['id']}/publish").json()["ruleVersionId"]
    task = _mk_task("B2 快照任务", wid, wvid, asset_id, rule_version_id=rpv)
    r = client.post(f"/api/tasks/{task['id']}/runs", json={}).json()
    trid = r["taskRunId"]
    tr = _wait_task_run(trid)
    assert tr["succeeded"] == 4

    # DataSnapshot：读取基数与版本记录
    db = SessionLocal()
    try:
        snap = db.get(DataSnapshot, r["dataSnapshotId"])
        assert snap is not None
        assert snap.asset_id == asset_id
        assert snap.read_count == 6 and snap.expected_count == 6
        assert snap.resolved_sampling == {"mode": "all"}
        assert snap.checksum  # 内容指纹，重放可校验
    finally:
        db.close()

    # 结果绑定冻结 RuleVersion（P0-07/08）
    qrs = client.get(f"/api/task-runs/{trid}/results").json()["items"]
    assert all(q["ruleVersionId"] == rpv for q in qrs)
    det = client.get(f"/api/quality-results/{qrs[0]['id']}").json()
    assert det["taskRunId"] == trid and det["taskId"] == task["id"]
    assert det["workflowVersionId"] == wvid

    # 发布后修改草稿不影响批次重放语义：再跑一次仍用 pinned 版本
    r2 = client.post(f"/api/tasks/{task['id']}/runs", json={}).json()
    tr2 = _wait_task_run(r2["taskRunId"])
    assert tr2["succeeded"] == 4
    runs2 = client.get(f"/api/task-runs/{r2['taskRunId']}/runs").json()["items"]
    assert all(x["workflowVersionId"] == wvid for x in runs2)


# ---------- 幂等与状态门（INV-10/INV-11） ----------

def test_taskrun_idempotency_key_returns_same_run():
    import uuid
    idem = f"idem-{uuid.uuid4().hex[:12]}"  # 持久测试库：键必须每次唯一，防止跨轮复用
    wid, wvid = _quality_wf("p0-b2-wf-idem")
    asset_id = _dataset_asset("p0-b2-asset-idem")
    task = _mk_task("B2 幂等任务", wid, wvid, asset_id)
    r1 = client.post(f"/api/tasks/{task['id']}/runs",
                     headers={"Idempotency-Key": idem})
    r2 = client.post(f"/api/tasks/{task['id']}/runs",
                     headers={"Idempotency-Key": idem})
    assert r1.status_code == 202 and r2.status_code == 202
    assert r1.json()["taskRunId"] == r2.json()["taskRunId"]
    runs = client.get(f"/api/tasks/{task['id']}/runs").json()["items"]
    assert len(runs) == 1  # INV-11：同一幂等键只创建一个 TaskRun
    assert runs[0]["id"] == r1.json()["taskRunId"]
    assert runs[0]["idempotencyKey"] == idem
    _wait_task_run(r1.json()["taskRunId"])


def test_taskrun_paused_task_rejected():
    wid, wvid = _quality_wf("p0-b2-wf-pause")
    asset_id = _dataset_asset("p0-b2-asset-pause")
    task = _mk_task("B2 暂停任务", wid, wvid, asset_id)
    st = client.post(f"/api/tasks/{task['id']}/status", json={"status": "paused"}).json()
    assert st["status"] == "paused"
    r = client.post(f"/api/tasks/{task['id']}/runs", json={})
    assert r.status_code == 409  # INV-10：暂停禁止新批次
    client.post(f"/api/tasks/{task['id']}/status", json={"status": "active"})
    r2 = client.post(f"/api/tasks/{task['id']}/runs", json={})
    assert r2.status_code == 202
    _wait_task_run(r2.json()["taskRunId"])


# ---------- P0-06：非法结构化输出不得落正式结果 ----------

def test_taskrun_invalid_schema_output_fails_run_without_result():
    """create-record 组装的输出违反 QualityEvaluation Schema → Run 失败、无 QR。"""
    wf = client.post("/api/workflows", json={"name": "p0-b2-bad-schema"}).json()
    d = client.get(f"/api/workflows/{wf['id']}").json()["definition"]
    start = next(n for n in d["graph"]["nodes"] if n["type"] == "input")
    end = next(n for n in d["graph"]["nodes"] if n["type"] == "end")
    d["graph"]["nodes"].append({"id": "n_cr", "type": "create-record", "name": "落质检",
                                "config": {}, "inputs": [
        {"name": "score", "type": "string",
         "source": {"kind": "fixed", "value": "not-a-number"}},  # 类型非法
        {"name": "summary", "type": "string",
         "source": {"kind": "fixed", "value": "x"}},
        # 缺 risk/issues 必填
    ]})
    d["graph"]["edges"] = [e for e in d["graph"]["edges"]
                           if not (e["source"] == start["id"] and e["target"] == end["id"])]
    d["graph"]["edges"] += [{"id": "e1", "source": start["id"], "target": "n_cr"},
                            {"id": "e2", "source": "n_cr", "target": end["id"]}]
    client.put(f"/api/workflows/{wf['id']}/draft",
               json={"definition": d, "baseRevision": d["workflow"]["draftRevision"]})
    pub = client.post(f"/api/workflows/{wf['id']}/publish").json()
    asset = client.post("/api/data-assets", json={"name": "bad-schema-asset", "rows": [
        {"interactionId": "BAD-1", "text": "a"},
        {"interactionId": "BAD-2", "text": "b"}]}).json()
    task = _mk_task("B2 非法输出任务", wf["id"], pub["versionId"], asset["id"])
    r = client.post(f"/api/tasks/{task['id']}/runs", json={}).json()
    tr = _wait_task_run(r["taskRunId"])
    assert tr["status"] == "failed"
    assert tr["succeeded"] == 0 and tr["failed"] == 2
    # INV-06：无正式 QualityResult
    qrs = client.get(f"/api/task-runs/{r['taskRunId']}/results").json()["items"]
    assert qrs == []
    runs = client.get(f"/api/task-runs/{r['taskRunId']}/runs").json()["items"]
    assert all(x["status"] == "failed" for x in runs)
    assert all("SCHEMA" in (x.get("error") or {}).get("code", "")
               or "schema" in (x.get("error") or {}).get("message", "").lower()
               for x in runs)


# ---------- 数据源不可用：批次失败关闭（P0-03/M-11） ----------

def test_taskrun_unavailable_source_fails_before_running():
    wid, wvid = _quality_wf("p0-b2-wf-src")
    from app.models import Connection, Datasource
    db = SessionLocal()
    try:
        conn = Connection(name="dead-conn", kind="basic", protocol="postgresql",
                          endpoint={"host": "127.0.0.1", "port": 59999, "user": "rivers"},
                          secret_ref="")
        db.add(conn)
        db.flush()
        ds = Datasource(name="dead-ds", type="postgresql", connection_id=conn.id,
                        location="wf_test")
        db.add(ds)
        db.commit()
        asset = client.post("/api/data-assets", json={
            "name": "dead-source-asset", "source": "datasource",
            "datasourceId": ds.id, "location": "no_such_table", "rows": []}).json()
    finally:
        db.close()
    task = _mk_task("B2 数据源不可用任务", wid, wvid, asset["id"])
    r = client.post(f"/api/tasks/{task['id']}/runs", json={})
    assert r.status_code in (422, 502)  # 启动即失败，不得产生任何批次/结果
    runs = client.get(f"/api/tasks/{task['id']}/runs").json()["items"]
    assert runs == []
