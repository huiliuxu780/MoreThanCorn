"""Validate smoke inputs, ground truth coverage, and fixture references."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parents[1]
SMOKE = ROOT / "datasets" / "smoke"
SCHEMA = ROOT / "schemas" / "call_record_input.schema.json"


def read_jsonl(path: Path) -> list[dict]:
    rows = []
    for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError as exc:
            raise ValueError(f"{path.name}:{line_no}: {exc}") from exc
    return rows


def main() -> int:
    schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
    inputs = read_jsonl(SMOKE / "call_records_v0.1.jsonl")
    truth = read_jsonl(SMOKE / "ground_truth_v0.1.jsonl")
    fixtures = json.loads((SMOKE / "tool_fixtures_v0.1.json").read_text(encoding="utf-8"))
    manifest = json.loads((SMOKE / "manifest_v0.1.json").read_text(encoding="utf-8"))

    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    errors: list[str] = []
    for row in inputs:
        for error in validator.iter_errors(row):
            path = ".".join(str(part) for part in error.absolute_path)
            errors.append(f"{row.get('sample_id', '?')}:{path}: {error.message}")

    input_ids = [row["sample_id"] for row in inputs]
    truth_ids = [row["sample_id"] for row in truth]
    if len(input_ids) != len(set(input_ids)):
        errors.append("duplicate sample_id in inputs")
    if len(truth_ids) != len(set(truth_ids)):
        errors.append("duplicate sample_id in ground truth")
    if set(input_ids) != set(truth_ids):
        errors.append("input and ground truth sample_id sets differ")
    if manifest["record_count"] != len(inputs):
        errors.append("manifest record_count does not match inputs")

    known_tools = set(fixtures)
    for row in truth:
        declared = set(row["required_tools"]) | set(row["forbidden_tools"])
        unknown = declared - known_tools
        if unknown:
            errors.append(f"{row['sample_id']}: unknown tools {sorted(unknown)}")
        overlap = set(row["required_tools"]) & set(row["forbidden_tools"])
        if overlap:
            errors.append(f"{row['sample_id']}: tools both required and forbidden {sorted(overlap)}")

    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    print(f"validated {len(inputs)} synthetic records and {len(truth)} ground-truth rows")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
