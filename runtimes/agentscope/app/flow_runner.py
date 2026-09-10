"""AgentFlow 运行时执行（审核 P0-1）：官方 PipelineProtocol 实现。

- 节点执行 = 官方原语：文本节点 await ChatService.run（官方 Session 执行/持久化/事件）；
  结构化节点 = structured_run_core（官方 get_model/get_toolkit/RAG + reply_stream(structured_schema)）。
- 流水线对象实现官方 ``PipelineProtocol.reply_stream``，产出官方 AgentEvent/CustomEvent。
- ``goal`` 型节点直接使用官方 ``GoalPipeline``（executor/verifier 循环）。
- 平台仅保留控制面记录与重跑决策；本模块不做轮询、不做 sleep、不自造状态机。
"""
from __future__ import annotations

import json
import re
from typing import Any, AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from agentscope.agent import Agent
from agentscope.app._service._model import get_model
from agentscope.app._service._toolkit import get_toolkit
from agentscope.app.deps import (
    get_background_task_manager,
    get_chat_service,
    get_knowledge_base_manager,
    get_message_bus,
    get_resource_access_service,
    get_scheduler_manager,
    get_storage,
    get_workspace_manager,
)
from agentscope.app.storage import SessionConfig, SessionKnowledgeConfig
from agentscope.state import AgentState
from agentscope.event import CustomEvent
from agentscope.message import Msg, TextBlock
from agentscope.pipeline import GoalPipeline, PipelineProtocol

from .mtc_router import structured_run_core
from .schema_tools import schema_to_model

flow_router = APIRouter(prefix="/mtc", tags=["mtc-flow"])


def _detect_chat_error(msgs: list) -> tuple[str, str, str]:
    """P0-3: 从 AgentScope 消息列表检测实际执行错误。

    ChatService.run 捕获内部异常不向上抛，而是将错误信息写入消息
    的 error 属性或 finished_reason。此函数提取这些信号。

    Returns:
        (error, status, output_text)
    """
    assistants = [m for m in msgs if m.role == "assistant"]
    error = ""
    status = "succeeded"
    out = ""
    if assistants:
        last = assistants[-1]
        msg_error = getattr(last, "error", None)
        fr = last.finished_reason or ""
        if msg_error or fr in ("error", "interrupted", "cancelled"):
            status = "failed"
            error = str(msg_error or fr)
        else:
            out = "".join(
                b.get("text", "")
                for b in (last.content or [])
                if isinstance(b, dict) and b.get("type") == "text"
            )
    else:
        status = "failed"
        error = "no assistant reply produced"
    return error, status, out


class FlowNodeSpec(BaseModel):
    id: str
    agent_id: str
    prompt_template: str = ""
    structured_schema: dict | None = None
    chat_model_config: dict
    knowledge_ids: list[str] = Field(default_factory=list)


class FlowGoalSpec(BaseModel):
    executor_agent_id: str
    verifier_agent_id: str
    goal_text: str
    chat_model_config: dict


class FlowRunBody(BaseModel):
    user_id: str
    nodes: list[FlowNodeSpec] = Field(default_factory=list)
    edges: list[dict] = Field(default_factory=list)
    flow_input: dict = Field(default_factory=dict)
    goal: FlowGoalSpec | None = None
    # P0-08: platform-minted per-flow-run internal Tool callback token;
    # registered for every node session this run creates
    internal_token: str | None = None
    agentflow_run_id: str | None = None


def _render(template: str, ctx: dict[str, Any]) -> str:
    def repl(m: re.Match) -> str:
        key = m.group(1)
        val = ctx.get(key)
        if val is None:
            return m.group(0)
        return val if isinstance(val, str) else json.dumps(val, ensure_ascii=False)

    return re.sub(r"\{\{(\w+)\}\}", repl, template or "")


