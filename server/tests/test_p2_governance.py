"""09-SDD P2-08：发布治理——版本 Diff / 审批 / Canary / 发布 / 回滚 / 变更审计。

覆盖 workflow|rule|definition|task 的 ReleaseRequest 状态机：
pending → approved|rejected → released（可 canary）→ promoted / rolled_back。
"""
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app

from ._quality_setup import CREATE_RECORD_INPUTS

client = TestClient(app)


# ---------- 构件 ----------

def _mk_workflow(client_) -> str:
    wf = client_.post("/api/workflows", json={"name": f"GOV-{uuid.uuid4().hex[:6]}"}).json()
    return wf["id"]


def _set_and_publish(client_, wf_id: str, marker: str, headers=None) -> dict:
    """设置含 create-record 节点的草稿并发布；以节点 name 作为版本间可 Diff 差异。

    outputKey 固定 quality_result（结构化输出校验约束），用 name 制造版本差异。"""
    d = client_.get(f"/api/workflows/{wf_id}", headers=headers).json()
    defn = d["definition"]
    defn["graph"]["nodes"] = [
        {"id": "n_start", "type": "input", "name": "开始", "config": {}, "inputs": []},
        {"id": "n_rec", "type": "create-record", "name": f"落质检-{marker}",
         "config": {"outputKey": "quality_result"}, "inputs": CREATE_RECORD_INPUTS},
    ]
    defn["graph"]["edges"] = [{"id": "e1", "source": "n_start", "target": "n_rec"}]
    r = client_.put(f"/api/workflows/{wf_id}/draft", headers=headers,
                    json={"definition": defn, "baseRevision": d["draftRevision"]})
    assert r.status_code == 200, r.text
    pub = client_.post(f"/api/workflows/{wf_id}/publish", headers=headers, json={})
    assert pub.status_code == 201, pub.text
    return pub.json()


def _current_wf_version(client_, wf_id: str) -> int | None:
    wf = client_.get(f"/api/workflows/{wf_id}").json()
    return wf.get("currentVersionNo")


def _mk_rule_set(client_) -> str:
    r = client_.post("/api/result-rules", json={
        "name": f"GOVR-{uuid.uuid4().hex[:6]}",
        "rules": {"scoreRules": [], "issueRules": []}}).json()
    return r["id"]


def _publish_rule(client_, rid: str) -> dict:
    return client_.post(f"/api/result-rules/{rid}/publish", json={}).json()


# ---------- 版本 Diff ----------

def test_diff_workflow_versions():
    wf_id = _mk_workflow(client)
    _set_and_publish(client, wf_id, "out_v1")
    _set_and_publish(client, wf_id, "out_v2")
    r = client.get("/api/governance/diff", params={
        "resourceType": "workflow", "resourceId": wf_id, "from": 1, "to": 2})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["hasChanges"] is True
    # 节点 name 从 落质检-out_v1 → 落质检-out_v2 应出现在 changed
    name_changes = [v for k, v in d["changed"].items() if k.endswith(".name")]
    assert name_changes, d["changed"]
    ch = name_changes[0]
    assert ch["from"] == "落质检-out_v1" and ch["to"] == "落质检-out_v2"


def test_diff_same_version_no_changes():
    wf_id = _mk_workflow(client)
    _set_and_publish(client, wf_id, "same")
    r = client.get("/api/governance/diff", params={
        "resourceType": "workflow", "resourceId": wf_id, "from": 1, "to": 1})
    assert r.status_code == 200
    assert r.json()["hasChanges"] is False


def test_diff_rule_versions():
    rid = _mk_rule_set(client)
    _publish_rule(client, rid)  # v1 空规则
    # 改规则再发布 v2
    client.put(f"/api/result-rules/{rid}", json={
        "rules": {"scoreRules": [{"field": "score", "op": ">", "value": 80}], "issueRules": []}})
    _publish_rule(client, rid)
    r = client.get("/api/governance/diff", params={
        "resourceType": "rule", "resourceId": rid, "from": 1, "to": 2})
    assert r.status_code == 200
    assert r.json()["hasChanges"] is True


def test_diff_rejects_bad_type():
    r = client.get("/api/governance/diff", params={
        "resourceType": "nope", "resourceId": "x", "from": 1, "to": 2})
    assert r.status_code == 422


# ---------- 审批门禁 ----------

