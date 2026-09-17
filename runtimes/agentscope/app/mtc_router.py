"""MoreThanCorn extension routes on top of the official AgentScope app.

These endpoints fill two registered upstream gaps (doc 13 §2.1):

- ``POST /mtc/session`` — deterministic fresh-session creation for
  single-shot executions (the official ``POST /sessions`` resumes the
  per-(user, agent, workspace) triple, which is wrong for stateless runs).
- ``POST /mtc/structured-run`` — schema-bound one-shot execution. The
  official chat surface does not expose ``structured_schema``, so this
  host assembles the agent with the *official* services (get_model,
  get_toolkit, RAGMiddleware, storage, message bus) and persists
  messages/state/events through the official primitives. It adds no
  parallel state machine: the session record, messages and AgentState
  remain AgentScope's.
"""
from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from agentscope.agent import Agent
from agentscope.app._bus_ops import publish_session_event
from agentscope.app._service._model import get_model
from agentscope.app._service._toolkit import get_toolkit
from agentscope.app._service._access import ResourceAccessService
from agentscope.app.deps import (
    get_background_task_manager,
    get_current_user_id,
    get_knowledge_base_manager,
    get_message_bus,
    get_resource_access_service,
    get_scheduler_manager,
    get_storage,
    get_workspace_manager,
)
from agentscope.app.storage import ChatModelConfig, SessionConfig, StorageBase
from agentscope.message import Msg, TextBlock, UserMsg
from agentscope.middleware import RAGMiddleware
from agentscope.state import AgentState

from .schema_tools import SchemaTranslationError, schema_to_model

async def structured_run_core(
    *,
    storage,
    message_bus,
    workspace_manager,
    kb_manager,
    access,
    scheduler_manager,
    background_task_manager,
    user_id: str,
    agent_record,
    session,
    text: str,
    schema,
    timeout_seconds: float = 300.0,
    rules_context: str | None = None,
):
    """官方原语组合的结构化执行核心（P0-1/P0-2 复用）：
    官方 get_model/get_toolkit/RAGMiddleware 装配 + reply_stream(structured_schema)
    + 官方 storage 持久化 + 官方 bus 事件发布。"""
    import asyncio as _asyncio

    from agentscope.agent import Agent
    from agentscope.app._service._model import get_model
    from agentscope.app._service._toolkit import get_toolkit
    from agentscope.middleware import RAGMiddleware
    from agentscope.message import Msg, TextBlock, UserMsg

    from agentscope.app._bus_ops import publish_session_event

    kb_cfg = session.config.knowledge_config
    middlewares = []
    if kb_cfg and kb_cfg.knowledge_base_ids and kb_manager is not None:
        knowledges = []
        for kb_id in kb_cfg.knowledge_base_ids:
            try:
                kb_record = await access.resolve_knowledge_base(user_id, kb_id)
                knowledges.append(
                    await kb_manager.get_knowledge(kb_record.user_id, kb_id)
                )
            except Exception:  # noqa: BLE001
                continue
        if knowledges:
            middlewares.append(
                RAGMiddleware(
                    knowledge_bases=knowledges,
                    parameters=RAGMiddleware.Parameters(**(kb_cfg.parameters or {})),
                )
            )
    workspace = await workspace_manager.get_workspace(
        user_id, agent_record.id, session.id, session.config.workspace_id
    )
    model = await get_model(user_id, session.config.chat_model_config, access)
    toolkit = await get_toolkit(
        storage=storage,
        workspace=workspace,
        workspace_manager=workspace_manager,
        scheduler_manager=scheduler_manager,
        background_task_manager=background_task_manager,
        message_bus=message_bus,
        middlewares=middlewares,
        user_id=user_id,
        agent_record=agent_record,
        session_record=session,
        resource_access_service=access,
        extra_factory=_extra_factory_from_app(),
    )
    agent = Agent(
        name=agent_record.id,
        system_prompt=agent_record.data.system_prompt,
        model=model,
        toolkit=toolkit,
        state=session.state or type(session.state)(),
        middlewares=middlewares,
        offloader=workspace,
        react_config=agent_record.data.react_config,
        context_config=agent_record.data.context_config,
    )
    if rules_context:
        # 09-17 规则 Skill 化：当前规则段以 SystemMsg 注入本次执行上下文
        from agentscope.message import SystemMsg as _RulesSysMsg
        agent.state.context.append(_RulesSysMsg(name="system", content=rules_context))
    input_msg = UserMsg(name=user_id, content=[TextBlock(type="text", text=text)])
    await storage.upsert_message(user_id, session.id, input_msg)
    final = None

    async def _drive():
        nonlocal final
        async for event in agent.reply_stream(
            inputs=input_msg, structured_schema=schema, yield_final_msg=True
        ):
            if isinstance(event, Msg):
                final = event
            else:
                await publish_session_event(
                    message_bus, session.id, event.model_dump(mode="json")
                )

    await _asyncio.wait_for(_drive(), timeout=timeout_seconds)
    if final is not None:
        await storage.upsert_message(user_id, session.id, final)
        await storage.upsert_session(
            user_id=user_id,
            agent_id=agent_record.id,
            config=session.config,
            state=agent.state,
            session_id=session.id,
            origin=session.origin,
        )
    return final


mtc_router = APIRouter(prefix="/mtc", tags=["mtc"])


class CreateSessionBody(BaseModel):
    agent_id: str
    chat_model_config: ChatModelConfig
    knowledge_base_ids: list[str] = Field(default_factory=list)
    name: str | None = None
    # P0-08: platform-minted per-session internal Tool callback token
    internal_token: str | None = None


