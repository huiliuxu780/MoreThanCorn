"""平台 Tool 真实执行（审核 P0-2 工具链最后一公里）。

Release 资源清单中的平台 Tool 由运行时以官方 ToolBase 包装调用本模块；
执行走真实 HTTP 配方（连接鉴权 + Egress 闸），与 Workflow tool 节点同语义。
"""
from __future__ import annotations

import json
from typing import Any

import httpx
from sqlalchemy.orm import Session

from .auth_signers import build_auth_headers
from .connection_runtime import resolve_for_request
from .egress import assert_safe_url
from .models import Connection, Tool, ToolVersion


def _render(template: str, args: dict[str, Any]) -> str:
    out = template
    for k, v in (args or {}).items():
        out = out.replace("{{" + k + "}}", v if isinstance(v, str) else json.dumps(v, ensure_ascii=False))
    return out


def execute_tool_version(db: Session, tool_version_id: str, args: dict[str, Any]) -> dict:
    tv = db.get(ToolVersion, tool_version_id)
    if tv is None:
        raise ValueError(f"tool version {tool_version_id} not found")
    tool = db.get(Tool, tv.tool_id)
    if tool is None:
        raise ValueError(f"tool {tv.tool_id} not found")
    spec = tv.spec or {}
    req = spec.get("request") or {}
    if not req:
        raise ValueError(f"tool {tool.name} 无 request 配方（测试 fixture 不允许生产执行）")
    url = _render(req.get("url", ""), args)
    assert_safe_url(url)
    headers: dict[str, str] = {}
    if tool.connection_id:
        conn = db.get(Connection, tool.connection_id)
        if conn:
            _ep, payload, _code = resolve_for_request(conn)
            headers = build_auth_headers(conn.kind, payload, script=conn.auth_script)
    method = (req.get("method") or "POST").upper()
    body = args if req.get("body") == "$args" else (req.get("body") or None)
    if isinstance(body, str):
        body = _render(body, args)
    resp = httpx.request(method, url, headers=headers, json=body if not isinstance(body, str) else None,
                         content=body if isinstance(body, str) else None, timeout=60, follow_redirects=False)
    try:
        data = resp.json()
    except Exception:  # noqa: BLE001
        data = {"text": resp.text[:2000]}
    return {"status_code": resp.status_code, "body": data}