def test_release_requires_approval():
    wf_id = _mk_workflow(client)
    _set_and_publish(client, wf_id, "a")
    _set_and_publish(client, wf_id, "b")  # current=v2
    rr = client.post("/api/governance/release-requests", json={
        "resourceType": "workflow", "resourceId": wf_id, "toVersionNo": 1}).json()
    assert rr["state"] == "pending"
    # 未审批直接发布 → 409
    r = client.post(f"/api/governance/release-requests/{rr['id']}/release")
    assert r.status_code == 409


def test_reject_blocks_release():
    wf_id = _mk_workflow(client)
    _set_and_publish(client, wf_id, "a")
    _set_and_publish(client, wf_id, "b")
    rr = client.post("/api/governance/release-requests", json={
        "resourceType": "workflow", "resourceId": wf_id, "toVersionNo": 1}).json()
    rj = client.post(f"/api/governance/release-requests/{rr['id']}/reject",
                     json={"reason": "不合规"})
    assert rj.status_code == 200 and rj.json()["state"] == "rejected"
    assert client.post(f"/api/governance/release-requests/{rr['id']}/release").status_code == 409


def test_release_advances_pointer_and_rollback_restores():
    wf_id = _mk_workflow(client)
    _set_and_publish(client, wf_id, "a")  # v1
    _set_and_publish(client, wf_id, "b")  # v2，current=2
    # 申请切回 v1
    rr = client.post("/api/governance/release-requests", json={
        "resourceType": "workflow", "resourceId": wf_id, "toVersionNo": 1}).json()
    assert rr["fromVersionNo"] == 2 and rr["toVersionNo"] == 1
    client.post(f"/api/governance/release-requests/{rr['id']}/approve")
    rel = client.post(f"/api/governance/release-requests/{rr['id']}/release")
    assert rel.status_code == 200 and rel.json()["state"] == "released"
    assert _current_wf_version(client, wf_id) == 1  # 指针切到 v1
    # 回滚 → 恢复 from_version_no=2
    rb = client.post(f"/api/governance/release-requests/{rr['id']}/rollback")
    assert rb.status_code == 200 and rb.json()["state"] == "rolled_back"
    assert _current_wf_version(client, wf_id) == 2


def test_release_nonexistent_version_rejected():
    wf_id = _mk_workflow(client)
    _set_and_publish(client, wf_id, "a")
    r = client.post("/api/governance/release-requests", json={
        "resourceType": "workflow", "resourceId": wf_id, "toVersionNo": 99})
    assert r.status_code == 404


def test_rollback_requires_released():
    wf_id = _mk_workflow(client)
    _set_and_publish(client, wf_id, "a")
    _set_and_publish(client, wf_id, "b")
    rr = client.post("/api/governance/release-requests", json={
        "resourceType": "workflow", "resourceId": wf_id, "toVersionNo": 1}).json()
    # pending 状态不可回滚
    assert client.post(f"/api/governance/release-requests/{rr['id']}/rollback").status_code == 409


# ---------- Canary ----------

def test_canary_release_and_promote():
    wf_id = _mk_workflow(client)
    _set_and_publish(client, wf_id, "a")
    _set_and_publish(client, wf_id, "b")
    rr = client.post("/api/governance/release-requests", json={
        "resourceType": "workflow", "resourceId": wf_id, "toVersionNo": 1,
        "canary": True, "canaryScope": {"percent": 10}}).json()
    assert rr["canary"] is True
    client.post(f"/api/governance/release-requests/{rr['id']}/approve")
    rel = client.post(f"/api/governance/release-requests/{rr['id']}/release").json()
    assert rel["state"] == "released" and rel["canaryPromoted"] is False
    pro = client.post(f"/api/governance/release-requests/{rr['id']}/promote")
    assert pro.status_code == 200 and pro.json()["canaryPromoted"] is True
    # 重复 promote → 409
    assert client.post(f"/api/governance/release-requests/{rr['id']}/promote").status_code == 409


def test_promote_requires_canary():
    wf_id = _mk_workflow(client)
    _set_and_publish(client, wf_id, "a")
    _set_and_publish(client, wf_id, "b")
    rr = client.post("/api/governance/release-requests", json={
        "resourceType": "workflow", "resourceId": wf_id, "toVersionNo": 1}).json()
    client.post(f"/api/governance/release-requests/{rr['id']}/approve")
    client.post(f"/api/governance/release-requests/{rr['id']}/release")
    # 非 canary 发布无需转全量
    assert client.post(f"/api/governance/release-requests/{rr['id']}/promote").status_code == 422


# ---------- 规则指针 ----------

