"""P04 — interrupt (cancel) and error traceability on real sessions.

Proves:
- a running reply can be interrupted through the official endpoint and
  the session returns to idle with the interruption visible in events
- a genuine model-side failure surfaces as a REPLY_END error event with
  a classified error type (no silent success)
"""
from __future__ import annotations

import threading
import time

from probes import common as C


def _turn(c, agent_id: str, session_id: str, text: str) -> None:
    r = c.post(
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
    r.raise_for_status()


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
                "name": "probe-p04",
                "system_prompt": (
                    "When asked for a long essay, write at least 1500 words."
                ),
            },
        ).json()["agent_id"]
        model_cfg = {
            "type": "dashscope",
            "credential_id": cid,
            "model": llm["model"],
            "parameters": {},
        }
        sid = c.post(
            "/sessions/",
            json={"agent_id": aid, "chat_model_config": model_cfg},
        ).json()["session_id"]

        events: list[dict] = []
        t = threading.Thread(
            target=lambda: events.extend(
                C.sse_events(sid, aid, timeout=120, stop_when_idle=20)
            ),
            daemon=True,
        )
        t.start()
        _turn(
            c,
            aid,
            sid,
            "Write a 1500-word essay about lighthouses. Do not stop early.",
        )
        time.sleep(6)  # let the reply get going
        r = c.post(
            f"/sessions/{sid}/interrupt", params={"agent_id": aid}
        )
        C.evidence("p04", "interrupt_response", {"status": r.status_code})
        C.wait_until(
            lambda: any(e.get("type") == "REPLY_END" for e in events),
            timeout=60,
        )
        st = c.get(
            f"/sessions/{sid}/status", params={"agent_id": aid}
        ).json()
        end = [e for e in events if e.get("type") == "REPLY_END"]
        C.evidence(
            "p04",
            "interrupt",
            {
                "status_after": st.get("status"),
                "reply_end": end[-1]["data"] if end else None,
                "saw_interrupt_event": any(
                    "INTERRUPT" in (e.get("type") or "").upper()
                    for e in events
                ),
            },
        )

        # genuine model failure: bogus model name in a separate session
        bad_sid = c.post(
            "/sessions/",
            json={
                "agent_id": aid,
                "chat_model_config": {
                    "type": "dashscope",
                    "credential_id": cid,
                    "model": "no-such-model-xyz-404",
                    "parameters": {},
                },
            },
        ).json()["session_id"]
        ev2: list[dict] = []
        t2 = threading.Thread(
            target=lambda: ev2.extend(C.sse_events(bad_sid, aid, timeout=90)),
            daemon=True,
        )
        t2.start()
        _turn(c, aid, bad_sid, "say hi")
        C.wait_until(
            lambda: any(e.get("type") == "REPLY_END" for e in ev2), timeout=90
        )
        end2 = [e for e in ev2 if e.get("type") == "REPLY_END"]
        C.evidence(
            "p04",
            "error_traceable",
            {
                "finished_reason": (end2[-1]["data"] or {}).get(
                    "finished_reason"
                )
                if end2
                else None,
                "error": (end2[-1]["data"] or {}).get("error")
                if end2
                else None,
            },
        )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        C.fail("p04", "fatal", exc)
