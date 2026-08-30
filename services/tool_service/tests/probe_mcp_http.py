"""Manual/E2E probe for a running Tool Service on localhost:8200."""

import asyncio
import json

from mcp import Client


async def main() -> None:
    async with Client("http://127.0.0.1:8200/mcp/") as client:
        tools = await client.list_tools()
        result = await client.call_tool(
            "ticket_query",
            {"case_id": "CASE-SYN-C02"},
        )
        print(
            json.dumps(
                {
                    "tools": sorted(tool.name for tool in tools.tools),
                    "ticket": result.structured_content,
                },
                ensure_ascii=False,
            )
        )


if __name__ == "__main__":
    asyncio.run(main())
