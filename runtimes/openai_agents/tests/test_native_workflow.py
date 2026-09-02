"""OAI-R2 native workflow 测试（SDD 14 §57）：五阶段、fan-out、barrier、重试、投影。

FakeRunner 与 AgentScope runtime 测试同构：编排逻辑与执行引擎解耦验证。
输出用平台 quality_output.schema.json 校验（§23/§45），不再使用 POC 过渡 schema。
"""

import asyncio
import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator
from quality_runtime_contract import (
    AgentExecutionSpec,
    ExecutionContext,
    ModelSpec,
    RuntimeExecuteRequest,
)

from app.native_workflow import (
    OpenAIAgentsNativeQualityWorkflow,
    StageResult,
    project_platform_output,
    runtime_usage_from_trace,
    Identification,
)

ROOT = Path(__file__).resolve().parents[3]
PLATFORM_SCHEMA = (
    ROOT / "server" / "app" / "agent_modules" / "quality_analysis" / "schemas"
    / "quality_output.schema.json"
)
DATA_ROOT = ROOT / "poc" / "agent_runtime_providers" / "datasets" / "native_workflow"


class FakeRunner:
    def __init__(self, *, flaky_stage=None, slow_stages=False):
        self.calls = []
        self.flaky_stage = flaky_stage
        self.flaky_fired = False
        self.slow_stages = slow_stages
        self.in_flight = 0
        self.max_in_flight = 0

    async def run(self, **kwargs):
        stage = kwargs["stage"]
        self.calls.append(
            {
                "stage": stage,
                "allowed_tools": kwargs["allowed_tools"],
                "task_states": {task.id: task.state for task in kwargs["tasks"]},
            }
        )
        if self.slow_stages and stage.startswith("execute/"):
            self.in_flight += 1
            self.max_in_flight = max(self.max_in_flight, self.in_flight)
            await asyncio.sleep(0.02)
            self.in_flight -= 1
        if stage == self.flaky_stage and not self.flaky_fired:
            self.flaky_fired = True
            raise ValueError(f"stage {stage} produced no structured output")
        return StageResult(output=stage_output(stage), trace=[])


def stage_output(stage):
    if stage == "identify":
        return {
            "consumer_needs": [
                {"category": "repair", "description": "处理断网", "evidence_sequences": [0]},
                {"category": "complaint", "description": "投诉未跟进", "evidence_sequences": [0]},
                {"category": "policy_consultation", "description": "咨询费用", "evidence_sequences": [0]},
            ],
            "knowledge_claims": [
                {"claim": "保修期设备故障免上门费", "evidence_sequences": [3]},
                {"claim": "故障单二十四小时联系", "evidence_sequences": [3]},
            ],
            "promises": [
                {"type": "ticket", "commitment": "创建工单", "evidence_sequences": [4]},
                {"type": "sms", "commitment": "发送短信", "evidence_sequences": [4]},
                {"type": "appointment", "commitment": "预约十四点", "evidence_sequences": [4]},
            ],
        }
    if stage == "execute/knowledge-1":
        return {
            "status": "accurate",
            "search_rounds": [
                {"query": "路由器上门费用", "evidence_refs": ["KB-ONSITE-FEE-ROUTER-GENERAL-V2"], "decisive": False},
                {"query": "华东 X2 保修期设备自身故障上门费", "evidence_refs": ["KB-ONSITE-FEE-X2-EAST-V2"], "decisive": True},
            ],
            "evidence_refs": ["KB-ONSITE-FEE-X2-EAST-V2"],
            "reason": "与知识库一致",
        }
    if stage == "execute/knowledge-2":
        return {
            "status": "inaccurate",
            "search_rounds": [
                {"query": "宽带故障单联系时限", "evidence_refs": ["KB-BROADBAND-CONTACT-SLA-V2"], "decisive": True}
            ],
            "evidence_refs": ["KB-BROADBAND-CONTACT-SLA-V2"],
            "reason": "知识库规定四十八小时",
        }
    if stage.startswith("execute/promise-"):
        index = int(stage.rsplit("-", 1)[1])
        statuses = {1: "fulfilled", 2: "unfulfilled", 3: "mismatched"}
        return {
            "status": statuses[index],
            "evidence_refs": [f"FACT-{index}"],
            "reason": "fixture result",
        }
    if stage == "synthesize":
        return {"summary": "三个诉求已识别；两条知识陈述和三项承诺均已逐项核验。"}
    raise AssertionError(stage)


