"""OpenAI Agents SDK business workflow for business_analysis_v1 (SDD-14，通话业务打标).

business-analysis = 对一通已脱敏服务热线通话做**只读业务理解与逐通话打标**：
服务类型、客户意图、业务结果、跟进机会。与 quality 的合规判定互补
（质检判"坐席做得对不对"，业务打标答"这通电话讲的是什么业务"）。

纯通话内容理解，无需企业工具——两阶段、无工具：
understand（读通话、抽取业务事实）→ synthesize（产出最终业务标签）。
输出 Schema 与平台 business_analysis/schemas/output.schema.json 对齐；
sample_id 由代码从输入确定性解析（不经语言模型）。
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Any, Literal

from pydantic import BaseModel, Field

from quality_runtime_contract import (
    ErrorCode,
    RuntimeError,
    RuntimeExecuteRequest,
    TraceEvent,
)
from quality_runtime_service import AdapterExecutionError

from .model_adapter import build_chat_model
from .native_workflow import (
    OpenAIAgentsStageRunner,
    _progress_details,
    resolve_sample_id,
    runtime_usage_from_trace,
)
from .tool_adapter import DEFAULT_TOOL_MCP_URL
from .trace_mapper import utcnow

log = logging.getLogger("openai_agents.business_workflow")

UNDERSTAND_INSTRUCTIONS = (
    "你在只读业务分析工作流 business_analysis_v1 的 understand 阶段。"
    "通读整段通话转写，从业务视角抽取事实：客户的业务诉求有哪些、属于什么服务场景、"
    "坐席做了哪些关键处理/承诺、通话结束时客户诉求处于什么状态。"
    "只抽取通话中真实出现的内容，不得推测或编造。"
)

SYNTHESIZE_INSTRUCTIONS = (
    "你在只读业务分析工作流的 synthesize 阶段。基于 understand 阶段抽取的业务事实，"
    "产出这通通话的最终业务标签：服务类型（只能从 CONSULTATION/REPAIR/COMPLAINT/OTHER 中选）、"
    "客户意图列表（每个独立诉求一条）、业务结果（resolved/pending/escalated/unresolved/unclear）、"
    "跟进机会列表（没有则空数组）、以及一句话业务总结。"
    "结论必须忠于通话事实，不得新增通话中不存在的信息。"
)


class BusinessUnderstanding(BaseModel):
    """understand 阶段：通话业务事实抽取（中间结构）。"""

    customer_needs: list[str] = Field(default_factory=list)
    service_scenario: str = ""
    key_events: list[str] = Field(default_factory=list)
    resolution_signals: str = ""


class CustomerIntent(BaseModel):
    intent: str = Field(min_length=1)
    description: str = ""


class FollowUp(BaseModel):
    action: str = Field(min_length=1)
    reason: str = ""


class BusinessTags(BaseModel):
    """synthesize 阶段：最终业务标签（与平台输出 Schema 对齐，sample_id 由代码注入）。"""

    service_type_code: str | None = None
    customer_intents: list[CustomerIntent] = Field(default_factory=list)
    business_outcome: Literal["resolved", "pending", "escalated", "unresolved", "unclear"] = (
        "unclear"
    )
    follow_ups: list[FollowUp] = Field(default_factory=list)
    summary: str = Field(min_length=1)


class BusinessTaggingWorkflow:
    STAGE_ORDER = ["understand", "synthesize"]

    def __init__(self, runner: OpenAIAgentsStageRunner) -> None:
        self.runner = runner
        self.trace: list[TraceEvent] = []

    def _event(self, event_type: str, name: str, **metadata: Any) -> None:
        self.trace.append(
            TraceEvent(
                sequence=len(self.trace),
                timestamp=utcnow(),
                type=event_type,
                name=name,
                metadata=metadata,
            )
        )
        if event_type.startswith("workflow/"):
            log.info("business workflow %s: %s %s", event_type, name, metadata or "")

    def _append_native_trace(self, stage: str, trace: list[TraceEvent]) -> None:
        for event in trace:
            event.sequence = len(self.trace)
            event.metadata = {**event.metadata, "workflow_stage": stage}
            self.trace.append(event)

    async def execute(
        self, request: RuntimeExecuteRequest
    ) -> tuple[dict[str, Any], list[TraceEvent]]:
        self._event("workflow/stage_started", "understand")
        understanding = await self.runner.run(
            stage="understand",
            instructions=UNDERSTAND_INSTRUCTIONS,
            payload={"input": request.input},
            schema=BusinessUnderstanding,
            allowed_tools=[],
            tasks=[],
        )
        self._append_native_trace("understand", understanding.trace)
        self._event("workflow/stage_completed", "understand")

        self._event("workflow/stage_started", "synthesize")
        tags = await self.runner.run(
            stage="synthesize",
            instructions=SYNTHESIZE_INSTRUCTIONS,
            payload={"input": request.input, "understanding": understanding.output},
            schema=BusinessTags,
            allowed_tools=[],
            tasks=[],
        )
        self._append_native_trace("synthesize", tags.trace)
        self._event("workflow/stage_completed", "synthesize")

        validated = BusinessTags.model_validate(tags.output)
        output = {
            "sample_id": resolve_sample_id(request),
            **validated.model_dump(mode="json"),
        }
        return output, self.trace


async def run_business_workflow(
    request: RuntimeExecuteRequest,
) -> tuple[dict[str, Any], list[TraceEvent], Any]:
    """adapter._execute_business 入口：构建模型与 StageRunner，执行并汇总。"""

    model = build_chat_model(request)
    runner = OpenAIAgentsStageRunner(
        model=model,
        request_tools=[tool.name for tool in request.agent.tools],
        mcp_url=os.environ.get("QUALITY_TOOL_MCP_URL", DEFAULT_TOOL_MCP_URL),
        model_parameters=request.agent.model.parameters,
    )
    workflow = BusinessTaggingWorkflow(runner)
    started = time.monotonic()
    try:
        output, trace = await asyncio.wait_for(
            workflow.execute(request),
            timeout=request.timeout_seconds,
        )
    except asyncio.TimeoutError as exc:
        raise AdapterExecutionError(
            RuntimeError(
                code=ErrorCode.TIMEOUT,
                message="OpenAI Agents business workflow timed out",
                retryable=True,
                details=_progress_details(workflow, started),
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
                message="OpenAI Agents business workflow failed",
                retryable=True,
                details={"exception_type": type(exc).__name__,
                         "exception_message": str(exc)[:300],
                         **_progress_details(workflow, started)},
            )
        ) from exc
    return output, trace, runtime_usage_from_trace(trace)
