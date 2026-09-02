from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime, timezone
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker
from pydantic import SecretStr

from quality_runtime_contract import (
    ErrorCode,
    ProviderCapabilities,
    RuntimeError,
    RuntimeExecuteRequest,
    RuntimeInfo,
    RuntimeRun,
    RuntimeUsage,
    RunStatus,
    TraceEvent,
)
from quality_runtime_service import AdapterExecutionError

from .schema_adapter import output_model

TRACE_NOISE_SUFFIXES = ("DeltaEvent",)


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


def _trace_event(sequence: int, event: Any) -> TraceEvent:
    event_name = type(event).__name__
    metadata: dict[str, Any] = {"event_class": event_name}
    for key in (
        "id",
        "name",
        "tool_name",
        "model_name",
        "input_tokens",
        "output_tokens",
        "cache_input_tokens",
        "cache_creation_input_tokens",
    ):
        value = getattr(event, key, None)
        if isinstance(value, (str, int, float, bool)):
            metadata[key] = value
    event_data: Any = None
    if hasattr(event, "model_dump"):
        event_data = event.model_dump(mode="json")
        if isinstance(event_data, dict):
            metadata["event_fields"] = sorted(str(key) for key in event_data)
    tool_name = None
    if event_name.startswith(("ToolCall", "ToolResult")):
        tool_name = _nested_scalar(
            event_data,
            {
                "tool_call_name",
                "tool_name",
                "toolName",
                "function_name",
                "functionName",
                "name",
            },
        )
    event_call_id = _nested_scalar(
        event_data,
        {"tool_call_id", "toolCallId", "call_id", "callId"},
    )
    return TraceEvent(
        sequence=sequence,
        timestamp=utcnow(),
        type=event_name,
        name=tool_name or (str(metadata.get("name")) if metadata.get("name") else None),
        call_id=event_call_id or (str(metadata.get("id")) if metadata.get("id") else None),
        metadata=metadata,
    )


def should_record_trace_event(event_type: str) -> bool:
    """Keep lifecycle and usage evidence, not token-by-token streaming noise."""

    return not event_type.endswith(TRACE_NOISE_SUFFIXES)


def enterprise_tool_call_count(trace: list[TraceEvent]) -> int:
    """Exclude AgentScope's built-in structured-output submission tool."""

    return sum(
        event.type == "ToolCallStartEvent"
        and event.name not in {"GenerateStructuredOutput", "generate_structured_output"}
        for event in trace
    )


def runtime_usage_from_trace(trace: list[TraceEvent]) -> RuntimeUsage:
    model_events = [event for event in trace if event.type == "ModelCallEndEvent"]
    input_tokens = sum(int(event.metadata.get("input_tokens", 0) or 0) for event in model_events)
    output_tokens = sum(int(event.metadata.get("output_tokens", 0) or 0) for event in model_events)
    return RuntimeUsage(
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=input_tokens + output_tokens,
        model_calls=len(model_events),
        tool_calls=enterprise_tool_call_count(trace),
    )


