"""OAI-R2/R4 离线 E2E：adapter.execute → native_quality_v0.2 → 平台 Schema。

用 ScriptedQualityModel（确定性脚本模型）+ 注入函数工具替代真实端点与 MCP，
验证从 RuntimeAdapter 入口到结构化输出/阶段 trace/usage 的完整链路；
真实模型 + 真实工具网关的在线 E2E 在 OAI-R5 执行并另附验收证据。
"""

import asyncio
import json
from pathlib import Path

import pytest
from agents import Model, ModelResponse, Usage, function_tool, set_tracing_disabled
from jsonschema import Draft202012Validator
from quality_runtime_contract import (
    AgentExecutionSpec,
    ErrorCode,
    ExecutionContext,
    ModelSpec,
    RunStatus,
    RuntimeExecuteRequest,
    ToolRef,
)
from quality_runtime_service import AdapterExecutionError

import app.native_workflow as native_workflow
from app.adapter import OpenAIAgentsRuntimeAdapter
from app.native_workflow import OpenAIAgentsStageRunner

set_tracing_disabled(True)

ROOT = Path(__file__).resolve().parents[3]
PLATFORM_SCHEMA = (
    ROOT / "server" / "app" / "agent_modules" / "quality_analysis" / "schemas"
    / "quality_output.schema.json"
)
DATA_ROOT = ROOT / "poc" / "agent_runtime_providers" / "datasets" / "native_workflow"

TOOL_NAMES = ["knowledge_search", "ticket_query", "sms_query", "appointment_query"]


def message(text: str) -> dict:
    return {
        "id": "msg-final",
        "type": "message",
        "status": "completed",
        "role": "assistant",
        "content": [{"type": "output_text", "text": text, "annotations": []}],
    }


def function_call(name: str, arguments: dict, call_id: str) -> dict:
    return {
        "id": f"fc-{call_id}",
        "type": "function_call",
        "status": "completed",
        "name": name,
        "call_id": call_id,
        "arguments": json.dumps(arguments, ensure_ascii=False),
    }


def parse_payload(input):
    if isinstance(input, str):
        return json.loads(input), 0
    payload_text = None
    tool_outputs = 0
    for item in input:
        if not isinstance(item, dict):
            dumper = getattr(item, "model_dump", None)
            item = dumper(mode="json") if dumper else {}
        # SDK 的 user 输入项可能不带 type 键（EasyInputMessage），按 role 识别。
        if item.get("role") == "user" and item.get("type") in (None, "message"):
            content = item.get("content")
            if isinstance(content, str):
                payload_text = content
            elif isinstance(content, list):
                for part in content:
                    if isinstance(part, dict) and part.get("type") in (
                        "input_text",
                        "text",
                        "output_text",
                    ):
                        payload_text = part.get("text")
        elif item.get("type") == "function_call_output":
            tool_outputs += 1
    return (json.loads(payload_text) if payload_text else {}), tool_outputs


