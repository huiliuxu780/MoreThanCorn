"""P02 — Session isolation and multi-turn reuse semantics.

Proves: two sessions of the same agent are isolated (codeword does not
leak), while turns inside one session share context (reuse).
"""
from __future__ import annotations

import threading

from probes import common as C
from probes.p01_session_chat import _assistant_text


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


def _wait_reply(events: list[dict]) -> None:
    C.wait_until(
        lambda: any(e.get("type") == "REPLY_END" for e in events), timeout=120
    )


def main() -> None:
    llm = C.resolve_llm()
    with C.client() as c:
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
        cid = r.json()["credential_id"]
        r = c.post(
            "/agent/",
            json={"name": "probe-p02", "system_prompt": "Answer briefly."},
        )
        aid = r.json()["agent_id"]
        model_cfg = {
            "type": "dashscope",
            "credential_id": cid,
            "model": llm["model"],
            "parameters": {},
        }
        s1 = c.post(
            "/sessions/",
            json={"agent_id": aid, "chat_model_config": model_cfg},
        ).json()["session_id"]
        s2 = c.post(
            "/sessions/",
            json={"agent_id": aid, "chat_model_config": model_cfg},
        ).json()["session_id"]
        C.evidence("p02", "sessions", {"s1": s1, "s2": s2, "distinct": s1 != s2})

        ev1: list[dict] = []
        t = threading.Thread(
            target=lambda: ev1.extend(C.sse_events(s1, aid, timeout=120)),
            daemon=True,
        )
        t.start()
        _turn(c, aid, s1, "Remember codeword ALPHA-9001. Reply: STORED")
        _wait_reply(ev1)

        # same session recalls
        ev1b: list[dict] = []
        t = threading.Thread(
            target=lambda: ev1b.extend(C.sse_events(s1, aid, timeout=120)),
            daemon=True,
        )
        t.start()
        _turn(c, aid, s1, "Reply with the codeword only.")
        _wait_reply(ev1b)
        txt1 = _assistant_text(
            c.get(
                f"/sessions/{s1}/messages", params={"agent_id": aid}
            ).json()
        )

        # other session must NOT know it
        ev2: list[dict] = []
        t = threading.Thread(
            target=lambda: ev2.extend(C.sse_events(s2, aid, timeout=120)),
            daemon=True,
        )
        t.start()
        _turn(
            c,
            aid,
            s2,
            "Was any codeword mentioned to you before this message? "
            "Answer YES or NO only.",
        )
        _wait_reply(ev2)
        txt2 = _assistant_text(
            c.get(
                f"/sessions/{s2}/messages", params={"agent_id": aid}
            ).json()
        )
        C.evidence(
            "p02",
            "isolation",
            {
                "same_session_recall_ok": "ALPHA-9001" in txt1,
                "other_session_answer": txt2[-80:],
                "isolated_ok": "ALPHA-9001" not in txt2 and "NO" in txt2.upper(),
            },
        )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        C.fail("p02", "fatal", exc)
