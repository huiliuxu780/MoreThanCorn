"""工具 URL 相对路径解析 + 执行面状态闸门（09-14 OpenAPI 初始化轮）。

背景：OpenAPI 批量导入的工具配方以相对路径存 url（/sopSelectPlatform/...），
运行时由绑定 Connection 的 endpoint.base_url 解析——端点单点归 Connection
（D5 原则），多环境切 env 即切域名。同时补执行面状态闸门：非 ready 工具
（disabled/archived）在两条执行路径（platform_tool_exec / runner.exec_tool）
一律失败关闭，杜绝「界面停用但被引用仍可执行」。
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.connection_runtime import ToolUrlError, resolve_tool_url
from app.db import SessionLocal
from app.models import Connection, Tool, ToolVersion
from app.platform_tool_exec import execute_tool_version
from app.runner import RunError, exec_tool
from app.secrets import encrypt_secret, serialize_secret

_MARKER = "relurl-t"


def _fake_conn(endpoint: dict, environments: list | None = None,
               default_env: str | None = None, name: str = "fake") -> SimpleNamespace:
    return SimpleNamespace(name=name, endpoint=endpoint,
                           environments=environments or [],
                           default_env=default_env, secret_ref="")


class TestResolveToolUrl:
    def test_absolute_url_passthrough_without_conn(self):
        u = "https://gateway.example.com/api/x"
        assert resolve_tool_url(u, None) == u

    def test_relative_joins_connection_base_url(self):
        conn = _fake_conn({"base_url": "https://gw.example.com/"})
        assert resolve_tool_url("/api/x?q=1", conn) == "https://gw.example.com/api/x?q=1"

    def test_env_endpoint_overrides_root(self):
        conn = _fake_conn(
            {"base_url": "https://root.example.com"},
            environments=[{"code": "dev", "endpoint": {"base_url": "https://dev.example.com"}}],
            default_env="dev")
        assert resolve_tool_url("/api/x", conn) == "https://dev.example.com/api/x"

    def test_relative_without_conn_fails_closed(self):
        with pytest.raises(ToolUrlError, match="绑定"):
            resolve_tool_url("/api/x", None)

    def test_relative_without_base_url_fails_closed(self):
        conn = _fake_conn({}, name="空端点连接")
        with pytest.raises(ToolUrlError, match="base_url"):
            resolve_tool_url("/api/x", conn)

    def test_empty_url_fails_closed(self):
        with pytest.raises(ToolUrlError, match="url"):
            resolve_tool_url("  ", None)


def _mk_rows(status: str, url: str, *, with_conn: bool):
    """直写 Tool/ToolVersion（+Connection），返回 (tool_id, tv_id, conn_id)。"""
    db = SessionLocal()
    try:
        conn_id = ""
        if with_conn:
            c = Connection(name=f"{_MARKER}-conn", kind="none", protocol="http-api",
                           endpoint={"base_url": "https://gw.test.invalid"},
                           environments=[], default_env=None,
                           secret_ref=encrypt_secret(serialize_secret({})),
                           lifecycle="active", status="active")
            db.add(c)
            db.flush()
            conn_id = c.id
        t = Tool(name=f"{_MARKER}-tool", description="t", kind="http",
                 status=status, connection_id=conn_id or None)
        db.add(t)
        db.flush()
        tv = ToolVersion(tool_id=t.id, version_no=1, input_schema={}, output_schema={},
                         spec={"request": {"url": url, "method": "GET"}}, status="ready")
        db.add(tv)
        db.commit()
        return t.id, tv.id, conn_id
    finally:
        db.close()


def _cleanup():
    db = SessionLocal()
    try:
        tool_ids = [r[0] for r in db.query(Tool.id).filter(
            Tool.name.like(f"{_MARKER}%")).all()]
        if tool_ids:
            db.query(ToolVersion).filter(ToolVersion.tool_id.in_(tool_ids)).delete(
                synchronize_session=False)
            db.query(Tool).filter(Tool.id.in_(tool_ids)).delete(
                synchronize_session=False)
        conn_ids = [r[0] for r in db.query(Connection.id).filter(
            Connection.name.like(f"{_MARKER}%")).all()]
        if conn_ids:
            from app.models import ConnectionSecretRevision
            db.query(ConnectionSecretRevision).filter(
                ConnectionSecretRevision.connection_id.in_(conn_ids)).delete(
                synchronize_session=False)
            db.query(Connection).filter(Connection.id.in_(conn_ids)).delete(
                synchronize_session=False)
        db.commit()
    finally:
        db.close()


class TestExecuteToolVersion:
    def setup_method(self):
        _cleanup()

    def teardown_method(self):
        _cleanup()

    def test_disabled_tool_fails_closed(self, monkeypatch):
        _id, tv_id, _c = _mk_rows("disabled", "/api/x", with_conn=True)
        called = []
        monkeypatch.setattr("app.platform_tool_exec.httpx.request",
                            lambda *a, **k: called.append(a) or (_ for _ in ()).throw(
                                AssertionError("disabled 工具不应发出 HTTP")))
        db = SessionLocal()
        try:
            with pytest.raises(ValueError, match="失败关闭"):
                execute_tool_version(db, tv_id, {})
        finally:
            db.close()
        assert not called

    def test_relative_url_resolves_via_connection(self, monkeypatch):
        _id, tv_id, _c = _mk_rows("ready", "/api/x", with_conn=True)
        seen = {}

        class _Resp:
            status_code = 200

            def json(self):
                return {"ok": True}

        def _fake_request(method, url, **kw):
            seen["method"], seen["url"] = method, url
            return _Resp()

        monkeypatch.setattr("app.platform_tool_exec.httpx.request", _fake_request)
        # 测试域名不可解析/本机代理 fake-ip 会被 egress 拦——单测聚焦 URL 拼接，闸门派生
        monkeypatch.setattr("app.platform_tool_exec.assert_safe_url", lambda u: None)
        db = SessionLocal()
        try:
            out = execute_tool_version(db, tv_id, {})
        finally:
            db.close()
        assert seen["url"] == "https://gw.test.invalid/api/x"
        assert out["status_code"] == 200

    def test_relative_url_without_connection_fails(self, monkeypatch):
        _id, tv_id, _c = _mk_rows("ready", "/api/x", with_conn=False)
        monkeypatch.setattr("app.platform_tool_exec.httpx.request",
                            lambda *a, **k: pytest.fail("不应发出 HTTP"))
        db = SessionLocal()
        try:
            with pytest.raises(ValueError, match="Connection"):
                execute_tool_version(db, tv_id, {})
        finally:
            db.close()


class TestRunnerExecToolGate:
    def setup_method(self):
        _cleanup()

    def teardown_method(self):
        _cleanup()

    def _ctx(self, db):
        return SimpleNamespace(db=db, outputs={}, run_input={},
                               call=lambda *a, **k: None)

    def test_runner_disabled_tool_fails_closed(self, monkeypatch):
        _id, tv_id, _c = _mk_rows("disabled", "/api/x", with_conn=True)
        monkeypatch.setattr("app.runner.httpx.Client",
                            lambda *a, **k: pytest.fail("disabled 工具不应发出 HTTP"))
        db = SessionLocal()
        try:
            with pytest.raises(RunError, match="失败关闭"):
                exec_tool({"config": {"toolVersionId": tv_id}, "inputs": []},
                          self._ctx(db))
        finally:
            db.close()

    def test_runner_relative_without_connection_fails(self):
        _id, tv_id, _c = _mk_rows("ready", "/api/x", with_conn=False)
        db = SessionLocal()
        try:
            with pytest.raises(RunError, match="Connection"):
                exec_tool({"config": {"toolVersionId": tv_id}, "inputs": []},
                          self._ctx(db))
        finally:
            db.close()