class ScriptedQualityModel(Model):
    """按 native_quality_v0.2 语义脚本化应答：2 条知识陈述 + 1 条工单承诺。"""

    KNOWLEDGE_ROUNDS_REQUIRED = {
        "保修期设备故障免上门费": 2,
        "故障单二十四小时联系": 1,
    }

    def __init__(self, identify_output=None):
        self.identify_output = identify_output
        self.model_calls = 0

    def _identification(self):
        if self.identify_output is not None:
            return self.identify_output
        return {
            "consumer_needs": [
                {"category": "repair", "description": "路由器断网报修", "evidence_sequences": [0]}
            ],
            "knowledge_claims": [
                {"claim": "保修期设备故障免上门费", "evidence_sequences": [3]},
                {"claim": "故障单二十四小时联系", "evidence_sequences": [5]},
            ],
            "promises": [
                {"type": "ticket", "commitment": "二十四小时内创建故障工单", "evidence_sequences": [6]}
            ],
        }

    def _respond(self, payload, tool_outputs):
        if "tool_transcript" in payload:
            # 两阶段执行的 Phase 2：无工具结构化整理调用
            stage = str(payload.get("stage") or "")
            if stage.startswith("execute/knowledge"):
                claim = payload.get("task_payload", {}).get("claim", {}).get("claim", "")
                rounds = [
                    {"query": str(t.get("arguments") or "")[:200],
                     "evidence_refs": ["KB-POC-1"], "decisive": True}
                    for t in payload.get("tool_transcript", [])
                ]
                status = "accurate" if claim.endswith("免上门费") else "insufficient_evidence"
                return {
                    "status": status,
                    "search_rounds": rounds,
                    "evidence_refs": ["KB-POC-1"],
                    "reason": f"针对「{claim}」的检索证据已闭环。",
                }, None
            if stage.startswith("execute/promise"):
                return {
                    "status": "fulfilled",
                    "evidence_refs": ["FACT-TICKET-1"],
                    "reason": "工单已按承诺创建。",
                }, None
            raise AssertionError(f"unexpected format stage: {stage}")
        if "claim" in payload:
            claim = payload["claim"]["claim"]
            required = self.KNOWLEDGE_ROUNDS_REQUIRED.get(claim, 1)
            if tool_outputs < required:
                return None, function_call(
                    "knowledge_search",
                    {"query": f"{claim}（第 {tool_outputs + 1} 轮）"},
                    f"kc-{abs(hash(claim)) % 10_000}-{tool_outputs}",
                )
            status = "accurate" if claim.endswith("免上门费") else "insufficient_evidence"
            rounds = [
                {"query": f"{claim}（第 {round_no} 轮）", "evidence_refs": ["KB-POC-1"],
                 "decisive": round_no == required}
                for round_no in range(1, required + 1)
            ]
            return {
                "status": status,
                "search_rounds": rounds,
                "evidence_refs": ["KB-POC-1"],
                "reason": f"针对「{claim}」的检索证据已闭环。",
            }, None
        if "promise" in payload:
            if tool_outputs == 0:
                return None, function_call(
                    "ticket_query", {"case_id": str(payload.get("case_id") or "")}, "pc-1"
                )
            return {
                "status": "fulfilled",
                "evidence_refs": ["FACT-TICKET-1"],
                "reason": "工单已按承诺创建。",
            }, None
        if "consumer_needs" in payload:
            return {"summary": "知识核验 2 项、承诺核验 1 项均已完成。"}, None
        return self._identification(), None

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
        self.model_calls += 1
        payload, tool_outputs = parse_payload(input)
        final, call = self._respond(payload, tool_outputs)
        output = [call] if call is not None else [message(json.dumps(final, ensure_ascii=False))]
        return ModelResponse(
            output=output,
            usage=Usage(input_tokens=120, output_tokens=40, total_tokens=160),
            response_id=f"resp-{self.model_calls}",
        )

    async def stream_response(self, *args, **kwargs):  # pragma: no cover - 非流式
        raise NotImplementedError("streaming disabled in POC")

    def get_retry_advice(self, request):
        return None

    async def close(self):
        return None


def install_local_tools(monkeypatch, record):
    @function_tool
    async def knowledge_search(query: str) -> str:
        """Search the knowledge base for policy facts."""
        record.append(("knowledge_search", query))
        return json.dumps({"hits": [{"id": "KB-POC-1", "text": "fixture knowledge"}]},
                          ensure_ascii=False)

    @function_tool
    async def ticket_query(case_id: str) -> str:
        """Query the ticket system for promise fulfilment facts."""
        record.append(("ticket_query", case_id))
        return json.dumps({"ticket_id": "T-1", "status": "created"}, ensure_ascii=False)

    @function_tool
    async def sms_query(case_id: str) -> str:
        """Query SMS gateway send records."""
        record.append(("sms_query", case_id))
        return json.dumps({"sent": True}, ensure_ascii=False)

    @function_tool
    async def appointment_query(case_id: str) -> str:
        """Query appointment system records."""
        record.append(("appointment_query", case_id))
        return json.dumps({"appointment": None}, ensure_ascii=False)

    catalog = {tool.name: tool for tool in
               (knowledge_search, ticket_query, sms_query, appointment_query)}

    def tooling(self, stage, allowed_tools):
        return [], [catalog[name] for name in allowed_tools if name in catalog]

    monkeypatch.setattr(OpenAIAgentsStageRunner, "_stage_tooling", tooling)


def make_request(monkeypatch):
    monkeypatch.setenv("QUALITY_MODEL_API_KEY", "test-key")
    return RuntimeExecuteRequest(
        run_id="e2e-openai-native",
        idempotency_key="e2e-openai-native",
        agent=AgentExecutionSpec(
            id="quality-agent",
            version="1",
            instructions="Use evidence only.",
            model=ModelSpec(provider="openai-compatible", model="qwen3.8-max"),
            tools=[ToolRef(name=name, version="1.0.0") for name in TOOL_NAMES],
            output_schema=json.loads(PLATFORM_SCHEMA.read_text(encoding="utf-8")),
        ),
        input=json.loads((DATA_ROOT / "complex_call_v0.2.json").read_text(encoding="utf-8")),
        context=ExecutionContext(metadata={"workflowMode": "native_quality_v0.2"}),
        timeout_seconds=300,
    )


