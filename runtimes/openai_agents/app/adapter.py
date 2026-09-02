"""OpenAI Agents SDK runtime adapter (SDD 14 §9–§13).

边界约束：
- 只实现 quality-runtime-service 的 RuntimeAdapter 协议，不新增平台执行抽象；
- OpenAI SDK remote tracing 默认关闭（§25.1），平台本地 Trace 是唯一审计事实；
- 结构化输出双层校验：SDK output_type（第一层）→ 本模块 JSON Schema 校验（第二层），
  平台侧还有第三层校验；
- 失败一律经 AdapterExecutionError 映射为契约错误码，禁止静默 succeeded。
"""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker

from quality_runtime_contract import (
    ErrorCode,
    ProviderCapabilities,
    RuntimeError,
    RuntimeExecuteRequest,
    RuntimeInfo,
    RuntimeRun,
    RunStatus,
    TraceEvent,
)
from quality_runtime_service import AdapterExecutionError

from .model_adapter import build_chat_model, resolve_api_key, validate_provider
from .schemas import output_model
from .tool_adapter import (
    DEFAULT_TOOL_MCP_URL,
    build_mcp_server,
    resolve_stage_tools,
    tool_gateway_health_url,
)
from .trace_mapper import (
    enterprise_tool_call_count,
    stage_trace_from_result,
    usage_from_results,
    utcnow,
)

GENERIC_MAX_TURNS = 8


def remote_tracing_enabled() -> bool:
    """SDD 14 §25.1：SDK remote tracing 默认关闭，显式声明才启用。"""

    return os.environ.get("OPENAI_AGENTS_REMOTE_TRACING", "false").strip().lower() == "true"


def workflow_mode_of(request: RuntimeExecuteRequest) -> str | None:
    """平台 dispatcher 注入的规范键是 workflowMode；workflow_mode 为评测 harness 旧键。"""

    return request.context.metadata.get("workflowMode") or request.context.metadata.get(
        "workflow_mode"
    )


