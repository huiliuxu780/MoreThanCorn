"""OAI-R2 扩展：business_analysis_v1 通话业务打标工作流测试（SDD-14）。

business-analysis = 对一通通话做只读业务理解与逐通话打标（服务类型/客户意图/
业务结果/跟进机会）。无工具两阶段：understand → synthesize。sample_id 由代码
从输入确定性注入，不经语言模型。
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
    ToolRef,
)

from app.business_workflow import BusinessTaggingWorkflow
from app.native_workflow import StageResult

ROOT = Path(__file__).resolve().parents[3]
PLATFORM_SCHEMA = (
    ROOT / "server" / "app" / "agent_modules" / "business_analysis" / "schemas"
    / "output.schema.json"
)

UNDERSTANDING = {
    "customer_needs": ["洗衣机甩干异常晃动，要求上门检修"],
    "service_scenario": "家电故障报修",
    "key_events": ["坐席登记故障现象", "坐席承诺安排师傅上门"],
    "resolution_signals": "已受理报修，等待上门，通话结束时尚未解决",
}

TAGS = {
    "service_type_code": "REPAIR",
    "customer_intents": [
        {"intent": "故障报修", "description": "洗衣机甩干异常晃动，要求上门检修"}
    ],
    "business_outcome": "pending",
    "follow_ups": [
        {"action": "安排师傅上门检修", "reason": "坐席已承诺上门，需落实"}
    ],
    "summary": "客户报修洗衣机甩干异常，坐席受理并承诺安排上门检修。",
}


class FakeRunner:
    def __init__(self, *, understanding=None, tags=None):
        self.calls = []
        self.understanding = understanding or UNDERSTANDING
        self.tags = tags or TAGS

    async def run(self, **kwargs):
        stage = kwargs["stage"]
        self.calls.append({"stage": stage, "allowed_tools": kwargs["allowed_tools"]})
        if stage == "understand":
            return StageResult(output=self.understanding, trace=[])
        if stage == "synthesize":
            return StageResult(output=self.tags, trace=[])
        raise AssertionError(stage)


def make_request():
    return RuntimeExecuteRequest(
        run_id="biz-test",
        idempotency_key="biz-test",
        agent=AgentExecutionSpec(
            id="business-agent",
            version="1.0.0",
            instructions="只读业务分析。",
            model=ModelSpec(provider="openai-compatible", model="fake"),
            tools=[],
            output_schema=json.loads(PLATFORM_SCHEMA.read_text(encoding="utf-8")),
        ),
        input={"sample_id": "sample-001", "call_id": "acid-1",
               "conversation": [{"sequence": 0, "speaker": "customer", "text": "洗衣机坏了"}]},
        context=ExecutionContext(metadata={"workflowMode": "business_analysis_v1"}),
    )


def test_business_tagging_workflow_stages_and_schema():
    runner = FakeRunner()
    output, trace = asyncio.run(BusinessTaggingWorkflow(runner).execute(make_request()))
    Draft202012Validator(json.loads(PLATFORM_SCHEMA.read_text(encoding="utf-8"))).validate(output)

    assert [event.name for event in trace if event.type == "workflow/stage_completed"] == [
        "understand", "synthesize",
    ]
    # 打标为纯通话理解，两阶段均无工具
    assert all(call["allowed_tools"] == [] for call in runner.calls)
    assert [call["stage"] for call in runner.calls] == ["understand", "synthesize"]

    assert output["service_type_code"] == "REPAIR"
    assert output["business_outcome"] == "pending"
    assert output["customer_intents"][0]["intent"] == "故障报修"
    assert output["follow_ups"][0]["action"] == "安排师傅上门检修"
    assert "洗衣机" in output["summary"]


def test_business_output_sample_id_is_deterministic():
    runner = FakeRunner()
    output, _ = asyncio.run(BusinessTaggingWorkflow(runner).execute(make_request()))
    # sample_id 来自输入（代码注入），不依赖语言模型
    assert output["sample_id"] == "sample-001"


def test_business_tags_missing_summary_rejected():
    bad_tags = {k: v for k, v in TAGS.items() if k != "summary"}
    runner = FakeRunner(tags=bad_tags)
    with pytest.raises(Exception):
        asyncio.run(BusinessTaggingWorkflow(runner).execute(make_request()))


def test_business_outcome_invalid_enum_rejected():
    bad_tags = {**TAGS, "business_outcome": "not-a-valid-outcome"}
    runner = FakeRunner(tags=bad_tags)
    with pytest.raises(Exception):
        asyncio.run(BusinessTaggingWorkflow(runner).execute(make_request()))
