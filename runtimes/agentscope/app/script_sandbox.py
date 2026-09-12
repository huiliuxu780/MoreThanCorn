"""WakerFlow 脚本沙箱（16号稿 P1，D1=子进程隔离）。

本模块**只用标准库**，可以脱离 agentscope 运行时独立测试，也可作为普通脚本文件被
父进程直接 spawn（无需包上下文）。

角色与协议
==========
父进程（运行时 /mtc/script-run）spawn 本文件::

    <python> app/script_sandbox.py

并通过 stdin 送入首行 manifest（JSON）::

    {"script": "...", "flow_input": {...}, "deadline_seconds": 600}

之后 stdin 的每一行都是对子进程 RPC 请求的响应；子进程把五原语请求写到 stdout::

    子→父  {"id": 1, "op": "worker|askUser|phase|log", "args": {...}}
    父→子  {"id": 1, "ok": true, "result": ...} | {"id": 1, "ok": false, "error": "..."}
    子→父  {"event": "done", "status": "succeeded|failed", "output": {...}, "error": ""}

脚本契约：模块定义 ``async def run(ctx)``，``ctx.primitives`` 按
``phase, log, worker, askUser, parallel`` 顺序解包（也提供 ``ctx.worker`` 等属性）；
run 返回 dict 即 flow 输出。
"""
from __future__ import annotations

import asyncio
import inspect
import json
import os
import subprocess
import sys
import tempfile
import threading
from typing import Any, Callable

MANIFEST_SIZE_LIMIT = 64 * 1024  # 脚本大小上限（16号稿 §4）


class ScriptError(Exception):
    """脚本契约违规（缺 run/返回非 dict 等），与节点执行失败区分。"""


# ---------------------------------------------------------------------------
# 核心执行器：transport 抽象使五原语语义可脱离真实子进程/hermetic 单测
# ---------------------------------------------------------------------------


class _Ctx:
    """脚本可见的执行上下文；primitives 顺序与 16号稿 §4 契约一致。"""

    def __init__(self, transport: Any) -> None:
        self._t = transport

    async def _call(self, op: str, **args: Any) -> Any:
        return await self._t.call(op, **args)

    async def _phase(self, name: str) -> None:
        await self._call("phase", name=str(name))

    async def _log(self, message: str) -> None:
        await self._call("log", message=str(message))

    async def _worker(
        self,
        prompt: str,
        *,
        schema: dict | None = None,
        waker: str | None = None,
        label: str | None = None,
        phase: str | None = None,
    ) -> Any:
        if not waker:
            raise ScriptError("worker() 需要 waker=<平台 Agent id>")
        return await self._call(
            "worker", prompt=str(prompt), schema=schema, waker=str(waker),
            label=label, phase=phase,
        )

    async def _ask_user(
        self,
        prompt: str,
        *,
        options: list | None = None,
        default: str | None = None,
        label: str | None = None,
        phase: str | None = None,
    ) -> dict:
        r = await self._call(
            "askUser", prompt=str(prompt), options=options, default=default,
            label=label, phase=phase,
        )
        if not isinstance(r, dict):
            r = {"value": r, "skipped": False}
        return {"value": r.get("value"), "skipped": bool(r.get("skipped"))}

    async def _parallel(self, fns: list) -> list:
        """并发扇出；单个子项异常降级为 None，不连坐（16号稿 §5）。"""

        async def _one(fn: Callable) -> Any:
            try:
                res = fn()
                if inspect.isawaitable(res):
                    res = await res
                return res
            except Exception:  # noqa: BLE001 —— 降级是 parallel 的产品语义
                return None

        return list(await asyncio.gather(*[_one(fn) for fn in list(fns)]))

    @property
    def primitives(self) -> tuple:
        return (self._phase, self._log, self._worker, self._ask_user, self._parallel)

    # 属性形态亦可用：ctx.worker(...)
    phase = _phase
    log = _log
    worker = _worker
    askUser = _ask_user
    parallel = _parallel


async def run_script(
    script: str,
    flow_input: dict,
    deadline_seconds: float,
    transport: Any,
) -> dict:
    """在当前事件循环里执行用户脚本（transport 提供五原语的真实实现）。

    契约校验失败抛 ScriptError；脚本内部异常原样上抛（调用方结算 failed）。"""
    if len(script) > MANIFEST_SIZE_LIMIT:
        raise ScriptError(f"script too large: {len(script)} > {MANIFEST_SIZE_LIMIT}")
    ns: dict[str, Any] = {"__name__": "wakerflow_script"}
    try:
        exec(compile(script, "<wakerflow>", "exec"), ns)  # noqa: S102 —— 子进程沙箱内执行（D1）
    except ScriptError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise ScriptError(f"script load failed: {exc!r}") from exc
    run_fn = ns.get("run")
    if run_fn is None or not inspect.iscoroutinefunction(run_fn):
        raise ScriptError("module must define `async def run(ctx)`")
    ctx = _Ctx(transport)
    out = await asyncio.wait_for(run_fn(ctx), timeout=float(deadline_seconds))
    if out is None:
        out = {}
    if not isinstance(out, dict):
        raise ScriptError(f"run() must return a dict, got {type(out).__name__}")
    return out


# ---------------------------------------------------------------------------
# 子进程入口：stdin 首行 manifest → 执行 → done 行
# ---------------------------------------------------------------------------


