"""OAI-R2 扩展：business_analysis_v1 工作流测试（SDD-14 business 场景）。

覆盖：五阶段编排、每计划恰好一次工具调用守卫、数值由代码从工具回包确定性解析
（不经语言模型）、失败不抢跑 synthesize。
"""

import asyncio
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from jsonschema import Draft202012Validator
from quality_runtime_contract import (
    AgentExecutionSpec,
    ExecutionContext,
    ModelSpec,
    RuntimeExecuteRequest,
    ToolRef,
)

from app.business_workflow import BusinessAnalysisWorkflow
from app.native_workflow import StageResult

ROOT = Path(__file__).resolve().parents[3]
PLATFORM_SCHEMA = (
    ROOT / "server" / "app" / "agent_modules" / "business_analysis" / "schemas"
    / "output.schema.json"
)


class FakeRunner:
    """identify/synthesize 走 run()；执行阶段走 run_tool_loop() 返回工具回包。"""

    def __init__(self, *, extra_tool_calls: int = 0, aggregate=86.4, known: bool = True):
        self.calls = []
        self.extra_tool_calls = extra_tool_calls
        self.aggregate = aggregate
        self.known = known

    async def run(self, **kwargs):
        stage = kwargs["stage"]
        self.calls.append({"stage": stage, "allowed_tools": kwargs["allowed_tools"]})
        if stage == "identify":
            output = {
                "question_id": "q1",
                "plans": [
                    {"kind": "metric", "subject": "connect_rate",
                     "query": "connect_rate 近 7 日"},
                    {"kind": "dimension", "subject": "connect_rate×region",
                     "query": "connect_rate 按 region 拆解 近 7 日"},
                ],
            }
            return StageResult(output=output, trace=[])
        if stage == "synthesize":
            return StageResult(output={"answer": "近 7 日热线接通率均值 86.4%，华东区最高。"},
                               trace=[])
        raise AssertionError(stage)

    async def run_tool_loop(self, *, stage, instructions, payload, allowed_tools):
        self.calls.append({"stage": stage, "allowed_tools": allowed_tools})
        plan = payload["plan"]
        tool = plan["tool"]
        if plan["kind"] == "metric":
            output = {"known": self.known, "metric": "connect_rate", "unit": "%",
                      "window": {"start": "2026-08-27", "end": "2026-09-02"},
                      "aggregate": self.aggregate,
                      "points": [{"date": "2026-09-02", "value": 87.1}]}
        else:
            output = {"known": self.known, "metric": "connect_rate", "dimension": "region",
                      "unit": "%", "window": {"start": "2026-08-27", "end": "2026-09-02"},
                      "breakdown": [{"key": "east", "value": 88.2}]}
        transcript = [{"tool": tool, "arguments": "{}",
                       "result": json.dumps({"tool": tool, "output": output},
                                            ensure_ascii=False)}]
        transcript += [{"tool": tool, "arguments": "{}", "result": ""}
                       for _ in range(self.extra_tool_calls)]
        return SimpleNamespace(), transcript, ""


def make_request():
    return RuntimeExecuteRequest(
        run_id="biz-test",
        idempotency_key="biz-test",
        agent=AgentExecutionSpec(
            id="business-agent",
            version="1.0.0",
            instructions="只读业务分析。",
            model=ModelSpec(provider="openai-compatible", model="fake"),
            tools=[ToolRef(name="metric_query", version="1.0.0"),
                   ToolRef(name="dimension_query", version="1.0.0")],
            output_schema=json.loads(PLATFORM_SCHEMA.read_text(encoding="utf-8")),
        ),
        input={"question_id": "q1", "question": "近 7 日热线接通率是多少？",
               "window": "last_7d"},
        context=ExecutionContext(metadata={"workflowMode": "business_analysis_v1"}),
    )


def test_business_workflow_fans_out_with_per_plan_tool_policies():
    runner = FakeRunner()
    output, trace = asyncio.run(BusinessAnalysisWorkflow(runner).execute(make_request()))
    Draft202012Validator(json.loads(PLATFORM_SCHEMA.read_text(encoding="utf-8"))).validate(output)

    assert [event.name for event in trace if event.type == "workflow/stage_completed"] == [
        "identify", "plan", "execute", "barrier", "synthesize",
    ]
    policies = {call["stage"]: call["allowed_tools"] for call in runner.calls}
    assert policies["identify"] == []
    assert policies["execute/metric-1"] == ["metric_query"]
    assert policies["execute/dimension-2"] == ["dimension_query"]
    assert policies["synthesize"] == []


def test_business_numeric_projection_is_deterministic_not_llm():
    runner = FakeRunner()
    output, _ = asyncio.run(BusinessAnalysisWorkflow(runner).execute(make_request()))
    assert output["question_id"] == "q1"
    # 数值/单位/引用来自代码对工具回包的解析，不是语言模型产物
    assert output["metrics"] == [{"metric": "connect_rate", "value": 86.4, "unit": "%"}]
    citations = output["citations"]
    assert {c["source"] for c in citations} == {"metric_query", "dimension_query"}
    metric_citation = next(c for c in citations if c["source"] == "metric_query")
    assert metric_citation["reference"] == "metric:connect_rate:2026-08-27..2026-09-02"
    assert output["confidence"] == 0.9
    assert "86.4" in output["answer"]  # synthesize 文本（FakeRunner 脚本）引用数值


def test_plan_tool_called_twice_is_rejected():
    runner = FakeRunner(extra_tool_calls=1)  # 每计划两次调用 → 违反恰好一次
    with pytest.raises(ValueError):
        asyncio.run(BusinessAnalysisWorkflow(runner).execute(make_request()))
    # 重试一次后仍失败 → 未进入 synthesize
    assert "synthesize" not in [call["stage"] for call in runner.calls]


def test_metric_plan_requires_numeric_aggregate():
    runner = FakeRunner(aggregate=None)  # 工具回包无聚合值 → 数值守卫拒绝
    with pytest.raises(ValueError):
        asyncio.run(BusinessAnalysisWorkflow(runner).execute(make_request()))
    assert "synthesize" not in [call["stage"] for call in runner.calls]


def test_unknown_metric_fails_honestly():
    runner = FakeRunner(known=False)  # 工具如实报告未知指标 → 不得编造
    with pytest.raises(ValueError):
        asyncio.run(BusinessAnalysisWorkflow(runner).execute(make_request()))


def test_tool_output_normalization_handles_mcp_content_blocks():
    from app.native_workflow import _normalize_tool_output

    # 字符串原样
    assert _normalize_tool_output('{"a":1}') == '{"a":1}'
    # MCP 内容块（dict 形态）
    blocks = [{"type": "input_text", "text": '{"tool":"metric_query","output":{"aggregate":86.4}}'}]
    assert "86.4" in _normalize_tool_output(blocks)
    # 对象形态（.text）
    assert _normalize_tool_output(SimpleNamespace(text="abc")) == "abc"
    # 对象形态（.content 递归）
    assert "86.4" in _normalize_tool_output(SimpleNamespace(content=blocks))
    assert _normalize_tool_output(None) == ""


def test_identification_requires_at_least_one_plan():
    class NoPlanRunner(FakeRunner):
        async def run(self, **kwargs):
            if kwargs["stage"] == "identify":
                return StageResult(output={"question_id": "q1", "plans": []}, trace=[])
            raise AssertionError(kwargs["stage"])

    with pytest.raises(Exception):
        asyncio.run(BusinessAnalysisWorkflow(NoPlanRunner()).execute(make_request()))
