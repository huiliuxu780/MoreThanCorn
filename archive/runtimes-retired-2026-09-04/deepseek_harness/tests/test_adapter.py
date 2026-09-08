import asyncio
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.adapter import (
    DeepSeekHarnessAdapter,
    _trace,
    parse_json_output,
    profile_bundles,
    runtime_usage_from_trace,
    supports_profile_runtime,
    terminal_diagnostics,
)
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
RUNTIME_ROOT = Path(__file__).resolve().parents[1]


def test_parse_json_output_accepts_plain_and_fenced_object():
    assert parse_json_output('{"findings": []}') == {"findings": []}
    assert parse_json_output('```json\n{"findings": []}\n```') == {"findings": []}
    assert parse_json_output(
        '<think>internal reasoning</think>\n```json\n{"findings": []}\n```'
    ) == {"findings": []}
    with pytest.raises(ValueError):
        parse_json_output("[]")


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
            model=ModelSpec(provider="deepseek-compatible", model="test-model"),
            output_schema=schema,
        ),
        input={"sample_id": "SMOKE-A02"},
    )
    with pytest.raises(AdapterExecutionError) as caught:
        asyncio.run(DeepSeekHarnessAdapter().execute(request))
    assert caught.value.error.code is ErrorCode.PROVIDER_UNAVAILABLE


def test_health_reports_unsafe_permission_override(monkeypatch):
    monkeypatch.delenv("QUALITY_MODEL_API_KEY", raising=False)
    monkeypatch.setenv("QUALITY_DSH_PERMISSION_MODE", "danger-full-access")
    monkeypatch.setenv("QUALITY_RUNTIME_ENV", "production")
    checks = asyncio.run(DeepSeekHarnessAdapter().health_checks())
    assert checks["runtime_package"] == "ok"
    assert checks["model_credential"] == "degraded"
    assert checks["permission_mode"] == "degraded"


def test_health_allows_explicit_unsafe_mode_only_in_test(monkeypatch):
    monkeypatch.setenv("QUALITY_DSH_PERMISSION_MODE", "danger-full-access")
    monkeypatch.setenv("QUALITY_RUNTIME_ENV", "test")
    checks = asyncio.run(DeepSeekHarnessAdapter().health_checks())
    assert checks["permission_mode"] == "ok"


def test_terminal_diagnostics_retains_reason_without_message_content():
    events = [
        {"type": "user/message", "data": {"message": {"content": "sensitive"}}},
        {"type": "turn/end", "data": {"reason": {"kind": "error", "message": "bad model"}}},
    ]
    diagnostics = terminal_diagnostics(events)
    assert diagnostics["event_types_tail"] == ["user/message", "turn/end"]
    assert diagnostics["turn_end"] == {"kind": "error", "message": "bad model"}
    assert "sensitive" not in str(diagnostics)


def test_usage_is_extracted_from_assistant_message_events():
    trace = _trace(
        [
            {"type": "session.event", "data": {"type": "wrapper"}},
            {"type": "assistant/chunk", "data": {"delta": "streaming noise"}},
            {
                "type": "assistant/message",
                "data": {"usage": {"inputTokens": 100, "outputTokens": 25}},
            },
            {"type": "tool/call", "data": {"name": "mcp__quality__sms_query"}},
            {
                "type": "assistant/message",
                "data": {"usage": {"inputTokens": 150, "outputTokens": 30}},
            },
        ],
        [
            SimpleNamespace(method="session.event", payload={"event": "chunk"}),
            SimpleNamespace(method="session.status", payload={"status": "ready"}),
        ],
    )
    usage = runtime_usage_from_trace(trace)
    assert usage.input_tokens == 250
    assert usage.output_tokens == 55
    assert usage.total_tokens == 305
    assert usage.model_calls == 2
    assert usage.tool_calls == 1
    assert [event.type for event in trace] == [
        "assistant/message",
        "tool/call",
        "assistant/message",
        "session.status",
    ]


def test_profile_runtime_detection_and_manifest(tmp_path):
    class LegacyConfig:
        __dataclass_fields__ = {"cordis": object()}

    class ProfileConfig:
        __dataclass_fields__ = {"dsh_home": object(), "profile": object()}

    assert supports_profile_runtime(LegacyConfig) is False
    assert supports_profile_runtime(ProfileConfig) is True

    profile = tmp_path / "profiles" / "sdk"
    profile.mkdir(parents=True)
    (profile / "package.json").write_text(
        json.dumps(
            {
                "dsh": {
                    "profile": {
                        "bundles": [
                            "@deepseek-ai/dsh-base",
                            "morethancorn-dsh-native-quality-workflow",
                        ]
                    }
                }
            }
        ),
        encoding="utf-8",
    )
    assert profile_bundles(tmp_path, "sdk") == [
        "@deepseek-ai/dsh-base",
        "morethancorn-dsh-native-quality-workflow",
    ]
    assert profile_bundles(tmp_path, "missing") == []


def test_native_bundle_manifest_and_patch_are_self_contained():
    manifest = json.loads(
        (RUNTIME_ROOT / "plugins" / "package.json").read_text(encoding="utf-8")
    )
    assert manifest["main"] == "./native_quality_workflow.mjs"
    assert manifest["dsh"]["bundle"]["patch"] == "./cordis.patch.yml"
    for relative in manifest["files"]:
        assert (RUNTIME_ROOT / "plugins" / relative).is_file()

    patch = (RUNTIME_ROOT / "plugins" / "cordis.patch.yml").read_text(
        encoding="utf-8"
    )
    assert "@deepseek-ai/dsh-mcp-client" in patch
    assert "native-quality-workflow" in patch
    assert "danger-full-access" not in patch
