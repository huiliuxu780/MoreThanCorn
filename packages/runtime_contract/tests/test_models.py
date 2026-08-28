from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from quality_runtime_contract import (
    AgentExecutionSpec,
    ErrorCode,
    ModelSpec,
    RunStatus,
    RuntimeError,
    RuntimeExecuteRequest,
    RuntimeInfo,
    RuntimeRun,
    RuntimeUsage,
    ToolRef,
)


def agent_spec() -> AgentExecutionSpec:
    return AgentExecutionSpec(
        id="quality-agent",
        version="0.1.0",
        instructions="Only make evidence-based findings.",
        model=ModelSpec(provider="openai-compatible", model="quality-model"),
        tools=[ToolRef(name="knowledge_search", version="1.0.0")],
        output_schema={"type": "object", "required": ["findings"]},
    )


def runtime_info() -> RuntimeInfo:
    return RuntimeInfo(
        provider="agentscope",
        runtime_version="2.0.7",
        adapter_version="0.1.0",
    )


def test_execute_request_is_strict_and_versioned():
    request = RuntimeExecuteRequest(
        run_id="run-001",
        idempotency_key="sample-001:agentscope:v1",
        agent=agent_spec(),
        input={"call_id": "CALL001", "conversation": []},
    )

    assert request.schema_version == "1.0"
    assert request.timeout_seconds == 120

    with pytest.raises(ValidationError):
        RuntimeExecuteRequest.model_validate({**request.model_dump(), "provider_options": {}})


def test_succeeded_run_requires_output_and_finish_time():
    now = datetime.now(timezone.utc)
    run = RuntimeRun(
        run_id="run-001",
        status=RunStatus.SUCCEEDED,
        output={"findings": []},
        runtime=runtime_info(),
        started_at=now,
        finished_at=now,
    )

    assert run.status.terminal is True

    with pytest.raises(ValidationError, match="must include output"):
        RuntimeRun(
            run_id="run-002",
            status=RunStatus.SUCCEEDED,
            runtime=runtime_info(),
            started_at=now,
            finished_at=now,
        )


def test_failed_run_requires_standard_error():
    now = datetime.now(timezone.utc)
    run = RuntimeRun(
        run_id="run-003",
        status=RunStatus.FAILED,
        runtime=runtime_info(),
        started_at=now,
        finished_at=now,
        error=RuntimeError(
            code=ErrorCode.OUTPUT_SCHEMA_ERROR,
            message="provider returned invalid structured output",
            retryable=True,
        ),
    )

    assert run.error is not None
    assert run.error.retryable is True


def test_non_terminal_run_cannot_publish_result_early():
    with pytest.raises(ValidationError, match="non-terminal run"):
        RuntimeRun(
            run_id="run-004",
            status=RunStatus.RUNNING,
            output={"findings": []},
            runtime=runtime_info(),
        )


def test_usage_total_is_not_provider_defined():
    assert RuntimeUsage(input_tokens=10, output_tokens=4, total_tokens=14).total_tokens == 14

    with pytest.raises(ValidationError, match="total_tokens"):
        RuntimeUsage(input_tokens=10, output_tokens=4, total_tokens=99)
