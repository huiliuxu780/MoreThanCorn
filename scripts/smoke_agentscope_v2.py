"""E2E smoke for the AgentScope 2.0.8 cutover (G4-G7 evidence).

Runs against backend 8120 + runtime 8301 with the REAL model.
Usage: server/.venv/bin/python ../scripts/smoke_agentscope_v2.py
"""
from __future__ import annotations

import sys
import time

import httpx

sys.path.insert(0, "/Users/rivers/MoreThanCorn/server")

from app.db import SessionLocal  # noqa: E402
from app.models import Agent, AgentVersion, Model  # noqa: E402

BASE = "http://127.0.0.1:8120"
RESULTS: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    RESULTS.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'} {name} {detail}", flush=True)


def main() -> None:
    db = SessionLocal()
    model = db.query(Model).filter(Model.model_key == "qwen-plus").first() or db.query(Model).first()
    config = {
        "identity": "You are CORTEX probe agent.",
        "bible": "Always answer briefly and truthfully.",
        "persona": "concise",
        "default_model_id": model.id,
    }
    agent = Agent(name=f"smoke-v2-{int(time.time())}", type="module", config=config)
    db.add(agent)
    db.commit()
    db.refresh(agent)
    version = AgentVersion(
        agent_id=agent.id, version_no=1, definition=config, common_config={}, dependency_snapshot={}, artifact_hash="smoke"
    )
    db.add(version)
    db.commit()
    db.refresh(version)
    aid, vid = agent.id, version.id
    db.close()

    with httpx.Client(base_url=BASE, timeout=180) as c:
        # A: release materialization + three-version visibility
        r = c.post(f"/api/v2/agents/{aid}/releases", json={"agent_version_id": vid})
        check("release_materialize", r.status_code == 200, r.text[:120])
        rv = c.get(f"/api/v2/agents/{aid}/runtime-view").json()
        check(
            "runtime_view_three_versions",
            bool(rv.get("editing") and rv.get("published") and rv.get("running"))
            and rv["running"].get("matches_published") is True,
            str(rv)[:200],
        )

        # C: session + turn + messages from runtime
        sid = c.post(f"/api/v2/agents/{aid}/sessions", json={}).json()["session_id"]
        r = c.post(f"/api/v2/agents/{aid}/sessions/{sid}/turns", json={"text": "Reply with exactly SMOKE-OK"})
        check("chat_turn_accepted", r.status_code == 200, r.text[:100])
        reply = ""
        for _ in range(60):
            msgs = c.get(f"/api/v2/agents/{aid}/sessions/{sid}/messages").json()["messages"]
            done = [m for m in msgs if m.get("role") == "assistant" and m.get("finished_reason")]
            if done:
                reply = "".join(b.get("text", "") for b in done[-1].get("content", []) if isinstance(b, dict))
                break
            time.sleep(2)
        check("agent_reply_real", "SMOKE-OK" in reply, reply[:80])

        # H: board projection sees the session row
        summary = c.get("/api/board/summary", params={"period": "30d"}).json()
        tasks = c.get("/api/board/tasks", params={"period": "30d", "keyword": agent.name}).json()
        check("board_projection", summary["total"] >= 1 and tasks["total"] >= 1, f"{summary} {tasks['total']}")

        # F: automation with schedule trigger + manual run + api invoke + dedupe
        r = c.post(
            "/api/v2/automations",
            json={
                "name": f"smoke-auto-{int(time.time())}",
                "target_kind": "agent",
                "agent_id": aid,
                "session_policy": "fresh",
                "prompt_template": "Reply with exactly AUTO-OK {{topic}}",
                "triggers": [{"kind": "schedule", "config": {"cron": "* * * * *", "timezone": "Asia/Shanghai"}}],
            },
        )
        auto = r.json()
        check("automation_create", r.status_code == 200 and bool(auto.get("runtime_schedule_id")), r.text[:160])
        r = c.post(f"/api/v2/automations/{auto['id']}/run-now")
        check("automation_run_now_manual", r.status_code == 200 and r.json().get("session_id"), r.text[:120])
        key = c.post(f"/api/v2/automations/{auto['id']}/api-keys").json()["key"]
        kid = c.get(f"/api/v2/automations/{auto['id']}").json()["id"]
        r = c.post(
            f"/api/v2/external/automations/{_key_id(c, auto['id'])}/invoke",
            json={"topic": "billing"},
            headers={"Authorization": f"Bearer {key}", "Idempotency-Key": "smoke-1"},
        )
        check("api_invoke_accepted", r.status_code == 200 and r.json().get("status") == "accepted", r.text[:120])
        r2 = c.post(
            f"/api/v2/external/automations/{_key_id(c, auto['id'])}/invoke",
            json={"topic": "billing"},
            headers={"Authorization": f"Bearer {key}", "Idempotency-Key": "smoke-1"},
        )
        check("api_invoke_dedupe", r2.json().get("status") == "deduped", r2.text[:120])

        # G: webhook ingress -> event trigger -> dispatch
        src = c.post("/api/v2/data-sources", json={"name": "smoke-wh", "kind": "webhook", "config": {"mapping": {"topic": "topic"}}}).json()
        c.post(f"/api/v2/automations/{auto['id']}/triggers", json={"kind": "event", "config": {"data_source_id": src["id"]}})
        r = c.post(
            f"/api/v2/ingress/webhook/{src['id']}",
            json={"id": "evt-1", "topic": "refund"},
            headers={"X-Source-Token": src["webhook_token"]},
        )
        check("webhook_ingest_dispatch", r.status_code == 200 and r.json().get("status") == "received", r.text[:120])

        # D: agentflow two-node run + selective node rerun
        flow = c.post("/api/v2/agentflows", json={"name": f"smoke-flow-{int(time.time())}"}).json()
        definition = {
            "nodes": [
                {"id": "n1", "kind": "agent", "agent_id": aid, "prompt_template": "Reply with exactly FLOW-ONE"},
                {
                    "id": "n2",
                    "kind": "agent",
                    "agent_id": aid,
                    "prompt_template": "Prior node said: {{n1}}. Reply with exactly FLOW-DONE",
                    "structured_schema": {
                        "type": "object",
                        "properties": {"decision": {"type": "string", "enum": ["pass", "reject"]}, "note": {"type": "string"}},
                        "required": ["decision"],
                    },
                },
            ],
            "edges": [{"from": "n1", "to": "n2"}],
        }
        ver = c.post(f"/api/v2/agentflows/{flow['id']}/versions", json={"definition": definition}).json()
        rel = c.post(f"/api/v2/agentflows/{flow['id']}/releases", json={"version_id": ver["id"]}).json()
        run = c.post("/api/v2/agentflows/runs", json={"release_id": rel["id"], "input": {}}).json()
        check("agentflow_run", run.get("status") == "succeeded", str(run)[:240])
        rr = c.post(f"/api/v2/agentflows/runs/{run['run_id']}/nodes/n1/rerun").json()
        check("agentflow_node_rerun", rr.get("attempt") == 2 and rr.get("status") == "succeeded", str(rr)[:160])

        # F: schedule fire statistics (wait one cron minute)
        hist = None
        for _ in range(40):
            hist = c.get(f"/api/v2/automations/{auto['id']}/history").json()
            if hist["auto_run_count"] >= 1:
                break
            time.sleep(5)
        check(
            "schedule_auto_stats_isolated",
            bool(hist) and hist["auto_run_count"] >= 1,
            f"auto={hist['auto_run_count'] if hist else None} manual_logs={len([i for i in (hist or {}).get('items', []) if i['source'] == 'manual'])}",
        )

    failed = [n for n, ok, _ in RESULTS if not ok]
    print("SMOKE_RESULT", "PASS" if not failed else f"FAIL:{failed}")


def _key_id(c: httpx.Client, automation_id: str) -> str:
    db = SessionLocal()
    from app.models import AutomationApiKey

    row = db.query(AutomationApiKey).filter_by(automation_id=automation_id).order_by(AutomationApiKey.created_at.desc()).first()
    kid = row.id
    db.close()
    return kid


if __name__ == "__main__":
    main()
