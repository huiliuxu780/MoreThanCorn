"""09-18 批跑波次编排器（控制面only：点火/等待/补投；分析全在 agent 工具链内）。

5 波 × page_size=100；每波完成后核对静默消失（completed 但会话无模型回复），
对其 acid 经 test-event 补投新事件重跑。结束后打印指标。
用法：server/.venv/bin/python assets/2026-09-18-trueask/run_batch_waves.py
"""
from __future__ import annotations

import json
import time

import httpx

BASE = "http://127.0.0.1:8120"
SRC = "656de0e522d044bda333c680ddbc903e"
AUTO = "3f0db0fc690c4044b9a98bee7ceb0491"
c = httpx.Client(base_url=BASE, timeout=300)


def invocations() -> list[dict]:
    return c.get(f"/api/v2/automations/{AUTO}/invocations",
                 params={"pageSize": 600}).json().get("items", [])


def wait_idle(timeout_s: int = 420) -> None:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        inv = invocations()
        if inv and all(i["status"] != "running" for i in inv):
            return
        time.sleep(15)
    print("  [warn] wait_idle timeout", flush=True)


def dropped_acids() -> list[tuple[str, str]]:
    """completed 但会话无模型回复的 (session_id, acid)。"""
    import psycopg
    conn = psycopg.connect(
        "dbname=wf_dev host=127.0.0.1 user=rivers", autocommit=True)
    rows = conn.execute("""
        SELECT t.session_id, e.payload->>'ACID', e.payload->>'serviceId'
        FROM automation_trigger_log t
        JOIN event_delivery d ON d.invocation_id = t.id
        JOIN data_source_event e ON e.id = d.event_id
        WHERE t.automation_id = %s AND t.status = 'completed' AND t.session_id != ''
          AND (SELECT count(*) FROM messages m WHERE m.session_id = t.session_id) <= 1
    """, (AUTO,)).fetchall()
    conn.close()
    return [(r[1], r[2]) for r in rows]


def main() -> None:
    for wave in range(1, 6):
        r = c.post(f"/api/v2/data-sources/{SRC}/poll")
        print(f"wave {wave} poll:", r.json(), flush=True)
        wait_idle()
        drops = dropped_acids()
        print(f"wave {wave} dropped: {len(drops)}", flush=True)
        for acid, servicer in drops:
            c.post(f"/api/v2/data-sources/{SRC}/test-event",
                   json={"ACID": acid, "serviceId": servicer,
                         "record_id": f"re-{acid}"})
        if drops:
            wait_idle(240)
    inv = invocations()
    done = sum(1 for i in inv if i["status"] == "completed")
    print(f"FINAL invocations completed={done} total={len(inv)}", flush=True)


if __name__ == "__main__":
    main()
