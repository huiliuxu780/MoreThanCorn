"""OpenAI Agents SDK staged business workflow for business_analysis_v1 (SDD-14 扩展).

编排语义对齐 DSH runtime 的 native_business_analysis 状态机：
identify（问题与查询计划）→ execute/<plan>（每计划恰好一次对应工具）→ barrier
→ synthesize。差异仅在实现形态：Python 控制阶段 + SDK Agent 控制单阶段。

模块铁律（business_analysis spec）：**数值计算由确定性代码完成**。执行阶段的
数值/单位/引用一律由代码从工具回包解析（语言模型只负责按计划在工具循环中发起
查询）；synthesize 阶段语言模型只撰写 answer 文本，metrics/citations/confidence
仍为确定性投影。
"""

from __future__ import annotations

import asyncio
import json
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
    PlanTask,
    _progress_details,
    runtime_usage_from_trace,
)
from .tool_adapter import DEFAULT_TOOL_MCP_URL
from .trace_mapper import stage_trace_from_result, utcnow

log = logging.getLogger("openai_agents.business_workflow")

PLAN_KIND_TO_TOOL = {"metric": "metric_query", "dimension": "dimension_query"}

IDENTIFY_INSTRUCTIONS = (
    "你在只读业务分析工作流 business_analysis_v1 的 identify 阶段。"
    "从输入中提取 question_id，并列出回答该问题所需的全部查询计划 plans："
    "每个计划含 kind（metric=查指标序列/聚合，dimension=查维度拆解）、"
    "subject（指标名，如 connect_rate；或维度主题，如 connect_rate×region）、"
    "query（给工具的查询说明：指标/维度名称 + 输入中的窗口符号，如 last_7d）。"
    "不得合并相互独立的指标；维度拆解是独立计划。question_id 必须原样保留。"
)

EXECUTE_INSTRUCTIONS_TEMPLATE = (
    "你在只读业务分析工作流的执行阶段 {stage}。必须且只能调用一次 {tool}，"
    "入参使用计划中的指标/维度名称；时间窗口一律用 window 符号参数"
    "（如 last_7d、last_14d，取自输入中的 window 字段），禁止自行推算或填写具体日期。"
    "工具返回后停止调用，用一句简短文本总结你查到的数据。"
)

SYNTHESIZE_INSTRUCTIONS = (
    "你在只读业务分析工作流的 synthesize 阶段。只根据已完成的确定性执行结果写一段"
    "简洁的中文结论 answer：引用关键数值与数据来源，不得新增事实、不得修改数值、"
    "不得给出超出数据的建议。只输出 answer 文本。"
)


class BusinessPlan(BaseModel):
    kind: Literal["metric", "dimension"]
    subject: str = Field(min_length=1)
    query: str = Field(min_length=1)


class BusinessIdentification(BaseModel):
    question_id: str = Field(min_length=1)
    plans: list[BusinessPlan] = Field(min_length=1)


class BusinessAnswer(BaseModel):
    answer: str = Field(min_length=1)


def _extract_tool_output(transcript: list[dict[str, Any]], tool: str) -> dict[str, Any] | None:
    """从工具循环记录解析该计划工具的首个回包 output（确定性，不经语言模型）。"""

    for entry in transcript:
        if entry.get("tool") != tool:
            continue
        try:
            parsed = json.loads(entry.get("result") or "")
        except (TypeError, ValueError):
            continue
        if not isinstance(parsed, dict):
            continue
        output = parsed.get("output")
        if isinstance(output, dict):
            return output
        return parsed
    return None


def _deterministic_execution(item: dict[str, Any], facts: dict[str, Any]) -> dict[str, Any]:
    """工具回包 → 计划执行结果（数值/单位/引用全部确定性生成）。"""

    tool = item["tool"]
    window = facts.get("window") or {}
    unit = str(facts.get("unit") or "")
    metric = str(facts.get("metric") or item["subject"])
    if not facts.get("known", True):
        raise ValueError(f"{item['id']}: tool reported unknown metric/dimension")
    if item["kind"] == "metric":
        value = facts.get("aggregate")
        if not isinstance(value, (int, float)):
            raise ValueError(f"{item['id']} tool result has no numeric aggregate")
        reference = f"metric:{metric}:{window.get('start')}..{window.get('end')}"
        points = facts.get("points") or []
        summary = f"窗口聚合 {value}{unit}（{len(points)} 个数据点）"
        reason = f"依据 {tool} 返回数据，窗口聚合值为 {value}{unit}。"
    else:
        value = None
        dimension = str(facts.get("dimension") or "")
        reference = f"dimension:{dimension}:{metric}"
        breakdown = facts.get("breakdown") or []
        summary = f"维度拆解 {len(breakdown)} 项"
        reason = f"依据 {tool} 返回数据，获得 {len(breakdown)} 项维度拆解。"
    return {
        "plan_id": item["id"],
        "kind": item["kind"],
        "subject": item["subject"],
        "value": value,
        "unit": unit,
        "citations": [{"source": tool, "reference": reference, "summary": summary}],
        "reason": reason,
    }


