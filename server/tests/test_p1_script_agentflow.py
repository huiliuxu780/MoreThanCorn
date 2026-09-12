"""P1 脚本编排回归（2026-09-12，16号稿 docs/v2-design/16-wakerflow-script-agentflow.md）。

三层验证：
1. 沙箱子进程五原语语义（stub 传输层，hermetic）：串行 / parallel 降级 / for+askUser 循环 /
   契约校验负向；
2. 真实子进程（spawn_sandbox，stdlib-only 可在 server venv 跑）：done 结算 / RPC 往返 /
   deadline 自超时 / 崩溃结算 / env 无平台凭据（AC-S4 部分）；
3. 平台 kind=script 分支（F0 探针法）：版本保存契约校验、run-now queued、
   start 事件 agent_id/runtime_agent_id 落 NodeRun/SessionIndex、终态结算。

真实运行时（8301）/mtc/script-run 的跨栈冒烟属 live 栈（P5，须额度批准），不在本文件。
"""
from __future__ import annotations

import asyncio
import importlib.util
import json
import time
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import agentscope_client as rt
from app.agentflow_executor import build_script_body, scan_script_wakers, script_projection
from app.db import SessionLocal
from app.main import app
from app.models import (
    AgentFlowNodeRun,
    AgentFlowRelease,
    AgentFlowRun,
    AgentSessionIndex,
)
from app.runner import _dispatch_job

client = TestClient(app)

_SB_PATH = (Path(__file__).resolve().parents[2] / "runtimes" / "agentscope"
            / "app" / "script_sandbox.py")
_spec = importlib.util.spec_from_file_location("mtc_script_sandbox", _SB_PATH)
sb = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sb)


