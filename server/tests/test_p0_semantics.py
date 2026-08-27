"""09-SDD P0-B1 冻结语义——目标契约测试（先红后绿）。

覆盖：
- P0-02 Task↔Workflow 绑定命名（公开契约无 agentId 承载 workflowId）
- P0-04 TaskVersion/DataSnapshot/TaskRun 实体与 API 契约（09 §9/§10.1）
- P0-07 ResultRuleVersion 不可变；发布不全库重算
- P0-06 QualityEvaluation Schema 种子与校验器
- INV-01/02/03/08 的数据库不变量（唯一约束 + 只追加复核）

本文件在实现前应全红（ImportError/404/断言失败），实现后全绿。
"""
import time

import pytest
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.models import (AnalysisTask, AnalysisTaskVersion, QualityResult, Run,
                        TaskRun)
from app.runner import start_worker
from tests._quality_setup import (make_definition_version, make_quality_workflow,
                                  make_rule_version)

client = TestClient(app)
_worker = start_worker()  # 消费 job_queue，使 Run 能到终态


# ---------- 公共 fixture 构造 ----------

def _published_wf(name="p0-wf"):
    wf = client.post("/api/workflows", json={"name": name}).json()
    pub = client.post(f"/api/workflows/{wf['id']}/publish").json()
    return wf["id"], pub["versionId"]


