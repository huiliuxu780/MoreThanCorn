from __future__ import annotations

import asyncio
import json
import os
import re
import tempfile
from datetime import datetime, timezone
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker

from quality_runtime_contract import (
    ErrorCode,
    ProviderCapabilities,
    RunStatus,
    RuntimeError,
    RuntimeExecuteRequest,
    RuntimeInfo,
    RuntimeRun,
    RuntimeUsage,
    TraceEvent,
)
from quality_runtime_service import AdapterExecutionError

TRACE_NOISE_EVENTS = {"assistant/chunk", "session.event"}
REPO_ROOT = Path(__file__).resolve().parents[3]
SOURCE_RUNTIME_ROOT = (
    REPO_ROOT / "poc" / "agent_runtime_providers" / ".artifacts" / "dsh-source"
)
NATIVE_BUNDLE = "morethancorn-dsh-native-quality-workflow"
# R8-UI-5：business-analysis DSH 原生实现 bundle（manifest implementations.deepseek-harness）
BUSINESS_BUNDLE = "morethancorn-dsh-business-analysis"


def native_assets_for_mode(workflow_mode: str | None) -> dict:
    """R8-UI-5：workflow_mode → (cordis 配置, 原生插件, 必需 bundle)。纯函数可测。"""
    if workflow_mode == "independent_no_tools_v1":
        return {"config": "no_tools.cordis.yml",
                "plugin": "native_quality_workflow.mjs",
                "bundle": None, "native": False, "no_tools": True}
    if workflow_mode == "business_analysis_v1":
        return {"config": "native_business.cordis.yml",
                "plugin": "native_business_analysis.mjs",
                "bundle": BUSINESS_BUNDLE, "native": True, "no_tools": False}
    if workflow_mode == "native_quality_v0.2":
        return {"config": "native_quality.cordis.yml",
                "plugin": "native_quality_workflow.mjs",
                "bundle": NATIVE_BUNDLE, "native": True, "no_tools": False}
    return {"config": "quality.cordis.yml", "plugin": "native_quality_workflow.mjs",
            "bundle": None, "native": False, "no_tools": False}


def installed_dsh_version() -> str:
    try:
        return version("deepseek-harness-sdk")
    except PackageNotFoundError:
        return "unavailable"


def supports_profile_runtime(config_type: type[Any]) -> bool:
    fields = getattr(config_type, "__dataclass_fields__", {})
    return "dsh_home" in fields and "profile" in fields


def configured_dsh_home() -> Path:
    raw = os.environ.get("QUALITY_DSH_HOME")
    return Path(raw).expanduser().resolve() if raw else (SOURCE_RUNTIME_ROOT / "home").resolve()


def profile_bundles(dsh_home: Path, profile: str) -> list[str]:
    manifest_path = dsh_home / "profiles" / profile / "package.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return []
    bundles = manifest.get("dsh", {}).get("profile", {}).get("bundles", [])
    return [str(item) for item in bundles] if isinstance(bundles, list) else []


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _nested_scalar(value: Any, keys: set[str]) -> str | None:
    if isinstance(value, dict):
        for key, child in value.items():
            if key in keys and isinstance(child, (str, int)):
                return str(child)
        for child in value.values():
            found = _nested_scalar(child, keys)
            if found is not None:
                return found
    elif isinstance(value, list):
        for child in value:
            found = _nested_scalar(child, keys)
            if found is not None:
                return found
    return None


def parse_json_output(text: str) -> dict[str, Any]:
    candidate = text.strip()
    thinking = re.fullmatch(
        r"<think>.*?</think>\s*(.*)",
        candidate,
        flags=re.DOTALL | re.IGNORECASE,
    )
    if thinking:
        candidate = thinking.group(1).strip()
    fenced = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", candidate, flags=re.DOTALL | re.IGNORECASE)
    if fenced:
        candidate = fenced.group(1)
    value = json.loads(candidate)
    if not isinstance(value, dict):
        raise ValueError("structured output root must be an object")
    return value


