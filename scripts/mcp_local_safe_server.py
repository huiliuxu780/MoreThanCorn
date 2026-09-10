"""P0-H 本地安全 MCP 服务器（streamable-http，127.0.0.1:8310）。

仅一个无副作用工具 safe_echo，用于验证 MCP 真实注册 → Workspace 挂载 →
工具发现 → 调用闭环（任务书 §十）。不暴露任何敏感能力。

Usage: runtimes/agentscope/.venv/bin/python scripts/mcp_local_safe_server.py
"""
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("safe-mcp-echo", host="127.0.0.1", port=8310)


@mcp.tool()
def safe_echo(text: str) -> str:
    """原样回显输入文本（本地安全测试工具，无副作用）。"""
    return f"ECHO:{text}"


if __name__ == "__main__":
    mcp.run(transport="streamable-http")
