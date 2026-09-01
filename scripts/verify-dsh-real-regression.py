#!/usr/bin/env python3
"""Verify real DSH regression runs without printing transcript or model text."""
from __future__ import annotations

import argparse
import json
import statistics
import sys
from pathlib import Path
from typing import Any

import httpx
from sqlalchemy import text


REPO_ROOT = Path(__file__).resolve().parents[1]
SERVER_ROOT = REPO_ROOT / "server"
EXPECTED_SAMPLES = [f"sample-{number:03d}" for number in range(1, 21)]
EXPECTED_RULES = [f"QA-{number:03d}" for number in range(1, 11)]


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser()
    p.add_argument("--api", default="http://127.0.0.1:8120")
    p.add_argument("--runtime", default="http://127.0.0.1:8302")
    p.add_argument("--quality-task-run", required=True)
    p.add_argument("--consumer-task-run", required=True)
    p.add_argument("--rule-version", required=True)
    return p


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def get(client: httpx.Client, path: str) -> Any:
    response = client.get(path)
    response.raise_for_status()
    return response.json()


def evidence_indexes(output: dict[str, Any], kind: str) -> list[int]:
    indexes: list[int] = []
    if kind == "quality":
        for result in output.get("results", []):
            for evidence in result.get("evidence", []):
                indexes.extend(evidence.get("message_indexes", []))
    else:
        for segment in output.get("segments", []):
            indexes.extend(segment.get("evidence_message_indexes", []))
            for entity in segment.get("entities", []):
                indexes.extend(entity.get("evidence_message_indexes", []))
    return indexes


def verify_runtime_run(
    runtime: dict[str, Any],
    *,
    kind: str,
    interaction_ref: str,
    message_count: int,
    rule_set_id: str,
    rule_set_version: int,
) -> dict[str, int]:
    require(runtime.get("status") == "succeeded", f"{kind} runtime failed: {interaction_ref}")
    require(runtime.get("error") is None, f"{kind} runtime has error: {interaction_ref}")
    usage = runtime.get("usage") or {}
    require(usage.get("model_calls") == 1, f"unexpected model call count: {interaction_ref}")
    require(usage.get("tool_calls") == 0, f"tool call detected: {interaction_ref}")
    output = runtime.get("output") or {}
    indexes = evidence_indexes(output, kind)
    require(all(isinstance(i, int) and 0 <= i < message_count for i in indexes),
            f"evidence index out of range: {interaction_ref}")

    if kind == "quality":
        results = output.get("results") or []
        require([row.get("rule_id") for row in results] == EXPECTED_RULES,
                f"quality rule order mismatch: {interaction_ref}")
        expected_map = {row["rule_id"]: row["result"] for row in results}
        require(output.get("result_by_rule") == expected_map,
                f"quality rule map mismatch: {interaction_ref}")
        require(output.get("rule_set_id") == rule_set_id,
                f"quality rule set mismatch: {interaction_ref}")
        require(output.get("rule_set_version") == rule_set_version,
                f"quality rule version mismatch: {interaction_ref}")
        require("score" not in output, f"model returned forbidden score: {interaction_ref}")
    else:
        segments = output.get("segments") or []
        previous_end = -1
        for number, segment in enumerate(segments, start=1):
            start = segment.get("start_index")
            end = segment.get("end_index")
            require(segment.get("segment_id") == f"segment-{number}",
                    f"consumer segment id mismatch: {interaction_ref}")
            require(isinstance(start, int) and isinstance(end, int),
                    f"consumer segment bounds missing: {interaction_ref}")
            require(previous_end < start <= end < message_count,
                    f"consumer segment overlap/range error: {interaction_ref}")
            previous_end = end

    return {
        "input_tokens": int(usage.get("input_tokens", 0) or 0),
        "output_tokens": int(usage.get("output_tokens", 0) or 0),
        "model_calls": int(usage.get("model_calls", 0) or 0),
        "tool_calls": int(usage.get("tool_calls", 0) or 0),
    }


