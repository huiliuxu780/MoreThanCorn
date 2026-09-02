"""OAI-R2 Trace 映射测试（SDD 14 §25/§26）：事件命名、配对、脱敏摘要、usage 汇总。"""

from types import SimpleNamespace

from quality_runtime_contract import TraceEvent

from app.trace_mapper import (
    SUMMARY_LIMIT,
    enterprise_tool_call_count,
    stage_trace_from_result,
    usage_from_results,
)


class ToolCallItem:
    def __init__(self, raw_item):
        self.raw_item = raw_item


class ToolCallOutputItem:
    def __init__(self, raw_item):
        self.raw_item = raw_item


def fake_response(input_tokens, output_tokens, response_id=None):
    return SimpleNamespace(
        usage=SimpleNamespace(input_tokens=input_tokens, output_tokens=output_tokens),
        response_id=response_id,
    )


def fake_result(raw_responses=(), new_items=()):
    return SimpleNamespace(raw_responses=list(raw_responses), new_items=list(new_items))


def test_stage_trace_lifecycle_and_platform_event_names():
    result = fake_result(
        raw_responses=[fake_response(100, 20, "resp-1")],
        new_items=[
            ToolCallItem(SimpleNamespace(name="knowledge_search", call_id="c1", arguments='{"q":1}')),
            ToolCallOutputItem(SimpleNamespace(call_id="c1", output="KB-RESULT")),
        ],
    )
    events = stage_trace_from_result("quality-execute/knowledge-1", result)
    types = [event.type for event in events]
    # 平台消费约定：Model*/Tool* 事件类名 + agent 生命周期
    assert types[0] == "agent/start"
    assert types[-1] == "agent/end"
    assert "ModelCallStartEvent" in types
    assert "ModelCallEndEvent" in types
    assert "ToolCallStartEvent" in types
    assert "ToolCallEndEvent" in types

    model_end = next(e for e in events if e.type == "ModelCallEndEvent")
    assert model_end.metadata == {"input_tokens": 100, "output_tokens": 20}
    assert model_end.call_id == "resp-1"

    tool_start = next(e for e in events if e.type == "ToolCallStartEvent")
    tool_end = next(e for e in events if e.type == "ToolCallEndEvent")
    assert tool_start.name == "knowledge_search"
    assert tool_start.call_id == "c1"
    assert tool_start.input == {"arguments": '{"q":1}'}
    # tool/end 通过 call_id 配对回工具名
    assert tool_end.name == "knowledge_search"
    assert tool_end.output == {"result": "KB-RESULT"}


def test_stage_trace_truncates_argument_and_output_summaries():
    long_arguments = "x" * (SUMMARY_LIMIT + 50)
    long_output = "y" * (SUMMARY_LIMIT + 80)
    result = fake_result(
        new_items=[
            ToolCallItem(
                SimpleNamespace(name="ticket_query", call_id="c2", arguments=long_arguments)
            ),
            ToolCallOutputItem(SimpleNamespace(call_id="c2", output=long_output)),
        ],
    )
    events = stage_trace_from_result("quality-stage", result)
    tool_start = next(e for e in events if e.type == "ToolCallStartEvent")
    tool_end = next(e for e in events if e.type == "ToolCallEndEvent")
    assert len(tool_start.input["arguments"]) == SUMMARY_LIMIT
    assert len(tool_end.output["result"]) == SUMMARY_LIMIT


def test_usage_sums_model_responses_and_counts_tools():
    result_a = fake_result(
        raw_responses=[fake_response(100, 20), fake_response(140, 30)],
        new_items=[
            ToolCallItem(SimpleNamespace(name="knowledge_search", call_id="c1", arguments="{}")),
        ],
    )
    result_b = fake_result(
        raw_responses=[fake_response(60, 10)],
        new_items=[
            ToolCallItem(SimpleNamespace(name="ticket_query", call_id="c2", arguments="{}")),
        ],
    )
    usage = usage_from_results([result_a, result_b], tool_calls=2)
    assert usage.input_tokens == 300
    assert usage.output_tokens == 60
    assert usage.total_tokens == 360
    assert usage.model_calls == 3
    assert usage.tool_calls == 2


def test_usage_is_zero_not_fabricated_when_endpoint_returns_none():
    result = fake_result(
        raw_responses=[SimpleNamespace(usage=None, response_id=None)],
    )
    usage = usage_from_results([result], tool_calls=0)
    assert usage.input_tokens == 0
    assert usage.output_tokens == 0
    assert usage.model_calls == 1


def test_enterprise_tool_count_excludes_internal_structured_output_helper():
    trace = [
        TraceEvent(sequence=0, timestamp=__import__("datetime").datetime.now(), type="ToolCallStartEvent", name="knowledge_search"),
        TraceEvent(sequence=1, timestamp=__import__("datetime").datetime.now(), type="ToolCallStartEvent", name="GenerateStructuredOutput"),
        TraceEvent(sequence=2, timestamp=__import__("datetime").datetime.now(), type="ToolCallEndEvent", name="knowledge_search"),
    ]
    assert enterprise_tool_call_count(trace) == 1
