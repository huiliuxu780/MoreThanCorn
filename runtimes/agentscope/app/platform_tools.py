"""Platform-owned AgentScope tools (official ToolBase extension point).

``run_workflow`` and ``run_agent_flow`` let an agent invoke MoreThanCorn
deterministic workflows and published AgentFlows through the platform's
single execution entry (HTTP callback with an internal token). These are
injected via ``create_app(extra_agent_tools=...)``; nothing in the
AgentScope kernel is modified.
"""
from __future__ import annotations

import os
from typing import Any

import httpx

from agentscope.message import TextBlock, ToolResultState
from agentscope.permission import PermissionBehavior, PermissionDecision
from agentscope.tool import ToolBase, ToolChunk

SERVER_URL = os.environ.get("MTC_SERVER_URL", "http://127.0.0.1:8120")
TOKEN = os.environ.get("MTC_INTERNAL_TOKEN", "")


async def _call_platform(
    path: str, payload: dict[str, Any], session_token: str | None = None
) -> ToolChunk:
    headers = {"X-MTC-Internal": TOKEN} if TOKEN else {}
    if session_token:
        # P0-08: per-session/flow-run binding token — the platform verifies it
        # against the session index hash and the release manifest
        headers["X-MTC-Session-Token"] = session_token
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            r = await client.post(
                f"{SERVER_URL}{path}", json=payload, headers=headers
            )
        if r.status_code >= 400:
            return ToolChunk(
                content=[
                    TextBlock(
                        type="text",
                        text=f"platform call failed: {r.status_code} {r.text[:300]}",
                    )
                ],
                state=ToolResultState.ERROR,
                is_last=True,
            )
        # 09-18（用户追问截断来源）：4000 ad-hoc 截断改为环境变量可配+显式标记；
        # 此前静默截断使模型在长转写上做半视图分析（批4分段偏差根因之一）
        import os as _os
        _cap = int(_os.environ.get("MTC_TOOL_RESULT_MAX", "24000"))
        _t = r.text
        if len(_t) > _cap:
            _t = _t[:_cap] + f"\n…[截断：原文 {len(_t)} 字，仅示前 {_cap} 字]"
        return ToolChunk(
            content=[TextBlock(type="text", text=_t)],
            state=ToolResultState.SUCCESS,
            is_last=True,
        )
    except Exception as exc:  # noqa: BLE001
        return ToolChunk(
            content=[
                TextBlock(type="text", text=f"platform unreachable: {exc!r}")
            ],
            state=ToolResultState.ERROR,
            is_last=True,
        )


def _session_token(session_id: str | None) -> str | None:
    if not session_id:
        return None
    from .internal_auth import get

    return get(session_id)


class RunWorkflowTool(ToolBase):
    name = "run_workflow"
    description = (
        "Execute a published MoreThanCorn deterministic workflow by id "
        "with a JSON input object and return its output."
    )
    input_schema = {
        "type": "object",
        "properties": {
            "workflow_id": {"type": "string"},
            "input": {"type": "object"},
        },
        "required": ["workflow_id", "input"],
    }
    is_concurrency_safe = False
    is_read_only = False

    def __init__(self, session_id: str | None = None) -> None:
        super().__init__()
        self._session_id = session_id

    async def call(self, workflow_id: str, input: dict) -> ToolChunk:  # noqa: A002
        return await _call_platform(
            "/api/internal/agent-tools/run-workflow",
            {"workflow_id": workflow_id, "input": input,
             "session_id": self._session_id or ""},
            session_token=_session_token(self._session_id),
        )

    async def check_permissions(self, tool_input, context):
        return PermissionDecision(
            behavior=PermissionBehavior.ALLOW,
            message="platform workflow invocation",
        )


class RunAgentFlowTool(ToolBase):
    name = "run_agent_flow"
    description = (
        "Execute a published MoreThanCorn AgentFlow (multi-agent pipeline) "
        "by id with a JSON input object and return its structured output."
    )
    input_schema = {
        "type": "object",
        "properties": {
            "agent_flow_id": {"type": "string"},
            "input": {"type": "object"},
        },
        "required": ["agent_flow_id", "input"],
    }
    is_concurrency_safe = False
    is_read_only = False

    def __init__(self, session_id: str | None = None) -> None:
        super().__init__()
        self._session_id = session_id

    async def call(self, agent_flow_id: str, input: dict) -> ToolChunk:  # noqa: A002
        return await _call_platform(
            "/api/internal/agent-tools/run-agent-flow",
            {"agent_flow_id": agent_flow_id, "input": input,
             "session_id": self._session_id or ""},
            session_token=_session_token(self._session_id),
        )

    async def check_permissions(self, tool_input, context):
        return PermissionDecision(
            behavior=PermissionBehavior.ALLOW,
            message="platform agentflow invocation",
        )


class PlatformHttpTool(ToolBase):
    """平台 Tool 目录条目 → 官方 ToolBase（P0-2 工具链运行时侧）。"""

    is_concurrency_safe = False
    is_read_only = False

    def __init__(self, spec: dict, session_id: str | None = None) -> None:
        super().__init__()
        self.name = spec["name"]
        self.description = spec.get("description") or spec["name"]
        self.input_schema = spec.get("input_schema") or {
            "type": "object",
            "properties": {},
        }
        self._tool_version_id = spec["tool_version_id"]
        self._session_id = session_id

    async def call(self, **kwargs) -> ToolChunk:
        return await _call_platform(
            "/api/internal/agent-tools/run-platform-tool",
            {"tool_version_id": self._tool_version_id, "args": kwargs,
             "session_id": self._session_id or ""},
            session_token=_session_token(self._session_id),
        )

    async def check_permissions(self, tool_input, context):
        return PermissionDecision(
            behavior=PermissionBehavior.ALLOW,
            message="platform catalog tool",
        )


async def platform_extra_tools(user_id: str, agent_id: str, session_id: str):
    tools: list[ToolBase] = [
        RunWorkflowTool(session_id), RunAgentFlowTool(session_id)
    ]
    token = _session_token(session_id)
    headers = {"X-MTC-Internal": TOKEN} if TOKEN else {}
    if token:
        headers["X-MTC-Session-Token"] = token
    import logging as _lg
    _log = _lg.getLogger("mtc.platform_tools")
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(
                f"{SERVER_URL}/api/internal/agent-tools/session-manifest",
                params={"session_id": session_id},
                headers=headers,
            )
            _log.warning("manifest fetch sid=%s status=%s token=%s",
                         session_id, r.status_code, bool(token))
            if r.status_code == 200:
                for spec in (r.json() or {}).get("tool_ids") or []:
                    tools.append(PlatformHttpTool(spec, session_id))
            else:
                _log.warning("manifest body=%s", r.text[:300])
    except Exception as exc:  # noqa: BLE001 —— 平台不可达时仅基础工具
        _log.warning("manifest fetch EXC sid=%s exc=%r", session_id, exc)
    _log.warning("extra tools sid=%s names=%s", session_id, [t.name for t in tools])
    return tools
