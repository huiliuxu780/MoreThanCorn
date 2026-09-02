"""Model resolution for the OpenAI Agents runtime (SDD 14 §14).

优先级：冻结请求 request.agent.model > 本地开发 fallback（仅模型名）。
真实 Secret 只来自环境变量，禁止进入请求体或 Trace。
"""

from __future__ import annotations

import os
from typing import Any

from quality_runtime_contract import ErrorCode, RuntimeError, RuntimeExecuteRequest
from quality_runtime_service import AdapterExecutionError

# 只接受 OpenAI-compatible 语义的 Provider 字符串；其余一律失败关闭。
SUPPORTED_PROVIDERS = {
    "openai",
    "openai-compatible",
    "deepseek-compatible",
    "dashscope",
    "dashscope-compatible",
    "bailian",
}

# dispatcher 未配置模型时下发 "unset"；此时允许用本地环境变量兜底（仅开发）。
UNSET_MODEL_SENTINELS = {"", "unset"}

# 契约层允许的模型参数；未知参数失败关闭（与 AgentScope runtime 同策略）。
ALLOWED_PARAMETERS = {"max_tokens", "temperature", "top_p", "parallel_tool_calls"}


def resolve_api_key() -> str:
    api_key = os.environ.get("QUALITY_MODEL_API_KEY", "")
    if not api_key:
        raise AdapterExecutionError(
            RuntimeError(
                code=ErrorCode.PROVIDER_UNAVAILABLE,
                message="QUALITY_MODEL_API_KEY is not configured",
            )
        )
    return api_key


def resolve_model_name(request: RuntimeExecuteRequest) -> str:
    model = str(request.agent.model.model or "")
    if model in UNSET_MODEL_SENTINELS:
        fallback = os.environ.get("QUALITY_MODEL_ID", "")
        if not fallback:
            raise AdapterExecutionError(
                RuntimeError(
                    code=ErrorCode.AGENT_SPEC_INVALID,
                    message="request model is unset and QUALITY_MODEL_ID fallback is empty",
                )
            )
        return fallback
    return model


def validate_provider(request: RuntimeExecuteRequest) -> None:
    if request.agent.model.provider not in SUPPORTED_PROVIDERS:
        raise AdapterExecutionError(
            RuntimeError(
                code=ErrorCode.AGENT_SPEC_INVALID,
                message=f"unsupported model provider: {request.agent.model.provider}",
            )
        )
    unknown_parameters = set(request.agent.model.parameters) - ALLOWED_PARAMETERS
    if unknown_parameters:
        raise AdapterExecutionError(
            RuntimeError(
                code=ErrorCode.AGENT_SPEC_INVALID,
                message=f"unsupported model parameters: {sorted(unknown_parameters)}",
            )
        )


def build_model_settings(parameters: dict[str, Any]) -> Any:
    """把契约参数映射为 SDK ModelSettings；未知参数已在 validate_provider 拒绝。"""

    from agents import ModelSettings

    kwargs: dict[str, Any] = {}
    if "temperature" in parameters:
        kwargs["temperature"] = float(parameters["temperature"])
    if "top_p" in parameters:
        kwargs["top_p"] = float(parameters["top_p"])
    if "max_tokens" in parameters:
        kwargs["max_tokens"] = int(parameters["max_tokens"])
    if "parallel_tool_calls" in parameters:
        kwargs["parallel_tool_calls"] = bool(parameters["parallel_tool_calls"])
    # chat completions 端点需要显式要求 usage 回传（token 统计来源）。
    kwargs["include_usage"] = True
    return ModelSettings(**kwargs)


def build_chat_model(request: RuntimeExecuteRequest) -> Any:
    """AsyncOpenAI(base_url, api_key) + OpenAIChatCompletionsModel（SDD 14 §14.3）。"""

    from agents import OpenAIChatCompletionsModel
    from openai import AsyncOpenAI

    api_key = resolve_api_key()
    validate_provider(request)
    client = AsyncOpenAI(
        api_key=api_key,
        base_url=os.environ.get("QUALITY_MODEL_BASE_URL") or None,
    )
    return OpenAIChatCompletionsModel(
        model=resolve_model_name(request),
        openai_client=client,
    )
