"""AgentScope-native staged quality workflow for the v0.2 POC.

The platform invokes one workflow, while this provider module owns stage
progression, AgentScope task state, per-stage tool allowlists, fan-out, the
completion barrier, and final normalization.
"""

from __future__ import annotations

import asyncio
import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Literal, Protocol

from pydantic import BaseModel, Field

from quality_runtime_contract import RuntimeExecuteRequest, TraceEvent


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


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


class AgentScopeStageRunner:
    """Run one bounded AgentScope Agent with a code-enforced tool allowlist."""

    def __init__(
        self,
        *,
        model: Any,
        mcp_url: str,
        trace_event_factory: Callable[[int, Any], TraceEvent],
    ) -> None:
        self.model = model
        self.mcp_url = mcp_url
        self.trace_event_factory = trace_event_factory

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
        from agentscope.agent import Agent, ModelConfig, ReActConfig
        from agentscope.mcp import HttpMCPConfig, MCPClient
        from agentscope.message import Msg, TextBlock
        from agentscope.state import AgentState, TaskContext
        from agentscope.tool import Toolkit

        client = None
        toolkit = Toolkit()
        if allowed_tools:
            client = MCPClient(
                name=re.sub(r"[^a-zA-Z0-9_-]", "-", f"native-{stage}"),
                is_stateful=False,
                mcp_config=HttpMCPConfig(url=self.mcp_url, timeout=30.0),
                enable_tools=allowed_tools,
                execution_timeout=30.0,
            )
            await client.connect()
            toolkit = Toolkit(mcps=[client])

        agent = Agent(
            name=f"quality-{stage}",
            system_prompt=instructions,
            model=self.model,
            toolkit=toolkit,
            state=AgentState(tasks_context=TaskContext(tasks=tasks)),
            model_config=ModelConfig(max_retries=1),
            react_config=ReActConfig(max_iters=12, structured_output_grace_iters=5),
        )
        message = Msg(
            name="quality-workflow",
            role="user",
            content=[TextBlock(text=json.dumps(payload, ensure_ascii=False))],
        )
        final_message = None
        trace: list[TraceEvent] = []
        try:
            async for item in agent.reply_stream(
                message,
                structured_schema=schema,
                yield_final_msg=True,
            ):
                if isinstance(item, Msg):
                    final_message = item
                elif not type(item).__name__.endswith("DeltaEvent"):
                    trace.append(self.trace_event_factory(len(trace), item))
        finally:
            if client is not None:
                await client.close(ignore_errors=True)

        if final_message is None or final_message.structured_output is None:
            raise ValueError(f"AgentScope stage {stage} did not produce structured output")
        return StageResult(output=final_message.structured_output, trace=trace)


class AgentScopeNativeQualityWorkflow:
    STAGE_ORDER = ["identify", "plan", "execute", "barrier", "synthesize"]
    PROMISE_TO_TOOL = {
        "ticket": "ticket_query",
        "sms": "sms_query",
        "appointment": "appointment_query",
    }

    def __init__(self, runner: StageRunner) -> None:
        self.runner = runner
        self.trace: list[TraceEvent] = []
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

    async def execute(self, request: RuntimeExecuteRequest) -> tuple[dict[str, Any], list[TraceEvent]]:
        from agentscope.state import Task

        identify_task = Task(
            id="stage-identify",
            subject="识别消费者诉求、知识陈述和坐席承诺",
            description="从通话逐项提取，不合并独立事项。",
            metadata={"stage": "identify"},
            state="in_progress",
        )
        tasks = [identify_task]
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
        execution_tasks: list[Any] = []
        for index, _claim in enumerate(identification.knowledge_claims, start=1):
            execution_tasks.append(
                Task(
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
                Task(
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

        async def run_knowledge(index: int, claim: KnowledgeClaim, task: Any) -> dict[str, Any]:
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

        async def run_promise(index: int, promise: Promise, task: Any) -> dict[str, Any]:
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

        output = {
            "sample_id": request.input["sample_id"],
            "consumer_needs": consumer_needs,
            "knowledge_claims": knowledge_results,
            "promises": promise_results,
            "workflow": {
                "stage_order": self.STAGE_ORDER,
                "plans": plans,
                "barrier_passed": True,
            },
            "summary": SummaryOutput.model_validate(synthesis.output).summary,
        }
        return output, self.trace