def make_request(metadata=None):
    return RuntimeExecuteRequest(
        run_id="native-v02-openai-test",
        idempotency_key="native-v02-openai-test",
        agent=AgentExecutionSpec(
            id="quality-native",
            version="0.2",
            instructions="Use evidence only.",
            model=ModelSpec(provider="openai-compatible", model="fake"),
            output_schema=json.loads(PLATFORM_SCHEMA.read_text(encoding="utf-8")),
        ),
        input=json.loads((DATA_ROOT / "complex_call_v0.2.json").read_text(encoding="utf-8")),
        context=ExecutionContext(metadata=metadata or {"workflowMode": "native_quality_v0.2"}),
    )


def test_native_workflow_fans_out_with_per_plan_tool_policies_and_barrier():
    runner = FakeRunner()
    output, trace = asyncio.run(
        OpenAIAgentsNativeQualityWorkflow(runner).execute(make_request())
    )
    Draft202012Validator(json.loads(PLATFORM_SCHEMA.read_text(encoding="utf-8"))).validate(output)

    assert output["sample_id"] == "NATIVE-V02-001"
    assert [event.name for event in trace if event.type == "workflow/stage_completed"] == [
        "identify", "plan", "execute", "barrier", "synthesize",
    ]
    assert output["labels"]["service_type_code"] == "REPAIR"
    assert output["labels"]["issue_codes"] == ["KNOWLEDGE_ERROR", "PROMISE_NOT_FULFILLED"]

    by_criterion = {f["criterion"]: f for f in output["findings"]}
    knowledge = by_criterion["knowledge_accuracy"]
    promise = by_criterion["promise_fulfillment"]
    assert knowledge["status"] == "failed"
    assert knowledge["confidence"] == 0.9
    assert knowledge["evidence"], "knowledge finding 必须携带证据项"
    assert any(e["source"] == "tool" for e in knowledge["evidence"])
    assert promise["status"] == "failed"
    assert "promise-2" in promise["reason"] and "unfulfilled" in promise["reason"]

    policies = {call["stage"]: call["allowed_tools"] for call in runner.calls}
    assert policies["identify"] == []
    assert policies["execute/knowledge-1"] == ["knowledge_search"]
    assert policies["execute/knowledge-2"] == ["knowledge_search"]
    assert policies["execute/promise-1"] == ["ticket_query"]
    assert policies["execute/promise-2"] == ["sms_query"]
    assert policies["execute/promise-3"] == ["appointment_query"]
    assert policies["synthesize"] == []

    # 阶段事件带 workflow_stage 元数据（平台 RunEvent 按此聚合阶段视图）
    executed = [e for e in trace if e.type == "ModelCallStartEvent"]
    assert executed == []  # FakeRunner 不产生 SDK trace；阶段事件来自工作流本身
    staged = [e for e in trace if e.metadata.get("workflow_stage", "").startswith("execute/")]
    assert staged == []


