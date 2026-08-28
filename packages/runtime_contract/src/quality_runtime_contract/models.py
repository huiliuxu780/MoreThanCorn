"""Provider-neutral request, lifecycle, result, and health schemas.

The contract deliberately models an asynchronous run lifecycle. A provider
accepts a run, exposes its current state, and eventually returns a terminal
result. Platform business objects such as Task, Scorecard, Review, and Result
do not belong in this package.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

JsonObject = dict[str, Any]


class ContractModel(BaseModel):
    """Strict base model so provider-specific fields cannot leak unnoticed."""

    model_config = ConfigDict(extra="forbid")


class RunStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"

    @property
    def terminal(self) -> bool:
        return self in {self.SUCCEEDED, self.FAILED, self.CANCELLED}


class ErrorCode(StrEnum):
    INVALID_REQUEST = "invalid_request"
    AGENT_SPEC_INVALID = "agent_spec_invalid"
    PROVIDER_UNAVAILABLE = "provider_unavailable"
    MODEL_ERROR = "model_error"
    TOOL_ERROR = "tool_error"
    OUTPUT_SCHEMA_ERROR = "output_schema_error"
    TIMEOUT = "timeout"
    CANCELLED = "cancelled"
    INTERNAL_ERROR = "internal_error"


class ModelSpec(ContractModel):
    provider: str = Field(min_length=1)
    model: str = Field(min_length=1)
    parameters: JsonObject = Field(default_factory=dict)


class ToolRef(ContractModel):
    name: str = Field(min_length=1)
    version: str = Field(min_length=1)


class MasterDataRef(ContractModel):
    name: str = Field(min_length=1)
    version: str = Field(min_length=1)


class AgentExecutionSpec(ContractModel):
    id: str = Field(min_length=1)
    version: str = Field(min_length=1)
    instructions: str = Field(min_length=1)
    model: ModelSpec
    tools: list[ToolRef] = Field(default_factory=list)
    master_data: list[MasterDataRef] = Field(default_factory=list)
    output_schema: JsonObject


class ExecutionContext(ContractModel):
    task_instance_id: str | None = None
    trace_id: str | None = None
    metadata: JsonObject = Field(default_factory=dict)


class RuntimeExecuteRequest(ContractModel):
    schema_version: Literal["1.0"] = "1.0"
    run_id: str = Field(min_length=1, max_length=128)
    idempotency_key: str = Field(min_length=1, max_length=256)
    agent: AgentExecutionSpec
    input: JsonObject
    context: ExecutionContext = Field(default_factory=ExecutionContext)
    timeout_seconds: int = Field(default=120, ge=1, le=3600)


class RuntimeUsage(ContractModel):
    input_tokens: int = Field(default=0, ge=0)
    output_tokens: int = Field(default=0, ge=0)
    total_tokens: int = Field(default=0, ge=0)
    model_calls: int = Field(default=0, ge=0)
    tool_calls: int = Field(default=0, ge=0)

    @model_validator(mode="after")
    def total_matches_parts(self) -> RuntimeUsage:
        expected = self.input_tokens + self.output_tokens
        if self.total_tokens != expected:
            raise ValueError("total_tokens must equal input_tokens + output_tokens")
        return self


class RuntimeError(ContractModel):
    code: ErrorCode
    message: str = Field(min_length=1)
    retryable: bool = False
    details: JsonObject = Field(default_factory=dict)


class TraceEvent(ContractModel):
    sequence: int = Field(ge=0)
    timestamp: datetime
    type: str = Field(min_length=1)
    name: str | None = None
    call_id: str | None = None
    parent_call_id: str | None = None
    input: JsonObject | None = None
    output: JsonObject | None = None
    error: RuntimeError | None = None
    metadata: JsonObject = Field(default_factory=dict)


class RuntimeInfo(ContractModel):
    provider: str = Field(min_length=1)
    runtime_version: str = Field(min_length=1)
    adapter_version: str = Field(min_length=1)


class RunAccepted(ContractModel):
    schema_version: Literal["1.0"] = "1.0"
    run_id: str
    status: RunStatus
    runtime: RuntimeInfo


class RuntimeRun(ContractModel):
    schema_version: Literal["1.0"] = "1.0"
    run_id: str
    status: RunStatus
    output: JsonObject | None = None
    usage: RuntimeUsage = Field(default_factory=RuntimeUsage)
    trace: list[TraceEvent] = Field(default_factory=list)
    runtime: RuntimeInfo
    started_at: datetime | None = None
    finished_at: datetime | None = None
    error: RuntimeError | None = None

    @model_validator(mode="after")
    def terminal_state_is_consistent(self) -> RuntimeRun:
        if self.status is RunStatus.SUCCEEDED:
            if self.output is None:
                raise ValueError("succeeded run must include output")
            if self.error is not None:
                raise ValueError("succeeded run cannot include error")
            if self.finished_at is None:
                raise ValueError("succeeded run must include finished_at")
        elif self.status is RunStatus.FAILED:
            if self.error is None:
                raise ValueError("failed run must include error")
            if self.finished_at is None:
                raise ValueError("failed run must include finished_at")
        elif self.status is RunStatus.CANCELLED:
            if self.finished_at is None:
                raise ValueError("cancelled run must include finished_at")
            if self.error is not None and self.error.code is not ErrorCode.CANCELLED:
                raise ValueError("cancelled run may only include a cancelled error")
        else:
            if self.output is not None or self.error is not None or self.finished_at is not None:
                raise ValueError("non-terminal run cannot include output, error, or finished_at")
        return self


class ProviderCapabilities(ContractModel):
    tools: bool
    skills: bool
    structured_output: bool
    trace: bool
    session: bool
    cancel: bool
    streaming: bool
    sandbox: bool


class HealthStatus(ContractModel):
    status: Literal["ok", "degraded", "unavailable"]
    runtime: RuntimeInfo
    capabilities: ProviderCapabilities
    checks: dict[str, Literal["ok", "degraded", "failed"]] = Field(default_factory=dict)
