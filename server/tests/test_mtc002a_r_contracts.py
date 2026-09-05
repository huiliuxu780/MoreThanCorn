"""MTC-002A-R：canonical/legacy 契约拆分 + runs/schedules 团队数据范围门禁。

- canonical workflow-target / agent-target 两种真实响应契约；
- legacy-only 字段（taskVersion/workflowVersionPolicy/dataAssetId/dataDefinitionId）
  不得出现在 canonical 响应中；
- 权限矩阵（WF_AUTH=on）：未登录 401 / 跨团队 team-scope 403 / 同团队 200 /
  scope=all 200 / admin 200，覆盖新旧 runs 与 schedules 四个端点。
"""
import uuid

import pytest
from fastapi.testclient import TestClient

from app.auth import hash_password
from app.db import SessionLocal
from app.main import app
from app.models import AnalysisTask, AnalysisTaskVersion, AppUser

client = TestClient(app)

CANONICAL_REQUIRED = {
    "id", "name", "description", "status", "agentId", "workflowId",
    "workflowVersionId", "inputConfig", "scheduleConfig", "executionConfig",
    "createdAt", "updatedAt", "createdBy", "version",
}
LEGACY_ONLY = {"taskVersion", "workflowVersionPolicy", "dataAssetId", "dataDefinitionId"}


def _insert_task(name: str, target: str = "workflow", created_by: str = "dev") -> str:
    """直接落库（target=workflow|agent）；agent 型 workflow_id 必须为 None（ck 约束互斥）。"""
    db = SessionLocal()
    try:
        t = AnalysisTask(
            name=name, created_by=created_by, updated_by=created_by,
            data_asset_id="da-002ar", status="active",
            execution_target_type=target,
            workflow_id=None if target == "agent" else "wf-002ar",
            agent_id="agent-002ar" if target == "agent" else None,
        )
        db.add(t)
        db.flush()
        v = AnalysisTaskVersion(
            task_id=t.id, version_no=1, data_asset_id="da-002ar",
            execution_target_type=target,
            workflow_id=None if target == "agent" else "wf-002ar",
            workflow_version_policy="latest_published" if target == "agent" else "latest_published",
            agent_id="agent-002ar" if target == "agent" else None,
        )
        db.add(v)
        db.flush()
        t.current_version_id = v.id
        db.commit()
        return t.id
    finally:
        db.close()


def test_canonical_workflow_target_contract():
    tid = _insert_task(f"002AR-wf-{uuid.uuid4().hex[:6]}", "workflow")
    r = client.get(f"/api/automations/{tid}")
    assert r.status_code == 200, r.text
    dto = r.json()
    assert CANONICAL_REQUIRED <= set(dto.keys())
    assert dto["workflowId"] == "wf-002ar"
    assert dto["agentId"] is None
    assert dto["workflowVersionId"] is None  # latest_published 无 pinned 版本
    assert dto["executionConfig"]["executionTarget"]["type"] == "workflow"
    assert LEGACY_ONLY & set(dto.keys()) == set()


def test_canonical_agent_target_contract():
    tid = _insert_task(f"002AR-ag-{uuid.uuid4().hex[:6]}", "agent")
    r = client.get(f"/api/automations/{tid}")
    assert r.status_code == 200, r.text
    dto = r.json()
    assert CANONICAL_REQUIRED <= set(dto.keys())
    assert dto["workflowId"] is None, "agent 型自主任务 workflowId 必须为 null"
    assert dto["agentId"] == "agent-002ar"
    assert dto["executionConfig"]["executionTarget"]["type"] == "agent"
    assert LEGACY_ONLY & set(dto.keys()) == set()
    # legacy 详情仍返回 legacy 形状（含 taskVersion / workflowVersionPolicy）
    o = client.get(f"/api/tasks/{tid}").json()
    assert {"taskVersion", "workflowVersionPolicy"} <= set(o.keys())
    assert o["taskVersion"]["executionTarget"]["type"] == "agent"


def test_legacy_list_keeps_projection_fields():
    tid = _insert_task(f"002AR-ls-{uuid.uuid4().hex[:6]}", "workflow")
    items = client.get("/api/tasks", params={"pageSize": 200}).json()["items"]
    row = next(i for i in items if i["id"] == tid)
    assert {"currentVersionNo", "executionTargetType", "lastTaskRun"} <= set(row.keys())
    assert row["currentVersionNo"] == 1
    assert "taskVersion" not in row, "legacy 列表不返回 taskVersion（页面须用 currentVersionNo）"


# ---------- 权限矩阵 ----------


@pytest.fixture
def auth_on(monkeypatch):
    monkeypatch.setenv("WF_AUTH", "on")
    monkeypatch.setenv("WF_SECRET_KEY", "mtc002ar-key-0123456789")
    yield


def _mk_user(role: str, team: str = "", scope: str = "all") -> str:
    name = f"{role}-{team or 'x'}-{uuid.uuid4().hex[:8]}"
    db = SessionLocal()
    try:
        u = AppUser(username=name, password_hash=hash_password("pass12345"),
                    role=role, team=team, data_scope=scope)
        db.add(u)
        db.commit()
        return name
    finally:
        db.close()


def _tok(username: str, password: str = "pass12345") -> str:
    return client.post("/api/auth/login", json={"username": username,
                                                "password": password}).json()["token"]


def _hdr(tok: str):
    return {"Authorization": f"Bearer {tok}"}


@pytest.mark.parametrize("base", ["/api/tasks", "/api/automations"])
@pytest.mark.parametrize("sub", ["/runs", "/schedules"])
def test_runs_schedules_scope_matrix(auth_on, base, sub):
    alice = _mk_user("operator", team="A", scope="team")
    bob = _mk_user("viewer", team="B", scope="team")
    carol = _mk_user("viewer", team="", scope="all")
    tid = _insert_task(f"002AR-sc-{uuid.uuid4().hex[:6]}", "workflow", created_by=alice)
    url = f"{base}/{tid}{sub}"

    # 未登录（WF_AUTH=on）→ 401
    assert client.get(url).status_code == 401
    # 跨团队 team-scope → 403
    assert client.get(url, headers=_hdr(_tok(bob))).status_code == 403
    # 同团队 → 200
    assert client.get(url, headers=_hdr(_tok(alice))).status_code == 200
    # scope=all → 200
    assert client.get(url, headers=_hdr(_tok(carol))).status_code == 200
    # admin → 200
    assert client.get(url, headers=_hdr(_tok("admin", "admin"))).status_code == 200


@pytest.mark.parametrize("base", ["/api/tasks", "/api/automations"])
def test_detail_scope_still_enforced(auth_on, base):
    alice = _mk_user("operator", team="A", scope="team")
    bob = _mk_user("viewer", team="B", scope="team")
    tid = _insert_task(f"002AR-dt-{uuid.uuid4().hex[:6]}", "workflow", created_by=alice)
    assert client.get(f"{base}/{tid}", headers=_hdr(_tok(bob))).status_code == 403
    assert client.get(f"{base}/{tid}", headers=_hdr(_tok(alice))).status_code == 200


def test_missing_task_still_404_not_403(auth_on):
    tok = _hdr(_tok(_mk_user("viewer", team="B", scope="team")))
    for url in ("/api/tasks/nope002a/runs", "/api/tasks/nope002a/schedules",
                "/api/automations/nope002a/runs", "/api/automations/nope002a/schedules"):
        assert client.get(url, headers=tok).status_code == 404