def u(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def _dequeue_run_jobs(run_id: str) -> None:
    """摘除该 run 的待执行 job。

    全量套件中先前测试文件模块级启动的常驻 worker 线程仍在轮询 job_queue；
    门控类用例执行窗口长，若被其认领会与显式 _dispatch_job 双执行
    （needs_input 处理两次 → 节点行重复）。显式驱动的用例必须先摘队。"""
    from app.models import JobQueue

    db = SessionLocal()
    try:
        db.query(JobQueue).filter(
            JobQueue.type == "agentflow-execution",
            JobQueue.status == "pending",
            JobQueue.payload["run_id"].astext == run_id,
        ).update({"status": "done"}, synchronize_session=False)
        db.commit()
    finally:
        db.close()


def _make_agent() -> str:
    from app.models import Model

    db = SessionLocal()
    try:
        mk = db.query(Model).filter_by(enabled=True).order_by(Model.id).first()
    finally:
        db.close()
    r = client.post("/api/agents", json={
        "name": u("p1AG")[:20], "moduleKey": "quality-analysis", "moduleVersion": "1.0.0",
        "description": "",
        "modelRef": {"modelId": mk.model_key if mk else "qwen-plus",
                     "provider": "openai-compatible"}})
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


class FakeTransport:
    """stub 传输层：按 op 出队预设结果；Exception 项表示该次 RPC 失败。"""

    def __init__(self, responses: dict[str, list]):
        self.responses = responses
        self.calls: list[tuple[str, dict]] = []

    async def call(self, op: str, **args):
        self.calls.append((op, args))
        await asyncio.sleep(0)
        seq = self.responses.get(op) or []
        if not seq:
            raise AssertionError(f"unexpected rpc: {op} {args}")
        r = seq.pop(0)
        if isinstance(r, Exception):
            raise r
        return r


def _run(script: str, transport, flow_input: dict | None = None):
    return sb.run_script(script, flow_input or {}, 10, transport)


def _make_flow_release(aid: str, script: str) -> tuple[str, str]:
    """script 形态 flow：返回 (flow_id, release_id)。"""
    ver = client.post(f"/api/agents/{aid}/versions", json={"note": "p1"}).json()
    vid = ver.get("versionId") or ver.get("id")
    rel = client.post(f"/api/agents/{aid}/releases",
                      json={"versionId": vid, "environment": "prod"})
    assert rel.status_code in (200, 201), rel.text
    fid = client.post("/api/v2/agentflows",
                      json={"name": u("p1-flow"), "description": ""}).json()["id"]
    v = client.post(f"/api/v2/agentflows/{fid}/versions", json={
        "definition": {"kind": "script", "script": script,
                       "meta": {"scope_agent_id": aid}}})
    assert v.status_code == 200, v.text
    r = client.post(f"/api/v2/agentflows/{fid}/releases",
                    json={"version_id": v.json()["id"], "environment": "prod"})
    assert r.status_code in (200, 201), r.text
    return fid, r.json()["id"]


# ---------------------------------------------------------------------------
# 1. 沙箱子进程五原语语义（stub 传输层，hermetic）
# ---------------------------------------------------------------------------


def test_sandbox_serial_golden():
    calls = []

    class T:
        async def call(self, op, **args):
            calls.append((op, args))
            return {"ok": 1} if op == "worker" else True

    script = """
META = {"phases": ["A", "B"]}
async def run(ctx):
    phase, log, worker, askUser, parallel = ctx.primitives
    await phase("A")
    await log("start " + str(ctx.input.get("k")))
    a = await worker("step-1", waker="wa", label="s1")
    await phase("B")
    b = await worker("step-2", waker="wa", label="s2", schema={"type": "object"})
    return {"a": a, "b": b}
"""
    out = asyncio.run(_run(script, T(), {"k": "v"}))
    assert out == {"a": {"ok": 1}, "b": {"ok": 1}}
    assert [c[0] for c in calls] == ["phase", "log", "worker", "phase", "worker"]
    assert calls[2][1]["label"] == "s1" and calls[4][1]["schema"] == {"type": "object"}


def test_sandbox_parallel_degrades_failed_child():
    calls = []

    class T:
        async def call(self, op, **args):
            calls.append((op, args))
            await asyncio.sleep(0)
            if args.get("label") == "f2":
                raise RuntimeError("boom")
            return {"role": args.get("label")}

    script = """
async def run(ctx):
    parallel = ctx.parallel
    worker = ctx.worker
    rs = await parallel([
        lambda: worker("p", waker="wa", label="f1"),
        lambda: worker("p", waker="wa", label="f2"),
        lambda: worker("p", waker="wa", label="f3"),
    ])
    return {"ok": [r for r in rs if r]}
"""
    out = asyncio.run(_run(script, T()))
    assert out == {"ok": [{"role": "f1"}, {"role": "f3"}]}
    assert len([c for c in calls if c[0] == "worker"]) == 3


def test_sandbox_loop_with_ask_user_breaks_on_skipped():
    class T:
        def __init__(self):
            self.worker_calls = 0
            self.asked = False

        async def call(self, op, **args):
            if op == "askUser":
                if not self.asked:
                    self.asked = True
                    return {"value": "需要调整", "skipped": False}
                return {"value": None, "skipped": True}
            self.worker_calls += 1
            return {"round": self.worker_calls}

    script = """
async def run(ctx):
    worker, askUser = ctx.worker, ctx.askUser
    agenda = await worker("draft", waker="wa", label="draft")
    for round in range(2):
        check = await askUser("ok?", options=["采纳", "调整"])
        if check["skipped"] or str(check["value"]).startswith("采纳"):
            break
        agenda = await worker(f"revise:{check['value']}", waker="wa", label="revise")
    return {"agenda": agenda}
"""
    t = T()
    out = asyncio.run(_run(script, t))
    assert t.worker_calls == 2  # 初稿 + 1 轮修订（第二轮 askUser skipped → break）
    assert out["agenda"] == {"round": 2}


def test_sandbox_contract_negatives():
    class T:
        async def call(self, op, **args):
            return True

    with pytest.raises(sb.ScriptError):
        asyncio.run(_run("x = 1", T()))  # 缺 run
    with pytest.raises(sb.ScriptError):
        asyncio.run(_run("async def run(ctx):\n    return 'not-a-dict'", T()))
    with pytest.raises(sb.ScriptError):
        asyncio.run(_run("async def run(ctx):\n    return {'a': 1}\n" + "#" * 70_000, T()))
    # worker 缺 waker 参数 → 脚本内抛 ScriptError → 运行失败
    with pytest.raises(sb.ScriptError):
        asyncio.run(_run("async def run(ctx):\n    return await ctx.worker('p')", T()))


# ---------------------------------------------------------------------------
# 2. 真实子进程（spawn_sandbox）：done/RPC/deadline/崩溃/env（AC-S4 部分）
# ---------------------------------------------------------------------------


def _collect(done: list, lines: list):
    def on_line(line: str) -> None:
        lines.append(line)
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            return
        if msg.get("event") == "done":
            done.append(msg)

    return on_line


def _wait_done(done: list, proc, timeout: float = 20.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if done:
            return done[0]
        time.sleep(0.05)
    proc.kill()
    raise AssertionError("sandbox did not report done in time")


def test_real_subprocess_done_without_rpc():
    done: list = []
    lines: list = []
    proc = sb.spawn_sandbox(
        {"script": "async def run(ctx):\n    return {'n': 1 + 1}", "flow_input": {}},
        on_line=_collect(done, lines), deadline_seconds=10)
    try:
        msg = _wait_done(done, proc)
        assert msg["status"] == "succeeded"
        assert msg["output"] == {"n": 2}
    finally:
        proc.kill()


def test_real_subprocess_rpc_roundtrip():
    done: list = []
    lines: list = []

    holder: dict = {}

    def on_line(line: str) -> None:
        lines.append(line)
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            return
        if msg.get("op") == "worker":
            resp = json.dumps({"id": msg["id"], "ok": True,
                               "result": {"echo": msg["args"]["prompt"]}})
            holder["handle"].respond(resp)
        elif msg.get("event") == "done":
            done.append(msg)

    script = (
        "async def run(ctx):\n"
        "    r = await ctx.worker('hello', waker='wa', label='w1')\n"
        "    return {'r': r}\n"
    )
    handle = sb.spawn_sandbox({"script": script, "flow_input": {}},
                              on_line=on_line, deadline_seconds=30)
    holder["handle"] = handle
    try:
        msg = _wait_done(done, handle, timeout=45)
        assert msg["status"] == "succeeded"
        assert msg["output"] == {"r": {"echo": "hello"}}
    finally:
        handle.kill()


def test_real_subprocess_sync_loop_needs_parent_kill():
    """同步死循环阻塞子进程事件循环，无法自报 done——只能由父侧看门狗强杀
    （运行时 script_runner._deadline_watchdog 职责，AC-S4）。"""
    import time as _time

    done: list = []
    lines: list = []
    script = "async def run(ctx):\n    while True:\n        pass\n"
    proc = sb.spawn_sandbox({"script": script, "flow_input": {}},
                            on_line=_collect(done, lines), deadline_seconds=2)
    try:
        _time.sleep(4)  # 越过 deadline + 余量：子进程不会自终
        if proc.poll() is None:
            proc.kill()
        rc = proc.wait(timeout=10)
        assert rc != 0
        assert done == [], "同步死循环不可能自行产出 done 行"
    finally:
        if proc.poll() is None:
            proc.kill()


def test_real_subprocess_crash_settles_failed():
    import time as _time

    done: list = []
    lines: list = []
    script = "async def run(ctx):\n    raise ValueError('exploded')\n"
    proc = sb.spawn_sandbox({"script": script, "flow_input": {}},
                            on_line=_collect(done, lines), deadline_seconds=10)
    try:
        msg = _wait_done(done, proc)
        assert msg["status"] == "failed"
        assert "exploded" in msg["error"]
        assert proc.wait(timeout=10) == 1
    finally:
        if proc.poll() is None:
            proc.kill()


def test_real_subprocess_env_has_no_platform_secrets():
    done: list = []
    lines: list = []
    script = (
        "import os\n"
        "async def run(ctx):\n"
        "    return {'leak': [k for k in os.environ "
        "if 'TOKEN' in k.upper() or 'SECRET' in k.upper() or 'DATABASE' in k.upper()]}\n"
    )
    proc = sb.spawn_sandbox({"script": script, "flow_input": {}},
                            on_line=_collect(done, lines), deadline_seconds=10)
    try:
        msg = _wait_done(done, proc)
        assert msg["status"] == "succeeded"
        assert msg["output"]["leak"] == [], "沙箱 env 不得携带平台凭据类变量"
    finally:
        proc.kill()


# ---------------------------------------------------------------------------
# 3. 平台 kind=script 分支（F0 探针法）
# ---------------------------------------------------------------------------


def _script(aid: str) -> str:
    return f"""
META = {{"scope_agent_id": "{aid}"}}

async def run(ctx):
    phase, log, worker, askUser, parallel = ctx.primitives
    await phase("P1")
    await log("hi")
    r = await worker("do", waker="{aid}", label="w1", schema={{"type": "object"}})
    return {{"r": r}}
"""


def test_script_projection_and_callsites():
    """P3+视觉对齐：phase 带 detail、worker 带 waker、log 不上画布、parallel 平铺；callSites 供跳行。"""
    aid = _make_agent()
    script = f'''
META = {{
    "scope_agent_id": "{aid}",
    "phases": [
        {{"title": "生成", "detail": "先生成初稿"}},
        {{"title": "清单", "detail": "并行生成三份清单"}},
    ],
}}

async def run(ctx):
    phase, log, worker, askUser, parallel = ctx.primitives
    await phase("生成")
    await log("开始")
    a = await worker("a", waker="{aid}", label="w1")
    await phase("清单")
    rs = await parallel([
        lambda: worker("h", waker="{aid}", label="host"),
        lambda: worker("m", waker="{aid}", label="member"),
    ])
    ok = await askUser("确认?", options=["采纳"], label="确认卡")
    return {{"a": a}}
'''
    meta = {"phases": [{"title": "生成", "detail": "先生成初稿"},
                       {"title": "清单", "detail": "并行生成三份清单"}]}
    projection, call_sites = script_projection(script, meta)
    assert [p["title"] for p in projection] == ["生成", "清单"]
    assert projection[0]["detail"] == "先生成初稿"
    assert projection[1]["detail"] == "并行生成三份清单"
    p1 = projection[0]["items"]
    # wake 台账：画布不渲染 log；worker 平铺并携带 waker
    assert [i["type"] for i in p1] == ["worker"]
    assert p1[0] == {"type": "worker", "label": "w1", "line": p1[0]["line"], "waker": aid}
    p2 = projection[1]["items"]
    # parallel 不分组框，worker 平铺进 phase
    assert [i["label"] for i in p2] == ["host", "member", "确认卡"]
    assert p2[0]["waker"] == aid and p2[2]["type"] == "ask_user"
    # log/parallel 仍留 callSite 供跳行
    assert any(c["primitive"] == "parallel" for c in call_sites)
    assert any(c["primitive"] == "log" for c in call_sites)
    assert all({"primitive", "label", "line", "column"} <= set(c) for c in call_sites)


def test_scan_and_build_script_body():
    aid = _make_agent()
    script = _script(aid)
    assert scan_script_wakers(script) == [aid]
    # build_script_body 需要该 agent 有 active prod release（与 DAG 节点绑定同源）
    ver = client.post(f"/api/agents/{aid}/versions", json={"note": "p1scan"}).json()
    vid = ver.get("versionId") or ver.get("id")
    rel = client.post(f"/api/agents/{aid}/releases",
                      json={"versionId": vid, "environment": "prod"})
    assert rel.status_code in (200, 201), rel.text
    db = SessionLocal()
    try:
        body = build_script_body(db, "dev",
                                 {"script": script, "meta": {"scope_agent_id": aid}}, {})
        assert list(body["wakers"].keys()) == [aid]
        assert body["wakers"][aid]["runtime_agent_id"]
        with pytest.raises(ValueError, match="not found"):
            build_script_body(db, "dev",
                              {"script": "async def run(ctx):\n"
                                         "    return await ctx.worker('p', waker='ghost')",
                               "meta": {}}, {})
    finally:
        db.close()


def test_create_version_validates_script_contract():
    aid = _make_agent()
    fid = client.post("/api/v2/agentflows",
                      json={"name": u("p1v"), "description": ""}).json()["id"]
    bad_cases = [
        {"kind": "script", "script": "x = 1", "meta": {}},                      # 缺 run
        {"kind": "script", "script": "async def run(", "meta": {}},             # 语法错
        {"kind": "script", "script": _script("ghost-agent"), "meta": {}},       # waker 不存在
        {"kind": "script", "script": "#" * 70_000, "meta": {}},                 # 超限
    ]
    for definition in bad_cases:
        r = client.post(f"/api/v2/agentflows/{fid}/versions", json={"definition": definition})
        assert r.status_code == 422, (definition, r.text)
    ok = client.post(f"/api/v2/agentflows/{fid}/versions", json={
        "definition": {"kind": "script", "script": _script(aid), "meta": {}}})
    assert ok.status_code == 200, ok.text


def test_script_run_incremental_and_settled(monkeypatch):
    aid = _make_agent()
    _, rel = _make_flow_release(aid, _script(aid))
    db = SessionLocal()
    try:
        release = db.get(AgentFlowRelease, rel)
        from app.agentflow_executor import start_run

        run = start_run(db, "dev", release, {"k": "v"})
        run_id = run.id
    finally:
        db.close()
    sid = f"sess-{run_id[:12]}"

    seen_mid: dict = {}

    def probe() -> None:
        s = SessionLocal()
        try:
            row = s.query(AgentFlowNodeRun).filter_by(run_id=run_id, node_id="w1").first()
            assert row is not None and row.status == "running"
            idx = s.query(AgentSessionIndex).filter_by(session_id=row.session_id).first()
            assert idx is not None
            assert idx.runtime_agent_id == "rt-agent-p1"
            assert idx.agent_id == aid
            seen_mid["ok"] = True
        finally:
            s.close()

    events = [
        {"event": "stage:w1", "data": {"phase": "start", "session_id": sid,
                                       "agent_id": aid, "runtime_agent_id": "rt-agent-p1"}},
        probe,
        {"event": "phase", "data": {"name": "P1"}},
        {"event": "log", "data": {"message": "hi"}},
        {"event": "stage:w1", "data": {"phase": "end", "status": "succeeded",
                                       "output": {"ok": 1}, "error": ""}},
        {"event": "flow:complete", "data": {"status": "succeeded",
                                            "output": {"r": {"ok": 1}}}},
    ]

    def fake_stream(body, timeout=900.0):
        def gen():
            for ev in events:
                if callable(ev):  # 探针：到达时执行（与 F0 fake 同约定）
                    ev()
                    continue
                yield ev

        return gen()

    monkeypatch.setattr(rt, "script_run_stream", fake_stream)
    _dispatch_job("agentflow-execution", {"run_id": run_id, "user_id": "dev"})

    s = SessionLocal()
    try:
        s.expire_all()
        run = s.get(AgentFlowRun, run_id)
        assert run.status == "succeeded"
        assert run.output == {"r": {"ok": 1}}
        node = s.query(AgentFlowNodeRun).filter_by(run_id=run_id, node_id="w1").one()
        assert node.status == "succeeded" and node.agent_id == aid
        assert node.started_at <= node.ended_at
        assert s.query(AgentSessionIndex).filter_by(agentflow_run_id=run_id).count() == 1
    finally:
        s.close()
    assert seen_mid.get("ok") is True


def test_generate_script_validation_and_retry(monkeypatch):
    """P4：产物过契约校验；坏→带错重试→好（attempts=2）；两次坏/未授权 waker→422。"""
    from fastapi import HTTPException

    from app.routers.as_flows_board import GenerateScriptBody, generate_script

    aid = _make_agent()
    good = _script(aid)
    calls = {"n": 0}

    def flaky_model(db, model_id, prompt):
        calls["n"] += 1
        if calls["n"] == 1:
            return "def broken(:\n", {}
        return good, {}

    monkeypatch.setattr("app.runner._call_model", flaky_model)
    r = generate_script(
        body=GenerateScriptBody(brief="测试需求", waker_ids=[aid]),
        db=SessionLocal(), user={"username": "dev"})
    assert r["attempts"] == 2
    assert "async def run(ctx)" in r["script"]

    def bad_model(db, model_id, prompt):
        return "x = 1\n", {}

    monkeypatch.setattr("app.runner._call_model", bad_model)
    with pytest.raises(HTTPException) as ei:
        generate_script(
            body=GenerateScriptBody(brief="测试需求", waker_ids=[aid]),
            db=SessionLocal(), user={"username": "dev"})
    assert ei.value.status_code == 422

    def ghost_model(db, model_id, prompt):
        return good.replace(aid, "ghost-agent"), {}

    monkeypatch.setattr("app.runner._call_model", ghost_model)
    with pytest.raises(HTTPException) as ei:
        generate_script(
            body=GenerateScriptBody(brief="测试需求", waker_ids=[aid]),
            db=SessionLocal(), user={"username": "dev"})
    assert ei.value.status_code == 422
    assert "未授权" in str(ei.value.detail)

    with pytest.raises(HTTPException) as ei:
        generate_script(
            body=GenerateScriptBody(brief="  ", waker_ids=[aid]),
            db=SessionLocal(), user={"username": "dev"})
    assert ei.value.status_code == 422


def test_runtime_script_runner_syntax():
    """运行时 script_runner 与主接线至少语法成立（跨栈行为由 live 栈覆盖）。"""
    import ast

    root = Path(__file__).resolve().parents[2] / "runtimes" / "agentscope" / "app"
    for name in ("script_runner.py", "script_sandbox.py", "main.py"):
        ast.parse((root / name).read_text())
    source = (root / "main.py").read_text()
    assert "script_router" in source, "运行时 main 必须挂载 script_router"
    assert "script-resume" in (root / "script_runner.py").read_text()


# ---------------------------------------------------------------------------
# P2：askUser 挂起/恢复（AC-S3 平台侧）
# ---------------------------------------------------------------------------


def _ask_script(aid: str) -> str:
    return f"""
META = {{"scope_agent_id": "{aid}"}}

async def run(ctx):
    askUser = ctx.askUser
    check = await askUser("议程草案已生成，请选择：", options=["采纳当前议程", "需要调整"],
                          label="议程确认")
    if check["skipped"] or str(check["value"]).startswith("采纳"):
        return {{"decision": "accepted"}}
    return {{"decision": "revised"}}
"""


def test_ask_user_resume_roundtrip(monkeypatch):
    """端到端：needs_input 落 waiting 节点 → 答复写回 runtime → 脚本继续 → 终态。"""
    import threading

    aid = _make_agent()
    _, rel = _make_flow_release(aid, _ask_script(aid))
    db = SessionLocal()
    try:
        release = db.get(AgentFlowRelease, rel)
        from app.agentflow_executor import start_run

        run = start_run(db, "dev", release, {})
        run_id = run.id
    finally:
        db.close()
    _dequeue_run_jobs(run_id)

    gate = threading.Event()
    captured: dict = {}

    def fake_stream(body, timeout=900.0):
        def gen():
            yield {"event": "needs_input",
                   "data": {"request_id": "inp-test-1", "label": "议程确认",
                            "prompt": "议程草案已生成，请选择：",
                            "options": ["采纳当前议程", "需要调整"]}}
            assert gate.wait(timeout=15), "resume 未到达，执行流卡死"
            value = captured.get("value")
            yield {"event": "stage:议程确认",
                   "data": {"phase": "end", "status": "succeeded",
                            "output": {"value": value, "skipped": False}, "error": ""}}
            yield {"event": "flow:complete",
                   "data": {"status": "succeeded", "output": {"decision": "accepted"}}}

        return gen()

    def fake_resume(**kwargs):
        captured.update(kwargs)
        captured["value"] = "采纳当前议程"
        gate.set()
        return {"ok": True}

    monkeypatch.setattr(rt, "script_run_stream", fake_stream)
    monkeypatch.setattr(rt, "script_resume", fake_resume)

    def resumer() -> None:
        node = None
        for _ in range(120):
            s = SessionLocal()
            try:
                s.expire_all()
                node = (
                    s.query(AgentFlowNodeRun)
                    .filter_by(run_id=run_id, status="waiting")
                    .first()
                )
            finally:
                s.close()
            if node is not None:
                break
            time.sleep(0.1)
        assert node is not None, "waiting 节点未落库"
        assert node.input["request_id"] == "inp-test-1"
        from app.routers.as_flows_board import RunInputBody, answer_run_input

        answer_run_input(
            rid=run_id, node_run_id=node.id,
            body=RunInputBody(value="采纳当前议程"),
            db=SessionLocal(), user={"username": "dev"},
        )

    t = threading.Thread(target=resumer)
    t.start()
    try:
        _dispatch_job("agentflow-execution", {"run_id": run_id, "user_id": "dev"})
    finally:
        t.join(timeout=20)

    assert captured.get("request_id") == "inp-test-1"
    s = SessionLocal()
    try:
        s.expire_all()
        run = s.get(AgentFlowRun, run_id)
        assert run.status == "succeeded"
        assert run.output == {"decision": "accepted"}
        node = s.query(AgentFlowNodeRun).filter_by(run_id=run_id, node_id="议程确认").one()
        assert node.status == "succeeded"
        assert node.output == {"value": "采纳当前议程", "skipped": False}
    finally:
        s.close()


def test_waiting_nodes_settled_when_run_terminal(monkeypatch):
    """run 终态时仍未答复的 waiting 节点 → cancelled（kill/deadline 路径）。"""
    aid = _make_agent()
    _, rel = _make_flow_release(aid, _ask_script(aid))
    db = SessionLocal()
    try:
        release = db.get(AgentFlowRelease, rel)
        from app.agentflow_executor import start_run

        run = start_run(db, "dev", release, {})
        run_id = run.id
    finally:
        db.close()
    _dequeue_run_jobs(run_id)

    def fake_stream(body, timeout=900.0):
        def gen():
            yield {"event": "needs_input",
                   "data": {"request_id": "inp-test-2", "label": "议程确认",
                            "prompt": "?", "options": ["采纳"]}}
            yield {"event": "flow:complete",
                   "data": {"status": "failed", "output": {}, "error": "killed"}}

        return gen()

    monkeypatch.setattr(rt, "script_run_stream", fake_stream)
    _dispatch_job("agentflow-execution", {"run_id": run_id, "user_id": "dev"})

    s = SessionLocal()
    try:
        s.expire_all()
        assert s.get(AgentFlowRun, run_id).status == "failed"
        node = s.query(AgentFlowNodeRun).filter_by(run_id=run_id, node_id="议程确认").one()
        assert node.status == "cancelled"
    finally:
        s.close()


def test_answer_input_rejects_non_waiting_and_terminal():
    """答复端点负向：非 waiting 节点 409；终态 run 409；未知节点 404。"""
    from app.routers.as_flows_board import RunInputBody, answer_run_input

    db = SessionLocal()
    try:
        run = AgentFlowRun(release_id="rel-p2", status="succeeded", trigger_kind="manual")
        db.add(run)
        db.flush()
        node = AgentFlowNodeRun(run_id=run.id, node_id="n1", status="succeeded")
        db.add(node)
        db.commit()
        with pytest.raises(Exception) as ei:
            answer_run_input(rid=run.id, node_run_id=node.id,
                             body=RunInputBody(value="x"), db=db, user={"username": "dev"})
        assert getattr(ei.value, "status_code", None) == 409  # run 已终态
        run.status = "running"
        db.commit()
        with pytest.raises(Exception) as ei:
            answer_run_input(rid=run.id, node_run_id=node.id,
                             body=RunInputBody(value="x"), db=db, user={"username": "dev"})
        assert getattr(ei.value, "status_code", None) == 409  # 节点非 waiting
        with pytest.raises(Exception) as ei:
            answer_run_input(rid=run.id, node_run_id="nope",
                             body=RunInputBody(value="x"), db=db, user={"username": "dev"})
        assert getattr(ei.value, "status_code", None) == 404
        db.delete(node)
        db.delete(run)
        db.commit()
    finally:
        db.close()
