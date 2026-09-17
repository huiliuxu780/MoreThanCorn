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
from .connection_runtime import ToolUrlError, resolve_for_request, resolve_tool_url
from .egress import enforce_egress
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
    # 09-14 OpenAPI 初始化轮：执行面状态闸门——非 ready（disabled/archived 等）
    # 失败关闭，杜绝「界面停用但引用仍可执行」的僵尸路径
    if (tool.status or "ready") != "ready":
        raise ValueError(f"工具 {tool.name} 状态为 {tool.status}：执行面失败关闭（仅 ready 可执行）")
    spec = tv.spec or {}
    req = spec.get("request") or {}
    if not req:
        raise ValueError(f"tool {tool.name} 无 request 配方（测试 fixture 不允许生产执行）")
    conn = db.get(Connection, tool.connection_id) if tool.connection_id else None
    try:
        url = resolve_tool_url(_render(req.get("url", ""), args), conn)
    except ToolUrlError as exc:
        raise ValueError(str(exc)) from exc
    # 09-18 端到端：与平台统一出站闸门对齐（生产拦私网、开发放行本地 fixture）；
    # 此前直调 assert_safe_url 比平台策略更严，dev fixture 工具被误拦。
    enforce_egress(url)
    headers: dict[str, str] = {}
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
