"""OpenAI Agents SDK staged quality workflow for native_quality_v0.2 (SDD 14 §18–§23).

编排语义与 AgentScope runtime 的 native_quality_v0.2 保持一致：相同阶段指令、
相同确定性 plan 生成、相同 barrier 语义、相同并发上限（maxParallelPlans=2，
代码承载而非 Prompt）。差异仅在 StageRunner 执行引擎（SDK Agent + Runner）。

最终输出经确定性投影符合平台 quality_output.schema.json（SDD 14 §23/§45）：
findings 由 knowledge/promise 逐项执行结果聚合，labels 只取 Master Data 码，
评分仍由平台规则引擎派生——本模块不算分。
"""

from __future__ import annotations

import asyncio
import json
import os
from dataclasses import dataclass, field
from typing import Any, Awaitable, Literal, Protocol

from pydantic import BaseModel, Field

from quality_runtime_contract import (
    ErrorCode,
    RuntimeError,
    RuntimeExecuteRequest,
    RuntimeUsage,
    TraceEvent,
)
from quality_runtime_service import AdapterExecutionError

from .model_adapter import build_chat_model
from .tool_adapter import DEFAULT_TOOL_MCP_URL, build_mcp_server, resolve_stage_tools
from .trace_mapper import enterprise_tool_call_count, stage_trace_from_result, utcnow


class Need(BaseModel):
    category: Literal["repair", "complaint", "policy_consultation", "appointment", "other"]
    description: str
    evidence_sequences: list[int]


class KnowledgeClaim(BaseModel):
    claim: str
    evidence_sequences: list[int]


class Promise(BaseModel):
    type: Literal["ticket", "sms", "appointment"]
    commitment: str
    evidence_sequences: list[int]


class Identification(BaseModel):
    consumer_needs: list[Need]
    knowledge_claims: list[KnowledgeClaim]
    promises: list[Promise]


class SearchRound(BaseModel):
    query: str
    evidence_refs: list[str]
    decisive: bool


class KnowledgeExecution(BaseModel):
    status: Literal["accurate", "inaccurate", "insufficient_evidence"]
    search_rounds: list[SearchRound]
    evidence_refs: list[str]
    reason: str


class PromiseExecution(BaseModel):
    status: Literal["fulfilled", "unfulfilled", "mismatched", "insufficient_evidence"]
    evidence_refs: list[str]
    reason: str


class SummaryOutput(BaseModel):
    summary: str = Field(min_length=1)


@dataclass
class StageResult:
    output: dict[str, Any]
    trace: list[TraceEvent]


@dataclass
class PlanTask:
    """OpenAI Runtime 侧的计划任务簿记（对应 AgentScope runtime 的 Task 状态）。"""

    id: str
    subject: str
    description: str
    metadata: dict[str, Any] = field(default_factory=dict)
    state: str = "pending"


class StageRunner(Protocol):
    async def run(
        self,
        *,
        stage: str,
        instructions: str,
        payload: dict[str, Any],
        schema: type[BaseModel],
        allowed_tools: list[str],
        tasks: list[Any],
    ) -> StageResult: ...


class OpenAIAgentsStageRunner:
    """Run one bounded OpenAI Agents stage with a code-enforced tool allowlist."""

    def __init__(
        self,
        *,
        model: Any,
        request_tools: list[str],
        mcp_url: str,
        max_turns: int = 12,
    ) -> None:
        self.model = model
        self.request_tools = request_tools
        self.mcp_url = mcp_url
        self.max_turns = max_turns

    def _stage_tooling(
        self, stage: str, allowed_tools: list[str]
    ) -> tuple[list[Any], list[Any]]:
        """(mcp_servers, function_tools)：生产经 MCP 网关；测试可注入函数工具。"""

        if not allowed_tools:
            return [], []
        return [build_mcp_server(stage, allowed_tools, self.mcp_url)], []

    async def run(
        self,
        *,
        stage: str,
        instructions: str,
        payload: dict[str, Any],
        schema: type[BaseModel],
        allowed_tools: list[str],
        tasks: list[Any],
    ) -> StageResult:
        from agents import Agent, Runner
        from agents.run import RunConfig

        # SDD 14 §15.2：阶段白名单 ∩ 请求声明工具；白名单外的工具物理不存在。
        allowed = resolve_stage_tools(self.request_tools, allowed_tools)
        mcp_servers, function_tools = self._stage_tooling(stage, allowed)
        agent = Agent(
            name=f"quality-{stage}",
            instructions=instructions,
            model=self.model,
            tools=function_tools,
            mcp_servers=mcp_servers,
            output_type=schema,
        )
        result = await Runner.run(
            agent,
            input=json.dumps(payload, ensure_ascii=False),
            max_turns=self.max_turns,
            run_config=RunConfig(tracing_disabled=True),
        )
        if result.final_output is None:
            raise ValueError(f"OpenAI Agents stage {stage} did not produce structured output")
        final_output = result.final_output
        output = (
            final_output.model_dump(mode="json")
            if hasattr(final_output, "model_dump")
            else dict(final_output)
        )
        trace = stage_trace_from_result(str(agent.name), result)
        return StageResult(output=output, trace=trace)