def _trace(events: list[dict[str, Any]], notifications: list[Any]) -> list[TraceEvent]:
    rows: list[TraceEvent] = []
    for event in events:
        event_type = str(event.get("type") or event.get("event") or "session_event")
        if event_type in TRACE_NOISE_EVENTS:
            continue
        event_data = event.get("data")
        tool_name = None
        call_id = None
        if event_type.startswith("tool/"):
            tool_name = _nested_scalar(
                event_data,
                {"tool_name", "toolName", "function_name", "functionName", "name"},
            )
            call_id = _nested_scalar(event_data, {"tool_call_id", "toolCallId", "call_id", "callId", "id"})
        metadata: dict[str, Any] = {"keys": sorted(str(key) for key in event)[:20]}
        if event_type == "assistant/message" and isinstance(event_data, dict):
            usage = event_data.get("usage")
            if isinstance(usage, dict):
                metadata["input_tokens"] = int(usage.get("inputTokens", 0) or 0)
                metadata["output_tokens"] = int(usage.get("outputTokens", 0) or 0)
                metadata["cache_read_tokens"] = int(usage.get("cacheReadTokens", 0) or 0)
                metadata["cache_write_tokens"] = int(usage.get("cacheWriteTokens", 0) or 0)
                metadata["reasoning_tokens"] = int(usage.get("reasoningTokens", 0) or 0)
        rows.append(
            TraceEvent(
                sequence=len(rows),
                timestamp=utcnow(),
                type=event_type,
                name=tool_name,
                call_id=call_id or (str(event.get("id")) if event.get("id") else None),
                metadata=metadata,
            )
        )
    for notification in notifications:
        notification_method = str(getattr(notification, "method", "notification"))
        if notification_method in TRACE_NOISE_EVENTS:
            continue
        payload = getattr(notification, "payload", {})
        rows.append(
            TraceEvent(
                sequence=len(rows),
                timestamp=utcnow(),
                type=notification_method,
                metadata={
                    "payload_keys": sorted(str(key) for key in payload)[:20]
                    if isinstance(payload, dict)
                    else [],
                },
            )
        )
    return rows


def runtime_usage_from_trace(trace: list[TraceEvent]) -> RuntimeUsage:
    model_events = [event for event in trace if event.type == "assistant/message"]
    input_tokens = sum(int(event.metadata.get("input_tokens", 0) or 0) for event in model_events)
    output_tokens = sum(int(event.metadata.get("output_tokens", 0) or 0) for event in model_events)
    return RuntimeUsage(
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=input_tokens + output_tokens,
        model_calls=len(model_events),
        tool_calls=sum(event.type == "tool/call" for event in trace),
    )


def terminal_diagnostics(events: list[dict[str, Any]]) -> dict[str, Any]:
    """Return bounded protocol diagnostics without copying message content."""

    event_types = [str(event.get("type") or "unknown") for event in events]
    turn_end: dict[str, Any] | None = None
    for event in reversed(events):
        if event.get("type") == "turn/end" and isinstance(event.get("data"), dict):
            data = event["data"]
            reason = data.get("reason")
            turn_end = reason if isinstance(reason, dict) else {"reason_type": type(reason).__name__}
            break
    return {
        "event_types_tail": event_types[-20:],
        "turn_end": turn_end,
    }