class StructuredRunBody(BaseModel):
    agent_id: str
    session_id: str | None = None
    chat_model_config: ChatModelConfig | None = None
    input_text: str
    schema: dict[str, Any]
    timeout_seconds: float = 300.0
    # 09-17 规则 Skill 化：平台 run 时解析的当前规则段（SystemMsg 注入，不污染用户输入）
    rules_context: str | None = None


async def _new_session(
    storage: StorageBase,
    workspace_manager,
    user_id: str,
    agent_id: str,
    model_cfg: ChatModelConfig,
    kb_ids: list[str],
):
    from agentscope.app.storage import SessionKnowledgeConfig

    session_id = None
    workspace_id = await workspace_manager.assign_workspace_id(
        user_id=user_id, agent_id=agent_id, session_id=_gen_id()
    )
    record = await storage.upsert_session(
        user_id=user_id,
        agent_id=agent_id,
        config=SessionConfig(
            workspace_id=workspace_id,
            chat_model_config=model_cfg,
            knowledge_config=SessionKnowledgeConfig(
                knowledge_base_ids=list(kb_ids)
            ),
        ),
        state=AgentState(),
        session_id=None,
    )
    return record


def _gen_id() -> str:
    from agentscope._utils._common import _generate_id

    return _generate_id()


@mtc_router.post("/session")
async def create_fresh_session(
    body: CreateSessionBody,
    user_id: str = Depends(get_current_user_id),
    storage: StorageBase = Depends(get_storage),
    workspace_manager=Depends(get_workspace_manager),
    access: ResourceAccessService = Depends(get_resource_access_service),
):
    await access.resolve_agent(user_id, body.agent_id)
    record = await _new_session(
        storage,
        workspace_manager,
        user_id,
        body.agent_id,
        body.chat_model_config,
        body.knowledge_base_ids,
    )
    if body.internal_token:
        from .internal_auth import register

        register(record.id, body.internal_token)
    return {"session_id": record.id}


@mtc_router.post("/structured-run")
async def structured_run(
    body: StructuredRunBody,
    user_id: str = Depends(get_current_user_id),
    storage: StorageBase = Depends(get_storage),
    message_bus=Depends(get_message_bus),
    workspace_manager=Depends(get_workspace_manager),
    scheduler_manager=Depends(get_scheduler_manager),
    background_task_manager=Depends(get_background_task_manager),
    access: ResourceAccessService = Depends(get_resource_access_service),
    kb_manager=Depends(get_knowledge_base_manager),
):
    try:
        schema_model = schema_to_model("StructuredOutput", body.schema)
    except SchemaTranslationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    agent_record = await access.resolve_agent(user_id, body.agent_id)
    if agent_record is None:
        raise HTTPException(status_code=404, detail="agent not found")

    if body.session_id:
        session = await storage.get_session(
            user_id, body.agent_id, body.session_id
        )
        if session is None:
            raise HTTPException(status_code=404, detail="session not found")
    else:
        if body.chat_model_config is None:
            raise HTTPException(
                status_code=422,
                detail="chat_model_config required for a new session",
            )
        session = await _new_session(
            storage,
            workspace_manager,
            user_id,
            body.agent_id,
            body.chat_model_config,
            [],
        )

    final = await structured_run_core(
        storage=storage,
        message_bus=message_bus,
        workspace_manager=workspace_manager,
        kb_manager=kb_manager,
        access=access,
        scheduler_manager=scheduler_manager,
        background_task_manager=background_task_manager,
        user_id=user_id,
        agent_record=agent_record,
        session=session,
        text=body.input_text,
        schema=schema_model,
        timeout_seconds=body.timeout_seconds,
        rules_context=body.rules_context,
    )
    if final is None:
        raise HTTPException(500, "structured run produced no final message")
    return {
        "session_id": session.id,
        "structured_output": getattr(final, "structured_output", None),
        "text": (final.get_text_content() or "") if final else "",
    }


class SessionTriple(BaseModel):
    user_id: str
    agent_id: str
    session_id: str


@mtc_router.post("/sessions-status")
async def sessions_status(
    triples: list[SessionTriple],
    storage: StorageBase = Depends(get_storage),
):
    """Batch session status + last-message outcome for board projection.

    The platform board is a read-only projection; it must not guess
    states, so the runtime reports the official session status together
    with the persisted last message's finished reason / error.
    """
    out = []
    for t in triples:
        record = await storage.get_session(t.user_id, t.agent_id, t.session_id)
        if record is None:
            out.append({"session_id": t.session_id, "found": False})
            continue
        messages, _more = await storage.list_messages(t.user_id, t.session_id)
        last = messages[-1] if messages else None
        out.append(
            {
                "session_id": t.session_id,
                "found": True,
                "status": record.status if hasattr(record, "status") else None,
                "updated_at": getattr(record, "updated_at", None)
                or getattr(record, "created_at", None),
                "last_role": last.role if last else None,
                "finished_reason": last.finished_reason if last else None,
                "error": last.error.model_dump(mode="json")
                if getattr(last, "error", None)
                else None,
            }
        )
    return {"sessions": out}


def _ev(kind: str, session_id: str, payload: dict) -> dict:
    from agentscope.event import CustomEvent  # noqa: PLC0415

    return CustomEvent(
        name=f"mtc:{kind}", metadata=payload
    ).model_dump(mode="json")


_EXTRA_FACTORY = None


def bind_extra_factory(factory) -> None:
    global _EXTRA_FACTORY
    _EXTRA_FACTORY = factory


def _extra_factory_from_app():
    return _EXTRA_FACTORY
