"""P01 — Agent creation, Session, multi-turn chat, SSE events, persistence.

Proves: agent CRUD, credential store, Session create/reuse, message
persistence, native AgentEvent stream, extra_agent_tools ToolBase effect.
"""
from __future__ import annotations

import json
import threading

from probes import common as C


def _assistant_text(payload: dict) -> str:
    out: list[str] = []
    for m in payload.get("messages", []):
        if m.get("role") != "assistant":
            continue
        for b in m.get("content", []):
            if isinstance(b, dict) and b.get("type") == "text":
                out.append(b.get("text", ""))
    return "\n".join(out)


def main() -> None:
    llm = C.resolve_llm()
    with C.client() as c:
        # 0. openapi snapshot as contract evidence
        spec = c.get("/openapi.json").json()
        with open(f"{C.EVIDENCE_DIR}/openapi-2.0.8.json", "w") as fh:
            json.dump(spec, fh, indent=1)
        C.evidence("p01", "openapi_paths", {"count": len(spec["paths"])})

        # 1. credential (secret never printed)
        r = c.post(
            "/credential/",
            json={
                "data": {
                    "type": "dashscope_credential",
                    "api_key": llm["api_key"],
                    "base_url": llm["base_url"],
                }
            },
        )
        r.raise_for_status()
        credential_id = r.json()["credential_id"]
        C.evidence(
            "p01",
            "credential",
            {"credential_id": credential_id, "key": C.mask(llm["api_key"])},
        )

        # 2. agent
        r = c.post(
            "/agent/",
            json={
                "name": "probe-p01",
                "system_prompt": (
                    "You are a precise probe assistant. Follow instructions "
                    "exactly. When asked to echo via tool, call probe_echo."
                ),
            },
        )
        r.raise_for_status()
        agent_id = r.json()["agent_id"]
        C.evidence("p01", "agent", {"agent_id": agent_id})

        model_cfg = {
            "type": "dashscope",
            "credential_id": credential_id,
            "model": llm["model"],
            "parameters": {},
        }

        # 3. session
        r = c.post(
            "/sessions/",
            json={
                "agent_id": agent_id,
                "name": "p01-turn-session",
                "chat_model_config": model_cfg,
            },
        )
        r.raise_for_status()
        session_id = r.json()["session_id"]
        C.evidence("p01", "session", {"session_id": session_id})

        # 4. stream consumer thread + chat turn 1 (codeword memorization)
        events: list[dict] = []

        def consume() -> None:
            events.extend(C.sse_events(session_id, agent_id, timeout=90))

        t = threading.Thread(target=consume, daemon=True)
        t.start()

        def turn(text: str) -> None:
            rr = c.post(
                "/chat/",
                json={
                    "agent_id": agent_id,
                    "session_id": session_id,
                    "input": {
                        "role": "user",
                        "name": "probe",
                        "content": [{"type": "text", "text": text}],
                    },
                },
            )
            rr.raise_for_status()

        turn(
            "Remember this codeword: ZULU-7741. Reply with exactly: "
            "STORED ZULU-7741"
        )
        C.wait_until(
            lambda: any(e.get("type") == "REPLY_END" for e in events),
            timeout=120,
        )
        t.join(timeout=5)
        types1 = sorted({e["type"] for e in events if e.get("type")})
        r = c.get(
            f"/sessions/{session_id}/messages", params={"agent_id": agent_id}
        )
        r.raise_for_status()
        turn1_text = _assistant_text(r.json())
        C.evidence(
            "p01",
            "turn1",
            {
                "event_count": len(events),
                "types": types1,
                "reply_text": turn1_text[:120],
                "recall_stored_ok": "STORED ZULU-7741" in turn1_text,
            },
        )

        # 5. turn 2 in SAME session: recall + tool use
        events2: list[dict] = []
        t2 = threading.Thread(
            target=lambda: events2.extend(
                C.sse_events(session_id, agent_id, timeout=90)
            ),
            daemon=True,
        )
        t2.start()
        turn(
            "What was the codeword? Then call the probe_echo tool with "
            "payload equal to the codeword, and finally reply with the tool "
            "output text."
        )
        C.wait_until(
            lambda: any(e.get("type") == "REPLY_END" for e in events2),
            timeout=120,
        )
        t2.join(timeout=5)
        blob2 = json.dumps(events2, ensure_ascii=False)
        r = c.get(
            f"/sessions/{session_id}/messages", params={"agent_id": agent_id}
        )
        r.raise_for_status()
        all_text = _assistant_text(r.json())
        C.evidence(
            "p01",
            "turn2",
            {
                "recall_ok": "ZULU-7741" in all_text,
                "tool_event_ok": "TOOL_CALL" in blob2 or "TOOL_RESULT" in blob2,
                "tool_effect_ok": "PROBE_ECHO::ZULU-7741" in blob2
                or "PROBE_ECHO::ZULU-7741" in all_text,
                "event_count": len(events2),
                "types": sorted({e["type"] for e in events2 if e.get("type")}),
            },
        )

        # 6. persistence: messages + status read back over HTTP
        r = c.get(
            f"/sessions/{session_id}/messages", params={"agent_id": agent_id}
        )
        r.raise_for_status()
        msgs = r.json()
        items = msgs if isinstance(msgs, list) else msgs.get("messages", msgs)
        roles = [m.get("role") for m in items]
        r = c.get(
            f"/sessions/{session_id}/status", params={"agent_id": agent_id}
        )
        r.raise_for_status()
        st = r.json()
        C.evidence(
            "p01",
            "persistence",
            {
                "message_count": len(items),
                "roles": roles,
                "status": st,
            },
        )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        C.fail("p01", "fatal", exc)
