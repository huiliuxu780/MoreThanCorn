"""P07 — real MCP connection registered into the AgentScope toolkit.

Proves: an MCP server (the repo's own tool_service, real MCP protocol
over streamable HTTP) is added to the session workspace, recorded in the
library, discovered as tools, and actually invoked by the agent during a
real chat turn (TOOL_CALL/TOOL_RESULT events + result content).
"""
from __future__ import annotations

import threading

from probes import common as C
from probes.p01_session_chat import _assistant_text

MCP_URL = "http://127.0.0.1:8200/mcp/"


def main() -> None:
    llm = C.resolve_llm()
    with C.client() as c:
        cid = c.post(
            "/credential/",
            json={
                "data": {
                    "type": "dashscope_credential",
                    "api_key": llm["api_key"],
                    "base_url": llm["base_url"],
                }
            },
        ).json()["credential_id"]
        aid = c.post(
            "/agent/",
            json={
                "name": "probe-p07",
                "system_prompt": (
                    "Use the available MCP tools when they help answer."
                ),
            },
        ).json()["agent_id"]
        sid = c.post(
            "/sessions/",
            json={
                "agent_id": aid,
                "chat_model_config": {
                    "type": "dashscope",
                    "credential_id": cid,
                    "model": llm["model"],
                    "parameters": {},
                },
            },
        ).json()["session_id"]

        r = c.post(
            "/workspace/mcp",
            params={"agent_id": aid, "session_id": sid},
            json={
                "name": "quality-tools",
                "is_stateful": False,
                "mcp_config": {"type": "http_mcp", "url": MCP_URL},
            },
        )
        C.evidence("p07", "workspace_mcp_add", {"status": r.status_code})
        r.raise_for_status()

        r = c.get(
            "/workspace/mcp", params={"agent_id": aid, "session_id": sid}
        )
        r.raise_for_status()
        ws_mcps = r.json()
        r = c.get("/mcp")
        r.raise_for_status()
        lib = r.json()
        C.evidence(
            "p07",
            "mcp_registered",
            {
                "workspace": ws_mcps
                if isinstance(ws_mcps, list)
                else list(ws_mcps),
                "library_names": [
                    m.get("name")
                    for m in (lib if isinstance(lib, list) else [])
                    if isinstance(m, dict)
                ],
            },
        )

        events: list[dict] = []
        t = threading.Thread(
            target=lambda: events.extend(C.sse_events(sid, aid, timeout=150)),
            daemon=True,
        )
        t.start()
        r = c.post(
            "/chat/",
            json={
                "agent_id": aid,
                "session_id": sid,
                "input": {
                    "role": "user",
                    "name": "probe",
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                "Call the knowledge_search MCP tool with a "
                                "query about billing disputes and summarize "
                                "the first result."
                            ),
                        }
                    ],
                },
            },
        )
        r.raise_for_status()
        C.wait_until(
            lambda: any(e.get("type") == "REPLY_END" for e in events),
            timeout=150,
        )
        blob = str(events)
        text = _assistant_text(
            c.get(
                f"/sessions/{sid}/messages", params={"agent_id": aid}
            ).json()
        )
        C.evidence(
            "p07",
            "mcp_effect",
            {
                "tool_call_events": sorted(
                    {
                        e["type"]
                        for e in events
                        if "TOOL" in (e.get("type") or "")
                    }
                ),
                "mcp_tool_named_in_events": "knowledge_search" in blob,
                "reply_excerpt": text[-160:],
            },
        )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        C.fail("p07", "fatal", exc)
