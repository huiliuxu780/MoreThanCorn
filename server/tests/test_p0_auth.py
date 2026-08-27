"""09-SDD P0-B3：后端身份与 RBAC（P0-10）。

要求：未登录 401、无权限 403；发布/复核/资源配置均服务端鉴权；actor 来自身份。
WF_AUTH=on 开启强制鉴权（生产恒开）；测试用 monkeypatch 隔离。先红后绿。
"""
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


@pytest.fixture
def auth_on(monkeypatch):
    monkeypatch.setenv("WF_AUTH", "on")
    monkeypatch.setenv("WF_SECRET_KEY", "p0-auth-key-0123456789")
    yield


def _login(username: str, password: str) -> dict:
    r = client.post("/api/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return r.json()


def _mk_user(admin_token: str, role: str) -> dict:
    name = f"{role}-{uuid.uuid4().hex[:8]}"
    r = client.post("/api/auth/users",
                    headers={"Authorization": f"Bearer {admin_token}"},
                    json={"username": name, "password": "pass12345", "role": role})
    assert r.status_code == 201, r.text
    return r.json()


def test_unauthenticated_401(auth_on):
    r = client.get("/api/workflows")
    assert r.status_code == 401
    r2 = client.post("/api/tasks", json={"name": "x"})
    assert r2.status_code == 401
    # 公共探活不鉴权
    assert client.get("/healthz").status_code == 200


def test_login_and_me(auth_on):
    body = _login("admin", "admin")
    assert body["token"] and body["user"]["role"] == "admin"
    me = client.get("/api/auth/me",
                    headers={"Authorization": f"Bearer {body['token']}"}).json()
    assert me["username"] == "admin"
    # 错误密码
    bad = client.post("/api/auth/login", json={"username": "admin", "password": "wrong"})
    assert bad.status_code == 401
    # 无效 token
    assert client.get("/api/workflows",
                      headers={"Authorization": "Bearer bogus"}).status_code == 401


def test_role_gates_publish_and_review(auth_on):
    admin = _login("admin", "admin")["token"]
    op = _login(_mk_user(admin, "operator")["username"], "pass12345")["token"]
    rev = _login(_mk_user(admin, "viewer")["username"], "pass12345")["token"]

    # 准备一个工作流（用 admin 身份）
    wid = client.post("/api/workflows", json={"name": "auth-wf"},
                      headers={"Authorization": f"Bearer {admin}"}).json()["id"]
    H_ADM = {"Authorization": f"Bearer {admin}"}
    H_OP = {"Authorization": f"Bearer {op}"}
    H_REV = {"Authorization": f"Bearer {rev}"}

    # reviewer 不能发布（403）
    r = client.post(f"/api/workflows/{wid}/publish", headers=H_REV)
    assert r.status_code == 403
    # operator 可以发布（服务端鉴权通过）
    r2 = client.post(f"/api/workflows/{wid}/publish", headers=H_OP)
    assert r2.status_code == 201, r2.text

    # 规则发布同样受角色门控
    rules = client.post("/api/result-rules", json={"name": "auth-rules", "rules": {}},
                        headers=H_ADM).json()
    assert client.post(f"/api/result-rules/{rules['id']}/publish", headers=H_REV).status_code == 403
    assert client.post(f"/api/result-rules/{rules['id']}/publish", headers=H_OP).status_code == 200

    # 资源配置（连接创建）仅 admin
    assert client.post("/api/connections", json={"name": "c-auth", "secret": "s"},
                       headers=H_OP).status_code == 403
    assert client.post("/api/connections", json={"name": "c-auth", "secret": "s"},
                       headers=H_ADM).status_code == 201


def test_actor_from_identity_in_audit(auth_on):
    admin = _login("admin", "admin")["token"]
    uname = _mk_user(admin, "operator")["username"]
    op = _login(uname, "pass12345")["token"]
    wid = client.post("/api/workflows", json={"name": "audit-wf"},
                      headers={"Authorization": f"Bearer {admin}"}).json()["id"]
    r = client.post(f"/api/workflows/{wid}/publish",
                    headers={"Authorization": f"Bearer {op}"})
    assert r.status_code == 201, r.text
    from app.db import SessionLocal
    from app.models import AuditLog
    db = SessionLocal()
    try:
        row = db.query(AuditLog).filter_by(action="workflow.publish", target_id=wid)\
            .order_by(AuditLog.created_at.desc()).first()
        assert row is not None and row.actor == uname  # actor 来自身份，不是写死
    finally:
        db.close()


def test_task_ops_require_operator(auth_on):
    admin = _login("admin", "admin")["token"]
    rev = _login(_mk_user(admin, "viewer")["username"], "pass12345")["token"]
    wf = client.post("/api/workflows", json={"name": "task-auth"},
                     headers={"Authorization": f"Bearer {admin}"}).json()
    asset = client.post("/api/data-assets",
                        json={"name": "a-auth", "rows": [{"interactionId": "X1"}]},
                        headers={"Authorization": f"Bearer {admin}"}).json()
    body = {"name": "auth-task", "workflowId": wf["id"], "dataAssetId": asset["id"]}
    assert client.post("/api/tasks", json=body,
                       headers={"Authorization": f"Bearer {rev}"}).status_code == 403
    r = client.post("/api/tasks", json=body,
                    headers={"Authorization": f"Bearer {admin}"})
    assert r.status_code == 201, r.text


def test_dev_mode_no_auth_default(monkeypatch):
    """未开 WF_AUTH（开发默认）：匿名可用，保持现状。"""
    monkeypatch.delenv("WF_AUTH", raising=False)
    monkeypatch.setenv("WF_ENV", "development")
    assert client.get("/api/workflows").status_code == 200
