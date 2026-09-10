"""Probe host: real AgentScope 2.0.8 app (create_app) on :8399.

Storage  = AsyncSQLAlchemyStorage (PostgreSQL wf_as_probe, official tables)
Bus      = RedisMessageBus (local redis, db 3)
Workspace= LocalWorkspaceManager under var/probe-workspaces
Scheduler= enabled (official SchedulerManager)
Extra    = one platform ToolBase injected via extra_agent_tools (G3 proof)
"""
from __future__ import annotations

import uvicorn

from agentscope.app import create_app
from agentscope.app.message_bus import RedisMessageBus
from agentscope.app.storage import AsyncSQLAlchemyStorage
from agentscope.app.rag.knowledge_base_manager import CollectionPerKbManager
from agentscope.app.workspace_manager import (
    LocalWorkspaceManager,
    IsolationPolicy,
)

from probes.vector_store import InMemoryVectorStore
from agentscope.message import TextBlock, ToolResultState
from agentscope.permission import PermissionBehavior, PermissionDecision
from agentscope.tool import ToolBase, ToolChunk

from probes.common import PROBE_DB_URL, REDIS_DB, WS_ROOT


class ProbeEchoTool(ToolBase):
    """Platform-owned capability injected through the official hook."""

    name = "probe_echo"
    description = (
        "Echoes the given payload back with a server-side marker. "
        "Call it once when the user asks for a probe echo."
    )
    input_schema = {
        "type": "object",
        "properties": {"payload": {"type": "string"}},
        "required": ["payload"],
    }
    is_concurrency_safe = True
    is_read_only = True

    async def call(self, payload: str) -> ToolChunk:
        return ToolChunk(
            content=[TextBlock(type="text", text=f"PROBE_ECHO::{payload}")],
            state=ToolResultState.SUCCESS,
            is_last=True,
        )

    async def check_permissions(self, tool_input, context):
        return PermissionDecision(
            behavior=PermissionBehavior.ALLOW,
            message="probe_echo is read-only platform tooling",
        )


async def extra_agent_tools(user_id: str, agent_id: str, session_id: str):
    return [ProbeEchoTool()]


def build_app():
    storage = AsyncSQLAlchemyStorage(PROBE_DB_URL, create_tables=True)
    bus = RedisMessageBus(db=REDIS_DB)
    workspace = LocalWorkspaceManager(
        basedir=WS_ROOT, isolation=IsolationPolicy.PER_SESSION
    )
    kb_manager = CollectionPerKbManager(storage, InMemoryVectorStore())
    return create_app(
        storage=storage,
        message_bus=bus,
        workspace_manager=workspace,
        knowledge_base_manager=kb_manager,
        enable_scheduler=True,
        extra_agent_tools=extra_agent_tools,
    )


if __name__ == "__main__":
    uvicorn.run(build_app(), host="127.0.0.1", port=8401, log_level="info")
