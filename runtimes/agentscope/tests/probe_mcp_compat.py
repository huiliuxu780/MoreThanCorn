"""Probe AgentScope's MCP v1 client against the Tool Service v2 server."""

import asyncio
import json

from agentscope.mcp import HttpMCPConfig, MCPClient


async def main() -> None:
    client = MCPClient(
        name="quality-tools-probe",
        is_stateful=False,
        mcp_config=HttpMCPConfig(url="http://127.0.0.1:8200/mcp/"),
    )
    try:
        await client.connect()
        raw_tools = await client.list_raw_tools()
        print(json.dumps({"tools": sorted(tool.name for tool in raw_tools)}))
    finally:
        await client.close(ignore_errors=True)


if __name__ == "__main__":
    asyncio.run(main())
