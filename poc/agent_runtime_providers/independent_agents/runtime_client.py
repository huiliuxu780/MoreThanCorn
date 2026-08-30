"""Small CLI for submitting one independent request to a Runtime Provider."""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen


TERMINAL_STATUSES = {"succeeded", "failed", "cancelled"}


def _request_json(url: str, *, body: dict[str, Any] | None = None) -> dict[str, Any]:
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    request = Request(
        url,
        data=data,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST" if body is not None else "GET",
    )
    with urlopen(request, timeout=30) as response:  # noqa: S310 - operator supplies local runtime URL
        value = json.loads(response.read().decode("utf-8"))
    if not isinstance(value, dict):
        raise ValueError("Runtime response root must be an object")
    return value


def execute_runtime_request(
    body: dict[str, Any],
    *,
    base_url: str,
    timeout_seconds: float = 360,
    poll_interval_seconds: float = 0.5,
) -> dict[str, Any]:
    base = base_url.rstrip("/")
    accepted = _request_json(f"{base}/v1/runs", body=body)
    run_id = str(accepted["run_id"])
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        result = _request_json(f"{base}/v1/runs/{run_id}")
        if result.get("status") in TERMINAL_STATUSES:
            return result
        time.sleep(poll_interval_seconds)
    raise TimeoutError(f"Runtime polling timed out for {run_id}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--base-url", default="http://127.0.0.1:8302")
    parser.add_argument("--timeout", type=float, default=360)
    args = parser.parse_args()

    body = json.loads(args.request.read_text(encoding="utf-8"))
    result = execute_runtime_request(body, base_url=args.base_url, timeout_seconds=args.timeout)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"run_id": result.get("run_id"), "status": result.get("status")}))
    return 0 if result.get("status") == "succeeded" else 1


if __name__ == "__main__":
    raise SystemExit(main())
