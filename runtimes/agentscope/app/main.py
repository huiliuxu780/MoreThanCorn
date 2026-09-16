"""MoreThanCorn Agent Runtime Service — native AgentScope 2.0.8 host.

The process embeds the official ``create_app`` (AgentRecord/Session/
ChatService/Schedule/Skill/MCP/Knowledge/Workspace routers, official
storage + message bus + scheduler) and adds:

- ``/mtc/*`` extension routes (fresh session, structured run) that only
  compose official primitives (doc 13 GAP-1);
- platform ToolBase tools (run_workflow / run_agent_flow) injected via
  the official ``extra_agent_tools`` hook;
- host-level diagnostics so setup failures log their original exception
  (doc 13 §2.1 item 4).

No AgentScope kernel code is modified; no parallel session/state/store
is introduced.
"""
from __future__ import annotations

import os

import uvicorn
from fastapi.middleware.cors import CORSMiddleware

# 09-11 权限策略：必须在 agentscope._service._chat 导入前包装 get_toolkit
# （_chat 以 from-import 绑定；晚于它包装不生效）。
from . import tool_policy  # noqa: F401,I001

from agentscope._logging import logger
from agentscope.app import create_app
from agentscope.app._service._chat import ChatService
from agentscope.app.message_bus import RedisMessageBus
from agentscope.app.rag.knowledge_base_manager import CollectionPerKbManager
from agentscope.app.storage import AsyncSQLAlchemyStorage
from agentscope.app.workspace_manager import (
    IsolationPolicy,
    LocalWorkspaceManager,
)
from agentscope.rag import MilvusLiteStore

from .mtc_router import bind_extra_factory, mtc_router
from .platform_tools import platform_extra_tools

# §三 数据库收敛：官方 Storage 与平台表共库 wf_dev（官方无 schema 隔离选项；
# 表名已验证无冲突——AgentScope 全复数 agents/sessions/...，平台全单数）。
# 历史独立库 wf_agentscope 已备份后退役（exports/db-cleanup-2026-09-10）。
DB_URL = os.environ.get(
    "MTC_RT_DB_URL", "postgresql+asyncpg:///wf_dev?host=/tmp"
)
REDIS_DB = int(os.environ.get("MTC_RT_REDIS_DB", "4"))
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WS_ROOT = os.environ.get("MTC_RT_WORKSPACES", f"{ROOT}/var/workspaces")
MILVUS_URI = os.environ.get("MTC_RT_MILVUS", f"{ROOT}/var/rag.db")
PORT = int(os.environ.get("MTC_RT_PORT", "8301"))

_orig_report_failure = ChatService._report_failure


async def _logged_report_failure(
    self, user_id, session_id, agent_id, error, *a, **k
):
    logger.exception(
        "ChatService setup/run failure original error session=%s agent=%s",
        session_id,
        agent_id,
        exc_info=error,
    )
    return await _orig_report_failure(
        self, user_id, session_id, agent_id, error, *a, **k
    )


ChatService._report_failure = _logged_report_failure


def build_app():
    os.makedirs(WS_ROOT, exist_ok=True)
    storage = AsyncSQLAlchemyStorage(DB_URL, create_tables=True)
    bus = RedisMessageBus(db=REDIS_DB)
    # Group worker 退化兜底中继（group_worker_guard）：放弃点前自动中继最后文本
    from . import group_worker_guard as _group_guard

    _group_guard.set_bus(bus)
    _group_guard.install()
    workspace = LocalWorkspaceManager(
        basedir=WS_ROOT, isolation=IsolationPolicy.PER_SESSION
    )
    kb_manager = CollectionPerKbManager(
        storage, MilvusLiteStore(uri=MILVUS_URI)
    )
    app = create_app(
        storage=storage,
        message_bus=bus,
        workspace_manager=workspace,
        knowledge_base_manager=kb_manager,
        enable_scheduler=True,
        extra_agent_tools=platform_extra_tools,
        title="MoreThanCorn Agent Runtime",
    )
    bind_extra_factory(platform_extra_tools)
    app.include_router(mtc_router)
    from .flow_runner import flow_router

    app.include_router(flow_router)
    from .script_runner import script_router

    app.include_router(script_router)
    from .group_runner import group_router

    app.include_router(group_router)  # Group Spec §4.2 装配端点
    # 平台前端直连运行时 SSE（开发态本地源放行；生产由平台代理收口）
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
        allow_methods=["*"],
        allow_headers=["*"],
    )
    return app


app = build_app()

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="info")
