"""OAI-R1 工具硬白名单测试（SDD 14 §56）：不许只测 Prompt 文本。

三层验证：
1. resolve_stage_tools 交集矩阵（§56 全部组合）；
2. build_mcp_server 的 tool_filter/URL 装配；
3. SDK 级功能反例——用 FakeModel 让"模型"尝试调用未授权工具，
   证明该调用在 Runner 层即被拒绝（工具根本不存在于 Agent 工具集）。
"""

import asyncio
import json

import pytest
from agents import (
    Agent,
    Model,
    ModelResponse,
    Runner,
    Usage,
    function_tool,
    set_tracing_disabled,
)

from app.tool_adapter import build_mcp_server, resolve_stage_tools

# 与 runtime 一致的默认：平台本地测试不产生 OpenAI 远端 trace（SDD 14 §25.1）。
set_tracing_disabled(True)


# ---------- 1. 交集矩阵（§56） ----------


def test_request_tools_empty_yields_no_agent_tools():
    assert resolve_stage_tools([], ["knowledge_search"]) == []
    assert resolve_stage_tools([], None) == []


def test_single_allowed_tool_passes_intersection():
    assert resolve_stage_tools(["knowledge_search"], ["knowledge_search"]) == ["knowledge_search"]


def test_stage_allowlist_narrows_request_tools():
    assert resolve_stage_tools(
        ["knowledge_search", "ticket_query"], ["knowledge_search"]
    ) == ["knowledge_search"]


def test_stage_tool_not_declared_in_request_is_excluded():
    assert resolve_stage_tools(["knowledge_search"], ["ticket_query"]) == []


def test_no_stage_allowlist_keeps_full_request_set():
    assert resolve_stage_tools(["knowledge_search", "ticket_query"], None) == [
        "knowledge_search",
        "ticket_query",
    ]


def test_promise_stage_binds_exactly_one_tool():
    request = ["knowledge_search", "ticket_query", "sms_query", "appointment_query"]
    assert resolve_stage_tools(request, ["ticket_query"]) == ["ticket_query"]
    assert resolve_stage_tools(request, ["sms_query"]) == ["sms_query"]
    assert resolve_stage_tools(request, ["appointment_query"]) == ["appointment_query"]


def test_identify_and_synthesize_stages_get_no_tools():
    request = ["knowledge_search", "ticket_query"]
    assert resolve_stage_tools(request, []) == []


# ---------- 2. MCP 装配 ----------


def test_build_mcp_server_carries_hard_tool_filter():
    server = build_mcp_server("execute/knowledge-1", ["knowledge_search"], "http://gw:8200/mcp/")
    assert server.tool_filter == {"allowed_tool_names": ["knowledge_search"]}
    assert server.params["url"] == "http://gw:8200/mcp/"
    assert server.cache_tools_list is False
    assert server.name == "quality-tools-execute-knowledge-1"


# ---------- 3. SDK 级隔离反例 ----------


class FakeModel(Model):
    """按脚本逐轮返回 function_call / 终结消息的确定性模型。"""

    def __init__(self, scripted_outputs: list[list[dict]]):
        self.scripted_outputs = scripted_outputs
        self.seen_tool_lists: list[list[str]] = []

    async def get_response(
        self,
        system_instructions,
        input,
        model_settings,
        tools,
        output_schema,
        handoffs,
        tracing,
        *,
        previous_response_id=None,
        conversation_id=None,
        prompt=None,
    ):
        self.seen_tool_lists.append([tool.name for tool in tools])
        output = self.scripted_outputs.pop(0)
        return ModelResponse(
            output=output,
            usage=Usage(input_tokens=10, output_tokens=5, total_tokens=15),
            response_id=f"resp-{len(self.seen_tool_lists)}",
        )

    async def stream_response(self, *args, **kwargs):  # pragma: no cover - 非流式
        raise NotImplementedError("streaming disabled in POC")

    def get_retry_advice(self, request):
        return None

    async def close(self):
        return None


def function_call(name: str, arguments: dict, call_id: str) -> dict:
    return {
        "id": f"fc-{call_id}",
        "type": "function_call",
        "status": "completed",
        "name": name,
        "call_id": call_id,
        "arguments": json.dumps(arguments),
    }


def final_message(text: str) -> dict:
    return {
        "id": "msg-final",
        "type": "message",
        "status": "completed",
        "role": "assistant",
        "content": [{"type": "output_text", "text": text, "annotations": []}],
    }


def test_declared_tool_is_executed_and_visible_to_model():
    calls: list[tuple[str, str]] = []

    @function_tool
    async def knowledge_search(query: str) -> str:
        """Search the knowledge base for policy facts."""
        calls.append(("knowledge_search", query))
        return "KB-ONSITE-FEE: 保修期内免上门费"

    model = FakeModel(
        [
            [function_call("knowledge_search", {"query": "上门费"}, "call-1")],
            [final_message("done")],
        ]
    )
    agent = Agent(name="quality-execute", instructions="verify", model=model, tools=[knowledge_search])
    result = asyncio.run(Runner.run(agent, input="verify claim"))
    assert calls == [("knowledge_search", "上门费")]
    # 每一轮模型请求都只看见白名单内的工具
    assert model.seen_tool_lists == [["knowledge_search"], ["knowledge_search"]]
    assert result.final_output == "done"


def test_undeclared_tool_call_is_rejected_not_executed():
    executed: list[str] = []

    @function_tool
    async def knowledge_search(query: str) -> str:
        """Search the knowledge base for policy facts."""
        executed.append("knowledge_search")
        return "KB"

    @function_tool
    async def ticket_query(case_id: str) -> str:
        """Query the ticket system for promise fulfilment."""
        executed.append("ticket_query")
        return "TICKET"

    # 阶段白名单只放行 knowledge_search：ticket_query 不在 Agent 工具集中。
    stage_tools = [knowledge_search]
    model = FakeModel([[function_call("ticket_query", {"case_id": "C1"}, "call-9")]])
    agent = Agent(name="quality-execute", instructions="verify", model=model, tools=stage_tools)
    with pytest.raises(Exception) as caught:
        asyncio.run(Runner.run(agent, input="verify promise"))
    assert "ticket_query" in str(caught.value)
    assert executed == []
    # 模型只看见白名单内的工具
    assert model.seen_tool_lists == [["knowledge_search"]]


def test_allowlist_union_of_request_and_stage_matches_agent_tools():
    """SDD 14 §15.2：Agent 工具 = request ∩ stage（module 层由平台冻结保证）。"""

    request_tools = ["knowledge_search", "ticket_query", "sms_query", "appointment_query"]
    stage_allowed = ["knowledge_search"]

    @function_tool
    async def knowledge_search(query: str) -> str:
        """Search the knowledge base for policy facts."""
        return "KB"

    @function_tool
    async def ticket_query(case_id: str) -> str:
        """Query the ticket system for promise fulfilment."""
        return "TICKET"

    catalog = {"knowledge_search": knowledge_search, "ticket_query": ticket_query}
    effective = resolve_stage_tools(request_tools, stage_allowed)
    agent_tools = [catalog[name] for name in effective if name in catalog]
    assert [tool.name for tool in agent_tools] == ["knowledge_search"]
