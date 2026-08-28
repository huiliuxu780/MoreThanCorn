from __future__ import annotations

import json
from pathlib import Path

from quality_runtime_evaluation.run_comparison import _atomic_write_json, _sample_is_complete


def test_atomic_write_json_replaces_content_without_leaving_temporary_file(tmp_path: Path) -> None:
    path = tmp_path / "comparison.json"
    _atomic_write_json(path, {"value": 1})
    _atomic_write_json(path, {"value": 2})

    assert json.loads(path.read_text(encoding="utf-8")) == {"value": 2}
    assert not path.with_suffix(".json.tmp").exists()


def test_sample_complete_requires_both_providers_to_be_terminal() -> None:
    providers = {"agentscope", "deepseek_harness"}
    complete = {
        "providers": {
            "agentscope": {"status": "succeeded"},
            "deepseek_harness": {"status": "failed"},
        }
    }
    retryable = {
        "providers": {
            "agentscope": {"status": "succeeded"},
            "deepseek_harness": {"status": "runner_error"},
        }
    }

    assert _sample_is_complete(complete, providers)
    assert not _sample_is_complete(complete, providers, retry_failed=True)
    assert not _sample_is_complete(retryable, providers)
