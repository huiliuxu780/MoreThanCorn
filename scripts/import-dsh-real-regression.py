#!/usr/bin/env python3
"""Verify and import the frozen DSH real-input regression dataset.

The imported table is deliberately one row per hotline interaction.  Both DSH
Modules consume the same canonical object, so transcript messages stay inside
``canonical_call`` JSONB instead of being split into a second mutable table.

This script never prints record bodies because this dataset is classified as
personal-data-local-only.  The import is idempotent and transactional.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import jsonschema
import psycopg
from psycopg.types.json import Jsonb


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATASET = (
    REPO_ROOT
    / "poc/agent_runtime_providers/.artifacts/real_datasets/dsh-independent-real-v1"
)
SCHEMA_PATH = (
    REPO_ROOT / "server/app/agent_modules/shared/hotline_call_input.schema.json"
)
TABLE = "dsh_real_regression_v1"


def _json_bytes(path: Path) -> tuple[bytes, dict]:
    body = path.read_bytes()
    value = json.loads(body)
    if not isinstance(value, dict):
        raise ValueError(f"{path.name}: expected a JSON object")
    return body, value


def _sha256(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def _inside(root: Path, relative: str) -> Path:
    path = (root / relative).resolve()
    path.relative_to(root.resolve())
    return path


def verified_rows(dataset_dir: Path) -> tuple[dict, list[tuple]]:
    _, manifest = _json_bytes(dataset_dir / "manifest.json")
    if manifest.get("dataset_kind") != "fixed-real-input-regression-set":
        raise ValueError("manifest dataset_kind is not a fixed real regression set")
    if manifest.get("privacy", {}).get("classification") != "personal-data-local-only":
        raise ValueError("manifest is missing the required local-only privacy classification")

    schema = json.loads(SCHEMA_PATH.read_text())
    validator = jsonschema.Draft202012Validator(schema)
    rows: list[tuple] = []
    seen: set[str] = set()
    cases = manifest.get("cases") or []
    for case in cases:
        sample_id = str(case.get("sample_id") or "")
        if not sample_id or sample_id in seen:
            raise ValueError(f"invalid or duplicate sample_id: {sample_id!r}")
        seen.add(sample_id)

        raw_path = _inside(dataset_dir, str(case["raw_file"]))
        canonical_path = _inside(dataset_dir, str(case["canonical_file"]))
        raw_body = raw_path.read_bytes()
        canonical_body, canonical = _json_bytes(canonical_path)
        if _sha256(raw_body) != case.get("raw_sha256"):
            raise ValueError(f"{sample_id}: raw SHA-256 mismatch")
        if _sha256(canonical_body) != case.get("canonical_sha256"):
            raise ValueError(f"{sample_id}: canonical SHA-256 mismatch")

        errors = sorted(validator.iter_errors(canonical), key=lambda e: list(e.path))
        if errors:
            first = errors[0]
            location = ".".join(str(p) for p in first.path) or "$"
            raise ValueError(f"{sample_id}: canonical schema error at {location}: {first.message}")
        messages = canonical.get("messages") or []
        if len(messages) != int(case.get("message_count", -1)):
            raise ValueError(f"{sample_id}: message count differs from manifest")

        started_at_ms = int(canonical["call"]["started_at_ms"])
        interaction_time = datetime.fromtimestamp(started_at_ms / 1000, tz=timezone.utc)
        rows.append(
            (
                sample_id,
                str(manifest["dataset_id"]),
                interaction_time,
                Jsonb(canonical),
                str(case["raw_sha256"]),
                str(case["canonical_sha256"]),
            )
        )

    if len(rows) != int(manifest.get("case_count", -1)):
        raise ValueError("verified row count differs from manifest case_count")
    actual_messages = sum(len(row[3].obj.get("messages") or []) for row in rows)
    if actual_messages != int(manifest.get("message_count", -1)):
        raise ValueError("verified message count differs from manifest message_count")
    return manifest, rows


def import_rows(dsn: str, manifest: dict, rows: list[tuple]) -> None:
    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                CREATE TABLE IF NOT EXISTS {TABLE} (
                    sample_id text PRIMARY KEY,
                    dataset_id text NOT NULL,
                    interaction_time timestamptz NOT NULL,
                    canonical_call jsonb NOT NULL,
                    raw_sha256 text NOT NULL CHECK (length(raw_sha256) = 64),
                    canonical_sha256 text NOT NULL CHECK (length(canonical_sha256) = 64)
                )
                """
            )
            cur.execute(
                f"CREATE INDEX IF NOT EXISTS ix_{TABLE}_dataset_time "
                f"ON {TABLE} (dataset_id, interaction_time)"
            )
            cur.executemany(
                f"""
                INSERT INTO {TABLE} (
                    sample_id, dataset_id, interaction_time, canonical_call,
                    raw_sha256, canonical_sha256
                ) VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (sample_id) DO UPDATE SET
                    dataset_id = EXCLUDED.dataset_id,
                    interaction_time = EXCLUDED.interaction_time,
                    canonical_call = EXCLUDED.canonical_call,
                    raw_sha256 = EXCLUDED.raw_sha256,
                    canonical_sha256 = EXCLUDED.canonical_sha256
                """,
                rows,
            )
            cur.execute(
                f"SELECT count(*), coalesce(sum(jsonb_array_length(canonical_call->'messages')), 0) "
                f"FROM {TABLE} WHERE dataset_id = %s",
                (manifest["dataset_id"],),
            )
            count, messages = cur.fetchone()
            if count != manifest["case_count"] or messages != manifest["message_count"]:
                raise RuntimeError(
                    f"post-import verification failed: rows={count}, messages={messages}"
                )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset-dir", type=Path, default=DEFAULT_DATASET)
    parser.add_argument(
        "--dsn",
        default="dbname=wf_dev user=rivers host=127.0.0.1 port=5432",
        help="psycopg DSN; do not include it in logs when it contains a password",
    )
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()

    manifest, rows = verified_rows(args.dataset_dir.resolve())
    if not args.verify_only:
        import_rows(args.dsn, manifest, rows)
    print(
        json.dumps(
            {
                "dataset_id": manifest["dataset_id"],
                "verified_cases": len(rows),
                "verified_messages": manifest["message_count"],
                "database_table": None if args.verify_only else TABLE,
                "personal_data_printed": False,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
