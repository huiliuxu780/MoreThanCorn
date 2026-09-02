"""OAI-R0 adapter 测试（SDD 14 §10/§14/§28/§31）：失败关闭、元数据、健康降级。"""

import asyncio
import json
from pathlib import Path

import pytest
from quality_runtime_contract import (
    AgentExecutionSpec,
    ErrorCode,
    ModelSpec,
    RuntimeExecuteRequest,
)
from quality_runtime_service import AdapterExecutionError

from app.adapter import (
    OpenAIAgentsRuntimeAdapter,
    remote_tracing_enabled,
    workflow_mode_of,
)
from app.model_adapter import resolve_model_name
from app.tool_adapter import tool_gateway_health_url

ROOT = Path(__file__).resolve().parents[3]
OUTPUT_SCHEMA = (
    ROOT / "server" / "app" / "agent_modules" / "quality_analysis" / "schemas"
    / "quality_output.schema.json"
)


def make_request(provider="openai-compatible", model="test-model", parameters=None,
                 metadata=None):
    return RuntimeExecuteRequest(
        run_id="run-adapter-test",
        idempotency_key="run-adapter-test",
        agent=AgentExecutionSpec(
            id="quality-agent",
            version="0.1.0",
            instructions="Use evidence only.",
            model=ModelSpec(provider=provider, model=model, parameters=parameters or {}),
            output_schema=json.loads(OUTPUT_SCHEMA.read_text(encoding="utf-8")),
        ),
        input={"sample_id": "SMOKE-1"},
        context={"metadata": metadata or {}},
    )


def test_missing_model_credential_fails_closed(monkeypatch):
    monkeypatch.delenv("QUALITY_MODEL_API_KEY", raising=False)
    with pytest.raises(AdapterExecutionError) as caught:
        asyncio.run(OpenAIAgentsRuntimeAdapter().execute(make_request()))
    assert caught.value.error.code is ErrorCode.PROVIDER_UNAVAILABLE


def test_unsupported_provider_rejected(monkeypatch):
    monkeypatch.setenv("QUALITY_MODEL_API_KEY", "test-key")
    with pytest.raises(AdapterExecutionError) as caught:
        asyncio.run(OpenAIAgentsRuntimeAdapter().execute(make_request(provider="anthropic")))
    assert caught.value.error.code is ErrorCode.AGENT_SPEC_INVALID


def test_unknown_model_parameter_rejected(monkeypatch):
    monkeypatch.setenv("QUALITY_MODEL_API_KEY", "test-key")
    with pytest.raises(AdapterExecutionError) as caught:
        asyncio.run(
            OpenAIAgentsRuntimeAdapter().execute(
                make_request(parameters={"thinking_enable": True})
            )
        )
    assert caught.value.error.code is ErrorCode.AGENT_SPEC_INVALID
    assert "thinking_enable" in caught.value.error.message


def test_runtime_metadata_and_capabilities_frozen():
    adapter = OpenAIAgentsRuntimeAdapter()
    assert adapter.runtime.provider == "openai-agents"
    assert adapter.runtime.runtime_version == "0.22.0"
    assert adapter.runtime.adapter_version == "0.1.0"
    assert adapter.capabilities.model_dump() == {
        "tools": True,
        "skills": False,
        "structured_output": True,
        "trace": True,
        "session": False,
        "cancel": True,
        "streaming": False,
        "sandbox": False,
    }


def test_workflow_mode_of_accepts_platform_and_legacy_keys():
    canonical = make_request(metadata={"workflowMode": "native_quality_v0.2"})
    legacy = make_request(metadata={"workflow_mode": "native_quality_v0.2"})
    both = make_request(metadata={"workflowMode": "native_quality_v0.2",
                                  "workflow_mode": "something_else"})
    assert workflow_mode_of(canonical) == "native_quality_v0.2"
    assert workflow_mode_of(legacy) == "native_quality_v0.2"
    assert workflow_mode_of(both) == "native_quality_v0.2"
    assert workflow_mode_of(make_request()) is None


def test_model_name_fallback_only_when_unset(monkeypatch):
    monkeypatch.setenv("QUALITY_MODEL_ID", "fallback-model")
    assert resolve_model_name(make_request(model="qwen3.8-max")) == "qwen3.8-max"
    assert resolve_model_name(make_request(model="unset")) == "fallback-model"
    monkeypatch.delenv("QUALITY_MODEL_ID", raising=False)
    with pytest.raises(AdapterExecutionError) as caught:
        resolve_model_name(make_request(model="unset"))
    assert caught.value.error.code is ErrorCode.AGENT_SPEC_INVALID


def test_remote_tracing_disabled_by_default(monkeypatch):
    monkeypatch.delenv("OPENAI_AGENTS_REMOTE_TRACING", raising=False)
    assert remote_tracing_enabled() is False
    monkeypatch.setenv("OPENAI_AGENTS_REMOTE_TRACING", "true")
    assert remote_tracing_enabled() is True
    monkeypatch.setenv("OPENAI_AGENTS_REMOTE_TRACING", "False")
    assert remote_tracing_enabled() is False


def test_health_probe_url_derived_from_mcp_url():
    assert (
        tool_gateway_health_url("http://127.0.0.1:8200/mcp/")
        == "http://127.0.0.1:8200/health"
    )


def test_health_degraded_without_credential_and_endpoint_probed(monkeypatch):
    monkeypatch.delenv("QUALITY_MODEL_API_KEY", raising=False)
    monkeypatch.setenv("QUALITY_MODEL_BASE_URL", "http://model.test/v1")
    probed: list[str] = []

    async def probe(url):
        probed.append(url)
        return "ok"

    adapter = OpenAIAgentsRuntimeAdapter()
    adapter._probe = probe
    checks = asyncio.run(adapter.health_checks())
    assert checks["adapter"] == "ok"
    assert checks["model_credential"] == "degraded"
    assert checks["model_endpoint"] == "ok"
    assert checks["tool_gateway"] == "ok"
    assert "http://model.test/v1" in probed
    assert "http://127.0.0.1:8200/health" in probed


def test_health_unavailable_when_gateway_probe_fails(monkeypatch):
    monkeypatch.setenv("QUALITY_MODEL_API_KEY", "test-key")

    async def probe(url):
        return "failed"

    adapter = OpenAIAgentsRuntimeAdapter()
    adapter._probe = probe
    checks = asyncio.run(adapter.health_checks())
    assert checks["tool_gateway"] == "failed"