class BusinessAnalysisWorkflow:
    STAGE_ORDER = ["identify", "plan", "execute", "barrier", "synthesize"]

    def __init__(self, runner: OpenAIAgentsStageRunner) -> None:
        self.runner = runner
        self.trace: list[TraceEvent] = []
        # Module policy maxParallelPlans=2：代码承载（与 quality 工作流一致）。
        self.execution_slots = asyncio.Semaphore(2)

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

    async def _execute_plan_once(
        self, item: dict[str, Any], stage: str, request_input: dict[str, Any]
    ) -> tuple[dict[str, Any], list[TraceEvent]]:
        loop_result, transcript, _notes = await self.runner.run_tool_loop(
            stage=stage,
            instructions=EXECUTE_INSTRUCTIONS_TEMPLATE.format(stage=stage, tool=item["tool"]),
            payload={"plan": item, "input": request_input},
            allowed_tools=[item["tool"]],
        )
        stage_trace = stage_trace_from_result(f"quality-{stage}", loop_result)
        calls = [entry for entry in transcript if entry.get("tool") == item["tool"]]
        if len(calls) != 1:
            raise ValueError(f"{item['id']} must call {item['tool']} exactly once")
        facts = _extract_tool_output(transcript, item["tool"])
        if facts is None:
            raise ValueError(f"{item['id']} has no parsable tool result")
        return _deterministic_execution(item, facts), stage_trace

    async def _run_plan_with_retry(
        self, item: dict[str, Any], stage: str, request_input: dict[str, Any]
    ) -> tuple[dict[str, Any], list[TraceEvent]]:
        """并发上限内执行；结构化/数值异常重试一次（与 quality 工作流同语义）。"""

        async with self.execution_slots:
            for attempt in (1, 2):
                try:
                    return await self._execute_plan_once(item, stage, request_input)
                except ValueError:
                    if attempt == 2:
                        raise
                    self._event(
                        "workflow/stage_retry",
                        stage,
                        attempt=attempt,
                        reason="invalid_stage_output",
                    )
        raise AssertionError("unreachable")

    async def execute(
        self, request: RuntimeExecuteRequest
    ) -> tuple[dict[str, Any], list[TraceEvent]]:
        self._event("workflow/stage_started", "identify")
        identified = await self.runner.run(
            stage="identify",
            instructions=IDENTIFY_INSTRUCTIONS,
            payload={"input": request.input},
            schema=BusinessIdentification,
            allowed_tools=[],
            tasks=[],
        )
        self._append_native_trace("identify", identified.trace)
        self._event("workflow/stage_completed", "identify")

        identification = BusinessIdentification.model_validate(identified.output)
        question_id = identification.question_id

        self._event("workflow/stage_started", "plan")
        queue: list[dict[str, Any]] = []
        execution_tasks: list[PlanTask] = []
        for index, plan in enumerate(identification.plans, start=1):
            tool = PLAN_KIND_TO_TOOL[plan.kind]
            plan_id = f"{plan.kind}-{index}"
            queue.append({"id": plan_id, "kind": plan.kind, "subject": plan.subject,
                          "query": plan.query, "tool": tool})
            execution_tasks.append(
                PlanTask(
                    id=f"plan-{plan_id}",
                    subject=f"核验 {plan_id}",
                    description=f"仅允许 {tool} 查询一次。",
                    metadata={"stage": "execute", "kind": plan.kind,
                              "subject_id": plan_id, "tool_policy": [tool]},
                )
            )
        self._event("workflow/stage_completed", "plan", plan_count=len(queue))
        self._event("workflow/stage_started", "execute", fan_out=len(queue))

        async def run_plan(item: dict[str, Any], task: PlanTask) -> dict[str, Any]:
            task.state = "in_progress"
            stage = f"execute/{item['id']}"
            execution, stage_trace = await self._run_plan_with_retry(item, stage, request.input)
            self._append_native_trace(stage, stage_trace)
            task.state = "completed"
            return execution

        results = await asyncio.gather(*(run_plan(item, task)
                                         for item, task in zip(queue, execution_tasks)))
        self._event("workflow/stage_completed", "execute", completed=len(results))

        self._event("workflow/stage_started", "barrier")
        incomplete = [task.id for task in execution_tasks if task.state != "completed"]
        if incomplete:
            raise RuntimeError(f"workflow barrier blocked by: {incomplete}")
        self._event("workflow/stage_completed", "barrier", barrier_passed=True)

        metrics = [
            {"metric": row["subject"], "value": row["value"], "unit": row["unit"]}
            for row in results if row["kind"] == "metric"
        ]
        citations = [citation for row in results for citation in row["citations"]]
        synthesis_state = {
            "question_id": question_id,
            "metrics": metrics,
            "citations": citations,
            "plan_results": results,
        }

        self._event("workflow/stage_started", "synthesize")
        synthesis = await self.runner.run(
            stage="synthesize",
            instructions=SYNTHESIZE_INSTRUCTIONS,
            payload=synthesis_state,
            schema=BusinessAnswer,
            allowed_tools=[],
            tasks=execution_tasks,
        )
        self._append_native_trace("synthesize", synthesis.trace)
        self._event("workflow/stage_completed", "synthesize")

        output = {
            "question_id": question_id,
            "answer": BusinessAnswer.model_validate(synthesis.output).answer,
            "metrics": metrics,
            "citations": citations,
            "confidence": 0.9,
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
    workflow = BusinessAnalysisWorkflow(runner)
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
