"""09-SDD P0 修复轮：负向安全测试（审计反例回归防护）。

覆盖审计反例：
- viewer 可读连接密钥 → 现应 403
- viewer 可创建 workflow/asset/rule → 现应 403
- Code Node 生产可经 WF_CODE_NODE=on 开启 → 现生产永久禁用
- 生产可注册 mock:// Provider → 现应拒绝
- 出站私网/元数据地址 → 生产 Egress 拦截
- 非法 Fernet Key 启动 → 拒绝
"""
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app, check_production_ready

client = TestClient(app)


@pytest.fixture
def auth_on(monkeypatch):
    monkeypatch.setenv("WF_AUTH", "on")
    monkeypatch.setenv("WF_SECRET_KEY", "p0-neg-key-0123456789")
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


def test_viewer_cannot_reveal_secret(auth_on):
    """审计反例 1：viewer 不得读取连接密钥。"""
    admin = _login("admin", "admin")["token"]
    rev = _login(_mk_user(admin, "viewer")["username"], "pass12345")["token"]
    conn = client.post("/api/connections", json={"name": "neg-conn", "secret": "sk-x"},
                       headers={"Authorization": f"Bearer {admin}"}).json()
    r = client.get(f"/api/connections/{conn['id']}/reveal",
                   headers={"Authorization": f"Bearer {rev}"})
    assert r.status_code == 403, f"viewer 读密钥应 403（实际 {r.status_code}）"
    # admin 可读
    ra = client.get(f"/api/connections/{conn['id']}/reveal",
                    headers={"Authorization": f"Bearer {admin}"})
    assert ra.status_code == 200


def test_viewer_cannot_write_resources(auth_on):
    """审计反例 2：viewer 不得创建工作流/数据资产/规则。"""
    admin = _login("admin", "admin")["token"]
    rev = _login(_mk_user(admin, "viewer")["username"], "pass12345")["token"]
    H = {"Authorization": f"Bearer {rev}"}
    assert client.post("/api/workflows", json={"name": "x"}, headers=H).status_code == 403
    assert client.post("/api/data-assets", json={"name": "x", "rows": []}, headers=H).status_code == 403
    assert client.post("/api/result-rules", json={"name": "x", "rules": {}}, headers=H).status_code == 403
    assert client.post("/api/connections", json={"name": "x", "secret": "s"}, headers=H).status_code == 403


def test_operator_cannot_admin_connections(auth_on):
    """operator 可编辑任务，但连接管理仅 admin。"""
    admin = _login("admin", "admin")["token"]
    op = _login(_mk_user(admin, "operator")["username"], "pass12345")["token"]
    H = {"Authorization": f"Bearer {op}"}
    assert client.post("/api/connections", json={"name": "x", "secret": "s"}, headers=H).status_code == 403
    # operator 可建工作流
    assert client.post("/api/workflows", json={"name": "op-wf"}, headers=H).status_code == 201


def test_code_node_production_permanently_disabled(monkeypatch):
    """审计反例 5：生产环境 Code Node 永久禁用，WF_CODE_NODE=on 也不得开启。"""
    from app.config import code_node_enabled
    monkeypatch.setenv("WF_ENV", "production")
    monkeypatch.setenv("WF_CODE_NODE", "on")
    assert code_node_enabled() is False, "生产 Code Node 必须永久禁用"
    # 非生产可经 WF_CODE_NODE=on 开启
    monkeypatch.setenv("WF_ENV", "development")
    assert code_node_enabled() is True
    monkeypatch.delenv("WF_CODE_NODE")
    assert code_node_enabled() is False


def test_mock_provider_blocked_in_production(monkeypatch):
    """审计反例 6：生产禁止注册 mock:// Provider。"""
    from app.routers.admin import _assert_no_mock_base
    monkeypatch.setenv("WF_ENV", "production")
    with pytest.raises(Exception):
        _assert_no_mock_base("mock://fake")
    # 正常 base 不拦截
    _assert_no_mock_base("https://api.example.com")
    # 非生产允许
    monkeypatch.setenv("WF_ENV", "development")
    _assert_no_mock_base("mock://fake")


def test_egress_blocks_private_in_production(monkeypatch):
    """审计反例 4：生产出站拦截私网/环回/元数据地址。"""
    from app.egress import EgressError, enforce_egress
    monkeypatch.setenv("WF_ENV", "production")
    for bad in ["http://127.0.0.1:8080/x", "http://10.0.0.5/x",
                "http://192.168.1.1/x", "http://169.254.169.254/latest/meta-data/",
                "http://[::1]/x", "http://0.0.0.0/x"]:
        with pytest.raises(EgressError):
            enforce_egress(bad)
    # 公网地址放行
    enforce_egress("https://93.184.216.34/x")
    # 非生产放行
    monkeypatch.setenv("WF_ENV", "development")
    enforce_egress("http://127.0.0.1:8080/x")


def test_invalid_fernet_key_rejected_at_startup(monkeypatch):
    """审计反例 1（补充）：生产启动校验 WF_SECRET_KEY 必须是合法 Fernet。"""
    monkeypatch.setenv("WF_ENV", "production")
    monkeypatch.setenv("WF_SECRET_KEY", "not-a-valid-fernet-key")
    with pytest.raises(RuntimeError, match="Fernet"):
        check_production_ready()
    monkeypatch.delenv("WF_SECRET_KEY")
    with pytest.raises(RuntimeError, match="WF_SECRET_KEY"):
        check_production_ready()


def test_encrypt_production_fails_closed(monkeypatch):
    """审计反例 1（补充）：生产 _encrypt 遇非法/缺失密钥失败关闭，不回落明文。"""
    from fastapi import HTTPException
    from app.routers.admin import _encrypt
    monkeypatch.setenv("WF_ENV", "production")
    monkeypatch.delenv("WF_SECRET_KEY", raising=False)
    with pytest.raises(HTTPException):
        _encrypt("secret")
    monkeypatch.setenv("WF_SECRET_KEY", "not-a-fernet-key")
    with pytest.raises(HTTPException):
        _encrypt("secret")