def _stdin_line_reader(loop: asyncio.AbstractEventLoop, sink: asyncio.Queue) -> None:
    """后台线程：逐行读 stdin（RPC 响应），投递到事件循环队列。"""

    def _pump() -> None:
        try:
            for line in sys.stdin:
                line = line.strip()
                if not line:
                    continue
                loop.call_soon_threadsafe(sink.put_nowait, line)
        except Exception:  # noqa: BLE001 —— 父进程关闭管道等，静默收尾
            pass

    threading.Thread(target=_pump, daemon=True).start()


class _StdioTransport:
    """把五原语请求写到 stdout，等待父进程在 stdin 上的响应行。"""

    def __init__(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop
        self._pending: dict[int, asyncio.Future] = {}
        self._next_id = 0
        self._queue: asyncio.Queue = asyncio.Queue()
        _stdin_line_reader(loop, self._queue)

    def feed(self, line: str) -> None:
        msg = json.loads(line)
        fut = self._pending.pop(msg.get("id"), None)
        if fut is not None and not fut.done():
            if msg.get("ok"):
                fut.set_result(msg.get("result"))
            else:
                fut.set_exception(RuntimeError(str(msg.get("error", "rpc failed"))))

    async def call(self, op: str, **args: Any) -> Any:
        self._next_id += 1
        rid = self._next_id
        fut: asyncio.Future = self._loop.create_future()
        self._pending[rid] = fut
        sys.stdout.write(
            json.dumps({"id": rid, "op": op, "args": args}, ensure_ascii=False, default=str)
            + "\n"
        )
        sys.stdout.flush()
        return await fut


def main() -> int:
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    manifest_line = sys.stdin.readline()
    try:
        manifest = json.loads(manifest_line)
    except json.JSONDecodeError:
        print(json.dumps({"event": "done", "status": "failed",
                          "output": {}, "error": "bad manifest line"}))
        return 2
    transport = _StdioTransport(loop)

    async def _drive() -> dict:
        # 消费响应行 → transport.feed（与 run_script 并发）
        async def _feed_loop() -> None:
            while True:
                line = await transport._queue.get()
                transport.feed(line)

        feeder = asyncio.ensure_future(_feed_loop())
        try:
            output = await run_script(
                manifest.get("script", ""),
                manifest.get("flow_input") or {},
                float(manifest.get("deadline_seconds", 600)),
                transport,
            )
        finally:
            feeder.cancel()
        return output

    try:
        output = loop.run_until_complete(_drive())
        status, error = "succeeded", ""
    except Exception as exc:  # noqa: BLE001 —— 任何失败都以 done 行结算
        output, status, error = {}, "failed", repr(exc)
    sys.stdout.write(
        json.dumps({"event": "done", "status": status, "output": output, "error": error},
                   ensure_ascii=False, default=str)
        + "\n"
    )
    sys.stdout.flush()
    return 0 if status == "succeeded" else 1


# ---------------------------------------------------------------------------
# 父进程侧 spawn 工具（stdlib-only，运行时与测试共用）
# ---------------------------------------------------------------------------


def spawn_sandbox(
    manifest: dict,
    *,
    on_line: Callable[[str], None],
    on_exit: Callable[[int], None] | None = None,
    python: str | None = None,
    deadline_seconds: float = 600.0,
    memory_bytes: int = 2 * 1024 ** 3,
    cpu_seconds: int = 600,
) -> subprocess.Popen:
    """spawn 沙箱子进程（16号稿 §8 加固清单 1/2）。

    - 最小 env：不继承父进程任何变量（平台凭据/LLM key/DB URL 断言由测试覆盖）；
    - rlimits：CPU/AS/NOFILE；cwd=临时目录；脚本文件路径直接作为入口（无需包上下文）。
    stdout 每行回调 on_line；进程退出回调 on_exit(returncode)。stderr 由调用方合并读取。
    """
    manifest = {**manifest, "deadline_seconds": deadline_seconds}
    sandbox_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "script_sandbox.py")

    def _preexec() -> None:  # 子进程内执行：资源限额
        try:
            import resource

            resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds))
            resource.setrlimit(resource.RLIMIT_AS, (memory_bytes, memory_bytes))
            resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
        except Exception:  # noqa: BLE001 —— 平台不支持某项限额时降级，不阻断
            pass

    env = {"LANG": "C.UTF-8", "HOME": tempfile.mkdtemp(prefix="mtc-sandbox-")}
    proc = subprocess.Popen(
        [python or sys.executable, sandbox_file],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
        cwd=tempfile.mkdtemp(prefix="mtc-sandbox-cwd-"),
        preexec_fn=_preexec,
        text=True,
        bufsize=1,
    )
    assert proc.stdin is not None and proc.stdout is not None
    proc.stdin.write(json.dumps(manifest, ensure_ascii=False, default=str) + "\n")
    proc.stdin.flush()

    def _pump() -> None:
        try:
            for line in proc.stdout:  # type: ignore[union-attr]
                on_line(line.rstrip("\n"))
        except Exception:  # noqa: BLE001
            pass
        code = proc.wait()
        if on_exit is not None:
            on_exit(code)

    threading.Thread(target=_pump, daemon=True).start()
    return proc


if __name__ == "__main__":
    raise SystemExit(main())
