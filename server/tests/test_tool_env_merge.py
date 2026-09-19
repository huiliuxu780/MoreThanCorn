"""09-18 用户拍板：工具固定参数做环境变量——三层合并优先级单测。

连接 endpoint.env（连接通用）< 工具版本 spec.env（单工具绑定常量）< 运行时 args。
hermetic：monkeypatch httpx.request 捕获实际发送 body，不外呼。
"""
from __future__ import annotations

import pytest

import httpx
from app.db import SessionLocal
from app.models import Connection, Tool, ToolVersion
from app.platform_tool_exec import execute_tool_version

_M = "envmerge-t"


@pytest.fixture()
def env_rows():
    db = SessionLocal()
    conn = Connection(
        name=f"{_M}-conn", kind="none", protocol="http-api",
        endpoint={"base_url": "http://127.0.0.1:1",
                  "env": {"arg0": "conn-instance", "shared": "conn"}},
        secret_ref="")
    db.add(conn)
    db.flush()
    tool = Tool(name=f"{_M}-tool", description="env merge 单测", kind="http",
                status="ready", connection_id=conn.id)
    db.add(tool)
    db.flush()
    tv = ToolVersion(tool_id=tool.id, version_no=1, input_schema={},
                     output_schema={},
                     spec={"env": {"arg0": "spec-instance", "spec_only": "s"},
                           "request": {"method": "POST", "url": "/echo",
                                       "body": "$args"}},
                     status="ready")
    db.add(tv)
    db.commit()
    ids = (conn.id, tool.id, tv.id)
    db.close()
    yield ids
    db = SessionLocal()
    for cls, tid in ((ToolVersion, ids[2]), (Tool, ids[1]), (Connection, ids[0])):
        row = db.get(cls, tid)
        if row:
            db.delete(row)
            db.flush()
    db.commit()
    db.close()


def test_env_merge_precedence(env_rows, monkeypatch):
    captured: dict = {}

    def fake_request(method, url, headers=None, json=None, content=None,
                     timeout=None, follow_redirects=None):
        captured["json"] = json

        class _R:
            status_code = 200
            text = "{}"

            def json(self):
                return {"ok": True}
        return _R()

    monkeypatch.setattr(httpx, "request", fake_request)
    db = SessionLocal()
    try:
        execute_tool_version(db, env_rows[2],
                             {"arg2": "agent-acid", "shared": "agent"})
    finally:
        db.close()
    body = captured["json"]
    # spec.env 覆盖 conn.env（单工具绑定常量优先于连接通用值）
    assert body["arg0"] == "spec-instance"
    # spec.env 注入（调用方未传也有）
    assert body["spec_only"] == "s"
    # 调用方显式 args 最高优先
    assert body["shared"] == "agent"
    assert body["arg2"] == "agent-acid"


def test_conn_env_injected_when_no_spec_env(env_rows, monkeypatch):
    captured: dict = {}

    def fake_request(method, url, headers=None, json=None, content=None,
                     timeout=None, follow_redirects=None):
        captured["json"] = json

        class _R:
            status_code = 200
            text = "{}"

            def json(self):
                return {"ok": True}
        return _R()

    monkeypatch.setattr(httpx, "request", fake_request)
    db = SessionLocal()
    try:
        tv = db.get(ToolVersion, env_rows[2])
        tv.spec = {"request": {"method": "POST", "url": "/echo", "body": "$args"}}
        db.commit()
        execute_tool_version(db, env_rows[2], {"arg2": "x"})
    finally:
        db.close()
    # 无 spec.env 时 conn.env 生效
    assert captured["json"]["arg0"] == "conn-instance"
    assert captured["json"]["shared"] == "conn"