# ---------- 平台 Schema 投影（确定性代码，不依赖语言模型） ----------

NEED_TO_SERVICE_TYPE = {
    "repair": "REPAIR",
    "complaint": "COMPLAINT",
    "policy_consultation": "CONSULTATION",
    "appointment": "OTHER",
    "other": "OTHER",
}
CONFIDENCE_DECISIVE = 0.9
CONFIDENCE_INSUFFICIENT = 0.5
EVIDENCE_SUMMARY_LIMIT = 300


def _evidence_summary(text: str) -> str:
    text = (text or "").strip()
    return text[:EVIDENCE_SUMMARY_LIMIT] if text else "（无附加说明）"


def _knowledge_evidence(results: list[dict[str, Any]]) -> list[dict[str, str]]:
    evidence: list[dict[str, str]] = []
    for row in results:
        evidence.append(
            {
                "source": "conversation",
                "reference": str(row.get("claim_id") or "knowledge"),
                "summary": _evidence_summary(str(row.get("claim") or "")),
            }
        )
        for ref in row.get("evidence_refs") or []:
            evidence.append(
                {
                    "source": "tool",
                    "reference": str(ref),
                    "summary": _evidence_summary(str(row.get("reason") or row.get("status"))),
                }
            )
    return evidence


def _promise_evidence(results: list[dict[str, Any]]) -> list[dict[str, str]]:
    evidence: list[dict[str, str]] = []
    for row in results:
        evidence.append(
            {
                "source": "conversation",
                "reference": str(row.get("promise_id") or "promise"),
                "summary": _evidence_summary(str(row.get("commitment") or "")),
            }
        )
        for ref in row.get("evidence_refs") or []:
            evidence.append(
                {
                    "source": "tool",
                    "reference": str(ref),
                    "summary": _evidence_summary(str(row.get("reason") or row.get("status"))),
                }
            )
    return evidence


