from __future__ import annotations

import pytest
from jsonschema import Draft202012Validator

from quality_runtime_evaluation import (
    build_native_workflow_request,
    build_request,
    list_sample_ids,
    request_fingerprint,
)


def test_all_smoke_samples_build_against_shared_contract() -> None:
    sample_ids = list_sample_ids()
    assert len(sample_ids) == 15
    for sample_id in sample_ids:
        request = build_request(sample_id, model="poc-model")
        assert request.input["sample_id"] == sample_id
        assert request.agent.version == "0.1.2"
        assert request.agent.model.parameters == {"max_tokens": 4096}
        assert len(request.agent.tools) == 4
        assert len(request.context.metadata["master_data"]) == 2
        Draft202012Validator.check_schema(request.agent.output_schema)


def test_request_is_deterministic_and_provider_neutral() -> None:
    first = build_request("SMOKE-A01", model="poc-model")
    second = build_request("SMOKE-A01", model="poc-model")
    assert first == second
    assert request_fingerprint(first) == request_fingerprint(second)


def test_unknown_sample_fails_closed() -> None:
    with pytest.raises(KeyError, match="unknown sample_id"):
        build_request("NOT-THERE", model="poc-model")


def test_build_native_workflow_request_uses_complex_schema_and_mode() -> None:
    request = build_native_workflow_request(model="qwen3.8-max")
    assert request.input["sample_id"] == "NATIVE-V02-001"
    assert request.context.metadata["workflow_mode"] == "native_quality_v0.2"
    assert request.timeout_seconds == 600
    assert request.agent.output_schema["$id"].endswith("native-workflow-output/0.2")
    assert [tool.name for tool in request.agent.tools] == [
        "knowledge_search",
        "ticket_query",
        "sms_query",
        "appointment_query",
    ]


def test_native_workflow_run_suffix_changes_execution_identity_only() -> None:
    first = build_native_workflow_request(model="qwen3.8-max", run_suffix="stability-01")
    second = build_native_workflow_request(model="qwen3.8-max", run_suffix="stability-02")
    assert first.run_id.endswith("stability-01")
    assert second.run_id.endswith("stability-02")
    assert first.idempotency_key != second.idempotency_key
    assert first.input == second.input
    assert first.agent == second.agent
