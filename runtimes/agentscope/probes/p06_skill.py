"""P06 — Skill materialized into the AgentScope workspace and runtime.

Proves: upload a real SKILL.md folder into the session workspace via the
official route, list it via workspace skills, and observe the agent
actually loading and following it during a real chat turn.
"""
from __future__ import annotations

import threading

from probes import common as C
from probes.p01_session_chat import _assistant_text

SKILL_MD = """---
name: probe-vault
description: Provides the vault code when the user asks for it.
---

# Probe Vault Skill

When the user asks for the vault code, you must reply with exactly
VAULT-4242 and nothing else.
"""


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
                "name": "probe-p06",
                "system_prompt": (
                    "Follow any installed skill instructions precisely."
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

        data = SKILL_MD.encode()
        manifest = (
            '{"entries": [{"path": "probe-vault/SKILL.md", "size": %d}]}'
            % len(data)
        )
        r = c.post(
            "/workspace/skill/upload",
            params={"agent_id": aid, "session_id": sid},
            data={"manifest": manifest},
            files=[("files", ("SKILL.md", data, "text/markdown"))],
        )
        C.evidence("p06", "upload", {"status": r.status_code})
        r.raise_for_status()

        r = c.get(
            "/workspace/skill", params={"agent_id": aid, "session_id": sid}
        )
        r.raise_for_status()
        skills = r.json()
        names = [
            s.get("name") if isinstance(s, dict) else s
            for s in (skills if isinstance(skills, list) else [])
        ]
        C.evidence("p06", "workspace_skills", {"names": names})

        events: list[dict] = []
        t = threading.Thread(
            target=lambda: events.extend(C.sse_events(sid, aid, timeout=120)),
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
                        {"type": "text", "text": "What is the vault code?"}
                    ],
                },
            },
        )
        r.raise_for_status()
        C.wait_until(
            lambda: any(e.get("type") == "REPLY_END" for e in events),
            timeout=120,
        )
        text = _assistant_text(
            c.get(
                f"/sessions/{sid}/messages", params={"agent_id": aid}
            ).json()
        )
        C.evidence(
            "p06",
            "skill_effect",
            {
                "in_workspace": "probe-vault" in names,
                "reply": text[-80:],
                "skill_followed_ok": "VAULT-4242" in text,
                "tool_events": sorted(
                    {
                        e["type"]
                        for e in events
                        if "TOOL" in (e.get("type") or "")
                    }
                ),
            },
        )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        C.fail("p06", "fatal", exc)
