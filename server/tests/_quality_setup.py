"""09-SDD P0 修复轮：质检任务测试公共构件。

提供"合规质检工作流 + 已发布定义版本 + 已发布规则版本"构件，
供测试组装满足新校验（定义版本必填 / 规则绑定 / 工作流含 create-record）的任务。
"""
import uuid

CREATE_RECORD_INPUTS = [
    {"name": "score", "type": "number", "source": {"kind": "input", "path": "score"}},
    {"name": "risk", "type": "string", "source": {"kind": "input", "path": "risk"}},
    {"name": "issues", "type": "array", "source": {"kind": "input", "path": "issues"}},
    {"name": "summary", "type": "string", "source": {"kind": "input", "path": "summary"}},
]

MAPPING = {"interactionId": "interactionId", "score": "score", "risk": "risk",
           "issues": "issues", "summary": "summary"}


def make_quality_workflow(client, name=None) -> tuple[str, str]:
    """创建并发布一个产出质检结果的工作流（input → create-record）。返回 (wf_id, version_id)。"""
    name = name or f"P0Q-{uuid.uuid4().hex[:6]}"
    wf = client.post("/api/workflows", json={"name": name}).json()
    d = client.get(f"/api/workflows/{wf['id']}").json()
    defn = d["definition"]
    defn["graph"]["nodes"] = [
        {"id": "n_start", "type": "input", "name": "开始", "config": {}, "inputs": []},
        {"id": "n_rec", "type": "create-record", "name": "落质检",
         "config": {"outputKey": "quality_result"}, "inputs": CREATE_RECORD_INPUTS},
    ]
    defn["graph"]["edges"] = [{"id": "e1", "source": "n_start", "target": "n_rec"}]
    r = client.put(f"/api/workflows/{wf['id']}/draft",
                   json={"definition": defn, "baseRevision": d["draftRevision"]})
    assert r.status_code == 200, r.text
    pub = client.post(f"/api/workflows/{wf['id']}/publish", json={})
    assert pub.status_code == 201, pub.text
    return wf["id"], pub.json()["versionId"]


def make_definition_version(client, asset_id: str, name=None) -> str:
    """为资产创建并发布一个数据定义版本，返回 definition_version_id。"""
    name = name or f"P0D-{uuid.uuid4().hex[:6]}"
    d = client.post("/api/data-definitions", json={
        "name": name, "assetId": asset_id,
        "fieldSchema": [
            {"key": "interactionId", "type": "String", "required": True},
            {"key": "score", "type": "Number", "required": False},
            {"key": "risk", "type": "String", "required": False},
            {"key": "issues", "type": "Array", "required": False},
            {"key": "summary", "type": "String", "required": False},
        ]}).json()
    pub = client.post(f"/api/data-definitions/{d['id']}/publish", json={})
    assert pub.status_code == 200, pub.text
    return pub.json()["versionId"]


def make_rule_set_with_version(client, name=None) -> tuple[str, str]:
    """创建并发布一个规则集，返回 (rule_set_id, rule_version_id)。"""
    name = name or f"P0R-{uuid.uuid4().hex[:6]}"
    r = client.post("/api/result-rules", json={
        "name": name, "rules": {"scoreRules": [], "issueRules": []}}).json()
    pub = client.post(f"/api/result-rules/{r['id']}/publish", json={})
    assert pub.status_code == 200, pub.text
    return r["id"], pub.json()["ruleVersionId"]


def make_rule_version(client, name=None) -> str:
    """创建并发布一个规则版本，返回 rule_version_id。"""
    return make_rule_set_with_version(client, name)[1]


def make_asset(client, rows, name=None) -> str:
    name = name or f"P0A-{uuid.uuid4().hex[:6]}"
    a = client.post("/api/data-assets", json={"name": name, "rows": rows,
                                              "timeField": "interactionTime"}).json()
    return a["id"]


def make_quality_task(client, rows=None, wf=None, defv=None, rulev=None,
                      rule_policy=None, extra=None, name=None) -> dict:
    """组装满足新校验的完整质检任务并创建，返回 create 响应。

    缺省自动创建合规工作流/定义版本/规则版本。"""
    rows = rows if rows is not None else [
        {"interactionId": "Q1", "score": 90, "risk": "Low", "issues": [], "summary": "ok"}]
    asset_id = make_asset(client, rows)
    wf_id, wv_id = wf or make_quality_workflow(client)
    defv = defv or make_definition_version(client, asset_id)
    body = {
        "name": name or f"P0T-{uuid.uuid4().hex[:6]}",
        "workflowId": wf_id,
        "workflowVersionPolicy": "pinned",
        "pinnedWorkflowVersionId": wv_id,
        "dataAssetId": asset_id,
        "dataDefinitionVersionId": defv,
        "inputMapping": MAPPING,
        "sampling": {"mode": "all"},
        "dataWindow": {"mode": "all"},
    }
    if rule_policy == "follow_latest":
        body["rulePolicy"] = "follow_latest"
        # 09 闭环修复：follow_latest 需显式 RuleSet 作用域
        set_id, _v = make_rule_set_with_version(client)
        body["resultRuleSetId"] = set_id
    else:
        body["resultRuleVersionId"] = rulev or make_rule_version(client)
    if extra:
        body.update(extra)
    r = client.post("/api/tasks", json=body)
    assert r.status_code == 201, r.text
    return r.json()