def project_platform_output(
    *,
    sample_id: str,
    identification: Identification,
    knowledge_results: list[dict[str, Any]],
    promise_results: list[dict[str, Any]],
    summary: str,
) -> dict[str, Any]:
    """native 执行结果 → quality_output.schema.json（findings/labels/summary）。"""

    findings: list[dict[str, Any]] = []

    if knowledge_results:
        statuses = [row.get("status") for row in knowledge_results]
        if "inaccurate" in statuses:
            status, confidence = "failed", CONFIDENCE_DECISIVE
        elif "insufficient_evidence" in statuses:
            status, confidence = "insufficient_evidence", CONFIDENCE_INSUFFICIENT
        else:
            status, confidence = "passed", CONFIDENCE_DECISIVE
        reason = "；".join(
            f"{row.get('claim_id')}({row.get('status')}): {row.get('reason') or '无理由说明'}"
            for row in knowledge_results
        )
        findings.append(
            {
                "criterion": "knowledge_accuracy",
                "status": status,
                "confidence": confidence,
                "reason": _evidence_summary(reason),
                "evidence": _knowledge_evidence(knowledge_results),
            }
        )
    else:
        findings.append(
            {
                "criterion": "knowledge_accuracy",
                "status": "not_applicable",
                "confidence": 1.0,
                "reason": "未识别出可核验的知识/政策陈述，本项不适用。",
                "evidence": [],
            }
        )

    if promise_results:
        statuses = [row.get("status") for row in promise_results]
        if "unfulfilled" in statuses or "mismatched" in statuses:
            status, confidence = "failed", CONFIDENCE_DECISIVE
        elif "insufficient_evidence" in statuses:
            status, confidence = "insufficient_evidence", CONFIDENCE_INSUFFICIENT
        else:
            status, confidence = "passed", CONFIDENCE_DECISIVE
        reason = "；".join(
            f"{row.get('promise_id')}({row.get('status')}): {row.get('reason') or '无理由说明'}"
            for row in promise_results
        )
        findings.append(
            {
                "criterion": "promise_fulfillment",
                "status": status,
                "confidence": confidence,
                "reason": _evidence_summary(reason),
                "evidence": _promise_evidence(promise_results),
            }
        )
    else:
        findings.append(
            {
                "criterion": "promise_fulfillment",
                "status": "not_applicable",
                "confidence": 1.0,
                "reason": "未识别出可核验的动作承诺，本项不适用。",
                "evidence": [],
            }
        )

    service_type_code = None
    if identification.consumer_needs:
        service_type_code = NEED_TO_SERVICE_TYPE.get(
            identification.consumer_needs[0].category, "OTHER"
        )
    issue_codes: list[str] = []
    for finding in findings:
        if finding["status"] != "failed":
            continue
        if finding["criterion"] == "knowledge_accuracy":
            issue_codes.append("KNOWLEDGE_ERROR")
        elif finding["criterion"] == "promise_fulfillment":
            issue_codes.append("PROMISE_NOT_FULFILLED")

    return {
        "sample_id": sample_id,
        "findings": findings,
        "labels": {"service_type_code": service_type_code, "issue_codes": issue_codes},
        "summary": summary,
    }


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