def test_e2e_native_workflow_through_adapter(monkeypatch):
    request = make_request(monkeypatch)
    record: list[tuple[str, str]] = []
    install_local_tools(monkeypatch, record)
    model = ScriptedQualityModel()
    monkeypatch.setattr(native_workflow, "build_chat_model", lambda req: model)

    run = asyncio.run(OpenAIAgentsRuntimeAdapter().execute(request))

    assert run.status is RunStatus.SUCCEEDED
    Draft202012Validator(json.loads(PLATFORM_SCHEMA.read_text(encoding="utf-8"))).validate(
        run.output
    )
    assert run.output["sample_id"] == "NATIVE-V02-001"

    by_criterion = {f["criterion"]: f for f in run.output["findings"]}
    assert by_criterion["knowledge_accuracy"]["status"] == "insufficient_evidence"
    assert by_criterion["promise_fulfillment"]["status"] == "passed"
    assert run.output["labels"]["issue_codes"] == []

    # 真实发生的工具调用（非伪造 trace）：knowledge 2+1 轮，工单承诺 1 次
    tool_names = [name for name, _ in record]
    assert tool_names.count("knowledge_search") == 3
    assert tool_names.count("ticket_query") == 1

    stages = [e.name for e in run.trace if e.type == "workflow/stage_completed"]
    assert stages == ["identify", "plan", "execute", "barrier", "synthesize"]
    fan_out = next(e for e in run.trace if e.type == "workflow/stage_started" and e.name == "execute")
    assert fan_out.metadata["fan_out"] == 3
    # 阶段元数据可供平台 RunEvent 聚合
    assert any(e.metadata.get("workflow_stage", "").startswith("execute/") for e in run.trace)

    assert run.usage.model_calls == model.model_calls
    assert run.usage.tool_calls == 4
    assert run.usage.total_tokens == run.usage.input_tokens + run.usage.output_tokens
    assert run.usage.total_tokens > 0
    assert run.runtime.provider == "openai-agents"
    assert run.finished_at is not None


def test_e2e_invalid_identify_maps_to_model_error(monkeypatch):
    request = make_request(monkeypatch)
    record: list[tuple[str, str]] = []
    install_local_tools(monkeypatch, record)
    bad_identification = {
        "consumer_needs": [
            {"category": "not-a-valid-category", "description": "x", "evidence_sequences": [0]}
        ],
        "knowledge_claims": [],
        "promises": [],
    }
    model = ScriptedQualityModel(identify_output=bad_identification)
    monkeypatch.setattr(native_workflow, "build_chat_model", lambda req: model)

    with pytest.raises(AdapterExecutionError) as caught:
        asyncio.run(OpenAIAgentsRuntimeAdapter().execute(request))
    assert caught.value.error.code is ErrorCode.MODEL_ERROR
    assert record == [], "identify 失败后不得继续执行工具"


def test_e2e_request_tools_constrain_stage_tools(monkeypatch):
    """G12 联动：请求只声明 knowledge_search 时，承诺阶段拿不到承诺工具。"""

    request = make_request(monkeypatch)
    request.agent.tools = [ToolRef(name="knowledge_search", version="1.0.0")]
    record: list[tuple[str, str]] = []
    install_local_tools(monkeypatch, record)

    seen_stage_tools: dict[str, list[str]] = {}
    from app.native_workflow import OpenAIAgentsStageRunner as RunnerCls

    def tooling(self, stage, allowed_tools):
        from app.tool_adapter import resolve_stage_tools

        effective = resolve_stage_tools(
            [tool.name for tool in request.agent.tools], allowed_tools
        )
        seen_stage_tools[stage] = effective
        catalog = {}
        return [], []

    monkeypatch.setattr(RunnerCls, "_stage_tooling", tooling)
    model = ScriptedQualityModel()
    monkeypatch.setattr(native_workflow, "build_chat_model", lambda req: model)

    # 承诺阶段因交集为空而无工具可用：脚本模型仍会尝试调用，但 SDK 无法执行
    # （无工具注入时 function_call 触发 tool-not-found），Run 失败关闭而非伪造成功。
    with pytest.raises(AdapterExecutionError):
        asyncio.run(OpenAIAgentsRuntimeAdapter().execute(request))
    # 只有非空交集的阶段会装配工具；承诺阶段交集为空 → 无工具分支，失败关闭
    assert seen_stage_tools["execute/knowledge-1"] == ["knowledge_search"]
    assert "execute/promise-1" not in seen_stage_tools
    assert "synthesize" not in seen_stage_tools


