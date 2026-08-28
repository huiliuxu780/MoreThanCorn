"""Send identical requests to both POC Runtime Providers and save raw results."""

from __future__ import annotations

import argparse
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

from .request_builder import build_request, list_sample_ids, request_fingerprint

TERMINAL = {"succeeded", "failed", "cancelled"}


def _execute(client: httpx.Client, base_url: str, body: dict[str, Any], timeout: float) -> dict[str, Any]:
    accepted = client.post(f"{base_url.rstrip('/')}/v1/runs", json=body)
    accepted.raise_for_status()
    run_id = accepted.json()["run_id"]
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        response = client.get(f"{base_url.rstrip('/')}/v1/runs/{run_id}")
        response.raise_for_status()
        result = response.json()
        if result["status"] in TERMINAL:
            return result
        time.sleep(0.25)
    raise TimeoutError(f"provider polling timed out for {run_id}")


def _atomic_write_json(path: Path, value: dict[str, Any]) -> None:
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def _provider_is_complete(result: Any, *, retry_failed: bool = False) -> bool:
    if not isinstance(result, dict) or result.get("status") not in TERMINAL:
        return False
    return not retry_failed or result.get("status") == "succeeded"


def _sample_is_complete(sample: Any, providers: set[str], *, retry_failed: bool = False) -> bool:
    if not isinstance(sample, dict):
        return False
    results = sample.get("providers")
    return isinstance(results, dict) and all(
        _provider_is_complete(results.get(name), retry_failed=retry_failed)
        for name in providers
    )


def _run_sample(
    sample_id: str,
    *,
    model: str,
    model_provider: str,
    timeout: float,
    endpoints: dict[str, str],
    existing: dict[str, Any] | None = None,
    retry_failed: bool = False,
) -> tuple[str, dict[str, Any]]:
    request = build_request(
        sample_id,
        model=model,
        model_provider=model_provider,
        timeout_seconds=int(timeout),
    )
    body = request.model_dump(mode="json")
    fingerprint = request_fingerprint(request)
    sample_results: dict[str, Any] = {
        "request_sha256": fingerprint,
        "providers": dict((existing or {}).get("providers", {})),
    }
    if existing and existing.get("request_sha256") not in {None, fingerprint}:
        raise ValueError(f"request changed for resumed sample {sample_id}")

    with httpx.Client(timeout=30.0) as client:
        for provider, endpoint in endpoints.items():
            if _provider_is_complete(
                sample_results["providers"].get(provider),
                retry_failed=retry_failed,
            ):
                continue
            started = time.monotonic()
            try:
                result = _execute(client, endpoint, body, timeout + 10)
            except Exception as exc:  # noqa: BLE001 - comparison must retain the other provider result
                result = {"status": "runner_error", "error": {"type": type(exc).__name__, "message": str(exc)}}
            result["runner_elapsed_seconds"] = round(time.monotonic() - started, 3)
            sample_results["providers"][provider] = result
    return sample_id, sample_results


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default=os.environ.get("QUALITY_MODEL_ID"), required=False)
    parser.add_argument("--model-provider", default="deepseek-compatible")
    parser.add_argument("--agentscope-url", default="http://127.0.0.1:8301")
    parser.add_argument("--dsh-url", default="http://127.0.0.1:8302")
    parser.add_argument("--sample-id", action="append", dest="sample_ids")
    parser.add_argument("--timeout", type=float, default=180.0)
    parser.add_argument("--concurrency", type=int, default=1)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument(
        "--retry-failed",
        action="store_true",
        help="With --resume, rerun failed/cancelled providers while preserving successes.",
    )
    args = parser.parse_args()
    if not args.model:
        parser.error("--model or QUALITY_MODEL_ID is required")
    if args.concurrency < 1:
        parser.error("--concurrency must be at least 1")
    if args.resume and args.output_dir is None:
        parser.error("--resume requires --output-dir")
    if args.retry_failed and not args.resume:
        parser.error("--retry-failed requires --resume")
    return args


def main() -> int:
    args = _parse_args()
    sample_ids = args.sample_ids or list_sample_ids()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    output_dir = args.output_dir or Path(__file__).resolve().parents[2] / "results" / stamp
    output_dir.mkdir(parents=True, exist_ok=args.resume)
    comparison_path = output_dir / "comparison.json"
    endpoints = {
        "agentscope": args.agentscope_url,
        "deepseek_harness": args.dsh_url,
    }
    if args.resume:
        if not comparison_path.exists():
            raise FileNotFoundError(f"cannot resume without {comparison_path}")
        summary = json.loads(comparison_path.read_text(encoding="utf-8"))
        if summary.get("model") != args.model or summary.get("model_provider", args.model_provider) != args.model_provider:
            raise ValueError("resume model configuration does not match existing comparison")
    else:
        summary = {
            "created_at": stamp,
            "model": args.model,
            "model_provider": args.model_provider,
            "timeout_seconds": args.timeout,
            "concurrency": args.concurrency,
            "samples": {},
        }
        _atomic_write_json(comparison_path, summary)

    provider_names = set(endpoints)
    pending = [
        sample_id
        for sample_id in sample_ids
        if not _sample_is_complete(
            summary["samples"].get(sample_id),
            provider_names,
            retry_failed=args.retry_failed,
        )
    ]
    print(f"comparison: {len(sample_ids) - len(pending)} complete, {len(pending)} pending", flush=True)
    with ThreadPoolExecutor(max_workers=args.concurrency) as executor:
        futures = {
            executor.submit(
                _run_sample,
                sample_id,
                model=args.model,
                model_provider=args.model_provider,
                timeout=args.timeout,
                endpoints=endpoints,
                existing=summary["samples"].get(sample_id),
                retry_failed=args.retry_failed,
            ): sample_id
            for sample_id in pending
        }
        for future in as_completed(futures):
            sample_id = futures[future]
            try:
                _, result = future.result()
            except Exception as exc:  # noqa: BLE001 - persist orchestration failures for resume
                result = {
                    "providers": {},
                    "runner_error": {"type": type(exc).__name__, "message": str(exc)},
                }
            summary["samples"][sample_id] = result
            _atomic_write_json(comparison_path, summary)
            statuses = {
                provider: provider_result.get("status", "missing")
                for provider, provider_result in result.get("providers", {}).items()
            }
            print(f"completed {sample_id}: {statuses}", flush=True)

    print(comparison_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