def _topo(nodes: list[FlowNodeSpec], edges: list[dict]) -> list[str]:
    ids = [n.id for n in nodes]
    indeg = {i: 0 for i in ids}
    adj: dict[str, list[str]] = {i: [] for i in ids}
    for e in edges:
        if e.get("from") in adj and e.get("to") in indeg:
            adj[e["from"]].append(e["to"])
            indeg[e["to"]] += 1
    queue = [i for i in ids if indeg[i] == 0]
    order: list[str] = []
    while queue:
        cur = queue.pop(0)
        order.append(cur)
        for nxt in adj[cur]:
            indeg[nxt] -= 1
            if indeg[nxt] == 0:
                queue.append(nxt)
    if len(order) != len(ids):
        raise ValueError("flow graph has a cycle")
    return order


class AgentFlowPipeline:
    """官方 PipelineProtocol 实现：顺序/拓扑节点 = 官方 Agent 执行原语。"""

    def __init__(
        self,
        *,
        chat_service,
        storage,
        workspace_manager,
        kb_manager,
        access,
        scheduler_manager,
        background_task_manager,
        user_id: str,
        nodes: list[FlowNodeSpec],
        edges: list[dict],
        flow_input: dict,
        goal: FlowGoalSpec | None = None,
        internal_token: str | None = None,
    ) -> None:
        self._chat = chat_service
        self._storage = storage
        self._wm = workspace_manager
        self._kb = kb_manager
        self._access = access
        self._sched = scheduler_manager
        self._bg = background_task_manager
        self.user_id = user_id
        self.nodes = {n.id: n for n in nodes}
        self.order = _topo(nodes, edges) if nodes else []
        self.flow_input = flow_input
        self.goal = goal
        self._internal_token = internal_token
        self.results: list[dict] = []
        self.outputs: dict[str, Any] = {}

    def reply_stream(
        self,
        inputs: Msg | list[Msg] | Any = None,
    ) -> AsyncGenerator[Any, None]:
        return self._stream()

    async def _assemble_agent(self, agent_id: str, model_cfg: dict, session):
        agent_record = await self._storage.get_agent(self.user_id, agent_id)
        workspace = await self._wm.get_workspace(
            self.user_id, agent_id, session.id, session.config.workspace_id
        )
        model = await get_model(self.user_id, session.config.chat_model_config, self._access)
        toolkit = await get_toolkit(
            storage=self._storage,
            workspace=workspace,
            workspace_manager=self._wm,
            scheduler_manager=self._sched,
            background_task_manager=self._bg,
            message_bus=self._chat._message_bus,
            middlewares=[],
            user_id=self.user_id,
            agent_record=agent_record,
            session_record=session,
            resource_access_service=self._access,
        )
        return agent_record, Agent(
            name=agent_record.id,
            system_prompt=agent_record.data.system_prompt,
            model=model,
            toolkit=toolkit,
            state=session.state or AgentState(),
            offloader=workspace,
            react_config=agent_record.data.react_config,
            context_config=agent_record.data.context_config,
        )

    async def _new_session(self, node: FlowNodeSpec):
        workspace_id = await self._wm.assign_workspace_id(
            user_id=self.user_id, agent_id=node.agent_id, session_id=None
        )
        session = await self._storage.upsert_session(
            user_id=self.user_id,
            agent_id=node.agent_id,
            config=SessionConfig(
                workspace_id=workspace_id,
                chat_model_config=node.chat_model_config,
                knowledge_config=SessionKnowledgeConfig(
                    knowledge_base_ids=list(node.knowledge_ids or [])
                ),
            ),
            state=AgentState(),
        )
        if self._internal_token:
            # P0-08: node sessions inherit the flow-run callback token so
            # platform Tools invoked from this run are bound to it
            from .internal_auth import register

            register(session.id, self._internal_token)
        return session

    async def _stream(self) -> AsyncGenerator[Any, None]:
        # goal 型：官方 GoalPipeline
        if self.goal is not None:
            g = self.goal
            exec_session = await self._new_session(
                FlowNodeSpec(
                    id="goal-executor",
                    agent_id=g.executor_agent_id,
                    chat_model_config=g.chat_model_config,
                )
            )
            ver_session = await self._new_session(
                FlowNodeSpec(
                    id="goal-verifier",
                    agent_id=g.verifier_agent_id,
                    chat_model_config=g.chat_model_config,
                )
            )
            _, executor = await self._assemble_agent(
                g.executor_agent_id, g.chat_model_config, exec_session
            )
            _, verifier = await self._assemble_agent(
                g.verifier_agent_id, g.chat_model_config, ver_session
            )
            gp = GoalPipeline(executor=executor, verifier=verifier)
            final = None
            async for ev in gp.reply_stream(
                Msg(
                    name="flow",
                    role="user",
                    content=[TextBlock(type="text", text=g.goal_text)],
                )
            ):
                if isinstance(ev, Msg):
                    final = ev
            self.results.append(
                {
                    "id": "goal",
                    "session_id": exec_session.id,
                    "status": "succeeded" if final else "failed",
                    "output": (final.get_text_content() if final else ""),
                    "error": "",
                }
            )
            self.outputs["goal"] = (final.get_text_content() if final else "")
            yield CustomEvent(
                name="stage:goal",
                metadata={"phase": "end", "session_id": exec_session.id},
            )
            yield Msg(
                name="flow",
                role="assistant",
                content=[TextBlock(text=json.dumps(self.outputs, ensure_ascii=False))],
            )
            return

        for nid in self.order:
            node = self.nodes[nid]
            yield CustomEvent(name=f"stage:{nid}", metadata={"phase": "start"})
            session = await self._new_session(node)
            rendered = _render(node.prompt_template, {**self.flow_input, **self.outputs})
            error, status = "", "succeeded"
            try:
                if node.structured_schema:
                    agent_record = await self._storage.get_agent(
                        self.user_id, node.agent_id
                    )
                    schema_model = schema_to_model(f"{nid}_output", node.structured_schema)
                    final = await structured_run_core(
                        storage=self._storage,
                        message_bus=self._chat._message_bus,
                        workspace_manager=self._wm,
                        kb_manager=self._kb,
                        access=self._access,
                        scheduler_manager=self._sched,
                        background_task_manager=self._bg,
                        user_id=self.user_id,
                        agent_record=agent_record,
                        session=session,
                        text=rendered,
                        schema=schema_model,
                    )
                    if final is None:
                        status = "failed"
                        error = "structured_run timed out or returned no message"
                        out = {}
                    else:
                        # P0-3: structured_run_core 捕获内部异常不向上抛，必须检查消息的错误状态
                        msgs, _ = await self._storage.list_messages(
                            self.user_id, session.id
                        )
                        error, status, out = _detect_chat_error(msgs)
                        if not out:
                            out = (final.structured_output if final else None) or {}
                else:
                    await self._chat.run(
                        self.user_id,
                        session.id,
                        node.agent_id,
                        Msg(
                            name="flow",
                            role="user",
                            content=[TextBlock(type="text", text=rendered)],
                        ),
                    )
                    msgs, _ = await self._storage.list_messages(
                        self.user_id, session.id
                    )
                    # P0-3: ChatService.run 捕获内部异常不向上抛，必须检查消息的错误状态
                    error, status, out = _detect_chat_error(msgs)
                self.outputs[nid] = out
                self.results.append(
                    {
                        "id": nid,
                        "session_id": session.id,
                        "status": status,
                        "output": out,
                        "error": error,
                    }
                )
                yield CustomEvent(
                    name=f"stage:{nid}",
                    metadata={
                        "phase": "end",
                        "session_id": session.id,
                        "status": status,
                        "error": error,
                    },
                )
            except Exception as exc:  # noqa: BLE001
                self.results.append(
                    {
                        "id": nid,
                        "session_id": session.id,
                        "status": "failed",
                        "output": None,
                        "error": repr(exc),
                    }
                )
                yield CustomEvent(
                    name=f"stage:{nid}",
                    metadata={
                        "phase": "end",
                        "session_id": session.id,
                        "status": "failed",
                        "error": repr(exc),
                    },
                )
                return
        yield Msg(
            name="flow",
            role="assistant",
            content=[TextBlock(text=json.dumps(self.outputs, ensure_ascii=False))],
        )


