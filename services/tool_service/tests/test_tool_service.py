import asyncio
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from mcp import Client

from app.main import app, create_mcp_server
from app.store import FixtureStore

ROOT = Path(__file__).resolve().parents[3]
GROUND_TRUTH = (
    ROOT
    / "poc"
    / "agent_runtime_providers"
    / "datasets"
    / "smoke"
    / "ground_truth_v0.1.jsonl"
)
NATIVE_FIXTURES = (
    ROOT
    / "poc"
    / "agent_runtime_providers"
    / "datasets"
    / "native_workflow"
    / "tool_fixtures_v0.2.json"
)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


def test_health_and_registry_expose_four_tools(client: TestClient):
    assert client.get("/health").json()["status"] == "ok"
    tools = client.get("/v1/tools").json()["items"]
    assert [tool["name"] for tool in tools] == [
        "appointment_query",
        "knowledge_search",
        "sms_query",
        "ticket_query",
    ]


def test_knowledge_search_returns_deterministic_evidence(client: TestClient):
    response = client.post(
        "/v1/tools/knowledge_search",
        json={"query": "宽带报修后多久联系", "limit": 2},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["fixture_dataset"] == "quality-runtime-smoke-v0.1"
    assert body["output"]["items"][0]["evidence_ref"] == "KB-BROADBAND-RESPONSE-V1"


def test_case_queries_distinguish_known_empty_from_unknown_case(client: TestClient):
    known = client.post("/v1/tools/sms_query", json={"case_id": "CASE-SYN-C01"}).json()
    assert known["output"]["case_known"] is True
    assert known["output"]["sent"] is False

    unknown = client.post("/v1/tools/sms_query", json={"case_id": "CASE-NOT-IN-FIXTURE"}).json()
    assert unknown["output"]["case_known"] is False
    assert unknown["output"]["sent"] is False


def test_generic_call_uses_same_implementation_and_validation(client: TestClient):
    response = client.post(
        "/v1/tools/ticket_query:call",
        json={"arguments": {"case_id": "CASE-SYN-C02"}},
    )
    assert response.status_code == 200
    assert response.json()["output"]["tickets"][0]["ticket_id"] == "TICKET-SYN-002"

    invalid = client.post(
        "/v1/tools/ticket_query:call",
        json={"arguments": {"case_id": "CASE-SYN-C02", "unexpected": True}},
    )
    assert invalid.status_code == 422


def test_every_ground_truth_tool_is_registered(client: TestClient):
    rows = [json.loads(line) for line in GROUND_TRUTH.read_text(encoding="utf-8").splitlines() if line]
    registered = {item["name"] for item in client.get("/v1/tools").json()["items"]}
    declared = {
        tool
        for row in rows
        for tool in row["required_tools"] + row["forbidden_tools"]
    }
    assert declared == registered


def test_mcp_transport_exposes_same_structured_result():
    async def run_call():
        server = create_mcp_server(FixtureStore())
        async with Client(server) as mcp_client:
            tools = await mcp_client.list_tools()
            result = await mcp_client.call_tool(
                "appointment_query",
                {"case_id": "CASE-SYN-C03"},
            )
            return tools, result

    tools, result = asyncio.run(run_call())
    assert {tool.name for tool in tools.tools} == {
        "appointment_query",
        "knowledge_search",
        "sms_query",
        "ticket_query",
    }
    assert all(tool.annotations.read_only_hint is True for tool in tools.tools)
    assert all(tool.annotations.destructive_hint is False for tool in tools.tools)
    assert result.structured_content["output"]["appointments"][0]["appointment_id"] == "APPT-SYN-003"


def test_native_workflow_fixture_forces_refined_knowledge_search():
    native_store = FixtureStore(NATIVE_FIXTURES)

    broad = native_store.knowledge_search("路由器保修期设备故障上门费用", 5)
    assert broad["fixture_dataset"] == "quality-runtime-native-workflow-v0.2"
    assert [item["evidence_ref"] for item in broad["output"]["items"]] == [
        "KB-ONSITE-FEE-ROUTER-GENERAL-V2"
    ]
    assert broad["output"]["items"][0]["decisive"] is False
    assert broad["output"]["items"][0]["refinement_hints"] == [
        "服务地区",
        "设备型号",
        "保修状态",
        "故障归因",
    ]

    refined = native_store.knowledge_search(
        "华东 X2 路由器保修期设备自身故障上门费",
        5,
    )
    refs = [item["evidence_ref"] for item in refined["output"]["items"]]
    assert refs[0] == "KB-ONSITE-FEE-X2-EAST-V2"
    assert refined["output"]["items"][0]["decisive"] is True
