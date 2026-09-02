"""Map OpenAI Agents SDK run results onto platform TraceEvents (SDD 14 §25/§26).

平台 Trace 是唯一业务审计事实；OpenAI SDK remote tracing 默认关闭，执行过程在
本地映射为 workflow/agent/model/tool 事件。事件按鸭子类型读取（.raw_responses /
.new_items / .raw_item），便于测试用轻量替身验证映射逻辑。

事件命名沿用平台既有消费约定（worker CallRecord 匹配 "ModelCall"/"ToolCall" +
"EndEvent" 后缀；workflow/* 阶段事件与 AgentScope runtime 一致），保证
Run Detail 的 stages/calls/usage 三块数据无需平台侧改造即可展示。

只记录脱敏摘要：工具入参/出参截断到 SUMMARY_LIMIT 字符；凭据类字段一律不采集。
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from quality_runtime_contract import RuntimeUsage, TraceEvent

SUMMARY_LIMIT = 500


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _preview(value: Any) -> str:
    text = value if isinstance(value, str) else repr(value)
    return text[:SUMMARY_LIMIT]


def _call_fields(raw_item: Any) -> dict[str, Any]:
    """从 function-call / mcp-call 原始项提取统一字段（两者字段名一致）。"""

    fields: dict[str, Any] = {}
    for key in ("name", "call_id", "arguments", "server_label"):
        item_value = getattr(raw_item, key, None)
        if item_value is not None:
            fields[key] = item_value
    return fields


def stage_trace_from_result(agent_name: str, result: Any) -> list[TraceEvent]:
    """一次 Runner.run 的本地审计事件序列（sequence 由 workflow 层重排）。"""

    events: list[TraceEvent] = []
    events.append(
        TraceEvent(
            sequence=0,
            timestamp=utcnow(),
            type="agent/start",
            name=agent_name,
        )
    )

    for index, response in enumerate(getattr(result, "raw_responses", []) or []):
        usage = getattr(response, "usage", None)
        call_id = getattr(response, "response_id", None) or f"model-call-{index}"
        metadata: dict[str, Any] = {}
        if usage is not None:
            metadata["input_tokens"] = int(getattr(usage, "input_tokens", 0) or 0)
            metadata["output_tokens"] = int(getattr(usage, "output_tokens", 0) or 0)
        events.append(
            TraceEvent(
                sequence=0,
                timestamp=utcnow(),
                type="ModelCallStartEvent",
                name=agent_name,
                call_id=str(call_id),
            )
        )
        events.append(
            TraceEvent(
                sequence=0,
                timestamp=utcnow(),
                type="ModelCallEndEvent",
                name=agent_name,
                call_id=str(call_id),
                metadata=metadata,
            )
        )

    pending_tool_starts: dict[str, int] = {}
    for item in getattr(result, "new_items", []) or []:
        kind = type(item).__name__
        raw_item = getattr(item, "raw_item", None)
        if kind == "ToolCallItem" and raw_item is not None:
            fields = _call_fields(raw_item)
            call_id = str(fields.get("call_id") or "")
            events.append(
                TraceEvent(
                    sequence=0,
                    timestamp=utcnow(),
                    type="ToolCallStartEvent",
                    name=str(fields.get("name") or "unknown_tool"),
                    call_id=call_id or None,
                    input={"arguments": _preview(fields.get("arguments"))}
                    if fields.get("arguments") is not None
                    else None,
                )
            )
            pending_tool_starts[call_id] = len(events) - 1
        elif kind == "ToolCallOutputItem" and raw_item is not None:
            call_id = str(getattr(raw_item, "call_id", "") or "")
            output_value = getattr(raw_item, "output", None)
            events.append(
                TraceEvent(
                    sequence=0,
                    timestamp=utcnow(),
                    type="ToolCallEndEvent",
                    name=_tool_name_for(events, pending_tool_starts.get(call_id)),
                    call_id=call_id or None,
                    output={"result": _preview(output_value)} if output_value is not None else None,
                )
            )

    events.append(
        TraceEvent(
            sequence=0,
            timestamp=utcnow(),
            type="agent/end",
            name=agent_name,
        )
    )
    return events


def _tool_name_for(events: list[TraceEvent], start_index: int | None) -> str | None:
    if start_index is None:
        return None
    return events[start_index].name


def usage_from_results(results: list[Any], tool_calls: int) -> RuntimeUsage:
    """汇总所有阶段 raw_responses 的 token usage（total 由 input+output 推导）。

    端点不返回 usage 时 input/output 均为 0——不伪造，runtime metadata 另行标注。
    """

    input_tokens = 0
    output_tokens = 0
    model_calls = 0
    for result in results:
        for response in getattr(result, "raw_responses", []) or []:
            model_calls += 1
            usage = getattr(response, "usage", None)
            if usage is not None:
                input_tokens += int(getattr(usage, "input_tokens", 0) or 0)
                output_tokens += int(getattr(usage, "output_tokens", 0) or 0)
    return RuntimeUsage(
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=input_tokens + output_tokens,
        model_calls=model_calls,
        tool_calls=tool_calls,
    )


def enterprise_tool_call_count(trace: list[TraceEvent]) -> int:
    """SDK 的 output_type 不产生工具项，因此 ToolCallStartEvent 全部是企业工具调用。

    保留与 AgentScope runtime 相同的内置工具排除守卫，防止任何结构化输出辅助
    工具被计入企业工具调用。
    """

    return sum(
        event.type == "ToolCallStartEvent"
        and event.name not in {"GenerateStructuredOutput", "generate_structured_output"}
        for event in trace
    )