# ---------- business_analysis_v1（SDD-14：通话业务打标，无工具两阶段） ----------


class ScriptedBusinessModel(Model):
    """business_analysis_v1 打标脚本模型：understand → synthesize，无工具。"""

    async def get_response(self, system_instructions, input, model_settings, tools,
                           output_schema, handoffs, tracing, *, previous_response_id=None,
                           conversation_id=None, prompt=None):
        payload, tool_outputs = parse_payload(input)
        final, call = self._respond(payload, tool_outputs)
        output = [call] if call is not None else [message(json.dumps(final, ensure_ascii=False))]
        return ModelResponse(output=output,
                             usage=Usage(input_tokens=50, output_tokens=20, total_tokens=70),
                             response_id="resp-biz")

    async def stream_response(self, *args, **kwargs):  # pragma: no cover - 非流式
        raise NotImplementedError("streaming disabled in POC")

    def _respond(self, payload, tool_outputs):
        if "understanding" in payload:  # synthesize 阶段
            return {
                "service_type_code": "REPAIR",
                "customer_intents": [
                    {"intent": "故障报修", "description": "洗衣机甩干异常晃动，要求上门检修"}
                ],
                "business_outcome": "pending",
                "follow_ups": [
                    {"action": "安排师傅上门检修", "reason": "坐席已承诺上门，需落实"}
                ],
                "summary": "客户报修洗衣机甩干异常，坐席受理并承诺安排上门检修。",
            }, None
        # understand 阶段
        return {
            "customer_needs": ["洗衣机甩干异常晃动，要求上门检修"],
            "service_scenario": "家电故障报修",
            "key_events": ["坐席登记故障现象", "坐席承诺安排师傅上门"],
            "resolution_signals": "已受理报修，等待上门",
        }, None


def test_e2e_business_workflow_through_adapter(monkeypatch):
    monkeypatch.setenv("QUALITY_MODEL_API_KEY", "test-key")
    schema_path = (ROOT / "server" / "app" / "agent_modules" / "business_analysis"
                   / "schemas" / "output.schema.json")
    output_schema = json.loads(schema_path.read_text(encoding="utf-8"))
    request = RuntimeExecuteRequest(
        run_id="e2e-business",
        idempotency_key="e2e-business",
        agent=AgentExecutionSpec(
            id="business-agent",
            version="1.0.0",
            instructions="只读业务分析。",
            model=ModelSpec(provider="openai-compatible", model="qwen3.8-max"),
            tools=[],
            output_schema=output_schema,
        ),
        input={"sample_id": "sample-001", "call_id": "acid-1",
               "conversation": [{"sequence": 0, "speaker": "customer", "text": "洗衣机坏了"}]},
        context=ExecutionContext(metadata={"workflowMode": "business_analysis_v1"}),
        timeout_seconds=300,
    )
    model = ScriptedBusinessModel()
    import app.business_workflow as business_workflow
    monkeypatch.setattr(business_workflow, "build_chat_model", lambda req: model)

    run = asyncio.run(OpenAIAgentsRuntimeAdapter().execute(request))
    assert run.status is RunStatus.SUCCEEDED
    from jsonschema import Draft202012Validator
    Draft202012Validator(output_schema).validate(run.output)
    # sample_id 由代码确定性注入；打标内容来自脚本模型
    assert run.output["sample_id"] == "sample-001"
    assert run.output["service_type_code"] == "REPAIR"
    assert run.output["business_outcome"] == "pending"
    assert run.output["customer_intents"][0]["intent"] == "故障报修"
    assert run.output["follow_ups"][0]["action"] == "安排师傅上门检修"
    # 打标为纯通话理解，无工具调用
    assert run.usage.tool_calls == 0
    # 两阶段事件齐全
    stages = [e.name for e in run.trace if e.type == "workflow/stage_completed"]
    assert stages == ["understand", "synthesize"]
