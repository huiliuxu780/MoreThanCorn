"""09-SDD P0-B3：高危执行封堵与最低安全整改（P0-11）。

- Code Node 生产默认禁用（WF_CODE_NODE=on 才允许，且记录在案）；
- SSRF：出站统一 Egress Policy——私网/环回/链路本地/云元数据/IPv6 全拦，禁自动重定向；
- Secret：生产缺 WF_SECRET_KEY 拒绝启动（见 production 测试）；密钥强制加密存储。

先红后绿。
"""
import pytest


# ---------- Code Node ----------

def _code_node_ctx():
    from app.db import SessionLocal
    from app.models import Run

    class _Ctx:
        pass

    ctx = _Ctx()
    ctx.db = SessionLocal()
    ctx.run = Run(workflow_id=None, trigger="test", status="running", input={})
    ctx.outputs = {}
    ctx.run_input = {}
    ctx.current_node_run_id = None
    ctx.call = lambda *a, **k: None  # CallRecord 记录桩
    return ctx


def test_code_node_disabled_by_default(monkeypatch):
    monkeypatch.delenv("WF_CODE_NODE", raising=False)
    from app.runner import RunError, exec_code_write
    ctx = _code_node_ctx()
    node = {"id": "c1", "type": "code-write", "config": {"code": "def main(args):\n    return {'output': 1}"}, "inputs": []}
    with pytest.raises(RunError, match="CODE_NODE_DISABLED|禁用"):
        exec_code_write(node, ctx)
    ctx.db.close()


def test_code_node_opt_in_runs(monkeypatch):
    monkeypatch.setenv("WF_CODE_NODE", "on")
    from app.runner import exec_code_write
    ctx = _code_node_ctx()
    node = {"id": "c1", "type": "code-write", "config": {"code": "def main(args):\n    return {'output': 42}"}, "inputs": []}
    out = exec_code_write(node, ctx)
    assert out["output"] == 42
    ctx.db.close()


# ---------- SSRF / Egress ----------

@pytest.mark.parametrize("url", [
    "http://127.0.0.1:8080/x",
    "http://localhost/x",
    "http://10.0.0.5/x",
    "http://192.168.1.1/x",
    "http://172.16.0.9/x",
    "http://169.254.169.254/latest/meta-data/",   # 云元数据
    "http://[::1]/x",
    "http://0.0.0.0/x",
    "ftp://example.com/x",
])
def test_egress_blocks_internal_targets(url):
    from app.egress import EgressError, assert_safe_url
    with pytest.raises(EgressError):
        assert_safe_url(url)


def test_egress_allows_public_host():
    from app.egress import assert_safe_url
    # 公网地址字面量放行（不依赖 DNS，避免测试网络抖动）
    assert assert_safe_url("https://93.184.216.34/api") is None


def test_tool_node_uses_egress():
    """exec_tool 的出站请求必须经 Egress（内网目标直接拒绝，不发请求）。"""
    from app.db import SessionLocal
    from app.models import Tool, ToolVersion, Run
    from app.runner import RunError, exec_tool

    class _Ctx:
        pass

    db = SessionLocal()
    try:
        t = Tool(name="ssrf-tool", kind="http")
        db.add(t)
        db.flush()
        tv = ToolVersion(tool_id=t.id, version_no=1,
                         spec={"request": {"url": "http://169.254.169.254/latest/meta-data/",
                                           "method": "GET"}})
        db.add(tv)
        db.flush()
        ctx = _Ctx()
        ctx.db = db
        ctx.run = Run(workflow_id=None, trigger="test", status="running", input={})
        ctx.outputs = {}
        ctx.run_input = {}
        ctx.current_node_run_id = None
        node = {"id": "t1", "type": "tool",
                "config": {"toolVersionId": tv.id}, "inputs": []}
        with pytest.raises(RunError):
            exec_tool(node, ctx)
    finally:
        db.rollback()
        db.close()


# ---------- Secret ----------

def test_secret_encrypted_when_key_present(monkeypatch):
    from cryptography.fernet import Fernet
    key = Fernet.generate_key().decode()
    monkeypatch.setenv("WF_SECRET_KEY", key)
    from app.routers.admin import _encrypt
    from app.runner import _decrypt
    ref = _encrypt("sk-test-123")
    assert ref != "sk-test-123"           # 不再明文
    assert _decrypt(ref) == "sk-test-123"


def test_decrypt_fails_closed_without_key(monkeypatch):
    """有密文但无密钥：不得回落明文（生产启动门已保证密钥存在，此为纵深防御）。"""
    from cryptography.fernet import Fernet
    key = Fernet.generate_key().decode()
    from app.routers.admin import _encrypt
    monkeypatch.setenv("WF_SECRET_KEY", key)
    ref = _encrypt("sk-secret-456")
    monkeypatch.delenv("WF_SECRET_KEY", raising=False)
    from app.runner import _decrypt
    with pytest.raises(Exception):
        _decrypt(ref)
