"""脚本编排运行时端点（16号稿 P1/P2）。

诊断日志走 stderr（uvicorn nohup 日志可见）：[script-run] 前缀。

POST /mtc/script-run (SSE)：spawn 沙箱子进程（app/script_sandbox.py，stdlib-only），
把五原语 RPC 分派到与 DAG 形态同源的节点执行件（Session/结构化输出/internal token
注册全部复用），并按 DAG 形状向平台发事件：

- ``stage:{label}`` start（携带 session_id/agent_id）/ end（status/output/error）
  —— 平台 F0 增量落库零改动消费；
- ``phase`` / ``log`` —— 观测事件（平台透传）；
- ``needs_input`` —— askUser 挂起（P2）：平台落 waiting 节点并弹确认卡，
  经 POST /mtc/script-resume 恢复；
- ``flow:complete`` —— 终态。

沙箱加固见 16号稿 §8：最小 env、rlimits、一次性执行（无持久通道）、deadline SIGKILL。
"""
from __future__ import annotations

import asyncio
import json
import sys
import threading
import uuid
from typing import Any, AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException
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

# P2：askUser 挂起表 (agentflow_run_id, request_id) → Future；进程内存活，
# run 结束/崩溃时统一按 skipped 结算（waiting 不跨进程持久——16号稿 §7 已知边界）。
_PENDING_INPUTS: dict[tuple[str, str], asyncio.Future] = {}

# P5 冒烟实证：并行 worker 并发 _new_session 会在 AgentScope app 内挂死（主线程空转等 IO，
# start 事件永不产出；单 worker 正常）。worker 执行暂以信号量串行化——parallel 聚合语义
# 不变，时间上暂不重叠；放开前须完成 AgentScope 存储并发验证（16号稿 §17 已登记）。
_WORKER_GATE = asyncio.Semaphore(1)


class ScriptResumeBody(BaseModel):
    agentflow_run_id: str
    request_id: str
    value: Any = None
    skipped: bool = False


@script_router.post("/script-resume")
async def script_resume(body: ScriptResumeBody):
    """平台把用户答复写回挂起的 askUser（P2/AC-S3）。"""
    key = (body.agentflow_run_id, body.request_id)
    fut = _PENDING_INPUTS.get(key)
    if fut is None or fut.done():
        raise HTTPException(404, "no pending input for this request")
    fut.set_result({"value": body.value, "skipped": bool(body.skipped)})
    return {"ok": True}


def _settle_run_inputs(agentflow_run_id: str) -> None:
    """run 结束/子进程死亡时，把该 run 全部挂起输入按 skipped 结算并清表。"""
    for key in [k for k in _PENDING_INPUTS if k[0] == agentflow_run_id]:
        fut = _PENDING_INPUTS.pop(key)
        if not fut.done():
            fut.set_result({"value": None, "skipped": True})


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
            print(f"[script-run] child line: {line[:160]}", file=sys.stderr, flush=True)
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
            print(f"[script-run] exec_worker enter id={msg.get('id')}", file=sys.stderr, flush=True)
            async with _WORKER_GATE:
                print(f"[script-run] gate acquired id={msg.get('id')}", file=sys.stderr, flush=True)
                rid = msg["id"]
                args = msg.get("args") or {}
                waker_id = str(args.get("waker") or "")
                binding = body.wakers.get(waker_id)
                if binding is None:
                    proc_holder["handle"].respond(
                        _rpc_error(rid, f"waker {waker_id} not declared in bindings"))
                    return
                label = str(args.get("label") or f"w{rid}")
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
                try:
                    if status == "succeeded":
                        resp = _rpc_response(rid, out)
                    else:
                        resp = _rpc_error(rid, error or f"worker {label} failed")
                    print(f"[script-run] rpc response id={rid} len={len(resp)}",
                          file=sys.stderr, flush=True)
                    proc_holder["handle"].respond(resp)
                except Exception:  # noqa: BLE001 —— 响应写失败必须留痕（否则子进程永久等待）
                    import traceback

                    print(f"[script-run] rpc response FAILED id={rid}\n"
                          + traceback.format_exc(), file=sys.stderr, flush=True)

        async def _dispatch(msg: dict) -> None:
            op = msg.get("op")
            rid = msg.get("id")
            if op == "worker":
                await _exec_worker(msg)
            elif op == "phase":
                emit({"event": "phase",
                      "data": {"name": (msg.get("args") or {}).get("name", "")}})
                proc_holder["handle"].respond(_rpc_response(rid, True))
            elif op == "log":
                emit({"event": "log",
                      "data": {"message": (msg.get("args") or {}).get("message", "")}})
                proc_holder["handle"].respond(_rpc_response(rid, True))
            elif op == "askUser":
                # P2/AC-S3：挂起等待人工答复；needs_input 事件让平台落 waiting 节点，
                # 答复经 /mtc/script-resume 写回 Future 后脚本继续。
                args = msg.get("args") or {}
                request_id = f"inp-{uuid.uuid4().hex[:12]}"
                label = str(args.get("label") or f"input-{rid}")
                fut: asyncio.Future = loop.create_future()
                _PENDING_INPUTS[(body.agentflow_run_id or "", request_id)] = fut
                emit({
                    "event": "needs_input",
                    "data": {"request_id": request_id, "label": label,
                             "prompt": str(args.get("prompt") or ""),
                             "options": args.get("options") or [],
                             "default": args.get("default"),
                             "phase": args.get("phase")},
                })
                result = await fut
                emit({
                    "event": f"stage:{label}",
                    "data": {"phase": "end", "status": "succeeded",
                             "output": {"value": result.get("value"),
                                        "skipped": bool(result.get("skipped"))},
                             "error": ""},
                })
                proc_holder["handle"].respond(_rpc_response(rid, result))
            else:
                proc_holder["handle"].respond(
                    _rpc_error(rid, f"op {op} not supported"))

        def _on_exit(code: int) -> None:
            def _handle() -> None:
                nonlocal finished
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

        proc_holder["handle"] = spawn_sandbox(
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
                for line in proc_holder["handle"].proc.stderr:  # type: ignore[union-attr]
                    stderr_tail.append(line)
                    del stderr_tail[:-50]
                    print(f"[sandbox-stderr] {line.rstrip()[:200]}", file=sys.stderr, flush=True)
            except Exception:  # noqa: BLE001
                pass

        threading.Thread(target=_drain_stderr, daemon=True).start()

        async def _deadline_watchdog() -> None:
            await asyncio.sleep(body.deadline_seconds + 5.0)
            if not finished:
                try:
                    proc_holder["handle"].kill()
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
            _settle_run_inputs(body.agentflow_run_id or "")
            try:
                if proc_holder["handle"].poll() is None:
                    proc_holder["handle"].kill()
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
