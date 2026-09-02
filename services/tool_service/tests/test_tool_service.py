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


def test_health_and_registry_expose_quality_and_business_tools(client: TestClient):
    assert client.get("/health").json()["status"] == "ok"
    tools = client.get("/v1/tools").json()["items"]
    # 质检四工具 + business-analysis 两工具（SDD-14 扩展，均 read-only）
    assert [tool["name"] for tool in tools] == [
        "appointment_query",
        "dimension_query",
        "knowledge_search",
        "metric_query",
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
    # smoke ground truth 声明的工具必须全部在册；注册表可含更多场景工具（business）
    assert declared <= registered


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
        "dimension_query",
        "knowledge_search",
        "metric_query",
        "sms_query",
        "ticket_query",
    }
    assert all(tool.annotations.read_only_hint is True for tool in tools.tools)
    assert all(tool.annotations.destructive_hint is False for tool in tools.tools)
    assert result.structured_content["output"]["appointments"][0]["appointment_id"] == "APPT-SYN-003"


def test_metric_query_returns_deterministic_window_aggregate():
    store = FixtureStore(NATIVE_FIXTURES)  # v0.2 fixture 含 metric_store
    out = store.metric_query("connect_rate")["output"]
    assert out["known"] is True
    assert out["unit"] == "%"
    assert len(out["points"]) == 7  # 默认近 7 日
    assert out["aggregate"] == 86.4  # 确定性均值（fixture 钉扎）

    full = store.metric_query("connect_rate", None, "2026-08-20", "2026-09-02")["output"]
    assert len(full["points"]) == 14
    assert full["window"] == {"start": "2026-08-20", "end": "2026-09-02"}


def test_metric_query_symbolic_window_resolved_against_dataset():
    store = FixtureStore(NATIVE_FIXTURES)
    # 符号窗口相对数据集自身日期范围求解，调用方无需推算日期
    out14 = store.metric_query("connect_rate", "last_14d")["output"]
    assert len(out14["points"]) == 14
    assert out14["window"] == {"start": "2026-08-20", "end": "2026-09-02"}
    out7 = store.metric_query("connect_rate", "last_7d")["output"]
    assert out7["window"] == {"start": "2026-08-27", "end": "2026-09-02"}
    out_all = store.metric_query("resolution_rate", "all")["output"]
    assert len(out_all["points"]) == 14


def test_metric_query_unknown_metric_fails_honestly(client: TestClient):
    out = client.post("/v1/tools/metric_query", json={"metric": "not_a_metric"}).json()["output"]
    assert out["known"] is False
    assert out["aggregate"] is None
    assert out["points"] == []


def test_dimension_query_returns_breakdown():
    store = FixtureStore(NATIVE_FIXTURES)
    out = store.dimension_query("connect_rate", "region")["output"]
    assert out["known"] is True
    assert out["unit"] == "%"
    assert {b["key"] for b in out["breakdown"]} == {"east", "north", "south", "west"}

    unknown = store.dimension_query("connect_rate", "nope")["output"]
    assert unknown["known"] is False and unknown["breakdown"] == []


def test_generic_call_route_serves_business_tools(client: TestClient):
    response = client.post(
        "/v1/tools/metric_query:call",
        json={"arguments": {"metric": "resolution_rate"}},
    )
    assert response.status_code == 200
    assert response.json()["output"]["metric"] == "resolution_rate"

    invalid = client.post(
        "/v1/tools/dimension_query:call",
        json={"arguments": {"metric": "connect_rate"}},  # 缺 dimension
    )
    assert invalid.status_code == 422


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
