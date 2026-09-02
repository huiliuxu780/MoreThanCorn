"""Tool allowlisting and MCP gateway binding (SDD 14 §15/§16/§17).

安全边界（SDD 14 §15.2 三层白名单）：

    request.agent.tools ∩ module logical tools ∩ stage allowed_tools
        = actual agent tools

- request.agent.tools 由平台 dispatcher 从冻结 AgentVersion 组装，Module Agent 场景下
  恰好等于 manifest logicalTools（跨 Provider 一致性由平台侧钉扎测试保证）；
- stage allowed_tools 是本模块代码常量（identify/synthesize 为空集）；
- 交集之外的工具根本不会出现在 Agent 的工具集中——不是 Prompt 禁止，而是不存在。

工具本体仍在 services/tool_service（read-only fixture 查询）；本模块只做
ToolRef → SDK MCP 工具集 的适配，不实现企业业务逻辑。
"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlsplit, urlunsplit

DEFAULT_TOOL_MCP_URL = "http://127.0.0.1:8200/mcp/"


def resolve_stage_tools(request_tools: list[str], stage_allowed: list[str] | None) -> list[str]:
    """阶段硬白名单：只保留请求已声明的阶段工具（保序、去重）。

    stage_allowed 为 None 表示该阶段不做额外收窄（使用请求全集，例如通用执行路径）。
    """

    declared = set(request_tools)
    if stage_allowed is None:
        return [name for name in request_tools if name in declared]
    return [name for name in stage_allowed if name in declared]


def build_mcp_server(stage: str, allowed_tools: list[str], mcp_url: str) -> Any:
    """按阶段构建受限 MCP 服务器连接；allowed_tools 即客户端硬过滤白名单。

    每个 stage 独立连接（与 AgentScope runtime 的每阶段 MCPClient 同构），
    避免跨阶段工具泄漏；cache_tools_list=False 保证白名单即时生效。
    """

    from agents.mcp import MCPServerStreamableHttp

    safe_stage = re.sub(r"[^a-zA-Z0-9_-]", "-", stage) or "stage"
    return MCPServerStreamableHttp(
        params={"url": mcp_url, "timeout": 30.0},
        name=f"quality-tools-{safe_stage}",
        tool_filter=list(allowed_tools),
        cache_tools_list=False,
    )


def tool_gateway_health_url(mcp_url: str) -> str:
    """从 MCP 端点推导工具服务的 /health（同一进程挂载，端口约定 8200）。"""

    parts = urlsplit(mcp_url.strip() or DEFAULT_TOOL_MCP_URL)
    return urlunsplit((parts.scheme, parts.netloc, "/health", "", ""))