def main() -> int:
    args = parser().parse_args()
    sys.path.insert(0, str(SERVER_ROOT))
    from app.db import SessionLocal

    db = SessionLocal()
    try:
        rows = db.execute(text(
            "select sample_id, jsonb_array_length(canonical_call->'messages') "
            "from wf_dev.public.dsh_real_regression_v1 order by sample_id"
        )).all()
        message_counts = {str(sample_id): int(count) for sample_id, count in rows}
        rule_row = db.execute(text(
            "select rule_set_id, version_no, rules from result_rule_version where id=:id"
        ), {"id": args.rule_version}).one()
        rule_set_version = int(rule_row[1])
        frozen_rules = rule_row[2]
        require(isinstance(frozen_rules, dict) and isinstance(frozen_rules.get("ruleSetId"), str),
                "frozen rules are missing business ruleSetId")
        rule_set_id = frozen_rules["ruleSetId"]
    finally:
        db.close()
    require(sorted(message_counts) == EXPECTED_SAMPLES, "frozen dataset is not sample-001..020")

    api = httpx.Client(base_url=args.api.rstrip("/"), timeout=30)
    runtime_api = httpx.Client(base_url=args.runtime.rstrip("/"), timeout=30)
    summaries: dict[str, Any] = {}
    all_usage = {"input_tokens": 0, "output_tokens": 0, "model_calls": 0, "tool_calls": 0}
    try:
        for kind, task_run_id in (
            ("quality", args.quality_task_run),
            ("consumer", args.consumer_task_run),
        ):
            task_run = get(api, f"/api/task-runs/{task_run_id}")
            require(task_run.get("status") == "succeeded", f"{kind} TaskRun not succeeded")
            require(task_run.get("total") == 20 and task_run.get("succeeded") == 20,
                    f"{kind} TaskRun count mismatch")
            require(task_run.get("failed") == 0 and task_run.get("cancelled") == 0,
                    f"{kind} TaskRun has terminal errors")
            snapshot = get(api, f"/api/task-runs/{task_run_id}/snapshot")["dataSnapshot"]
            require(snapshot.get("expectedCount") == 20 and snapshot.get("readCount") == 20,
                    f"{kind} snapshot count mismatch")
            runs = get(api, f"/api/task-runs/{task_run_id}/runs")["items"]
            require(len(runs) == 20, f"{kind} platform Run count mismatch")
            require(sorted(row["interactionRef"] for row in runs) == EXPECTED_SAMPLES,
                    f"{kind} sample coverage mismatch")

            usage = {"input_tokens": 0, "output_tokens": 0, "model_calls": 0, "tool_calls": 0}
            durations: list[int] = []
            for row in runs:
                ref = row["interactionRef"]
                require(row.get("status") == "succeeded", f"{kind} platform Run failed: {ref}")
                runtime_run = get(runtime_api, f"/v1/runs/{row['id']}")
                current = verify_runtime_run(
                    runtime_run,
                    kind=kind,
                    interaction_ref=ref,
                    message_count=message_counts[ref],
                    rule_set_id=rule_set_id,
                    rule_set_version=rule_set_version,
                )
                for key, value in current.items():
                    usage[key] += value
                    all_usage[key] += value
                durations.append(int(row.get("durationMs", 0) or 0))

            quality_results = get(api, f"/api/task-runs/{task_run_id}/results")["items"]
            if kind == "quality":
                require(len(quality_results) == 20, "QualityResult count mismatch")
                require(sorted(row["interactionRef"] for row in quality_results) == EXPECTED_SAMPLES,
                        "QualityResult sample coverage mismatch")
                require(all(row.get("ruleVersionId") == args.rule_version for row in quality_results),
                        "QualityResult rule version mismatch")
                scores = [float(row["score"]) for row in quality_results]
                result_summary = {
                    "quality_results": 20,
                    "score_min": min(scores),
                    "score_max": max(scores),
                    "score_average": round(statistics.fmean(scores), 2),
                }
            else:
                require(not quality_results, "consumer task produced QualityResult rows")
                result_summary = {"quality_results": 0}
            summaries[kind] = {
                "task_run_id": task_run_id,
                "runs": 20,
                "succeeded": 20,
                "failed": 0,
                "duration_ms_min": min(durations),
                "duration_ms_max": max(durations),
                "duration_ms_average": round(statistics.fmean(durations)),
                "usage": usage,
                **result_summary,
            }
    finally:
        api.close()
        runtime_api.close()

    require(all_usage["model_calls"] == 40, "total model call count is not 40")
    require(all_usage["tool_calls"] == 0, "total tool call count is not zero")
    print(json.dumps({
        "ok": True,
        "dataset": {"samples": 20, "sample_ids": "sample-001..sample-020"},
        "rule_version_id": args.rule_version,
        "runs": summaries,
        "total_usage": all_usage,
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
