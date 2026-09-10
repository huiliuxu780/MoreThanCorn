"""P10 — persistence and restart recovery of the official storage/bus.

Run a chat turn, stop the app process, start it again against the same
PostgreSQL storage + Redis bus, and read the session back: messages,
status and schedule records must survive with no re-seeding.
"""
from __future__ import annotations

import subprocess
import threading
import time

from probes import common as C
from probes.p01_session_chat import _assistant_text


def _serve_pid() -> str:
    with open(f"{C.EVIDENCE_DIR}/serve.pid") as fh:
        return fh.read().split()[1]


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
            json={"name": "probe-p10", "system_prompt": "Reply briefly."},
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
        events: list[dict] = []
        t = threading.Thread(
            target=lambda: events.extend(C.sse_events(sid, aid, timeout=90)),
            daemon=True,
        )
        t.start()
        c.post(
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
                            "text": "Reply with exactly: BEFORE-RESTART",
                        }
                    ],
                },
            },
        ).raise_for_status()
        C.wait_until(
            lambda: any(e.get("type") == "REPLY_END" for e in events),
            timeout=90,
        )
        before = _assistant_text(
            c.get(
                f"/sessions/{sid}/messages", params={"agent_id": aid}
            ).json()
        )

    # restart the app process
    pid = _serve_pid()
    subprocess.run(["kill", pid], check=False)
    time.sleep(3)
    with open(f"{C.EVIDENCE_DIR}/serve.log", "ab") as log:
        proc = subprocess.Popen(
            [
                f"{C.RUNTIME_ROOT}/.venv/bin/python",
                "-m",
                "probes.serve",
            ],
            cwd=C.RUNTIME_ROOT,
            stdout=log,
            stderr=log,
        )
    with open(f"{C.EVIDENCE_DIR}/serve.pid", "w") as fh:
        fh.write(f"pid {proc.pid}\n")
    C.wait_until(
        lambda: subprocess.run(
            ["curl", "-s", "-m", "2", f"{C.BASE}/health"],
            capture_output=True,
        ).returncode
        == 0,
        timeout=60,
    )

    with C.client() as c:
        msgs = c.get(
            f"/sessions/{sid}/messages", params={"agent_id": aid}
        ).json()
        after = _assistant_text(msgs)
        st = c.get(
            f"/sessions/{sid}/status", params={"agent_id": aid}
        ).json()
        ag = c.get(f"/agent/{aid}").json()
        C.evidence(
            "p10",
            "restart_recovery",
            {
                "before": before[:60],
                "after": after[:60],
                "messages_survived": "BEFORE-RESTART" in after,
                "status_after_restart": st.get("status"),
                "agent_survived": ag.get("name") == "probe-p10"
                or ag.get("data", {}).get("name") == "probe-p10",
            },
        )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        C.fail("p10", "fatal", exc)
