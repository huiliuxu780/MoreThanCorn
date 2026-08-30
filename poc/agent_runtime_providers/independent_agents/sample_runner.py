"""Normalize a real call and materialize two independent Runtime requests."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .normalizer import normalize_hotline_payload
from .recording import inspect_wav
from .request_builder import (
    build_consumer_analysis_request,
    build_quality_rules_request,
    load_rule_snapshot,
    validate_canonical_call,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--transcript", type=Path, required=True)
    parser.add_argument("--audio", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--model", default="poc-model")
    parser.add_argument("--rule-snapshot", type=Path)
    return parser.parse_args()


def _save(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    args = parse_args()
    payload = json.loads(args.transcript.read_text(encoding="utf-8"))
    call = normalize_hotline_payload(payload)
    if args.audio:
        call["recording_metadata"] = inspect_wav(args.audio)
    validate_canonical_call(call)
    rule_snapshot = load_rule_snapshot(args.rule_snapshot)
    acid = call["call"]["acid"]
    consumer = build_consumer_analysis_request(
        call,
        model=args.model,
        run_id=f"consumer-analysis-{acid}-sample",
    )
    quality = build_quality_rules_request(
        call,
        rule_snapshot=rule_snapshot,
        model=args.model,
        run_id=f"quality-rules-{acid}-sample",
        available_tools=(),
    )
    args.output_dir.mkdir(parents=True, exist_ok=True)
    _save(args.output_dir / "canonical_call.json", call)
    _save(args.output_dir / "consumer_analysis_request.json", consumer.model_dump(mode="json"))
    _save(args.output_dir / "quality_rules_request.json", quality.model_dump(mode="json"))
    transcript_duration_ms = call["call"]["ended_at_ms"] - call["call"]["started_at_ms"]
    summary = {
        "acid": acid,
        "messages": len(call["messages"]),
        "roles": {
            role: sum(message["role"] == role for message in call["messages"])
            for role in ("customer", "agent", "chatbot", "system", "unknown")
        },
        "transcript_duration_ms": transcript_duration_ms,
        "recording_metadata": call.get("recording_metadata"),
        "independent_run_ids": [consumer.run_id, quality.run_id],
        "agent_2_rule_count": len(rule_snapshot["evaluationRules"]),
        "agent_2_tools_in_sample_request": [tool.name for tool in quality.agent.tools],
    }
    _save(args.output_dir / "run_summary.json", summary)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
