"""AgentFlow 详情治理轮回归（2026-09-11）：

- 详情页就地重命名端点 PATCH /api/v2/agentflows/{fid}（名称非空校验/404）；
- 列表暴露 active_version_no（历史版本面板「当前版本」chip 的数据源）。

真实生产函数 + 真实 DB（wf_test 经 conftest），不复制实现。
"""
from __future__ import annotations

import uuid

from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.models import Agent

client = TestClient(app)


def u(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def _make_agent() -> str:
    db = SessionLocal()
    try:
        a = Agent(name=u("govAG")[:20], type="custom", status="draft",
                  config={"rolePrompt": "x", "modelRef": {}})
        db.add(a)
        db.commit()
        return a.id
    finally:
        db.close()


def _create_flow(name: str) -> str:
    r = client.post("/api/v2/agentflows", json={"name": name, "description": ""})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def test_patch_flow_rename_and_guards():
    fid = _create_flow(u("gov-flow"))
    r = client.patch(f"/api/v2/agentflows/{fid}", json={"name": "  新名字  "})
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "新名字"

    r = client.patch(f"/api/v2/agentflows/{fid}", json={"name": "   "})
    assert r.status_code == 422

    r = client.patch("/api/v2/agentflows/nonexistent-id", json={"name": "x"})
    assert r.status_code == 404

    items = client.get("/api/v2/agentflows").json()["items"]
    row = next((x for x in items if x["id"] == fid), None)
    assert row is not None and row["name"] == "新名字"


def test_list_flows_exposes_active_version_no():
    fid = _create_flow(u("gov-ver"))
    aid = _make_agent()
    v = client.post(
        f"/api/v2/agentflows/{fid}/versions",
        json={"definition": {"nodes": [{"id": "n1", "kind": "agent", "agent_id": aid,
                                        "prompt_template": "p"}],
                             "edges": []}},
    )
    assert v.status_code == 200, v.text
    vid = v.json()["id"]

    items = client.get("/api/v2/agentflows").json()["items"]
    row = next(x for x in items if x["id"] == fid)
    assert row["active_version_no"] is None

    rel = client.post(
        f"/api/v2/agentflows/{fid}/releases",
        json={"version_id": vid, "environment": "prod"},
    )
    assert rel.status_code in (200, 201), rel.text

    items = client.get("/api/v2/agentflows").json()["items"]
    row = next(x for x in items if x["id"] == fid)
    assert row["active_version_no"] == 1
    assert row["active_release_id"]


def test_release_actor_cannot_be_spoofed_via_payload(fake_runtime=None):
    """09-11 审计 P1-13：release actor 取自已认证主体，请求体伪造无效。"""
    import uuid as _uuid
    from app.db import SessionLocal
    from app.models import Agent, AgentVersion, Release

    db = SessionLocal()
    try:
        from app.models import Model
        mk = db.query(Model).filter_by(enabled=True).order_by(Model.id).first()
        a = Agent(name=f"actor-{_uuid.uuid4().hex[:6]}"[:20], type="custom", status="draft",
                  config={"rolePrompt": "x", "modelRef": {"modelId": mk.model_key if mk else "qwen-plus"}})
        db.add(a)
        db.commit()
        aid = a.id
    finally:
        db.close()

    v = client.post(f"/api/agents/{aid}/versions", json={"note": "n"})
    assert v.status_code == 201, v.text
    vid = v.json().get("versionId") or v.json().get("id")
    r = client.post(
        f"/api/agents/{aid}/releases",
        json={"versionId": vid, "environment": "sandbox", "actor": "evil-spoof"},
    )
    assert r.status_code in (200, 201), r.text
    db = SessionLocal()
    try:
        rel = db.get(Release, r.json()["releaseId"])
        assert rel.created_by != "evil-spoof", rel.created_by
    finally:
        db.close()


def test_tool_policy_freezes_into_release_snapshot():
    """09-11 权限策略：config.permissions 发布时冻结，缺省键视为开启。"""
    import uuid as _uuid
    from app.db import SessionLocal
    from app.models import Agent, Model, Release

    db = SessionLocal()
    try:
        mk = db.query(Model).filter_by(enabled=True).order_by(Model.id).first()
        a = Agent(
            name=f"perm-{_uuid.uuid4().hex[:6]}"[:20], type="custom", status="draft",
            config={"rolePrompt": "x",
                    "modelRef": {"modelId": mk.model_key if mk else "qwen-plus"},
                    "permissions": {"shell": False}},
        )
        db.add(a)
        db.commit()
        aid = a.id
    finally:
        db.close()

    v = client.post(f"/api/agents/{aid}/versions", json={"note": "perm"})
    assert v.status_code == 201, v.text
    vid = v.json().get("versionId") or v.json().get("id")
    r = client.post(f"/api/agents/{aid}/releases",
                    json={"versionId": vid, "environment": "sandbox"})
    assert r.status_code in (200, 201), r.text

    db = SessionLocal()
    try:
        rel = db.get(Release, r.json()["releaseId"])
        pol = (rel.runtime_binding_snapshot or {}).get("frozen_tool_policy") or {}
        assert pol.get("shell") is False
        assert pol.get("file_write") is True
        assert pol.get("platform_tools") is True
    finally:
        db.close()

    rows = client.get(f"/api/agents/{aid}/releases").json()
    assert rows[0]["frozenToolPolicy"]["shell"] is False


def test_permission_policy_v2_freezes_into_release():
    """14 号稿 P1：config.permissions v2 → frozen_permission_policy 执行规格。"""
    import uuid as _uuid
    from app.db import SessionLocal
    from app.models import Agent, Model, Release

    db = SessionLocal()
    try:
        mk = db.query(Model).filter_by(enabled=True).order_by(Model.id).first()
        a = Agent(
            name=f"permv2-{_uuid.uuid4().hex[:6]}"[:20], type="custom", status="draft",
            config={"rolePrompt": "x",
                    "modelRef": {"modelId": mk.model_key if mk else "qwen-plus"},
                    "permissions": {"version": 2, "master": True,
                                    "tools": {"Bash": "deny", "ScheduleCreate": "ask"},
                                    "sensitive_enabled": True,
                                    "sensitive_paths": ["**/.ssh/**"]}},
        )
        db.add(a)
        db.commit()
        aid = a.id
    finally:
        db.close()

    v = client.post(f"/api/agents/{aid}/versions", json={"note": "permv2"})
    assert v.status_code == 201, v.text
    vid = v.json().get("versionId") or v.json().get("id")
    r = client.post(f"/api/agents/{aid}/releases",
                    json={"versionId": vid, "environment": "sandbox"})
    assert r.status_code in (200, 201), r.text

    db = SessionLocal()
    try:
        rel = db.get(Release, r.json()["releaseId"])
        spec = (rel.runtime_binding_snapshot or {}).get("frozen_permission_policy") or {}
        assert spec.get("mode") == "accept_edits"
        assert spec.get("deny_tools") == ["Bash"]
        assert spec.get("ask_tools") == ["ScheduleCreate"]
        assert "**/.ssh/**" in spec.get("sensitive_globs")
        assert "rm -rf" in spec.get("bash_ask_patterns")
        assert "| bash" in spec.get("bash_deny_patterns")
    finally:
        db.close()

    rows = client.get(f"/api/agents/{aid}/releases").json()
    assert rows[0]["frozenPermissionPolicy"]["mode"] == "accept_edits"
