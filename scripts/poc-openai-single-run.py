"""SDD-14 POC 调试脚本：用平台 dispatcher 的真实请求直连 OpenAI runtime 单例计时。

用途：测量 native_quality_v0.2 各阶段真实耗时（SDD §63：超时调整必须先有
哪个 Stage/哪个 Tool/为什么慢 的证据）。非验收路径——最终验收走平台页面。

用法：
  cd server && .venv/bin/python ../scripts/poc-openai-single-run.py <run_id> [timeout_seconds]
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))

from app.db import SessionLocal
from app.models import Run
from app.runtime_providers.dispatcher import build_runtime_request

RUNTIME_URL = "http://127.0.0.1:8303"


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    source_run_id = sys.argv[1]
    timeout = int(sys.argv[2]) if len(sys.argv) > 2 else 1200

    db = SessionLocal()
    try:
        run = db.get(Run, source_run_id)
        if run is None:
            print(f"run {source_run_id} not found")
            return 2
        request = build_runtime_request(db, run, timeout_seconds=timeout)
    finally:
        db.close()

    payload = request.model_dump(mode="json")
    payload["run_id"] = f"poc-timing-{int(time.time())}"
    payload["idempotency_key"] = payload["run_id"]

    started = time.monotonic()
    with httpx.Client(timeout=30) as client:
        accepted = client.post(f"{RUNTIME_URL}/v1/runs", json=payload)
        accepted.raise_for_status()
        run_id = accepted.json()["run_id"]
        print(f"submitted -> {run_id} (timeout={timeout}s)")
        while True:
            time.sleep(5)
            state = client.get(f"{RUNTIME_URL}/v1/runs/{run_id}").json()
            elapsed = time.monotonic() - started
            print(f"  [{elapsed:6.1f}s] status={state['status']}")
            if state["status"] in ("succeeded", "failed", "cancelled"):
                break
            if elapsed > timeout + 60:
                print("client-side bail")
                return 1

    print(f"\nterminal: {state['status']} after {time.monotonic() - started:.1f}s")
    if state.get("error"):
        print("error:", json.dumps(state["error"], ensure_ascii=False))

    trace = state.get("trace") or []
    stage_events = [e for e in trace if e["type"].startswith("workflow/stage")]
    first_ts = None
    for event in stage_events:
        ts = event["timestamp"]
        if first_ts is None:
            first_ts = ts
        print(f"  {ts}  {event['type']:<28} {event.get('name') or '':<24} "
              f"{json.dumps(event.get('metadata') or {}, ensure_ascii=False)[:80]}")

    model_events = [e for e in trace if e["type"] == "ModelCallEndEvent"]
    tool_events = [e for e in trace if e["type"] == "ToolCallStartEvent"]
    print(f"\nmodel_calls={len(model_events)} tool_calls={len(tool_events)} "
          f"usage={json.dumps(state.get('usage') or {})}")
    if state.get("output"):
        print("output sample_id:", state["output"].get("sample_id"))
        print("labels:", json.dumps(state["output"].get("labels"), ensure_ascii=False))
        print("summary:", (state["output"].get("summary") or "")[:200])
    with open("/tmp/poc-openai-single-run.json", "w", encoding="utf-8") as fh:
        json.dump(state, fh, ensure_ascii=False, indent=2)
    print("\nfull state -> /tmp/poc-openai-single-run.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
