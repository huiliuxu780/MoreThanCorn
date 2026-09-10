"""Shared helpers for the AgentScope 2.0.8 contract probes (G1 evidence).

Every probe prints machine-readable `EVIDENCE <probe> <key> <json>` lines.
Secrets are resolved in-process from the platform connection registry and
are NEVER printed; only masked prefixes appear in evidence.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time

import httpx

RUNTIME_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROBE_DIR = os.path.dirname(os.path.abspath(__file__))
EVIDENCE_DIR = os.path.join(PROBE_DIR, "evidence")
WS_ROOT = os.path.join(RUNTIME_ROOT, "var", "probe-workspaces")
BASE = os.environ.get("PROBE_BASE", "http://127.0.0.1:8401")
USER = "probe-user"
PROBE_DB_URL = os.environ.get(
    "PROBE_DB_URL", "postgresql+asyncpg:///wf_as_probe?host=/tmp"
)
REDIS_DB = 3

os.makedirs(EVIDENCE_DIR, exist_ok=True)
os.makedirs(WS_ROOT, exist_ok=True)


def mask(secret: str) -> str:
    if not secret:
        return "<empty>"
    return f"{secret[:6]}...{secret[-4:]} (len={len(secret)})"


def resolve_llm() -> dict:
    """Read the platform LLM connection (read-only) from wf_dev.

    Returns base_url / api_key / model. The key never leaves this process
    except inside HTTPS request bodies to the model endpoint.
    """
    out = subprocess.run(
        [
            "psql",
            "-d",
            "wf_dev",
            "-tAc",
            "select endpoint, secret_ref from connection "
            "where protocol='llm' and archived_at is null limit 1",
        ],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    if not out:
        raise RuntimeError("no protocol='llm' connection in wf_dev")
    endpoint, secret = out.split("|", 1)
    base_url = json.loads(endpoint)["base_url"]
    if secret.startswith("env1:"):
        raise RuntimeError(
            "envelope-encrypted secret requires WF_SECRET_KEY; "
            "resolve via server KMS instead"
        )
    model = os.environ.get("PROBE_MODEL", "qwen-plus")
    return {"base_url": base_url, "api_key": secret, "model": model}


def client() -> httpx.Client:
    return httpx.Client(
        base_url=BASE, headers={"X-User-ID": USER}, timeout=60.0
    )


def evidence(probe: str, key: str, payload: dict) -> None:
    line = f"EVIDENCE {probe} {key} {json.dumps(payload, ensure_ascii=False)}"
    print(line, flush=True)
    path = os.path.join(EVIDENCE_DIR, f"{probe}.jsonl")
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(
            json.dumps(
                {"ts": time.time(), "key": key, "payload": payload},
                ensure_ascii=False,
            )
            + "\n"
        )


def fail(probe: str, key: str, err: Exception) -> None:
    evidence(probe, key, {"error": f"{type(err).__name__}: {err}"})
    sys.exit(1)


def sse_events(
    session_id: str,
    agent_id: str,
    timeout: float = 120.0,
    stop_when_idle: float = 8.0,
) -> list[dict]:
    """Consume the session SSE stream.

    Frames are ``data:``-only (the AgentEvent JSON carries its own
    ``type``). Returns once no new event arrived for ``stop_when_idle``
    seconds, or on timeout.
    """
    headers = {"X-User-ID": USER, "Accept": "text/event-stream"}
    events: list[dict] = []
    cur_id = None
    cur_type = None
    data_buf: list[str] = []
    deadline = time.time() + timeout
    last_event_at = time.time()
    with httpx.Client(
        base_url=BASE, timeout=httpx.Timeout(timeout, read=timeout)
    ) as c:
        with c.stream(
            "GET",
            f"/sessions/{session_id}/stream",
            params={"agent_id": agent_id},
            headers=headers,
        ) as resp:
            resp.raise_for_status()
            for raw in resp.iter_lines():
                now = time.time()
                if now > deadline:
                    break
                if events and now - last_event_at > stop_when_idle:
                    break
                if raw == "":
                    if data_buf:
                        try:
                            data = json.loads("\n".join(data_buf))
                        except json.JSONDecodeError:
                            data = "\n".join(data_buf)
                        etype = cur_type
                        if isinstance(data, dict):
                            etype = etype or data.get("type")
                        events.append(
                            {"id": cur_id, "type": etype, "data": data}
                        )
                        last_event_at = now
                    cur_id, cur_type, data_buf = None, None, []
                    continue
                if raw.startswith("id:"):
                    cur_id = raw[3:].strip()
                elif raw.startswith("event:"):
                    cur_type = raw[6:].strip()
                elif raw.startswith("data:"):
                    data_buf.append(raw[5:].strip())
                # heartbeat comment frames (":" prefix) are ignored
    return events


def wait_until(fn, timeout: float = 90.0, interval: float = 1.0):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = fn()
        if last:
            return last
        time.sleep(interval)
    raise TimeoutError(f"condition not met within {timeout}s (last={last})")
