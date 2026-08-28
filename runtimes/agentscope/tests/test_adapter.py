import asyncio
import json
from pathlib import Path

import pytest

from types import SimpleNamespace

from app.adapter import (
    AgentScopeAdapter,
    _trace_event,
    enterprise_tool_call_count,
    runtime_usage_from_trace,
    should_record_trace_event,
)
from app.schema_adapter import output_model
from quality_runtime_contract import (
    AgentExecutionSpec,
    ErrorCode,
    ModelSpec,
    RuntimeExecuteRequest,
)
from quality_runtime_service import AdapterExecutionError

ROOT = Path(__file__).resolve().parents[3]
OUTPUT_SCHEMA = (
    ROOT / "poc" / "agent_runtime_providers" / "schemas" / "quality_output.schema.json"
)


def test_json_schema_adapter_accepts_quality_output_and_rejects_extra_fields():
    schema = json.loads(OUTPUT_SCHEMA.read_text(encoding="utf-8"))
    model = output_model(schema)
    valid = model.model_validate(
        {
            "sample_id": "SMOKE-A02",
            "findings": [],
            "labels": {"service_type_code": None, "issue_codes": []},
            "summary": "No issue found.",
        }
    )
    assert valid.sample_id == "SMOKE-A02"

    with pytest.raises(Exception):
        model.model_validate(
            {
                "sample_id": "SMOKE-A02",
                "findings": [],
                "labels": {"service_type_code": None, "issue_codes": []},
                "summary": "No issue found.",
                "score": 100,
            }
        )


def test_missing_model_credential_fails_closed(monkeypatch):
    monkeypatch.delenv("QUALITY_MODEL_API_KEY", raising=False)
    schema = json.loads(OUTPUT_SCHEMA.read_text(encoding="utf-8"))
    request = RuntimeExecuteRequest(
        run_id="run-no-credential",
        idempotency_key="run-no-credential",
        agent=AgentExecutionSpec(
            id="quality-agent",
            version="0.1.0",
            instructions="Use evidence only.",
            model=ModelSpec(provider="openai-compatible", model="test-model"),
            output_schema=schema,
        ),
        input={"sample_id": "SMOKE-A02"},
    )
    with pytest.raises(AdapterExecutionError) as caught:
        asyncio.run(AgentScopeAdapter().execute(request))
    assert caught.value.error.code is ErrorCode.PROVIDER_UNAVAILABLE


def test_health_reports_real_runtime_and_missing_credential(monkeypatch):
    monkeypatch.delenv("QUALITY_MODEL_API_KEY", raising=False)
    checks = asyncio.run(AgentScopeAdapter().health_checks())
    assert checks == {
        "adapter": "ok",
        "runtime_package": "ok",
        "model_credential": "degraded",
    }


def test_usage_excludes_internal_structured_output_tool():
    internal_only = [
        SimpleNamespace(type="ToolCallStartEvent", name="GenerateStructuredOutput")
    ]
    one_enterprise_call = [
        SimpleNamespace(type="ToolCallStartEvent", name="knowledge_search"),
        SimpleNamespace(type="ToolCallStartEvent", name="GenerateStructuredOutput"),
    ]
    assert enterprise_tool_call_count(internal_only) == 0
    assert enterprise_tool_call_count(one_enterprise_call) == 1


def test_usage_sums_model_events():
    trace = [
        SimpleNamespace(
            type="ModelCallEndEvent",
            name=None,
            metadata={"input_tokens": 100, "output_tokens": 20},
        ),
        SimpleNamespace(
            type="ModelCallEndEvent",
            name=None,
            metadata={"input_tokens": 140, "output_tokens": 30},
        ),
        SimpleNamespace(type="ToolCallStartEvent", name="knowledge_search", metadata={}),
        SimpleNamespace(type="ToolCallStartEvent", name="GenerateStructuredOutput", metadata={}),
    ]
    usage = runtime_usage_from_trace(trace)
    assert usage.input_tokens == 240
    assert usage.output_tokens == 50
    assert usage.total_tokens == 290
    assert usage.model_calls == 2
    assert usage.tool_calls == 1


def test_trace_compaction_drops_stream_deltas_only():
    assert not should_record_trace_event("ThinkingBlockDeltaEvent")
    assert not should_record_trace_event("ToolCallDeltaEvent")
    assert should_record_trace_event("ModelCallEndEvent")
    assert should_record_trace_event("ToolCallStartEvent")


def test_trace_event_maps_runtime_event_instead_of_returning_none():
    class ModelCallEndEvent:
        input_tokens = 120
        output_tokens = 30
        id = "model-call-1"

        def model_dump(self, mode: str):
            assert mode == "json"
            return {"id": self.id, "input_tokens": self.input_tokens}

    event = _trace_event(3, ModelCallEndEvent())
    assert event.sequence == 3
    assert event.type == "ModelCallEndEvent"
    assert event.call_id == "model-call-1"
    assert event.metadata["input_tokens"] == 120
