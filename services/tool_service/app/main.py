from __future__ import annotations

import contextlib
from typing import Any, Callable

from fastapi import FastAPI, HTTPException
from mcp.server import MCPServer
from mcp.types import ToolAnnotations
from pydantic import ValidationError

from .schemas import (
    CaseQueryRequest,
    GenericToolCall,
    KnowledgeSearchRequest,
    ToolEnvelope,
)
from .store import FIXTURE_DATASET, TOOL_VERSIONS, FixtureStore

store = FixtureStore()
READ_ONLY_TOOL = ToolAnnotations(
    readOnlyHint=True,
    destructiveHint=False,
    idempotentHint=True,
    openWorldHint=False,
)


def create_mcp_server(fixture_store: FixtureStore) -> MCPServer:
    server = MCPServer(
        name="quality-enterprise-tools",
        version="0.1.0",
        instructions="Return fixture facts only. Do not make quality decisions or calculate scores.",
    )

    @server.tool(annotations=READ_ONLY_TOOL)
    def knowledge_search(query: str, limit: int = 3) -> dict[str, Any]:
        """Search the synthetic enterprise knowledge fixture for factual evidence."""
        request = KnowledgeSearchRequest(query=query, limit=limit)
        return fixture_store.knowledge_search(request.query, request.limit)

    @server.tool(annotations=READ_ONLY_TOOL)
    def ticket_query(case_id: str) -> dict[str, Any]:
        """Return synthetic work-order facts for one case ID."""
        request = CaseQueryRequest(case_id=case_id)
        return fixture_store.ticket_query(request.case_id)

    @server.tool(annotations=READ_ONLY_TOOL)
    def sms_query(case_id: str) -> dict[str, Any]:
        """Return synthetic SMS-delivery facts for one case ID."""
        request = CaseQueryRequest(case_id=case_id)
        return fixture_store.sms_query(request.case_id)

    @server.tool(annotations=READ_ONLY_TOOL)
    def appointment_query(case_id: str) -> dict[str, Any]:
        """Return synthetic appointment facts for one case ID."""
        request = CaseQueryRequest(case_id=case_id)
        return fixture_store.appointment_query(request.case_id)

    return server


mcp = create_mcp_server(store)


mcp_app = mcp.streamable_http_app(
    streamable_http_path="/",
    stateless_http=True,
    json_response=True,
)


@contextlib.asynccontextmanager
async def lifespan(_app: FastAPI):
    async with mcp.session_manager.run():
        yield


app = FastAPI(title="Quality Enterprise Tool Service", version="0.1.0", lifespan=lifespan)


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "fixture_dataset": store.dataset_id,
        "tools": TOOL_VERSIONS,
    }


@app.get("/v1/tools")
def list_tools() -> dict[str, Any]:
    return {
        "items": [
            {"name": name, "version": version}
            for name, version in sorted(TOOL_VERSIONS.items())
        ]
    }


@app.post("/v1/tools/knowledge_search", response_model=ToolEnvelope)
def knowledge_search_http(request: KnowledgeSearchRequest) -> dict[str, Any]:
    return store.knowledge_search(request.query, request.limit)


@app.post("/v1/tools/ticket_query", response_model=ToolEnvelope)
def ticket_query_http(request: CaseQueryRequest) -> dict[str, Any]:
    return store.ticket_query(request.case_id)


@app.post("/v1/tools/sms_query", response_model=ToolEnvelope)
def sms_query_http(request: CaseQueryRequest) -> dict[str, Any]:
    return store.sms_query(request.case_id)


@app.post("/v1/tools/appointment_query", response_model=ToolEnvelope)
def appointment_query_http(request: CaseQueryRequest) -> dict[str, Any]:
    return store.appointment_query(request.case_id)


_HTTP_HANDLERS: dict[str, tuple[type[KnowledgeSearchRequest] | type[CaseQueryRequest], Callable[..., dict[str, Any]]]] = {
    "knowledge_search": (KnowledgeSearchRequest, store.knowledge_search),
    "ticket_query": (CaseQueryRequest, store.ticket_query),
    "sms_query": (CaseQueryRequest, store.sms_query),
    "appointment_query": (CaseQueryRequest, store.appointment_query),
}


@app.post("/v1/tools/{tool_name}:call", response_model=ToolEnvelope)
def call_tool(tool_name: str, call: GenericToolCall) -> dict[str, Any]:
    registered = _HTTP_HANDLERS.get(tool_name)
    if not registered:
        raise HTTPException(404, detail="tool not found")
    request_type, handler = registered
    try:
        request = request_type.model_validate(call.arguments)
    except ValidationError as exc:
        raise HTTPException(422, detail=exc.errors(include_url=False)) from exc
    return handler(**request.model_dump())


app.mount("/mcp", mcp_app)
