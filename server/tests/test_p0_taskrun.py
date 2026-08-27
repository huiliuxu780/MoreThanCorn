"""09-SDD P0-B2 + 修复轮：TaskRun 执行链（P0-04/05/06/08 + INV-01..07）。

修复轮口径（审计反例 3）：
- N 输入 = N Run（含空 ID/重复 ID 的明确 rejected/failed Run），合法样本各产一条结果；
- 成功 Run 必须恰好一条生效 QualityResult，否则判失败；
- 任务创建强制：定义版本必填 + 规则绑定 + 工作流含 create-record。
"""
import time

from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.runner import start_worker
from tests._quality_setup import (MAPPING, make_asset, make_definition_version,
                                  make_quality_workflow, make_rule_set_with_version,
                                  make_rule_version)

client = TestClient(app)
_worker = start_worker()


def _wait_task_run(trid: str, timeout: float = 40.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        r = client.get(f"/api/task-runs/{trid}").json()
        if r.get("status") in ("succeeded", "partial", "failed", "cancelled"):
            return r
        time.sleep(0.3)
    raise AssertionError(f"task-run {trid} 未在 {timeout}s 内到终态")


def _mk_valid_task(rows, **task_over) -> dict:
    """组装满足新校验的任务（定义版本+规则+合规工作流）并返回 create 响应。"""
    asset_id = make_asset(client, rows)
    wf_id, wv_id = make_quality_workflow(client)
    defv = make_definition_version(client, asset_id)
    rulev = make_rule_version(client)
    body = {"name": task_over.get("name", "P0-taskrun"),
            "workflowId": wf_id, "workflowVersionPolicy": "pinned",
            "pinnedWorkflowVersionId": wv_id, "dataAssetId": asset_id,
            "dataDefinitionVersionId": defv, "resultRuleVersionId": rulev,
            "inputMapping": MAPPING, "sampling": {"mode": "all"},
            "dataWindow": {"mode": "all"}}
    body.update({k: v for k, v in task_over.items() if k != "name"})
    r = client.post("/api/tasks", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def _rows_score_risk(n: int):
    return [{"interactionId": f"N{i}", "score": 90, "risk": "Low",
             "issues": [], "summary": f"s{i}"} for i in range(n)]


def test_task_create_requires_definition_and_rule():
    """修复轮：缺定义版本 / 缺规则绑定 / 工作流无 create-record 都应拒绝。"""
    wf_id, wv_id = make_quality_workflow(client)
    rows = _rows_score_risk(1)
    asset_id = make_asset(client, rows)
    rulev = make_rule_version(client)
    base = {"name": "x", "workflowId": wf_id, "workflowVersionPolicy": "pinned",
            "pinnedWorkflowVersionId": wv_id, "dataAssetId": asset_id,
            "resultRuleVersionId": rulev, "inputMapping": MAPPING}
    # 缺定义版本 → 422
    r = client.post("/api/tasks", json={k: v for k, v in base.items()})
    assert r.status_code == 422, f"缺定义版本应拒绝（{r.status_code}）"
    # 缺规则绑定且未声明 follow_latest → 422
    defv = make_definition_version(client, asset_id)
    body2 = {**base, "dataDefinitionVersionId": defv}
    del body2["resultRuleVersionId"]
    r2 = client.post("/api/tasks", json=body2)
    assert r2.status_code == 422, f"缺规则绑定应拒绝（{r2.status_code}）"
    # 工作流无 create-record → 422
    plain = client.post("/api/workflows", json={"name": "no-cr"}).json()
    d = client.get(f"/api/workflows/{plain['id']}").json()
    defn = d["definition"]  # 默认 input→end，无 create-record
    client.put(f"/api/workflows/{plain['id']}/draft",
               json={"definition": defn, "baseRevision": d["draftRevision"]})
    pub = client.post(f"/api/workflows/{plain['id']}/publish", json={})
    assert pub.status_code == 201
    body3 = {**base, "dataDefinitionVersionId": defv, "resultRuleVersionId": rulev,
             "workflowId": plain["id"], "pinnedWorkflowVersionId": pub.json()["versionId"]}
    r3 = client.post("/api/tasks", json=body3)
    assert r3.status_code == 422, f"无 create-record 工作流应拒绝（{r3.status_code}）"


def test_n_equals_n_runs_including_rejected():
    """4 合法 + 1 重复 + 1 空 ID = 6 输入 → 6 Run（4 成功 + 2 失败）→ 4 结果。"""
    rows = _rows_score_risk(4)
    rows.append({"interactionId": "N0", "score": 90, "risk": "Low", "issues": [], "summary": "dup"})
    rows.append({"score": 90, "risk": "Low", "issues": [], "summary": "no-id"})
    task = _mk_valid_task(rows)
    start = client.post(f"/api/tasks/{task['id']}/runs", json={})
    assert start.status_code == 202, start.text
    tr = _wait_task_run(start.json()["taskRunId"])
    assert tr["total"] == 6, tr
    assert tr["succeeded"] == 4, tr
    assert tr["failed"] == 2, tr
    runs = client.get(f"/api/task-runs/{tr['id']}/runs").json()["items"]
    assert len(runs) == 6, f"N 输入应产生 N Run（实际 {len(runs)}）"
    failed_msgs = [r["error"]["message"] for r in runs if r["status"] == "failed"]
    assert any("DUPLICATE_INTERACTION_REF" in m for m in failed_msgs)
    assert any("EMPTY_INTERACTION_REF" in m for m in failed_msgs)
    results = client.get(f"/api/task-runs/{tr['id']}/results").json()["items"]
    assert len(results) == 4, f"4 个合法样本应产生 4 结果（实际 {len(results)}）"
    assert len({r["interactionRef"] for r in results}) == 4


def test_successful_run_must_have_unique_result():
    """修复轮反例 3：成功 Run 若无结果必须判失败（用无 create-record 已被任务创建拦截，
    此处验证正常链路每成功 Run 恰一条结果）。"""
    task = _mk_valid_task(_rows_score_risk(3))
    start = client.post(f"/api/tasks/{task['id']}/runs", json={})
    tr = _wait_task_run(start.json()["taskRunId"])
    assert tr["succeeded"] == 3 and tr["failed"] == 0
    results = client.get(f"/api/task-runs/{tr['id']}/results").json()["items"]
    assert len(results) == 3
    # 每结果 run_id 唯一（INV-03）
    assert len({r["runId"] for r in results}) == 3


def test_traceability_fields_non_null():
    """P0-08：结果追踪字段（TaskRun/WorkflowVersion/RuleVersion）非空可反查。"""
    task = _mk_valid_task(_rows_score_risk(2))
    start = client.post(f"/api/tasks/{task['id']}/runs", json={})
    tr = _wait_task_run(start.json()["taskRunId"])
    results = client.get(f"/api/task-runs/{tr['id']}/results").json()["items"]
    assert results
    for r in results:
        assert r["taskRunId"] == tr["id"]
        assert r["workflowVersionId"], "workflowVersionId 非空"
        assert r["ruleVersionId"], "ruleVersionId 非空（INV-05）"
        assert r["interactionRef"], "interactionRef 非空（INV-04）"


def test_follow_latest_rule_policy():
    """follow_latest：批次启动解析最新发布规则版本；无已发布规则则启动失败。"""
    rows = _rows_score_risk(1)
    asset_id = make_asset(client, rows)
    wf_id, wv_id = make_quality_workflow(client)
    defv = make_definition_version(client, asset_id)
    set_id, ver_id = make_rule_set_with_version(client)  # 本任务跟随的规则集
    body = {"name": "follow", "workflowId": wf_id, "workflowVersionPolicy": "pinned",
            "pinnedWorkflowVersionId": wv_id, "dataAssetId": asset_id,
            "dataDefinitionVersionId": defv, "rulePolicy": "follow_latest",
            "resultRuleSetId": set_id,
            "inputMapping": MAPPING, "sampling": {"mode": "all"}, "dataWindow": {"mode": "all"}}
    r = client.post("/api/tasks", json=body)
    assert r.status_code == 201, r.text
    # 09 闭环修复（P1-3）：发布另一个规则集不应串用——解析仍应落在本集版本
    make_rule_version(client, name="other-set")
    start = client.post(f"/api/tasks/{r.json()['id']}/runs", json={})
    assert start.status_code == 202, start.text
    assert start.json()["resolvedVersions"]["ruleVersionId"] == ver_id, \
        "follow_latest 应解析本规则集最新版本，不串用他集"
    tr = _wait_task_run(start.json()["taskRunId"])
    assert tr["succeeded"] == 1


def test_follow_latest_requires_rule_set_scope():
    """09 闭环修复（P1-3）：follow_latest 未声明 RuleSet 作用域 → 422。"""
    rows = _rows_score_risk(1)
    asset_id = make_asset(client, rows)
    wf_id, wv_id = make_quality_workflow(client)
    defv = make_definition_version(client, asset_id)
    body = {"name": "follow-noscope", "workflowId": wf_id, "workflowVersionPolicy": "pinned",
            "pinnedWorkflowVersionId": wv_id, "dataAssetId": asset_id,
            "dataDefinitionVersionId": defv, "rulePolicy": "follow_latest",
            "inputMapping": MAPPING, "sampling": {"mode": "all"}, "dataWindow": {"mode": "all"}}
    r = client.post("/api/tasks", json=body)
    assert r.status_code == 422, "follow_latest 缺 resultRuleSetId 必须 422"


def test_idempotency_key_returns_same_run():
    import uuid
    task = _mk_valid_task(_rows_score_risk(1))
    key = f"p0-idem-{uuid.uuid4().hex}"  # 唯一键：避免共享库残留旧 TaskRun 干扰
    s1 = client.post(f"/api/tasks/{task['id']}/runs", json={}, headers={"Idempotency-Key": key})
    s2 = client.post(f"/api/tasks/{task['id']}/runs", json={}, headers={"Idempotency-Key": key})
    assert s1.status_code == 202 and s2.status_code == 202
    assert s1.json()["taskRunId"] == s2.json()["taskRunId"]
    runs = client.get(f"/api/tasks/{task['id']}/runs").json()["items"]
    assert len([x for x in runs if x["idempotencyKey"] == key]) == 1


def test_paused_task_rejected():
    task = _mk_valid_task(_rows_score_risk(1))
    client.post(f"/api/tasks/{task['id']}/status", json={"status": "paused"})
    r = client.post(f"/api/tasks/{task['id']}/runs", json={})
    assert r.status_code == 409, f"paused 任务应拒绝启动（{r.status_code}）"
    client.post(f"/api/tasks/{task['id']}/status", json={"status": "active"})


def test_invalid_schema_output_fails_run():
    """非法结构化输出（risk 枚举越界）→ Run 失败，不产生结果。"""
    rows = [{"interactionId": "BAD1", "score": 90, "risk": "NotARisk",
             "issues": [], "summary": "x"}]
    task = _mk_valid_task(rows)
    start = client.post(f"/api/tasks/{task['id']}/runs", json={})
    tr = _wait_task_run(start.json()["taskRunId"])
    assert tr["succeeded"] == 0 and tr["failed"] == 1
    results = client.get(f"/api/task-runs/{tr['id']}/results").json()["items"]
    assert results == [], "非法 Schema 不得产生结果"
    runs = client.get(f"/api/task-runs/{tr['id']}/runs").json()["items"]
    assert runs[0]["status"] == "failed"
    assert "OUTPUT_SCHEMA_INVALID" in runs[0]["error"]["message"]