def test_workflow_without_claims_or_promises_marks_criteria_not_applicable():
    class NoPlansRunner(FakeRunner):
        async def run(self, **kwargs):
            stage = kwargs["stage"]
            self.calls.append({"stage": stage, "allowed_tools": kwargs["allowed_tools"],
                               "task_states": {}})
            if stage == "identify":
                return StageResult(output={
                    "consumer_needs": [
                        {"category": "other", "description": "一般咨询", "evidence_sequences": [0]}
                    ],
                    "knowledge_claims": [],
                    "promises": [],
                }, trace=[])
            if stage == "synthesize":
                return StageResult(output={"summary": "无可核验事项。"}, trace=[])
            raise AssertionError(stage)

    output, trace = asyncio.run(
        OpenAIAgentsNativeQualityWorkflow(NoPlansRunner()).execute(make_request())
    )
    Draft202012Validator(json.loads(PLATFORM_SCHEMA.read_text(encoding="utf-8"))).validate(output)
    by_criterion = {f["criterion"]: f for f in output["findings"]}
    assert by_criterion["knowledge_accuracy"]["status"] == "not_applicable"
    assert by_criterion["promise_fulfillment"]["status"] == "not_applicable"
    assert output["labels"]["issue_codes"] == []
    assert output["labels"]["service_type_code"] == "OTHER"
    plan_event = next(e for e in trace if e.type == "workflow/stage_completed" and e.name == "plan")
    assert plan_event.metadata["plan_count"] == 0


def test_missing_structured_output_is_retried_once():
    runner = FakeRunner(flaky_stage="execute/knowledge-2")
    output, trace = asyncio.run(
        OpenAIAgentsNativeQualityWorkflow(runner).execute(make_request())
    )
    retries = [e for e in trace if e.type == "workflow/stage_retry"]
    assert len(retries) == 1
    assert retries[0].name == "execute/knowledge-2"
    assert retries[0].metadata["reason"] == "missing_structured_output"
    assert output["labels"]["issue_codes"] == ["KNOWLEDGE_ERROR", "PROMISE_NOT_FULFILLED"]


def test_plan_failure_propagates_and_synthesize_is_not_reached():
    class ExplodingRunner(FakeRunner):
        async def run(self, **kwargs):
            if kwargs["stage"] == "execute/promise-2":
                raise RuntimeError("tool gateway unreachable")
            return await super().run(**kwargs)

    runner = ExplodingRunner()
    with pytest.raises(RuntimeError):
        asyncio.run(OpenAIAgentsNativeQualityWorkflow(runner).execute(make_request()))
    assert "synthesize" not in [call["stage"] for call in runner.calls]


def test_parallel_fan_out_is_bounded_by_module_policy():
    runner = FakeRunner(slow_stages=True)
    asyncio.run(OpenAIAgentsNativeQualityWorkflow(runner).execute(make_request()))
    assert runner.max_in_flight <= 2, "maxParallelPlans=2 必须由代码强制"
    assert runner.max_in_flight == 2  # 5 个 plan 确实发生了并行


def test_usage_from_workflow_trace_counts_model_and_tool_events():
    from quality_runtime_contract import TraceEvent
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)
    trace = [
        TraceEvent(sequence=0, timestamp=now, type="ModelCallEndEvent",
                   metadata={"input_tokens": 100, "output_tokens": 20}),
        TraceEvent(sequence=1, timestamp=now, type="ModelCallEndEvent",
                   metadata={"input_tokens": 50, "output_tokens": 10}),
        TraceEvent(sequence=2, timestamp=now, type="ToolCallStartEvent", name="knowledge_search"),
        TraceEvent(sequence=3, timestamp=now, type="ToolCallStartEvent", name="ticket_query"),
    ]
    usage = runtime_usage_from_trace(trace)
    assert usage.input_tokens == 150
    assert usage.output_tokens == 30
    assert usage.total_tokens == 180
    assert usage.model_calls == 2
    assert usage.tool_calls == 2


def test_projection_rejects_unknown_need_category_at_identify_layer():
    with pytest.raises(Exception):
        Identification.model_validate({
            "consumer_needs": [{"category": "unknown", "description": "x", "evidence_sequences": [0]}],
            "knowledge_claims": [],
            "promises": [],
        })


def test_projection_never_emits_abusive_language_without_evaluation():
    identification = Identification.model_validate({
        "consumer_needs": [],
        "knowledge_claims": [],
        "promises": [],
    })
    output = project_platform_output(
        sample_id="S-1",
        identification=identification,
        knowledge_results=[],
        promise_results=[],
        summary="nothing to verify",
    )
    criteria = {f["criterion"] for f in output["findings"]}
    assert "abusive_language" not in criteria
    assert output["labels"] == {"service_type_code": None, "issue_codes": []}