def test_rule_release_pointer():
    rid = _mk_rule_set(client)
    _publish_rule(client, rid)  # v1
    client.put(f"/api/result-rules/{rid}", json={
        "rules": {"scoreRules": [{"field": "score", "op": ">", "value": 90}], "issueRules": []}})
    _publish_rule(client, rid)  # v2，current=2
    rr = client.post("/api/governance/release-requests", json={
        "resourceType": "rule", "resourceId": rid, "toVersionNo": 1}).json()
    assert rr["fromVersionNo"] == 2
    client.post(f"/api/governance/release-requests/{rr['id']}/approve")
    client.post(f"/api/governance/release-requests/{rr['id']}/release")
    ruleset = client.get(f"/api/result-rules/{rid}").json()
    assert ruleset["version"] == 1


# ---------- 审计留痕 ----------

def test_release_flow_writes_audit():
    wf_id = _mk_workflow(client)
    _set_and_publish(client, wf_id, "a")
    _set_and_publish(client, wf_id, "b")
    rr = client.post("/api/governance/release-requests", json={
        "resourceType": "workflow", "resourceId": wf_id, "toVersionNo": 1}).json()
    client.post(f"/api/governance/release-requests/{rr['id']}/approve")
    client.post(f"/api/governance/release-requests/{rr['id']}/release")
    client.post(f"/api/governance/release-requests/{rr['id']}/rollback")
    audit_rows = client.get("/api/audit", params={"limit": 500}).json()["items"]
    actions = {a["action"] for a in audit_rows if a["targetId"] == wf_id}
    assert {"release.request", "release.approve", "release.release", "release.rollback"} <= actions


# ---------- 职责分离（真实鉴权） ----------

@pytest.fixture
def auth_on(monkeypatch):
    monkeypatch.setenv("WF_AUTH", "on")
    monkeypatch.setenv("WF_SECRET_KEY", "p2-gov-key-0123456789")
    yield


def _login(username: str, password: str) -> str:
    return client.post("/api/auth/login", json={"username": username, "password": password}).json()["token"]


def test_separation_of_duties(auth_on):
    admin_tok = _login("admin", "admin")
    # 建一个 operator
    op_name = f"op-{uuid.uuid4().hex[:8]}"
    client.post("/api/auth/users", headers={"Authorization": f"Bearer {admin_tok}"},
                json={"username": op_name, "password": "pass12345", "role": "operator"})
    op_tok = _login(op_name, "pass12345")
    H_OP = {"Authorization": f"Bearer {op_tok}"}
    H_AD = {"Authorization": f"Bearer {admin_tok}"}
    # operator 建并发布工作流两个版本
    wf_id = client.post("/api/workflows", headers=H_OP,
                        json={"name": f"GOVSOD-{uuid.uuid4().hex[:6]}"}).json()["id"]
    _set_and_publish(client, wf_id, "a", headers=H_OP)
    _set_and_publish(client, wf_id, "b", headers=H_OP)
    rr = client.post("/api/governance/release-requests", headers=H_OP, json={
        "resourceType": "workflow", "resourceId": wf_id, "toVersionNo": 1}).json()
    assert rr["requestedBy"] == op_name
    # 申请人（operator）不能审批自己的申请 → 403（operator 亦非 admin）
    assert client.post(f"/api/governance/release-requests/{rr['id']}/approve",
                       headers=H_OP).status_code in (403,)
    # admin 审批通过（admin ≠ 申请人）
    ap = client.post(f"/api/governance/release-requests/{rr['id']}/approve", headers=H_AD)
    assert ap.status_code == 200 and ap.json()["approvedBy"] == "admin"


def test_admin_cannot_approve_own_request(auth_on):
    admin_tok = _login("admin", "admin")
    H = {"Authorization": f"Bearer {admin_tok}"}
    wf_id = client.post("/api/workflows", headers=H,
                        json={"name": f"GOVOWN-{uuid.uuid4().hex[:6]}"}).json()["id"]
    _set_and_publish(client, wf_id, "a", headers=H)
    _set_and_publish(client, wf_id, "b", headers=H)
    rr = client.post("/api/governance/release-requests", headers=H, json={
        "resourceType": "workflow", "resourceId": wf_id, "toVersionNo": 1}).json()
    assert rr["requestedBy"] == "admin"
    # admin 审批自己发起的申请 → 职责分离拒绝
    assert client.post(f"/api/governance/release-requests/{rr['id']}/approve",
                       headers=H).status_code == 403
