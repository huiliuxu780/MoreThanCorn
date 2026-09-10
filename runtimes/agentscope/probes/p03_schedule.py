"""P03 — AgentScope native Schedule lifecycle and session semantics.

Proves against the official SchedulerManager:
- stateful=false: every fire creates a FRESH session (2 fires -> 2 sessions)
- pause (enabled=false) blocks new fires but keeps the record
- resume re-arms it
- stateful=true: consecutive fires reuse ONE session
- schedule sessions API is the execution history
- schedule prompt is delivered from ScheduleData.description
"""
from __future__ import annotations

import time

from probes import common as C


def _sessions(c, sid: str) -> list[dict]:
    r = c.get(f"/schedule/{sid}/sessions")
    r.raise_for_status()
    data = r.json()
    return data if isinstance(data, list) else data.get("sessions", [])


def _wait_fires(c, sid: str, n: int, timeout: float = 200.0) -> list[dict]:
    def cond():
        rows = _sessions(c, sid)
        return rows if len(rows) >= n else None

    return C.wait_until(cond, timeout=timeout, interval=5.0)


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
                "name": "probe-p03",
                "system_prompt": (
                    "You are woken by a scheduled task. Reply with exactly "
                    "one line: SCHED-OK."
                ),
            },
        ).json()["agent_id"]
        model_cfg = {
            "type": "dashscope",
            "credential_id": cid,
            "model": llm["model"],
            "parameters": {},
        }

        # stateless schedule, fires every minute
        r = c.post(
            "/schedule/",
            json={
                "name": "probe-stateless",
                "description": "Probe fire: reply SCHED-OK once.",
                "cron_expression": "* * * * *",
                "timezone": "Asia/Shanghai",
                "agent_id": aid,
                "chat_model_config": model_cfg,
                "enabled": True,
                "stateful": False,
            },
        )
        r.raise_for_status()
        sl = r.json()["schedule_id"]
        C.evidence("p03", "schedule_stateless_created", {"schedule_id": sl})

        rows = _wait_fires(c, sl, 2, timeout=200)
        ids = [x.get("session_id") or x.get("id") for x in rows]
        C.evidence(
            "p03",
            "stateless_fires",
            {"session_ids": ids, "fresh_each_fire": len(set(ids)) == len(ids)},
        )

        # pause blocks new fires
        r = c.patch(f"/schedule/{sl}", json={"enabled": False})
        r.raise_for_status()
        paused_count = len(_sessions(c, sl))
        time.sleep(75)
        after_pause = len(_sessions(c, sl))
        C.evidence(
            "p03",
            "pause_blocks_new_fires",
            {"at_pause": paused_count, "after_75s": after_pause},
        )

        # resume re-arms
        r = c.patch(f"/schedule/{sl}", json={"enabled": True})
        r.raise_for_status()
        _wait_fires(c, sl, paused_count + 1, timeout=200)
        C.evidence("p03", "resume_rearms", {"sessions": len(_sessions(c, sl))})

        # stateful schedule reuses one session
        r = c.post(
            "/schedule/",
            json={
                "name": "probe-stateful",
                "description": "Probe stateful fire: reply SCHED-OK once.",
                "cron_expression": "* * * * *",
                "timezone": "Asia/Shanghai",
                "agent_id": aid,
                "chat_model_config": model_cfg,
                "enabled": True,
                "stateful": True,
            },
        )
        sf = r.json()["schedule_id"]
        time.sleep(130)  # allow two fires
        srows = _sessions(c, sf)
        sids = [x.get("session_id") or x.get("id") for x in srows]
        C.evidence(
            "p03",
            "stateful_reuse",
            {"session_ids": sids, "single_session": len(set(sids)) == 1},
        )

        # prompt provenance: scheduled hint carries the description
        if sids:
            msgs = c.get(
                f"/sessions/{sids[0]}/messages", params={"agent_id": aid}
            ).json()
            blob = str(msgs)
            C.evidence(
                "p03",
                "prompt_from_description",
                {"description_in_first_user_turn": "Probe" in blob},
            )

        # cleanup: disable both (records retained as history)
        for sid in (sl, sf):
            c.patch(f"/schedule/{sid}", json={"enabled": False})
        C.evidence("p03", "cleanup_disabled", {"schedules": [sl, sf]})


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        C.fail("p03", "fatal", exc)