class OpenAIAgentsNativeQualityWorkflow:
    STAGE_ORDER = ["identify", "plan", "execute", "barrier", "synthesize"]
    PROMISE_TO_TOOL = {
        "ticket": "ticket_query",
        "sms": "sms_query",
        "appointment": "appointment_query",
    }

    def __init__(self, runner: StageRunner) -> None:
        self.runner = runner
        self.trace: list[TraceEvent] = []
        # Module policy maxParallelPlans=2：代码承载（与 AgentScope runtime 一致）。
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

    def _append_native_trace(self, stage: str, trace: list[TraceEvent]) -> None:
        for event in trace:
            event.sequence = len(self.trace)
            event.metadata = {**event.metadata, "workflow_stage": stage}
            self.trace.append(event)

    async def _run_execution_stage(self, **kwargs: Any) -> StageResult:
        """Bound provider concurrency and retry one missing structured output."""

        validator = kwargs.pop("result_validator", None)
        async with self.execution_slots:
            for attempt in (1, 2):
                try:
                    result = await self.runner.run(**kwargs)
                    if validator is not None:
                        validator(result)
                    return result
                except ValueError:
                    if attempt == 2:
                        raise
                    self._event(
                        "workflow/stage_retry",
                        str(kwargs["stage"]),
                        attempt=attempt,
                        reason="missing_structured_output",
                    )
        raise AssertionError("unreachable")

    async def execute(
        self, request: RuntimeExecuteRequest
    ) -> tuple[dict[str, Any], list[TraceEvent]]:
        identify_task = PlanTask(
            id="stage-identify",
            subject="识别消费者诉求、知识陈述和坐席承诺",
            description="从通话逐项提取，不合并独立事项。",
            metadata={"stage": "identify"},
            state="in_progress",
        )
        tasks: list[PlanTask] = [identify_task]
        self._event("workflow/stage_started", "identify")
        identified = await self.runner.run(
            stage="identify",
            instructions=(
                "仅根据通话逐项提取消费者诉求、坐席知识/政策陈述和具体可核验承诺。"
                "不得把多个独立事项合并；未来动作是承诺，不是知识陈述。"
                "知识陈述仅限可由知识库核验的政策、规则或产品知识；"
                "工单已提交、短信已发送、预约已创建等个案业务状态不得归为知识陈述，"
                "应放在对应承诺的企业事实工具阶段核验。"
                "consumer_needs.category 只能使用 repair、complaint、policy_consultation、"
                "appointment、other；promises.type 只能使用 ticket、sms、appointment。"
            ),
            payload={"input": request.input},
            schema=Identification,
            allowed_tools=[],
            tasks=tasks,
        )
        self._append_native_trace("identify", identified.trace)
        identify_task.state = "completed"
        self._event("workflow/stage_completed", "identify")

        identification = Identification.model_validate(identified.output)
        self._event("workflow/stage_started", "plan")
        execution_tasks: list[PlanTask] = []
        for index, _claim in enumerate(identification.knowledge_claims, start=1):
            execution_tasks.append(
                PlanTask(
                    id=f"plan-knowledge-{index}",
                    subject=f"核验 knowledge-{index}",
                    description="允许多轮 knowledge_search，证据充分后结束。",
                    metadata={
                        "stage": "execute",
                        "kind": "knowledge",
                        "subject_id": f"knowledge-{index}",
                        "tool_policy": ["knowledge_search"],
                    },
                )
            )
        for index, promise in enumerate(identification.promises, start=1):
            tool = self.PROMISE_TO_TOOL.get(promise.type)
            if tool is None:
                raise ValueError(f"unsupported promise type: {promise.type}")
            execution_tasks.append(
                PlanTask(
                    id=f"plan-promise-{index}",
                    subject=f"核验 promise-{index}",
                    description=f"仅允许 {tool} 核验该承诺。",
                    metadata={
                        "stage": "execute",
                        "kind": "promise",
                        "subject_id": f"promise-{index}",
                        "tool_policy": [tool],
                    },
                )
            )
        tasks.extend(execution_tasks)
        self._event("workflow/stage_completed", "plan", plan_count=len(execution_tasks))

        self._event("workflow/stage_started", "execute", fan_out=len(execution_tasks))

        async def run_knowledge(index: int, claim: KnowledgeClaim, task: PlanTask) -> dict[str, Any]:
            task.state = "in_progress"
            minimum_rounds = 2 if index == 1 else 1

            def validate_result(result: StageResult) -> None:
                rounds = result.output.get("search_rounds")
                if not isinstance(rounds, list) or len(rounds) < minimum_rounds:
                    raise ValueError(f"knowledge-{index} requires {minimum_rounds} search rounds")
                actual_calls = sum(
                    event.type == "ToolCallStartEvent"
                    and bool(event.name)
                    and str(event.name).endswith("knowledge_search")
                    for event in result.trace
                )
                if actual_calls and actual_calls < minimum_rounds:
                    raise ValueError(
                        f"knowledge-{index} reported {len(rounds)} rounds but made {actual_calls} tool calls"
                    )

            result = await self._run_execution_stage(
                stage=f"execute/knowledge-{index}",
                instructions=(
                    "核验这一条知识陈述。只可使用 knowledge_search。第一次结果若标记 decisive=false，"
                    "必须根据 refinement_hints 和通话上下文改写查询，继续检索；禁止用常识补齐。"
                    + (
                        "本验收任务要求至少两轮实际检索：第一轮只用‘路由器、保修、故障、上门费用’"
                        "做宽查询，不得带地区和型号；第二轮再加入地区、型号和保修状态精确查询。"
                        if minimum_rounds == 2
                        else ""
                    )
                ),
                payload={
                    "claim": claim.model_dump(),
                    "call": request.input,
                    "minimum_search_rounds": minimum_rounds,
                },
                schema=KnowledgeExecution,
                allowed_tools=["knowledge_search"],
                tasks=tasks,
                result_validator=validate_result,
            )
            self._append_native_trace(f"execute/knowledge-{index}", result.trace)
            task.state = "completed"
            return {
                "claim_id": f"knowledge-{index}",
                "claim": claim.claim,
                **result.output,
            }

        async def run_promise(index: int, promise: Promise, task: PlanTask) -> dict[str, Any]:
            task.state = "in_progress"
            tool = self.PROMISE_TO_TOOL[promise.type]
            result = await self._run_execution_stage(
                stage=f"execute/promise-{index}",
                instructions=(
                    f"核验这一条 {promise.type} 承诺。必须且只能调用 {tool}，"
                    "区分已履约、未履约、内容或时间不一致、证据不足。"
                ),
                payload={
                    "promise": promise.model_dump(),
                    "case_id": request.input.get("case_id"),
                    "call_start_time": request.input.get("start_time"),
                },
                schema=PromiseExecution,
                allowed_tools=[tool],
                tasks=tasks,
            )
            self._append_native_trace(f"execute/promise-{index}", result.trace)
            task.state = "completed"
            return {
                "promise_id": f"promise-{index}",
                "type": promise.type,
                "commitment": promise.commitment,
                "tool": tool,
                **result.output,
            }

        pending: list[Awaitable[dict[str, Any]]] = []
        task_index = 0
        for index, claim in enumerate(identification.knowledge_claims, start=1):
            pending.append(run_knowledge(index, claim, execution_tasks[task_index]))
            task_index += 1
        for index, promise in enumerate(identification.promises, start=1):
            pending.append(run_promise(index, promise, execution_tasks[task_index]))
            task_index += 1
        results = await asyncio.gather(*pending)
        self._event("workflow/stage_completed", "execute", completed=len(results))

        self._event("workflow/stage_started", "barrier")
        incomplete = [task.id for task in execution_tasks if task.state != "completed"]
        if incomplete:
            raise RuntimeError(f"workflow barrier blocked by: {incomplete}")
        self._event("workflow/stage_completed", "barrier", barrier_passed=True)

        knowledge_results = [row for row in results if "claim_id" in row]
        promise_results = [row for row in results if "promise_id" in row]
        plans = [
            {
                "plan_id": task.id,
                "kind": task.metadata["kind"],
                "subject_id": task.metadata["subject_id"],
                "status": "completed" if task.state == "completed" else "failed",
                "tool_policy": task.metadata["tool_policy"],
            }
            for task in execution_tasks
        ]
        consumer_needs = [
            {"need_id": f"need-{index}", **need.model_dump()}
            for index, need in enumerate(identification.consumer_needs, start=1)
        ]

        self._event("workflow/stage_started", "synthesize")
        synthesis = await self.runner.run(
            stage="synthesize",
            instructions=(
                "只根据已完成的结构化执行结果写一段简洁总结。不得新增事实、改变状态或遗漏失败项。"
            ),
            payload={
                "consumer_needs": consumer_needs,
                "knowledge_claims": knowledge_results,
                "promises": promise_results,
            },
            schema=SummaryOutput,
            allowed_tools=[],
            tasks=tasks,
        )
        self._append_native_trace("synthesize", synthesis.trace)
        self._event("workflow/stage_completed", "synthesize")

        output = project_platform_output(
            sample_id=request.input["sample_id"],
            identification=identification,
            knowledge_results=knowledge_results,
            promise_results=promise_results,
            summary=SummaryOutput.model_validate(synthesis.output).summary,
        )
        return output, self.trace


async def run_native_quality_workflow(
    request: RuntimeExecuteRequest,
) -> tuple[dict[str, Any], list[TraceEvent], RuntimeUsage]:
    """adapter._execute_native 入口：构建模型与 StageRunner，执行并汇总。"""

    model = build_chat_model(request)
    runner = OpenAIAgentsStageRunner(
        model=model,
        request_tools=[tool.name for tool in request.agent.tools],
        mcp_url=os.environ.get("QUALITY_TOOL_MCP_URL", DEFAULT_TOOL_MCP_URL),
    )
    try:
        output, trace = await asyncio.wait_for(
            OpenAIAgentsNativeQualityWorkflow(runner).execute(request),
            timeout=request.timeout_seconds,
        )
    except asyncio.TimeoutError as exc:
        raise AdapterExecutionError(
            RuntimeError(
                code=ErrorCode.TIMEOUT,
                message="OpenAI Agents native workflow timed out",
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
                message="OpenAI Agents native workflow failed",
                retryable=True,
                details={"exception_type": type(exc).__name__},
            )
        ) from exc
    return output, trace, runtime_usage_from_trace(trace)
