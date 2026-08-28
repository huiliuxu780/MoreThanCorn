"""Evaluate raw provider results against deterministic smoke Ground Truth."""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any

from .request_builder import SMOKE_ROOT, _jsonl

INTERNAL_TOOLS = {"GenerateStructuredOutput", "generate_structured_output"}


def _tool_calls(run: dict[str, Any]) -> list[str]:
    calls: list[str] = []
    for event in run.get("trace", []):
        if event.get("type") not in {"ToolCallStartEvent", "tool/call"}:
            continue
        name = event.get("name")
        if not isinstance(name, str) or name in INTERNAL_TOOLS:
            continue
        if name.startswith("mcp__") and "__" in name:
            name = name.rsplit("__", 1)[-1]
        calls.append(name)
    return calls


def _evidence_present(expected: set[str], actual: set[Any]) -> bool:
    actual_strings = {value for value in actual if isinstance(value, str)}
    return all(
        any(
            re.search(
                rf"(?<![A-Za-z0-9_-]){re.escape(wanted)}(?![A-Za-z0-9_-])",
                reference,
            )
            for reference in actual_strings
        )
        for wanted in expected
    )


def evaluate_run(run: dict[str, Any], truth: dict[str, Any]) -> dict[str, Any]:
    output = run.get("output") if isinstance(run.get("output"), dict) else {}
    findings = {
        item.get("criterion"): item.get("status")
        for item in output.get("findings", [])
        if isinstance(item, dict)
    }
    evidence_refs = {
        evidence.get("reference")
        for item in output.get("findings", [])
        if isinstance(item, dict)
        for evidence in item.get("evidence", [])
        if isinstance(evidence, dict)
    }
    calls = _tool_calls(run)
    call_counts = Counter(calls)
    required = set(truth["required_tools"])
    forbidden = set(truth["forbidden_tools"])
    expected_evidence = set(truth.get("expected_evidence_refs", []))
    checks = {
        "runtime_succeeded": run.get("status") == "succeeded",
        "finding_statuses_match": findings == truth["expected_findings"],
        "issue_codes_match": set(output.get("labels", {}).get("issue_codes", []))
        == set(truth["expected_issue_codes"]),
        "required_tools_called": required.issubset(calls),
        "forbidden_tools_not_called": forbidden.isdisjoint(calls),
        "expected_evidence_present": _evidence_present(expected_evidence, evidence_refs),
    }
    return {
        "passed": all(checks.values()),
        "checks": checks,
        "actual_findings": findings,
        "tool_call_counts": dict(sorted(call_counts.items())),
        "duplicate_tool_calls": sorted(name for name, count in call_counts.items() if count > 1),
        "error": run.get("error"),
    }


def evaluate_comparison(comparison: dict[str, Any]) -> dict[str, Any]:
    truths = {
        row["sample_id"]: row
        for row in _jsonl(SMOKE_ROOT / "ground_truth_v0.1.jsonl")
    }
    samples: dict[str, Any] = {}
    for sample_id, sample in comparison["samples"].items():
        truth = truths[sample_id]
        samples[sample_id] = {
            provider: evaluate_run(run, truth)
            for provider, run in sample["providers"].items()
        }
    provider_totals: dict[str, dict[str, int]] = {}
    providers = sorted(
        {provider for sample in samples.values() for provider in sample}
    )
    for provider in providers:
        rows = [sample[provider] for sample in samples.values() if provider in sample]
        provider_totals[provider] = {
            "passed": sum(row["passed"] for row in rows),
            "total": len(rows),
        }
    return {"provider_totals": provider_totals, "samples": samples}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "comparison",
        type=Path,
        nargs="+",
        help="One or more comparison files; later files replace duplicate sample IDs.",
    )
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    comparison: dict[str, Any] = {"samples": {}}
    for path in args.comparison:
        current = json.loads(path.read_text(encoding="utf-8"))
        comparison["samples"].update(current["samples"])
    result = evaluate_comparison(comparison)
    result["sources"] = [str(path) for path in args.comparison]
    output = args.output or args.comparison[0].with_name("evaluation.json")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result["provider_totals"], ensure_ascii=False))
    print(output)
    return 0 if all(row["passed"] == row["total"] for row in result["provider_totals"].values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