@flow_router.post("/flow-run")
async def flow_run(
    body: FlowRunBody,
    chat_service=Depends(get_chat_service),
    storage=Depends(get_storage),
    workspace_manager=Depends(get_workspace_manager),
    kb_manager=Depends(get_knowledge_base_manager),
    access=Depends(get_resource_access_service),
    scheduler_manager=Depends(get_scheduler_manager),
    background_task_manager=Depends(get_background_task_manager),
):
    pipeline = AgentFlowPipeline(
        chat_service=chat_service,
        storage=storage,
        workspace_manager=workspace_manager,
        kb_manager=kb_manager,
        access=access,
        scheduler_manager=scheduler_manager,
        background_task_manager=background_task_manager,
        user_id=body.user_id,
        nodes=body.nodes,
        edges=body.edges,
        flow_input=body.flow_input,
        goal=body.goal,
        internal_token=body.internal_token,
    )
    # PipelineProtocol 非 runtime_checkable：以结构（reply_stream 可调用）校验
    if not callable(getattr(pipeline, "reply_stream", None)):
        raise HTTPException(500, "pipeline does not satisfy PipelineProtocol")
    # P0-3: 不再丢弃 Pipeline 事件；收集 stage 事件供调用方观测
    stages: list[dict] = []
    async for ev in pipeline.reply_stream(None):
        if isinstance(ev, CustomEvent) and (ev.name or "").startswith("stage:"):
            stages.append({"name": ev.name, "metadata": ev.metadata})
    failed = [r for r in pipeline.results if r["status"] == "failed"]
    return {
        "status": "failed" if failed else "succeeded",
        "output": pipeline.outputs,
        "nodes": pipeline.results,
        "events": stages,
    }