class AgentScopeAdapter:
    runtime = RuntimeInfo(
        provider="agentscope",
        runtime_version="2.0.7",
        adapter_version="0.1.0",
    )
    capabilities = ProviderCapabilities(
        tools=True,
        skills=True,
        structured_output=True,
        trace=True,
        session=True,
        cancel=True,
        streaming=True,
        sandbox=False,
    )

    async def execute(self, request: RuntimeExecuteRequest) -> RuntimeRun:
        from agentscope.agent import Agent, ReActConfig
        from agentscope.credential import OpenAICredential
        from agentscope.mcp import HttpMCPConfig, MCPClient
        from agentscope.message import Msg, TextBlock
        from agentscope.model import OpenAIChatModel
        from agentscope.tool import Toolkit

        api_key = os.environ.get("QUALITY_MODEL_API_KEY", "")
        if not api_key:
            raise AdapterExecutionError(
                RuntimeError(
                    code=ErrorCode.PROVIDER_UNAVAILABLE,
                    message="QUALITY_MODEL_API_KEY is not configured",
                )
            )
        if request.agent.model.provider not in {
            "openai",
            "openai-compatible",
            "deepseek-compatible",
        }:
            raise AdapterExecutionError(
                RuntimeError(
                    code=ErrorCode.AGENT_SPEC_INVALID,
                    message=f"unsupported model provider: {request.agent.model.provider}",
                )
            )

        allowed_parameters = {
            "max_tokens",
            "thinking_enable",
            "reasoning_effort",
            "temperature",
            "top_p",
            "parallel_tool_calls",
        }
        unknown_parameters = set(request.agent.model.parameters) - allowed_parameters
        if unknown_parameters:
            raise AdapterExecutionError(
                RuntimeError(
                    code=ErrorCode.AGENT_SPEC_INVALID,
                    message=f"unsupported model parameters: {sorted(unknown_parameters)}",
                )
            )

        credential = OpenAICredential(
            api_key=SecretStr(api_key),
            base_url=os.environ.get("QUALITY_MODEL_BASE_URL") or None,
        )
        model = OpenAIChatModel(
            credential=credential,
            model=request.agent.model.model,
            parameters=OpenAIChatModel.Parameters(**request.agent.model.parameters),
            stream=True,
        )

        # 平台 dispatcher 注入的规范键是 workflowMode（SDD 10 R2 起）；
        # workflow_mode 是评测 harness 直连请求使用的旧键，两者都接受。
        workflow_mode = (
            request.context.metadata.get("workflowMode")
            or request.context.metadata.get("workflow_mode")
        )
        if workflow_mode == "native_quality_v0.2":
            from .native_workflow import (
                AgentScopeNativeQualityWorkflow,
                AgentScopeStageRunner,
            )

            started_at = utcnow()
            runner = AgentScopeStageRunner(
                model=model,
                mcp_url=os.environ.get(
                    "QUALITY_TOOL_MCP_URL",
                    "http://127.0.0.1:8200/mcp/",
                ),
                trace_event_factory=_trace_event,
            )
            try:
                output, trace = await asyncio.wait_for(
                    AgentScopeNativeQualityWorkflow(runner).execute(request),
                    timeout=request.timeout_seconds,
                )
            except Exception as exc:  # noqa: BLE001
                raise AdapterExecutionError(
                    RuntimeError(
                        code=ErrorCode.MODEL_ERROR,
                        message="AgentScope native workflow failed",
                        retryable=True,
                        details={"exception_type": type(exc).__name__},
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
                        message="AgentScope native workflow output failed JSON Schema validation",
                        retryable=True,
                        details={"path": list(first.absolute_path), "reason": first.message},
                    )
                )
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

        mcp_client = None
        toolkit = None
        if request.agent.tools:
            mcp_client = MCPClient(
                name=f"quality-tools-{request.run_id}",
                is_stateful=False,
                mcp_config=HttpMCPConfig(
                    url=os.environ.get("QUALITY_TOOL_MCP_URL", "http://127.0.0.1:8200/mcp/"),
                    timeout=30.0,
                ),
                enable_tools=[tool.name for tool in request.agent.tools],
                execution_timeout=30.0,
            )
            try:
                await mcp_client.connect()
                toolkit = Toolkit(mcps=[mcp_client])
            except Exception as exc:  # noqa: BLE001
                await mcp_client.close(ignore_errors=True)
                raise AdapterExecutionError(
                    RuntimeError(
                        code=ErrorCode.TOOL_ERROR,
                        message="failed to connect to enterprise Tool Service",
                        retryable=True,
                        details={"exception_type": type(exc).__name__},
                    )
                ) from exc

        schema_model = output_model(request.agent.output_schema)
        prompt = json.dumps(
            {
                "task": "Analyze the call record and return only the required structured output.",
                "input": request.input,
                "context": request.context.model_dump(mode="json"),
                "master_data": [item.model_dump(mode="json") for item in request.agent.master_data],
            },
            ensure_ascii=False,
        )
        message = Msg(
            name="quality-platform",
            role="user",
            content=[TextBlock(text=prompt)],
        )
        agent = Agent(
            name=request.agent.id,
            system_prompt=request.agent.instructions,
            model=model,
            toolkit=toolkit,
            react_config=ReActConfig(max_iters=8, structured_output_grace_iters=3),
        )

        started_at = utcnow()
        trace: list[TraceEvent] = []
        final_message = None
        try:
            async for item in agent.reply_stream(
                message,
                structured_schema=schema_model,
                yield_final_msg=True,
            ):
                if isinstance(item, Msg):
                    final_message = item
                elif should_record_trace_event(type(item).__name__):
                    trace.append(_trace_event(len(trace), item))
        except Exception as exc:  # noqa: BLE001
            raise AdapterExecutionError(
                RuntimeError(
                    code=ErrorCode.MODEL_ERROR,
                    message="AgentScope execution failed",
                    retryable=True,
                    details={"exception_type": type(exc).__name__},
                )
            ) from exc
        finally:
            if mcp_client is not None:
                await mcp_client.close(ignore_errors=True)

        if final_message is None or final_message.structured_output is None:
            details: dict[str, Any] = {
                "final_message_present": final_message is not None,
                "trace_types_tail": [event.type for event in trace[-30:]],
                "model_calls": sum(event.type == "ModelCallEndEvent" for event in trace),
                "tool_calls_completed": sum(event.type == "ToolCallEndEvent" for event in trace),
                "tool_names": sorted({event.name for event in trace if event.name}),
            }
            if (
                final_message is not None
                and request.context.metadata.get("dataset_kind") == "fully_synthetic"
            ):
                details["final_content_preview"] = json.dumps(
                    final_message.content,
                    ensure_ascii=False,
                    default=str,
                )[:2000]
            raise AdapterExecutionError(
                RuntimeError(
                    code=ErrorCode.OUTPUT_SCHEMA_ERROR,
                    message="AgentScope did not produce structured output",
                    retryable=True,
                    details=details,
                )
            )
        output = final_message.structured_output
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
                    message="AgentScope output failed JSON Schema validation",
                    retryable=True,
                    details={"path": list(first.absolute_path), "reason": first.message},
                )
            )

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
        return None

    async def health_checks(self) -> dict[str, str]:
        try:
            import agentscope  # noqa: F401
        except ImportError:
            return {"adapter": "ok", "runtime_package": "failed"}
        return {
            "adapter": "ok",
            "runtime_package": "ok",
            "model_credential": "ok" if os.environ.get("QUALITY_MODEL_API_KEY") else "degraded",
        }
