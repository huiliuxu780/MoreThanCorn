"""Run repeated native-workflow executions and persist stability statistics."""

from __future__ import annotations

import argparse
import json
import os
import statistics
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

from .request_builder import NATIVE_WORKFLOW_ROOT, build_native_workflow_request, request_fingerprint
from .run_comparison import _atomic_write_json, _execute


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--provider", choices=("agentscope", "deepseek_harness"), required=True)
    parser.add_argument("--runs", type=int, default=10)
    parser.add_argument("--url")
    parser.add_argument("--model", default=os.environ.get("QUALITY_MODEL_ID"))
    parser.add_argument("--timeout", type=float, default=650.0)
    parser.add_argument("--output-dir", type=Path)
    args = parser.parse_args()
    if not args.model:
        parser.error("--model or QUALITY_MODEL_ID is required")
    if args.runs < 1:
        parser.error("--runs must be at least 1")
    if not args.url:
        args.url = "http://127.0.0.1:8301" if args.provider == "agentscope" else "http://127.0.0.1:8302"
    return args


def _percentile(values: list[float], percentile: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return round(ordered[0], 3)
    position = (len(ordered) - 1) * percentile
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    fraction = position - lower
    return round(ordered[lower] + (ordered[upper] - ordered[lower]) * fraction, 3)


def _native_checks(result: dict[str, Any], truth: dict[str, Any]) -> dict[str, bool]:
    output = result.get("output") if result.get("status") == "succeeded" else None
    if not isinstance(output, dict):
        return {"runtime_succeeded": False, "output_matches_ground_truth": False}

    needs = output.get("consumer_needs", [])
    categories = Counter(item.get("category") for item in needs if isinstance(item, dict))
    expected_categories = Counter(item["category"] for item in truth["consumer_needs"])
    knowledge = {
        item.get("claim_id"): item
        for item in output.get("knowledge_claims", [])
        if isinstance(item, dict)
    }
    promises = {
        item.get("promise_id"): item
        for item in output.get("promises", [])
        if isinstance(item, dict)
    }
    knowledge_ok = all(
        (actual := knowledge.get(expected["claim_id"])) is not None
        and actual.get("status") == expected["expected_status"]
        and len(actual.get("search_rounds", [])) >= expected["minimum_search_rounds"]
        and set(expected["required_evidence_refs"]).issubset(actual.get("evidence_refs", []))
        for expected in truth["knowledge_claims"]
    )
    promises_ok = all(
        (actual := promises.get(expected["promise_id"])) is not None
        and actual.get("type") == expected["type"]
        and actual.get("status") == expected["expected_status"]
        and actual.get("tool") == expected["required_tool"]
        for expected in truth["promises"]
    )
    workflow = output.get("workflow", {})
    expected_plan_count = len(truth["knowledge_claims"]) + len(truth["promises"])
    workflow_ok = (
        workflow.get("stage_order") == truth["required_stage_order"]
        and workflow.get("barrier_passed") is True
        and len(workflow.get("plans", [])) == expected_plan_count
        and all(plan.get("status") == "completed" for plan in workflow.get("plans", []))
    )
    tool_names = [
        str(event.get("name") or "")
        for event in result.get("trace", [])
        if event.get("type") in {"tool/call", "tool_call", "ToolCallStartEvent"}
    ]
    tools_ok = all(any(name.endswith(required) for name in tool_names) for required in truth["required_tools"])
    checks = {
        "runtime_succeeded": True,
        "sample_id": output.get("sample_id") == truth["sample_id"],
        "consumer_needs": all(categories[key] >= count for key, count in expected_categories.items()),
        "knowledge_claims": knowledge_ok,
        "promises": promises_ok,
        "workflow_barrier": workflow_ok,
        "required_tools": tools_ok,
    }
    checks["output_matches_ground_truth"] = all(checks.values())
    return checks


def _summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    succeeded = [row for row in rows if row["result"].get("status") == "succeeded"]
    correct = [row for row in rows if row["checks"].get("output_matches_ground_truth")]
    elapsed = [float(row["runner_elapsed_seconds"]) for row in rows]
    usage_fields = ("input_tokens", "output_tokens", "total_tokens", "model_calls", "tool_calls")
    usage: dict[str, Any] = {}
    for field in usage_fields:
        values = [int(row["result"].get("usage", {}).get(field, 0) or 0) for row in succeeded]
        usage[field] = {
            "mean": round(statistics.fmean(values), 2) if values else None,
            "min": min(values) if values else None,
            "max": max(values) if values else None,
        }
    errors = Counter(
        str(row["result"].get("error", {}).get("code") or row["result"].get("status"))
        for row in rows
        if row["result"].get("status") != "succeeded"
    )
    return {
        "runs": len(rows),
        "succeeded": len(succeeded),
        "success_rate": round(len(succeeded) / len(rows), 4) if rows else 0,
        "ground_truth_passed": len(correct),
        "ground_truth_pass_rate": round(len(correct) / len(rows), 4) if rows else 0,
        "elapsed_seconds": {
            "mean": round(statistics.fmean(elapsed), 3) if elapsed else None,
            "p50": _percentile(elapsed, 0.5),
            "p95": _percentile(elapsed, 0.95),
            "min": round(min(elapsed), 3) if elapsed else None,
            "max": round(max(elapsed), 3) if elapsed else None,
        },
        "usage": usage,
        "errors": dict(errors),
    }


def main() -> int:
    args = _parse_args()
    truth = json.loads((NATIVE_WORKFLOW_ROOT / "ground_truth_v0.2.json").read_text(encoding="utf-8"))
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    output_dir = args.output_dir or Path(__file__).resolve().parents[2] / "results" / f"stability-{stamp}"
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{args.provider}.json"
    report: dict[str, Any] = {
        "provider": args.provider,
        "model": args.model,
        "created_at": stamp,
        "requested_runs": args.runs,
        "rows": [],
        "summary": {},
    }
    with httpx.Client(timeout=30.0) as client:
        for index in range(1, args.runs + 1):
            request = build_native_workflow_request(
                model=args.model,
                timeout_seconds=int(args.timeout),
                run_suffix=f"stability-{stamp.lower()}-{index:02d}",
            )
            started = time.monotonic()
            try:
                result = _execute(client, args.url, request.model_dump(mode="json"), args.timeout + 10)
            except Exception as exc:  # noqa: BLE001 - persist and continue the stability campaign
                result = {
                    "status": "runner_error",
                    "error": {"type": type(exc).__name__, "message": str(exc)},
                }
            row = {
                "index": index,
                "request_sha256": request_fingerprint(request),
                "runner_elapsed_seconds": round(time.monotonic() - started, 3),
                "checks": _native_checks(result, truth),
                "result": result,
            }
            report["rows"].append(row)
            report["summary"] = _summary(report["rows"])
            _atomic_write_json(output_path, report)
            usage = result.get("usage", {})
            print(
                f"{args.provider} {index}/{args.runs}: {result.get('status')} "
                f"correct={row['checks'].get('output_matches_ground_truth')} "
                f"calls={usage.get('model_calls')} tokens={usage.get('total_tokens')} "
                f"elapsed={row['runner_elapsed_seconds']}s",
                flush=True,
            )
    print(json.dumps(report["summary"], ensure_ascii=False, indent=2), flush=True)
    print(output_path, flush=True)
    return 0 if report["summary"]["ground_truth_passed"] == args.runs else 1


if __name__ == "__main__":
    raise SystemExit(main())