class OpenAIAgentsRuntimeAdapter:
    runtime = RuntimeInfo(
        provider="openai-agents",
        runtime_version="0.22.0",
        adapter_version="0.1.0",
    )
    capabilities = ProviderCapabilities(
        tools=True,
        skills=False,
        structured_output=True,
        trace=True,
        session=False,
        cancel=True,
        streaming=False,
        sandbox=False,
    )

    def __init__(self) -> None:
        self._active: dict[str, asyncio.Task[Any]] = {}

    # ---------- RuntimeAdapter ----------

    async def execute(self, request: RuntimeExecuteRequest) -> RuntimeRun:
        import agents

        agents.set_tracing_disabled(not remote_tracing_enabled())

        resolve_api_key()
        validate_provider(request)
        started_at = utcnow()

        if workflow_mode_of(request) == "native_quality_v0.2":
            core = self._execute_native(request)
        else:
            core = self._execute_generic(request)

        task = asyncio.create_task(core)
        self._active[request.run_id] = task
        try:
            output, trace, usage = await task
        except asyncio.CancelledError:
            task.cancel()
            raise
        finally:
            self._active.pop(request.run_id, None)

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
                    message="OpenAI Agents output failed JSON Schema validation",
                    retryable=True,
                    details={"path": list(first.absolute_path), "reason": first.message},
                )
            )

        return RuntimeRun(
            run_id=request.run_id,
            status=RunStatus.SUCCEEDED,
            output=output,
            usage=usage,
            trace=trace,
            runtime=self.runtime,
            started_at=started_at,
            finished_at=utcnow(),
        )

    async def cancel(self, run_id: str) -> None:
        task = self._active.get(run_id)
        if task is not None and not task.done():
            task.cancel()

    async def health_checks(self) -> dict[str, str]:
        try:
            import agents  # noqa: F401
            import openai  # noqa: F401
        except ImportError:
            return {"adapter": "failed"}
        checks: dict[str, str] = {"adapter": "ok"}
        checks["model_credential"] = (
            "ok" if os.environ.get("QUALITY_MODEL_API_KEY") else "degraded"
        )
        base_url = os.environ.get("QUALITY_MODEL_BASE_URL", "")
        if base_url:
            # 连通级探测（任意 HTTP 应答即视为可达），不发送模型请求、不耗额度。
            checks["model_endpoint"] = await self._probe(base_url)
        checks["tool_gateway"] = await self._probe(
            tool_gateway_health_url(os.environ.get("QUALITY_TOOL_MCP_URL", DEFAULT_TOOL_MCP_URL))
        )
        return checks

    # ---------- 内部 ----------

    async def _probe(self, url: str) -> str:
        import httpx

        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                await client.get(url)
            return "ok"
        except Exception:  # noqa: BLE001 - 探测失败只降级健康状态
            return "failed"

    async def _execute_generic(
        self, request: RuntimeExecuteRequest
    ) -> tuple[dict[str, Any], list[TraceEvent], Any]:
        """非 native 模式：单 Agent + 请求级工具白名单 + output_type 结构化输出。"""

        from agents import Agent, Runner

        model = build_chat_model(request)
        request_tools = [tool.name for tool in request.agent.tools]
        allowed = resolve_stage_tools(request_tools, None)
        mcp_servers = []
        if allowed:
            mcp_servers.append(
                build_mcp_server(
                    f"run-{request.run_id}",
                    allowed,
                    os.environ.get("QUALITY_TOOL_MCP_URL", DEFAULT_TOOL_MCP_URL),
                )
            )

        schema_model = output_model(request.agent.output_schema)
        agent = Agent(
            name=request.agent.id,
            instructions=request.agent.instructions,
            model=model,
            mcp_servers=mcp_servers,
            output_type=schema_model,
        )
        prompt = json.dumps(
            {
                "task": "Analyze the call record and return only the required structured output.",
                "input": request.input,
                "context": request.context.model_dump(mode="json"),
                "master_data": [item.model_dump(mode="json") for item in request.agent.master_data],
            },
            ensure_ascii=False,
        )

        try:
            result = await asyncio.wait_for(
                Runner.run(
                    agent,
                    input=prompt,
                    max_turns=GENERIC_MAX_TURNS,
                    run_config=self._run_config(),
                ),
                timeout=request.timeout_seconds,
            )
        except asyncio.TimeoutError as exc:
            raise AdapterExecutionError(
                RuntimeError(
                    code=ErrorCode.TIMEOUT,
                    message="OpenAI Agents execution timed out",
                    retryable=True,
                )
            ) from exc
        except asyncio.CancelledError:
            raise
        except AdapterExecutionError:
            raise
        except Exception as exc:  # noqa: BLE001 - Provider 边界不得泄漏异常
            raise AdapterExecutionError(
                RuntimeError(
                    code=ErrorCode.MODEL_ERROR,
                    message="OpenAI Agents execution failed",
                    retryable=True,
                    details={"exception_type": type(exc).__name__},
                )
            ) from exc

        if result.final_output is None:
            raise AdapterExecutionError(
                RuntimeError(
                    code=ErrorCode.OUTPUT_SCHEMA_ERROR,
                    message="OpenAI Agents did not produce structured output",
                    retryable=True,
                    details={
                        "model_calls": len(getattr(result, "raw_responses", []) or []),
                    },
                )
            )

        output = _dump_output(result.final_output)
        trace = stage_trace_from_result(str(agent.name), result)
        usage = usage_from_results([result], enterprise_tool_call_count(trace))
        return output, trace, usage

    async def _execute_native(
        self, request: RuntimeExecuteRequest
    ) -> tuple[dict[str, Any], list[TraceEvent], Any]:
        """native_quality_v0.2 五阶段工作流（OAI-R2 交付）。"""

        from .native_workflow import run_native_quality_workflow

        return await run_native_quality_workflow(request)

    @staticmethod
    def _run_config() -> Any:
        from agents.run import RunConfig

        return RunConfig(tracing_disabled=True)


def _dump_output(final_output: Any) -> dict[str, Any]:
    if hasattr(final_output, "model_dump"):
        dumped = final_output.model_dump(mode="json")
        if isinstance(dumped, dict):
            return dumped
    if isinstance(final_output, dict):
        return final_output
    raise AdapterExecutionError(
        RuntimeError(
            code=ErrorCode.OUTPUT_SCHEMA_ERROR,
            message="OpenAI Agents final output is not an object",
            retryable=True,
            details={"output_type": type(final_output).__name__},
        )
    )