def _wait_run_terminal(run_id: str, timeout: float = 15.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        r = client.get(f"/api/runs/{run_id}").json()
        if r.get("status") in ("succeeded", "failed", "cancelled"):
            return r
        time.sleep(0.2)
    raise AssertionError(f"run {run_id} 未在 {timeout}s 内到终态")


def _run_create_record_flow() -> tuple[str, str, dict]:
    """input → create-record(score 固定 90) → end，执行并取回 QualityResult。"""
    wf = client.post("/api/workflows", json={"name": "p0-sink"}).json()
    d = client.get(f"/api/workflows/{wf['id']}").json()["definition"]
    start = next(n for n in d["graph"]["nodes"] if n["type"] == "input")
    end = next(n for n in d["graph"]["nodes"] if n["type"] == "end")
    d["graph"]["nodes"].append({"id": "n_cr", "type": "create-record", "name": "落质检",
                                "config": {}, "inputs": [
        {"name": "score", "type": "number", "source": {"kind": "fixed", "value": 90}},
        {"name": "summary", "type": "string", "source": {"kind": "fixed", "value": "ok"}},
    ]})
    d["graph"]["edges"] = [e for e in d["graph"]["edges"]
                           if not (e["source"] == start["id"] and e["target"] == end["id"])]
    d["graph"]["edges"] += [{"id": "e1", "source": start["id"], "target": "n_cr"},
                            {"id": "e2", "source": "n_cr", "target": end["id"]}]
    client.put(f"/api/workflows/{wf['id']}/draft",
               json={"definition": d, "baseRevision": d["workflow"]["draftRevision"]})
    run = client.post("/api/runs", json={"workflowId": wf["id"], "trigger": "test",
                                         "input": {"interactionId": "P0-IX-1"}}).json()
    _wait_run_terminal(run["runId"])
    db = SessionLocal()
    try:
        qr = db.query(QualityResult).filter_by(run_id=run["runId"]).first()
        assert qr is not None, "create-record 未产生 QualityResult"
        return wf["id"], run["runId"], {"id": qr.id, "runId": qr.run_id, "score": qr.score}
    finally:
        db.close()


def _asset(name="p0-asset", rows=None) -> str:
    a = client.post("/api/data-assets", json={
        "name": name,
        "rows": rows or [{"interactionId": "A1", "text": "x"},
                         {"interactionId": "A2", "text": "y"}]}).json()
    return a["id"]


# ---------- P0-02 / P0-04：Task 创建返回已解析 TaskVersion（09 §10.1） ----------

def test_task_create_returns_resolved_task_version():
    wid, wvid = make_quality_workflow(client)
    asset_id = _asset("tv-create")
    defv = make_definition_version(client, asset_id)
    rules = client.post("/api/result-rules", json={"name": "tv-rules", "rules": {}}).json()
    rpv = client.post(f"/api/result-rules/{rules['id']}/publish").json()["ruleVersionId"]
    body = {
        "name": "P0 任务", "description": "09-SDD §10.1",
        "workflowId": wid,
        "workflowVersionPolicy": "pinned",
        "pinnedWorkflowVersionId": wvid,
        "dataAssetId": asset_id,
        "dataDefinitionVersionId": defv,
        "resultRuleVersionId": rpv,
        "inputMapping": {"interactionId": "id", "text": "content"},
        "scope": {"op": "and", "conditions": []},
        "sampling": {"mode": "all"},
        "dataWindow": {"mode": "relative", "value": "previous_day", "timezone": "Asia/Shanghai"},
    }
    r = client.post("/api/tasks", json=body)
    assert r.status_code == 201, r.text
    t = r.json()
    assert t["workflowId"] == wid  # P0-02：workflow 命名
    tv = t["taskVersion"]
    assert tv["versionNo"] == 1
    assert tv["workflowId"] == wid
    assert tv["workflowVersionPolicy"] == "pinned"
    assert tv["pinnedWorkflowVersionId"] == wvid
    assert tv["dataAssetId"] == asset_id
    assert tv["resultRuleVersionId"] == rpv
    assert tv["inputMapping"] == {"interactionId": "id", "text": "content"}
    assert tv["sampling"] == {"mode": "all"}
    assert tv["dataWindow"]["value"] == "previous_day"
    assert tv["outputSchemaVersion"]  # D09-3：必须绑定输出 Schema 版本
    # 服务端快照可回读（确认页用返回快照渲染，§5.2）
    g = client.get(f"/api/tasks/{t['id']}").json()
    assert g["workflowId"] == wid
    assert g["taskVersion"]["versionNo"] == 1
    assert g["taskVersion"]["resultRuleVersionId"] == rpv
    assert g["status"] == "active"


def test_task_create_validation_rejects_bad_refs():
    wid, _ = _published_wf("p0-wf-bad")
    asset_id = _asset("tv-bad")
    # 缺 workflow
    r = client.post("/api/tasks", json={"name": "x", "workflowId": "no-such",
                                        "dataAssetId": asset_id})
    assert r.status_code in (404, 422)
    # pinned 策略必须给真实版本
    r2 = client.post("/api/tasks", json={"name": "x", "workflowId": wid,
                                         "workflowVersionPolicy": "pinned",
                                         "pinnedWorkflowVersionId": "no-such",
                                         "dataAssetId": asset_id})
    assert r2.status_code == 422
    # 不存在的 RuleVersion
    r3 = client.post("/api/tasks", json={"name": "x", "workflowId": wid,
                                         "workflowVersionPolicy": "latest_published",
                                         "dataAssetId": asset_id,
                                         "resultRuleVersionId": "no-such"})
    assert r3.status_code == 422


def test_task_create_accepts_legacy_flat_fields_with_visible_snapshot():
    """旧前端扁平契约的确定性转换（不得静默丢弃；返回快照可审计，09 §5.2）。"""
    wid, wvid = make_quality_workflow(client, "p0-wf-legacy")
    asset_id = _asset("tv-legacy")
    defv = make_definition_version(client, asset_id)
    rpv = make_rule_version(client)
    r = client.post("/api/tasks", json={"name": "legacy", "workflowId": wid,
                                        "workflowVersionPolicy": "pinned",
                                        "pinnedWorkflowVersionId": wvid,
                                        "dataAssetId": asset_id,
                                        "dataDefinitionVersionId": defv,
                                        "resultRuleVersionId": rpv,
                                        "sampling": "first_5", "dataWindow": "last_7d",
                                        "scope": "all"})
    assert r.status_code == 201, r.text
    tv = r.json()["taskVersion"]
    assert tv["sampling"] == {"mode": "count", "count": 5}
    assert tv["dataWindow"]["mode"] == "relative" and tv["dataWindow"]["value"] == "last_7d"
    assert tv["scope"] == {"op": "and", "conditions": []}


def test_task_list_exposes_workflow_naming():
    wid, wvid = make_quality_workflow(client, "p0-wf-list")
    asset_id = _asset("tv-list")
    defv = make_definition_version(client, asset_id)
    rpv = make_rule_version(client)
    t = client.post("/api/tasks", json={"name": "列表任务", "workflowId": wid,
                                        "workflowVersionPolicy": "pinned",
                                        "pinnedWorkflowVersionId": wvid,
                                        "dataAssetId": asset_id,
                                        "dataDefinitionVersionId": defv,
                                        "resultRuleVersionId": rpv}).json()
    items = client.get("/api/tasks").json()["items"]
    mine = next(x for x in items if x["id"] == t["id"])
    assert mine["workflowId"] == wid
    assert "workflowVersionPolicy" in mine
    # 09 P0-02：公开契约不得再以 agentId 承载 workflowId
    assert "agentId" not in mine


# ---------- P0-04：TaskVersion 不可变历史 ----------

def test_task_update_creates_new_immutable_version():
    wid, _wvid = make_quality_workflow(client, "p0-wf-ver")
    asset_id = _asset("tv-ver")
    defv = make_definition_version(client, asset_id)
    rpv = make_rule_version(client)
    t = client.post("/api/tasks", json={"name": "版本任务", "workflowId": wid,
                                        "workflowVersionPolicy": "latest_published",
                                        "dataAssetId": asset_id,
                                        "dataDefinitionVersionId": defv,
                                        "resultRuleVersionId": rpv}).json()
    u = client.put(f"/api/tasks/{t['id']}",
                   json={"sampling": {"mode": "count", "count": 5}}).json()
    assert u["taskVersion"]["versionNo"] == 2
    assert u["taskVersion"]["sampling"] == {"mode": "count", "count": 5}
    vs = client.get(f"/api/tasks/{t['id']}/versions").json()["items"]
    nos = sorted(v["versionNo"] for v in vs)
    assert nos == [1, 2]
    v1 = next(v for v in vs if v["versionNo"] == 1)
    assert v1["sampling"] == {"mode": "all"}  # 旧版本不被覆盖
    v2 = next(v for v in vs if v["versionNo"] == 2)
    assert v2["workflowId"] == wid  # 未提交字段继承自上一版本


# ---------- P0-07：ResultRuleVersion 不可变 + 发布不全库重算 ----------

def test_rule_publish_freezes_version_and_scopes_effect():
    """P0-07 核心：发布冻结不可变版本；存量结果发布前后分毫不动；新结果绑新版本。
    断言全部相对化（发布前快照对比），不依赖共享库里其他测试发布的规则。"""
    _wid, _run_id, qr_before = _run_create_record_flow()
    det0 = client.get(f"/api/quality-results/{qr_before['id']}").json()
    rules = client.post("/api/result-rules", json={"name": "p0-rule", "rules": {
        "scoreRules": [{"id": "s1", "field": "score", "op": "gt", "value": 1000, "weight": 50}],
        "issueRules": []}}).json()
    pub = client.post(f"/api/result-rules/{rules['id']}/publish").json()
    assert pub.get("ruleVersionId"), "发布必须返回不可变版本 ID"
    assert pub["version"] >= 1
    assert not pub.get("recalculated"), "发布不得再全库重算"
    # 存量结果不受新规则影响：发布前后 score / ruleVersionId 完全一致
    det = client.get(f"/api/quality-results/{qr_before['id']}").json()
    assert det["score"] == det0["score"]
    assert det.get("ruleVersionId") == det0.get("ruleVersionId")
    assert det["aiResult"] == det0["aiResult"]
    # 草稿修改后再发布 → 独立新版本快照，旧版本不被修改
    client.put(f"/api/result-rules/{rules['id']}",
               json={"rules": {"scoreRules": [], "issueRules": []}})
    pub2 = client.post(f"/api/result-rules/{rules['id']}/publish").json()
    assert pub2["version"] == pub["version"] + 1
    assert pub2["ruleVersionId"] != pub["ruleVersionId"]
    vs = client.get(f"/api/result-rules/{rules['id']}/versions").json()["items"]
    v1 = next(v for v in vs if v["id"] == pub["ruleVersionId"])
    assert len(v1["rules"]["scoreRules"]) == 1  # 先发布快照不被后续草稿修改
    # 发布后新建的结果绑定最新冻结 RuleVersion
    _w2, _r2, qr_after = _run_create_record_flow()
    det2 = client.get(f"/api/quality-results/{qr_after['id']}").json()
    assert det2["ruleVersionId"] == pub2["ruleVersionId"]


# ---------- P0-06 / D09-3：QualityEvaluation Schema ----------

def test_quality_evaluation_schema_seeded_and_validates():
    from app.output_schema import latest_quality_schema, validate_evaluation
    row = latest_quality_schema()
    assert row is not None and row.key == "quality_evaluation" and row.version_no >= 1
    schema = row.schema_
    assert set(schema["required"]) >= {"score", "risk", "issues", "summary"}
    ok, errs = validate_evaluation({"score": 80, "risk": "Low", "issues": [], "summary": "fine"})
    assert ok and not errs
    ok, errs = validate_evaluation({"score": "not-a-number", "risk": "Low",
                                    "issues": [], "summary": "x"})
    assert not ok and errs
    ok, errs = validate_evaluation({"risk": "Low"})  # 缺必填
    assert not ok and errs
    ok, errs = validate_evaluation({"score": 10, "risk": "UnknownRisk",
                                    "issues": [], "summary": "x"})  # 枚举越界
    assert not ok


# ---------- P0-07 / INV-08：复核只追加，AI 原始结果不可变 ----------

def test_review_revision_append_only_and_ai_result_immutable():
    """INV-08：ai_result=创建时冻结的 AI 值（含当时规则派生）；
    人工修订只改生效值并追加 ReviewRevision。断言相对化，不假设无规则环境。"""
    _wid, _run_id, qr = _run_create_record_flow()
    base = client.get(f"/api/quality-results/{qr['id']}").json()
    ai_score = base["aiResult"]["score"]
    assert ai_score is not None
    new_score = float(ai_score) - 30
    # 09 P0-10（审计）：尝试用请求体伪造 reviewer，应被忽略（以鉴权身份为准；
    # 开发匿名环境身份=dev）
    r1 = client.post(f"/api/quality-results/{qr['id']}/review",
                     json={"action": "revise", "score": new_score,
                           "reviewer": "qa-alice-forged", "note": "降级"}).json()
    assert r1["review"] == "REVIEWED"
    det = client.get(f"/api/quality-results/{qr['id']}").json()
    assert det["score"] == new_score                # 生效值=人工修订
    assert det["aiResult"] == base["aiResult"]      # AI 原始值不可变
    revs = det["reviewRevisions"]
    assert len(revs) == 1
    assert revs[0]["action"] == "revise"
    assert revs[0]["reviewer"] == "dev"             # 来自身份，忽略伪造的 qa-alice
    assert revs[0]["before"]["score"] == ai_score
    assert revs[0]["after"]["score"] == new_score
    # 再次修订 → revision 追加，不覆盖第一条
    client.post(f"/api/quality-results/{qr['id']}/review",
                json={"action": "revise", "score": new_score + 10, "reviewer": "qa-bob"})
    det2 = client.get(f"/api/quality-results/{qr['id']}").json()
    assert len(det2["reviewRevisions"]) == 2
    assert det2["aiResult"] == base["aiResult"]


# ---------- 数据库不变量：INV-01 / INV-02 / INV-03 ----------

def _mk_taskrun_chain(db):
    t = AnalysisTask(name="inv-task", workflow_id="wf-x", data_asset_id="asset-x")
    db.add(t)
    db.flush()
    tv = AnalysisTaskVersion(task_id=t.id, version_no=1, workflow_id="wf-x",
                             data_asset_id="asset-x")
    db.add(tv)
    db.flush()
    tr = TaskRun(task_id=t.id, task_version_id=tv.id, trigger="manual")
    db.add(tr)
    db.flush()
    return t, tv, tr


def test_inv03_latest_result_per_run_unique():
    _wid, run_id, _qr = _run_create_record_flow()
    db = SessionLocal()
    try:
        db.add(QualityResult(run_id=run_id, is_latest=True, interaction_ref="dup"))
        with pytest.raises(Exception):  # IntegrityError：latest 唯一
            db.flush()
        db.rollback()
        # 谱系行（is_latest=false）允许
        db.add(QualityResult(run_id=run_id, is_latest=False, interaction_ref="dup"))
        db.commit()
    finally:
        db.close()


def test_inv01_taskrun_requires_version_and_fire_key_unique():
    db = SessionLocal()
    try:
        _t, _tv, tr = _mk_taskrun_chain(db)
        tr.schedule_fire_key = "sch1:2026-08-27T00:00"
        db.flush()
        t2 = db.get(AnalysisTask, tr.task_id)
        tv2 = db.query(AnalysisTaskVersion).filter_by(task_id=t2.id).first()
        dup = TaskRun(task_id=t2.id, task_version_id=tv2.id, trigger="schedule",
                      schedule_fire_key="sch1:2026-08-27T00:00")
        db.add(dup)
        with pytest.raises(Exception):  # IntegrityError：fire key 唯一
            db.flush()
        db.rollback()
    finally:
        db.close()


def test_inv02_run_interaction_unique_within_taskrun():
    db = SessionLocal()
    try:
        _t, tv, tr = _mk_taskrun_chain(db)
        # workflow_id 走真实外键：临时建一个最小 workflow
        from app.models import Workflow
        wf = Workflow(name="inv-wf")
        db.add(wf)
        db.flush()
        r1 = Run(workflow_id=wf.id, trigger="batch", status="queued",
                 task_run_id=tr.id, task_version_id=tv.id,
                 interaction_ref="IX-1", attempt=1)
        db.add(r1)
        db.flush()
        r2 = Run(workflow_id=wf.id, trigger="batch", status="queued",
                 task_run_id=tr.id, task_version_id=tv.id,
                 interaction_ref="IX-1", attempt=1)
        db.add(r2)
        with pytest.raises(Exception):  # IntegrityError：(task_run, ref, attempt) 唯一
            db.flush()
        db.rollback()
    finally:
        db.close()


# ---------- P0-04：Definition 版本化（DataSnapshot 依赖） ----------

def test_definition_publish_creates_immutable_version():
    asset_id = _asset("def-asset")
    d = client.post("/api/data-definitions", json={
        "name": "p0-def", "assetId": asset_id,
        "fieldSchema": [{"key": "interactionId", "type": "string"},
                        {"key": "text", "type": "string"}]}).json()
    p1 = client.post(f"/api/data-definitions/{d['id']}/publish").json()
    assert p1.get("versionId") and p1["versionNo"] == 1
    # 草稿修改后再发布 → v2；v1 快照不受影响
    client.put(f"/api/data-definitions/{d['id']}",
               json={"fieldSchema": [{"key": "interactionId", "type": "string"}]})
    p2 = client.post(f"/api/data-definitions/{d['id']}/publish").json()
    assert p2["versionNo"] == 2 and p2["versionId"] != p1["versionId"]
    vs = client.get(f"/api/data-definitions/{d['id']}/versions").json()["items"]
    v1 = next(v for v in vs if v["versionNo"] == 1)
    assert len(v1["fieldSchema"]) == 2
