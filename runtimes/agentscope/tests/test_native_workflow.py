import asyncio
import json
from pathlib import Path

from app.native_workflow import AgentScopeNativeQualityWorkflow, StageResult
from jsonschema import Draft202012Validator
from quality_runtime_contract import (
    AgentExecutionSpec,
    ExecutionContext,
    ModelSpec,
    RuntimeExecuteRequest,
)

ROOT = Path(__file__).resolve().parents[3]
DATA_ROOT = ROOT / "poc" / "agent_runtime_providers" / "datasets" / "native_workflow"
SCHEMA = ROOT / "poc" / "agent_runtime_providers" / "schemas" / "native_workflow_output.schema.json"


class FakeRunner:
    def __init__(self):
        self.calls = []

    async def run(self, **kwargs):
        self.calls.append(
            {
                "stage": kwargs["stage"],
                "allowed_tools": kwargs["allowed_tools"],
                "task_states": {task.id: task.state for task in kwargs["tasks"]},
            }
        )
        stage = kwargs["stage"]
        if stage == "identify":
            output = {
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
        elif stage == "execute/knowledge-1":
            output = {
                "status": "accurate",
                "search_rounds": [
                    {"query": "路由器上门费用", "evidence_refs": ["KB-ONSITE-FEE-ROUTER-GENERAL-V2"], "decisive": False},
                    {"query": "华东 X2 保修期设备自身故障上门费", "evidence_refs": ["KB-ONSITE-FEE-X2-EAST-V2"], "decisive": True},
                ],
                "evidence_refs": ["KB-ONSITE-FEE-X2-EAST-V2"],
                "reason": "与知识库一致",
            }
        elif stage == "execute/knowledge-2":
            output = {
                "status": "inaccurate",
                "search_rounds": [
                    {"query": "宽带故障单联系时限", "evidence_refs": ["KB-BROADBAND-CONTACT-SLA-V2"], "decisive": True}
                ],
                "evidence_refs": ["KB-BROADBAND-CONTACT-SLA-V2"],
                "reason": "知识库规定四十八小时",
            }
        elif stage.startswith("execute/promise-"):
            index = int(stage.rsplit("-", 1)[1])
            statuses = {1: "fulfilled", 2: "unfulfilled", 3: "mismatched"}
            output = {
                "status": statuses[index],
                "evidence_refs": [f"FACT-{index}"],
                "reason": "fixture result",
            }
        elif stage == "synthesize":
            output = {"summary": "三个诉求已识别；两条知识陈述和三项承诺均已逐项核验。"}
        else:
            raise AssertionError(stage)
        return StageResult(output=output, trace=[])


def request():
    return RuntimeExecuteRequest(
        run_id="native-v02-test",
        idempotency_key="native-v02-test",
        agent=AgentExecutionSpec(
            id="quality-native",
            version="0.2",
            instructions="Use evidence only.",
            model=ModelSpec(provider="openai-compatible", model="fake"),
            output_schema=json.loads(SCHEMA.read_text(encoding="utf-8")),
        ),
        input=json.loads((DATA_ROOT / "complex_call_v0.2.json").read_text(encoding="utf-8")),
        context=ExecutionContext(metadata={"workflow_mode": "native_quality_v0.2"}),
    )


def test_native_workflow_fans_out_with_per_plan_tool_policies_and_barrier():
    runner = FakeRunner()
    output, trace = asyncio.run(AgentScopeNativeQualityWorkflow(runner).execute(request()))
    Draft202012Validator(json.loads(SCHEMA.read_text(encoding="utf-8"))).validate(output)

    assert output["workflow"]["stage_order"] == [
        "identify",
        "plan",
        "execute",
        "barrier",
        "synthesize",
    ]
    assert output["workflow"]["barrier_passed"] is True
    assert len(output["consumer_needs"]) == 3
    assert len(output["knowledge_claims"]) == 2
    assert len(output["knowledge_claims"][0]["search_rounds"]) == 2
    assert [row["status"] for row in output["promises"]] == [
        "fulfilled",
        "unfulfilled",
        "mismatched",
    ]

    policies = {call["stage"]: call["allowed_tools"] for call in runner.calls}
    assert policies["identify"] == []
    assert policies["execute/knowledge-1"] == ["knowledge_search"]
    assert policies["execute/knowledge-2"] == ["knowledge_search"]
    assert policies["execute/promise-1"] == ["ticket_query"]
    assert policies["execute/promise-2"] == ["sms_query"]
    assert policies["execute/promise-3"] == ["appointment_query"]
    assert policies["synthesize"] == []
    assert [event.name for event in trace if event.type == "workflow/stage_completed"] == [
        "identify",
        "plan",
        "execute",
        "barrier",
        "synthesize",
    ]
