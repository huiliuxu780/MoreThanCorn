"""Run the shared complex workflow against one local Runtime Provider."""

from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import httpx

from .request_builder import build_native_workflow_request, request_fingerprint
from .run_comparison import _execute


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--provider", choices=("agentscope", "deepseek_harness"), required=True)
    parser.add_argument("--url")
    parser.add_argument("--model", default=os.environ.get("QUALITY_MODEL_ID"))
    parser.add_argument("--timeout", type=float, default=650.0)
    parser.add_argument("--output-dir", type=Path)
    args = parser.parse_args()
    if not args.model:
        parser.error("--model or QUALITY_MODEL_ID is required")
    if not args.url:
        args.url = "http://127.0.0.1:8301" if args.provider == "agentscope" else "http://127.0.0.1:8302"
    return args


def main() -> int:
    args = parse_args()
    request = build_native_workflow_request(
        model=args.model,
        timeout_seconds=int(args.timeout),
    )
    started = datetime.now(timezone.utc)
    with httpx.Client(timeout=30.0) as client:
        result = _execute(
            client,
            args.url,
            request.model_dump(mode="json"),
            args.timeout + 10,
        )
    stamp = started.strftime("%Y%m%dT%H%M%SZ")
    output_dir = args.output_dir or (
        Path(__file__).resolve().parents[2] / "results" / f"native-{stamp}"
    )
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{args.provider}.json"
    output_path.write_text(
        json.dumps(
            {
                "provider": args.provider,
                "request_sha256": request_fingerprint(request),
                "result": result,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"{args.provider}: {result['status']}")
    print(output_path)
    return 0 if result["status"] == "succeeded" else 1


if __name__ == "__main__":
    raise SystemExit(main())
