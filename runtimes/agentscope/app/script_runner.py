"""脚本编排运行时端点（16号稿 P1）。

POST /mtc/script-run (SSE)：spawn 沙箱子进程（app/script_sandbox.py，stdlib-only），
把五原语 RPC 分派到与 DAG 形态同源的节点执行件（Session/结构化输出/internal token
注册全部复用），并按 DAG 形状向平台发事件：

- ``stage:{label}`` start（携带 session_id/agent_id）/ end（status/output/error）
  —— 平台 F0 增量落库零改动消费；
- ``phase`` / ``log`` —— 观测事件（平台透传）；
- ``flow:complete`` —— 终态。

沙箱加固见 16号稿 §8：最小 env、rlimits、一次性执行（无持久通道）、deadline SIGKILL。
askUser 在 P2 接入（当前 RPC 返回错误，脚本会以失败结算——诚实行为）。
"""
from __future__ import annotations

import asyncio
import json
import threading
from typing import Any, AsyncGenerator

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from agentscope.app.deps import (
    get_background_task_manager,
    get_chat_service,
    get_knowledge_base_manager,
    get_resource_access_service,
    get_scheduler_manager,
    get_storage,
    get_workspace_manager,
)
from agentscope.app.storage import SessionConfig, SessionKnowledgeConfig
from agentscope.state import AgentState

from .flow_runner import _detect_chat_error
from .mtc_router import structured_run_core
from .schema_tools import schema_to_model
from .script_sandbox import spawn_sandbox

script_router = APIRouter(prefix="/mtc", tags=["mtc-script"])

DEFAULT_DEADLINE_SECONDS = 600.0


class WakerBinding(BaseModel):
    runtime_agent_id: str
    chat_model_config: dict
    knowledge_ids: list[str] = Field(default_factory=list)


class ScriptRunBody(BaseModel):
    user_id: str
    script: str
    # 平台预解析的 waker 绑定（16号稿 §6）：script 中出现的每个 waker id 必须在列
    wakers: dict[str, WakerBinding] = Field(default_factory=dict)
    flow_input: dict = Field(default_factory=dict)
    internal_token: str | None = None
    agentflow_run_id: str | None = None
    deadline_seconds: float = DEFAULT_DEADLINE_SECONDS


def _rpc_response(rid: int, result: Any) -> str:
    return json.dumps({"id": rid, "ok": True, "result": result}, ensure_ascii=False, default=str)


def _rpc_error(rid: int, error: str) -> str:
    return json.dumps({"id": rid, "ok": False, "error": error}, ensure_ascii=False)


