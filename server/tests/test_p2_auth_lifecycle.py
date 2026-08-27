"""09-SDD P2-01：企业身份（本地账号+角色增强）——用户生命周期。"""
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


@pytest.fixture
def auth_on(monkeypatch):
    monkeypatch.setenv("WF_AUTH", "on")
    monkeypatch.setenv("WF_SECRET_KEY", "p2-auth-key-0123456789")
    yield


def _login(username: str, password: str):
    return client.post("/api/auth/login", json={"username": username, "password": password})


def _mk_user(admin_token: str, role: str = "viewer") -> dict:
    name = f"{role}-{uuid.uuid4().hex[:8]}"
    r = client.post("/api/auth/users", headers={"Authorization": f"Bearer {admin_token}"},
                    json={"username": name, "password": "pass12345", "role": role})
    assert r.status_code == 201, r.text
    return r.json()


def test_disabled_user_cannot_login(auth_on):
    admin = _login("admin", "admin").json()["token"]
    u = _mk_user(admin, "viewer")
    # 停用前可登录
    assert _login(u["username"], "pass12345").status_code == 200
    r = client.post(f"/api/auth/users/{u['id']}/status",
                    headers={"Authorization": f"Bearer {admin}"},
                    json={"status": "disabled"})
    assert r.status_code == 200 and r.json()["status"] == "disabled"
    # 停用后无法登录
    assert _login(u["username"], "pass12345").status_code == 401


def test_disabled_user_existing_token_invalidated(auth_on):
    admin = _login("admin", "admin").json()["token"]
    u = _mk_user(admin, "viewer")
    tok = _login(u["username"], "pass12345").json()["token"]
    # 停用前令牌可用
    assert client.get("/api/workflows", headers={"Authorization": f"Bearer {tok}"}).status_code == 200
    client.post(f"/api/auth/users/{u['id']}/status",
                headers={"Authorization": f"Bearer {admin}"}, json={"status": "disabled"})
    # 既有令牌立即失效
    assert client.get("/api/workflows", headers={"Authorization": f"Bearer {tok}"}).status_code == 401


def test_password_change(auth_on):
    admin = _login("admin", "admin").json()["token"]
    u = _mk_user(admin, "viewer")
    r = client.post(f"/api/auth/users/{u['id']}/password",
                    headers={"Authorization": f"Bearer {admin}"},
                    json={"password": "newpass6789"})
    assert r.status_code == 200
    assert _login(u["username"], "pass12345").status_code == 401  # 旧密码失效
    assert _login(u["username"], "newpass6789").status_code == 200


def test_cannot_disable_self(auth_on):
    admin_token = _login("admin", "admin").json()["token"]
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {admin_token}"}).json()
    r = client.post(f"/api/auth/users/{me['id']}/status",
                    headers={"Authorization": f"Bearer {admin_token}"},
                    json={"status": "disabled"})
    assert r.status_code == 422, "不能停用自己"


def test_password_too_short_rejected(auth_on):
    admin = _login("admin", "admin").json()["token"]
    u = _mk_user(admin, "viewer")
    r = client.post(f"/api/auth/users/{u['id']}/password",
                    headers={"Authorization": f"Bearer {admin}"},
                    json={"password": "short"})
    assert r.status_code == 422