@flow_router.post("/flows/run/stream")
async def flow_run_sse(
    body: FlowRunBody,
    chat_service=Depends(get_chat_service),
    storage=Depends(get_storage),
    workspace_manager=Depends(get_workspace_manager),
    kb_manager=Depends(get_knowledge_base_manager),
    access=Depends(get_resource_access_service),
    scheduler_manager=Depends(get_scheduler_manager),
    background_task_manager=Depends(get_background_task_manager),
):
    """P0-7: SSE streaming endpoint — stages are streamed as they complete
    rather than collected into a final JSON array."""

    pipeline = AgentFlowPipeline(
        chat_service=chat_service,
        storage=storage,
        workspace_manager=workspace_manager,
        kb_manager=kb_manager,
        access=access,
        scheduler_manager=scheduler_manager,
        background_task_manager=background_task_manager,
        user_id=body.user_id,
        nodes=body.nodes,
        edges=body.edges,
        flow_input=body.flow_input,
        goal=body.goal,
        internal_token=body.internal_token,
    )
    if not callable(getattr(pipeline, "reply_stream", None)):
        raise HTTPException(500, "pipeline does not satisfy PipelineProtocol")

    async def event_generator():
        async for ev in pipeline.reply_stream(None):
            if isinstance(ev, CustomEvent) and (ev.name or "").startswith("stage:"):
                payload = json.dumps(
                    {"event": ev.name, "data": ev.metadata}, ensure_ascii=False
                )
                yield f"data: {payload}\n\n"
            elif isinstance(ev, Msg):
                # final aggregation message
                pass
        # terminal event with results
        failed = [r for r in pipeline.results if r["status"] == "failed"]
        final = json.dumps(
            {
                "event": "flow:complete",
                "data": {
                    "status": "failed" if failed else "succeeded",
                    "output": pipeline.outputs,
                    "nodes": pipeline.results,
                },
            },
            ensure_ascii=False,
        )
        yield f"data: {final}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