@script_router.post("/script-run")
async def script_run(
    body: ScriptRunBody,
    chat_service=Depends(get_chat_service),
    storage=Depends(get_storage),
    workspace_manager=Depends(get_workspace_manager),
    kb_manager=Depends(get_knowledge_base_manager),
    access=Depends(get_resource_access_service),
    scheduler_manager=Depends(get_scheduler_manager),
    background_task_manager=Depends(get_background_task_manager),
):
    """执行脚本沙箱：事件按 DAG 形状流式返回（16号稿 §6）。"""

    async def event_generator() -> AsyncGenerator[str, None]:
        queue: asyncio.Queue = asyncio.Queue()
        loop = asyncio.get_running_loop()
        proc_holder: dict[str, Any] = {}
        stderr_tail: list[str] = []
        finished = False

        def emit(event: dict) -> None:
            queue.put_nowait(("event", event))

        def emit_line(line: str) -> None:
            line = line.strip()
            if not line:
                return
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                return

            def _handle() -> None:
                if "event" in msg:  # done 行
                    _finish_from_done(msg)
                elif "op" in msg:
                    asyncio.ensure_future(_dispatch(msg))

            loop.call_soon_threadsafe(_handle)

        def _finish_from_done(msg: dict) -> None:
            nonlocal finished
            if finished:
                return
            finished = True
            emit({
                "event": "flow:complete",
                "data": {
                    "status": msg.get("status", "failed"),
                    "output": msg.get("output") or {},
                    "nodes": [],
                    "error": msg.get("error", ""),
                },
            })
            queue.put_nowait(("stop", None))

        async def _new_session(waker_id: str, binding: WakerBinding):
            workspace_id = await workspace_manager.assign_workspace_id(
                user_id=body.user_id, agent_id=binding.runtime_agent_id, session_id=None
            )
            session = await storage.upsert_session(
                user_id=body.user_id,
                agent_id=binding.runtime_agent_id,
                config=SessionConfig(
                    workspace_id=workspace_id,
                    chat_model_config=binding.chat_model_config,
                    knowledge_config=SessionKnowledgeConfig(
                        knowledge_base_ids=list(binding.knowledge_ids or [])
                    ),
                ),
                state=AgentState(),
            )
            if body.internal_token:
                from .internal_auth import register

                register(session.id, body.internal_token)
            return session

        async def _exec_worker(msg: dict) -> None:
            rid = msg["id"]
            args = msg.get("args") or {}
            waker_id = str(args.get("waker") or "")
            binding = body.wakers.get(waker_id)
            if binding is None:
                proc_holder["proc"].stdin.write(
                    _rpc_error(rid, f"waker {waker_id} not declared in bindings")
                )
                proc_holder["proc"].stdin.flush()
                return
            label = str(args.get("label") or f"w{rid}")
            phase_name = args.get("phase")
            prompt = str(args.get("prompt") or "")
            schema = args.get("schema")
            status, out, error = "succeeded", None, ""
            try:
                session = await _new_session(waker_id, binding)
                emit({
                    "event": f"stage:{label}",
                    "data": {"phase": "start", "session_id": session.id,
                             "agent_id": waker_id,
                             "runtime_agent_id": binding.runtime_agent_id},
                })
                agent_record = await storage.get_agent(body.user_id, binding.runtime_agent_id)
                if schema:
                    schema_model = schema_to_model(f"{label}_output", schema)
                    final = await structured_run_core(
                        storage=storage,
                        message_bus=chat_service._message_bus,
                        workspace_manager=workspace_manager,
                        kb_manager=kb_manager,
                        access=access,
                        scheduler_manager=scheduler_manager,
                        background_task_manager=background_task_manager,
                        user_id=body.user_id,
                        agent_record=agent_record,
                        session=session,
                        text=prompt,
                        schema=schema_model,
                    )
                    msgs, _ = await storage.list_messages(body.user_id, session.id)
                    error, status, out = _detect_chat_error(msgs)
                    if not out and final is not None:
                        out = final.structured_output or {}
                else:
                    from agentscope.message import Msg, TextBlock

                    await chat_service.run(
                        body.user_id,
                        session.id,
                        binding.runtime_agent_id,
                        Msg(name="flow", role="user",
                            content=[TextBlock(type="text", text=prompt)]),
                    )
                    msgs, _ = await storage.list_messages(body.user_id, session.id)
                    error, status, out = _detect_chat_error(msgs)
            except Exception as exc:  # noqa: BLE001 —— 节点失败结算为 end(failed)
                status, out, error = "failed", None, repr(exc)
            emit({
                "event": f"stage:{label}",
                "data": {"phase": "end", "status": status,
                         "output": out if isinstance(out, dict) else (
                             {"text": out} if out is not None else None),
                         "error": error},
            })
            if status == "succeeded":
                proc_holder["proc"].stdin.write(_rpc_response(rid, out))
            else:
                proc_holder["proc"].stdin.write(
                    _rpc_error(rid, error or f"worker {label} failed"))
            proc_holder["proc"].stdin.flush()

        async def _dispatch(msg: dict) -> None:
            op = msg.get("op")
            rid = msg.get("id")
            if op == "worker":
                await _exec_worker(msg)
            elif op == "phase":
                emit({"event": "phase",
                      "data": {"name": (msg.get("args") or {}).get("name", "")}})
                proc_holder["proc"].stdin.write(_rpc_response(rid, True))
                proc_holder["proc"].stdin.flush()
            elif op == "log":
                emit({"event": "log",
                      "data": {"message": (msg.get("args") or {}).get("message", "")}})
                proc_holder["proc"].stdin.write(_rpc_response(rid, True))
                proc_holder["proc"].stdin.flush()
            else:
                proc_holder["proc"].stdin.write(
                    _rpc_error(rid, f"op {op} not supported (askUser lands in P2)"))
                proc_holder["proc"].stdin.flush()

        def _on_exit(code: int) -> None:
            def _handle() -> None:
                if not finished:
                    finished = True
                    emit({
                        "event": "flow:complete",
                        "data": {"status": "failed", "output": {},
                                 "error": f"sandbox exited rc={code} "
                                          f"stderr={''.join(stderr_tail)[-800:]}"},
                    })
                    queue.put_nowait(("stop", None))

            loop.call_soon_threadsafe(_handle)

        proc_holder["proc"] = spawn_sandbox(
            {
                "script": body.script,
                "flow_input": body.flow_input,
            },
            on_line=emit_line,
            on_exit=_on_exit,
            deadline_seconds=body.deadline_seconds,
        )

        def _drain_stderr() -> None:
            try:
                for line in proc_holder["proc"].stderr:  # type: ignore[union-attr]
                    stderr_tail.append(line)
                    del stderr_tail[:-50]
            except Exception:  # noqa: BLE001
                pass

        threading.Thread(target=_drain_stderr, daemon=True).start()

        async def _deadline_watchdog() -> None:
            await asyncio.sleep(body.deadline_seconds + 5.0)
            if not finished:
                try:
                    proc_holder["proc"].kill()
                except Exception:  # noqa: BLE001
                    pass

        watchdog = asyncio.ensure_future(_deadline_watchdog())
        try:
            while True:
                kind, payload = await queue.get()
                if kind == "stop":
                    break
                yield (
                    "data: "
                    + json.dumps(payload, ensure_ascii=False, default=str)
                    + "\n\n"
                )
        finally:
            watchdog.cancel()
            try:
                if proc_holder["proc"].poll() is None:
                    proc_holder["proc"].kill()
            except Exception:  # noqa: BLE001
                pass

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