class DeepSeekHarnessAdapter:
    runtime = RuntimeInfo(
        provider="deepseek_harness",
        runtime_version=installed_dsh_version(),
        adapter_version="0.3.0",
    )
    capabilities = ProviderCapabilities(
        tools=True,
        skills=True,
        structured_output=False,
        trace=True,
        session=True,
        cancel=True,
        streaming=True,
        sandbox=False,
    )

    def __init__(self) -> None:
        self._active: dict[str, Any] = {}

    async def execute(self, request: RuntimeExecuteRequest) -> RuntimeRun:
        from deepseek_harness import DeepSeekHarness, DeepSeekHarnessConfig

        api_key = os.environ.get("QUALITY_MODEL_API_KEY", "")
        if not api_key:
            raise AdapterExecutionError(
                RuntimeError(
                    code=ErrorCode.PROVIDER_UNAVAILABLE,
                    message="QUALITY_MODEL_API_KEY is not configured",
                )
            )

        root = Path(os.environ.get("QUALITY_DSH_WORK_ROOT", tempfile.gettempdir())) / "quality-runtime"
        root.mkdir(parents=True, exist_ok=True)
        safe_run_id = re.sub(r"[^A-Za-z0-9_.-]", "_", request.run_id)[:80] or "run"
        # R8-UI-5：模式→资产选择收敛到 native_assets_for_mode（quality/business/通用）
        workflow_mode = (request.context.metadata.get("workflow_mode")
                         or request.context.metadata.get("workflowMode"))
        assets = native_assets_for_mode(workflow_mode)
        if assets["no_tools"] and request.agent.tools:
            raise AdapterExecutionError(
                RuntimeError(
                    code=ErrorCode.PROVIDER_UNAVAILABLE,
                    message="independent_no_tools_v1 forbids mounted tools",
                    details={"declared_tool_count": len(request.agent.tools)},
                )
            )
        native_workflow = assets["native"]
        profile_runtime = supports_profile_runtime(DeepSeekHarnessConfig)
        config_root = Path(__file__).resolve().parents[1] / "config"
        cordis = config_root / assets["config"]
        dsh_home = configured_dsh_home()
        dsh_profile = os.environ.get("QUALITY_DSH_PROFILE", "sdk")
        if profile_runtime:
            bundles = profile_bundles(dsh_home, dsh_profile)
            if not bundles:
                raise AdapterExecutionError(
                    RuntimeError(
                        code=ErrorCode.PROVIDER_UNAVAILABLE,
                        message="DSH profile runtime is not provisioned",
                        details={"profile": dsh_profile, "dsh_home": str(dsh_home)},
                    )
                )
            if assets["bundle"] and assets["bundle"] not in bundles:
                raise AdapterExecutionError(
                    RuntimeError(
                        code=ErrorCode.PROVIDER_UNAVAILABLE,
                        message="DSH native bundle is not installed",
                        details={"profile": dsh_profile, "bundle": assets["bundle"]},
                    )
                )
        native_plugin = Path(__file__).resolve().parents[1] / "plugins" / assets["plugin"]
        tool_mapping = {
            tool.name: f"mcp__quality__{tool.name}"
            for tool in request.agent.tools
        }
        prompt = "\n\n".join(
            [
                request.agent.instructions,
                "Transport tool mapping (logical name -> runtime name): "
                + json.dumps(tool_mapping, ensure_ascii=False),
                "Return one JSON object only, with no Markdown fence, conforming exactly to this schema:\n"
                + json.dumps(request.agent.output_schema, ensure_ascii=False),
                "Input:\n" + json.dumps(request.input, ensure_ascii=False),
                "Context:\n" + request.context.model_dump_json(),
            ]
        )
        notifications: list[Any] = []
        started_at = utcnow()

        try:
            with tempfile.TemporaryDirectory(prefix=f"{safe_run_id}-", dir=root) as run_dir:
                workspace = Path(run_dir) / "workspace"
                sessions = Path(run_dir) / "sessions"
                workspace.mkdir()
                sessions.mkdir()
                runtime_env = {
                    "QUALITY_TOOL_MCP_URL": os.environ.get(
                        "QUALITY_TOOL_MCP_URL",
                        "http://127.0.0.1:8200/mcp/",
                    ),
                    "QUALITY_DSH_NATIVE_PLUGIN": str(native_plugin),
                    "DSH_TELEMETRY_DISABLED": "1",
                }
                permission_mode = os.environ.get("QUALITY_DSH_PERMISSION_MODE", "").strip()
                runtime_environment = os.environ.get("QUALITY_RUNTIME_ENV", "production").strip().lower()
                if permission_mode == "danger-full-access" and runtime_environment not in {
                    "development",
                    "test",
                }:
                    raise AdapterExecutionError(
                        RuntimeError(
                            code=ErrorCode.PROVIDER_UNAVAILABLE,
                            message="unsafe DSH permission mode is forbidden outside development/test",
                        )
                    )
                if permission_mode:
                    runtime_env["DSH_PERMISSION_MODE"] = permission_mode
                common_config: dict[str, Any] = {
                    "provider": "deepseek-official",
                    "model": request.agent.model.model,
                    "max_tokens": request.agent.model.parameters.get("max_tokens", 4096),
                    "cwd": str(workspace),
                    "runtime_cwd": str(workspace),
                    "env": runtime_env,
                    "base_url": os.environ.get("QUALITY_MODEL_BASE_URL") or None,
                    "api_key": api_key,
                    "request_timeout_seconds": float(request.timeout_seconds),
                }
                if profile_runtime:
                    patches: tuple[str, ...] = ()
                    if assets["no_tools"]:
                        patches = (str(config_root / "no_tools.patch.yml"),)
                    elif not native_workflow:
                        patches = (str(config_root / "disable_native_workflow.patch.yml"),)
                    common_config.update(
                        dsh_home=str(dsh_home),
                        dsh_bin=os.environ.get("QUALITY_DSH_BIN") or None,
                        profile=dsh_profile,
                        patches=patches,
                    )
                else:
                    common_config.update(
                        session_root=str(sessions),
                        cordis=str(cordis),
                    )
                config = DeepSeekHarnessConfig(**common_config)
                harness = DeepSeekHarness(config)
                self._active[request.run_id] = harness
                try:
                    result = await asyncio.to_thread(
                        harness.run,
                        prompt,
                        session_id=safe_run_id,
                        on_notification=notifications.append,
                    )
                finally:
                    await asyncio.to_thread(harness.close)
                    self._active.pop(request.run_id, None)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise AdapterExecutionError(
                RuntimeError(
                    code=ErrorCode.MODEL_ERROR,
                    message="DeepSeek Harness execution failed",
                    retryable=True,
                    details={"exception_type": type(exc).__name__},
                )
            ) from exc

        diagnostics = terminal_diagnostics(result.events)
        if result.finish_reason == "error":
            terminal = diagnostics.get("turn_end")
            provider_error = terminal.get("error") if isinstance(terminal, dict) else None
            status = provider_error.get("status") if isinstance(provider_error, dict) else None
            raise AdapterExecutionError(
                RuntimeError(
                    code=ErrorCode.MODEL_ERROR,
                    message="DeepSeek Harness model turn ended with an error",
                    retryable=isinstance(status, int) and status >= 500,
                    details=diagnostics,
                )
            )

        try:
            output = parse_json_output(result.final_response)
        except (json.JSONDecodeError, ValueError) as exc:
            details: dict[str, Any] = {
                "exception_type": type(exc).__name__,
                "response_length": len(result.final_response),
                "finish_reason": result.finish_reason,
                **diagnostics,
            }
            if request.context.metadata.get("dataset_kind") == "fully_synthetic":
                details["response_preview"] = result.final_response[:1000]
            raise AdapterExecutionError(
                RuntimeError(
                    code=ErrorCode.OUTPUT_SCHEMA_ERROR,
                    message="DeepSeek Harness did not return one JSON object",
                    retryable=True,
                    details=details,
                )
            ) from exc

        validation_errors = sorted(
            Draft202012Validator(
                request.agent.output_schema,
                format_checker=FormatChecker(),
            ).iter_errors(output),
            key=lambda error: list(error.absolute_path),
        )
        if validation_errors:
            first = validation_errors[0]
            raise AdapterExecutionError(
                RuntimeError(
                    code=ErrorCode.OUTPUT_SCHEMA_ERROR,
                    message="DeepSeek Harness output failed JSON Schema validation",
                    retryable=True,
                    details={"path": list(first.absolute_path), "reason": first.message},
                )
            )

        trace = _trace(result.events, result.notifications)
        return RuntimeRun(
            run_id=request.run_id,
            status=RunStatus.SUCCEEDED,
            output=output,
            usage=runtime_usage_from_trace(trace),
            trace=trace,
            runtime=self.runtime,
            started_at=started_at,
            finished_at=utcnow(),
        )

    async def cancel(self, run_id: str) -> None:
        harness = self._active.get(run_id)
        if harness is not None:
            await asyncio.to_thread(harness.close)

    async def health_checks(self) -> dict[str, str]:
        try:
            from deepseek_harness import DeepSeekHarnessConfig
        except ImportError:
            return {"adapter": "ok", "runtime_package": "failed"}
        checks = {
            "adapter": "ok",
            "runtime_package": "ok",
            "model_credential": "ok" if os.environ.get("QUALITY_MODEL_API_KEY") else "degraded",
        }
        permission_mode = os.environ.get("QUALITY_DSH_PERMISSION_MODE", "").strip()
        runtime_environment = os.environ.get("QUALITY_RUNTIME_ENV", "production").strip().lower()
        checks["permission_mode"] = (
            "degraded"
            if permission_mode == "danger-full-access"
            and runtime_environment not in {"development", "test"}
            else "ok"
        )
        if supports_profile_runtime(DeepSeekHarnessConfig):
            checks["profile"] = (
                "ok"
                if profile_bundles(
                    configured_dsh_home(),
                    os.environ.get("QUALITY_DSH_PROFILE", "sdk"),
                )
                else "failed"
            )
        return checks
