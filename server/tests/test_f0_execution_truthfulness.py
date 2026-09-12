"""F0 执行真实性修复回归（2026-09-12）。

spec: docs/product-domain/execution-automation-batch-spec.md §19 F0 / §18 AC-001~007

覆盖：
- AC-004 AgentFlow run-now 不阻塞 HTTP（queued 即返 + 入 job 队列，执行外置）；
- F0③④ NodeRun/SessionIndex 增量落库（执行中可查、真实时间戳、恢复重跑 attempt 递增）；
- F0① NodeRun 反链字段（run_id）修复——无索引行节点 Session 按运行中 flow-run
  令牌放行（旧实现提前 401、兜底分支引用不存在列 agentflow_run_id 会 500）；
- AC-003 终态执行链回调令牌失效（agentflow / automation 两条链，手工对话不设终态）；
- AC-001/006 agent 目标 run-now 返回 Invocation 定位 + watcher 真实终态对账 +
  暂停定义新触发 rejected；
- worker 分派表接线（agentflow-execution）。

真实生产函数 + 真实 DB（conftest wf_test），运行时边界 hermetic，flow 执行用
可控假 SSE 流驱动（monkeypatch rt.flow_run_stream）。
"""
from __future__ import annotations

import hashlib
import secrets as _secrets
import uuid

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import agentscope_client as rt
from app.agentflow_executor import execute_agentflow_run, start_run
from app.automation_watcher import reconcile_once
from app.db import SessionLocal
from app.main import app
from app.models import (
    AgentFlowNodeRun,
    AgentFlowRelease,
    AgentFlowRun,
    AgentSessionIndex,
    AutomationDefinition,
    AutomationTriggerLog,
    JobQueue,
    Model,
)
from app.routers.as_automations import dispatch
from app.routers.as_flows_board import _UnindexedFlowSession, _authorized_session

client = TestClient(app)


def u(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def _sha(tok: str) -> str:
    return hashlib.sha256(tok.encode()).hexdigest()


def _make_agent() -> str:
    """可发布 Agent（module 型，发布校验可过；同 cutover/make_module_agent 形态）。"""
    db = SessionLocal()
    try:
        mk = db.query(Model).filter_by(enabled=True).order_by(Model.id).first()
    finally:
        db.close()
    payload = {
        "name": u("f0AG")[:20],
        "moduleKey": "quality-analysis",
        "moduleVersion": "1.0.0",
        "description": "",
        "modelRef": {"modelId": mk.model_key if mk else "qwen-plus",
                     "provider": "openai-compatible"},
    }
    r = client.post("/api/agents", json=payload)
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def _make_flow_release() -> tuple[str, str]:
    """Agent（含 prod Release）+ AgentFlow（含 prod Release），返回 (flow_id, release_id)。"""
    aid = _make_agent()
    ver = client.post(f"/api/agents/{aid}/versions", json={"note": "f0"}).json()
    vid = ver.get("versionId") or ver.get("id")
    rel = client.post(f"/api/agents/{aid}/releases",
                      json={"versionId": vid, "environment": "prod"})
    assert rel.status_code in (200, 201), rel.text
    fid = client.post("/api/v2/agentflows",
                      json={"name": u("f0-flow"), "description": ""}).json()["id"]
    v = client.post(
        f"/api/v2/agentflows/{fid}/versions",
        json={"definition": {"nodes": [
            {"id": "n1", "kind": "agent", "agent_id": aid, "prompt_template": "p"}],
            "edges": []}},
    )
    assert v.status_code == 200, v.text
    r = client.post(f"/api/v2/agentflows/{fid}/releases",
                    json={"version_id": v.json()["id"], "environment": "prod"})
    assert r.status_code in (200, 201), r.text
    return fid, r.json()["id"]


def _fake_stream(events: list):
    """可控 SSE 流：dict=事件原样产出；callable=到达时执行的探针（可查库断言）。"""
    def fake(body, timeout=900.0):
        def gen():
            for ev in events:
                if callable(ev):
                    ev()
                    continue
                yield ev
        return gen()
    return fake


def _dequeue_run_jobs(run_id: str) -> None:
    """摘除该 run 的待执行 job——全量套件中先前测试的常驻 worker 线程可能认领，
    与显式 _dispatch_job/execute 双执行（长窗口门控用例下必现，P2 轮教训）。"""
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


# ---------------------------------------------------------------------------
# AC-004：run-now 不阻塞
# ---------------------------------------------------------------------------


def test_flow_run_now_returns_queued_without_executing(monkeypatch):
    calls: list = []
    monkeypatch.setattr(rt, "flow_run_stream", _fake_stream(calls))
    _, rel = _make_flow_release()

    r = client.post("/api/v2/agentflows/runs", json={"release_id": rel, "input": {}})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "queued", body
    run_id = body["run_id"]
    assert calls == [], "run-now 不得在 HTTP 请求内执行 flow"

    db = SessionLocal()
    try:
        run = db.get(AgentFlowRun, run_id)
        assert run is not None and run.status == "queued"
        job = (
            db.query(JobQueue)
            .filter_by(type="agentflow-execution")
            .order_by(JobQueue.created_at.desc())
            .first()
        )
        assert job is not None
        assert job.status == "pending"
        assert job.payload["run_id"] == run_id
    finally:
        db.close()


# ---------------------------------------------------------------------------
# F0③④：增量落库（执行中可查 + 真实时间戳）
# ---------------------------------------------------------------------------


def test_execute_records_nodes_incrementally(monkeypatch):
    _, rel = _make_flow_release()
    db = SessionLocal()
    try:
        release = db.get(AgentFlowRelease, rel)
        run = start_run(db, "dev", release, {"k": "v"})
        run_id = run.id
    finally:
        db.close()
    _dequeue_run_jobs(run_id)
    sid = f"sess-{run_id[:12]}"

    seen_mid: dict = {}

    def probe() -> None:
        """start 事件与 end 事件之间查库：节点事实必须已增量可见。"""
        s = SessionLocal()
        try:
            row = (
                s.query(AgentFlowNodeRun)
                .filter_by(run_id=run_id, node_id="n1")
                .first()
            )
            assert row is not None, "节点执行中 NodeRun 未落库（仍是一次性补写）"
            assert row.status == "running"
            assert row.started_at is not None
            idx = s.query(AgentSessionIndex).filter_by(session_id=row.session_id).first()
            assert idx is not None, "节点 SessionIndex 未在执行期登记"
            assert idx.agentflow_run_id == run_id
            assert idx.trigger_kind == "agentflow"
            seen_mid["ok"] = True
        finally:
            s.close()

    events = [
        {"event": "stage:n1", "data": {"phase": "start", "session_id": sid}},
        probe,
        {"event": "stage:n1",
         "data": {"phase": "end", "session_id": sid, "status": "succeeded",
                  "output": {"text": "hi"}, "error": ""}},
        {"event": "flow:complete",
         "data": {"status": "succeeded", "output": {"n1": {"text": "hi"}}}},
    ]
    monkeypatch.setattr(rt, "flow_run_stream", _fake_stream(events))
    execute_agentflow_run(run_id, "dev")

    s = SessionLocal()
    try:
        s.expire_all()
        run = s.get(AgentFlowRun, run_id)
        assert run.status == "succeeded"
        assert run.ended_at is not None
        assert run.output == {"n1": {"text": "hi"}}
        node = s.query(AgentFlowNodeRun).filter_by(run_id=run_id, node_id="n1").one()
        assert node.status == "succeeded"
        assert node.session_id == sid
        assert node.started_at <= node.ended_at
        assert s.query(AgentSessionIndex).filter_by(agentflow_run_id=run_id).count() == 1
    finally:
        s.close()
    assert seen_mid.get("ok") is True


def test_worker_dispatch_table_consumes_agentflow_job(monkeypatch):
    """runner._dispatch_job(type=agentflow-execution) 接线：真实消费入队 run。"""
    _, rel = _make_flow_release()
    db = SessionLocal()
    try:
        release = db.get(AgentFlowRelease, rel)
        run = start_run(db, "dev", release, {})
        run_id = run.id
    finally:
        db.close()
    _dequeue_run_jobs(run_id)
    sid = f"sess-{run_id[:12]}"
    events = [
        {"event": "stage:n1", "data": {"phase": "start", "session_id": sid}},
        {"event": "stage:n1",
         "data": {"phase": "end", "session_id": sid, "status": "succeeded"}},
        {"event": "flow:complete", "data": {"status": "succeeded", "output": {"n1": {}}}},
    ]
    monkeypatch.setattr(rt, "flow_run_stream", _fake_stream(events))

    from app.runner import _dispatch_job

    _dispatch_job("agentflow-execution", {"run_id": run_id, "user_id": "dev"})

    s = SessionLocal()
    try:
        s.expire_all()
        assert s.get(AgentFlowRun, run_id).status == "succeeded"
    finally:
        s.close()


def test_worker_reexecute_increments_attempt(monkeypatch):
    """worker 崩溃恢复：run 仍 running 时整体重跑，attempt 递增不撞唯一约束。"""
    _, rel = _make_flow_release()
    db = SessionLocal()
    try:
        release = db.get(AgentFlowRelease, rel)
        run = start_run(db, "dev", release, {})
        run_id = run.id
        run.status = "running"  # 模拟上一 worker 崩溃遗留
        db.commit()
    finally:
        db.close()
    _dequeue_run_jobs(run_id)
    sid = f"sess-{run_id[:12]}"
    events = [
        {"event": "stage:n1", "data": {"phase": "start", "session_id": sid}},
        {"event": "stage:n1",
         "data": {"phase": "end", "session_id": sid, "status": "succeeded"}},
        {"event": "flow:complete", "data": {"status": "succeeded", "output": {}}},
    ]
    monkeypatch.setattr(rt, "flow_run_stream", _fake_stream(events))
    execute_agentflow_run(run_id, "dev")

    s = SessionLocal()
    try:
        s.expire_all()
        rows = (
            s.query(AgentFlowNodeRun)
            .filter_by(run_id=run_id, node_id="n1")
            .order_by(AgentFlowNodeRun.attempt)
            .all()
        )
        assert len(rows) >= 1
        assert rows[-1].attempt >= 1
        assert rows[-1].status == "succeeded"
        assert s.get(AgentFlowRun, run_id).status == "succeeded"
    finally:
        s.close()


# ---------------------------------------------------------------------------
# F0① + AC-003：回调令牌链
# ---------------------------------------------------------------------------


def test_flow_node_session_token_running_vs_terminal():
    token = _secrets.token_urlsafe(16)
    db = SessionLocal()
    try:
        run = AgentFlowRun(release_id="rel-f0", status="running",
                           run_token_hash=_sha(token), trigger_kind="manual")
        db.add(run)
        db.flush()
        nr = AgentFlowNodeRun(run_id=run.id, node_id="n1",
                              session_id="sess-flowauth", status="running")
        db.add(nr)
        db.flush()
        idx = AgentSessionIndex(
            session_id="sess-flowauth", user_id="dev", agent_id="a",
            trigger_kind="agentflow", agentflow_run_id=run.id,
            agentflow_node_run_id=nr.id,
        )
        db.add(idx)
        db.commit()
        # 运行中：run 令牌放行
        got = _authorized_session(db, "sess-flowauth", token)
        assert got.session_id == "sess-flowauth"
        # 终态：令牌失效（AC-003）
        run.status = "succeeded"
        db.commit()
        with pytest.raises(HTTPException) as ei:
            _authorized_session(db, "sess-flowauth", token)
        assert ei.value.status_code == 401
        db.delete(idx)
        db.delete(nr)
        db.delete(run)
        db.commit()
    finally:
        db.close()


def test_no_index_node_session_authorized_while_running():
    """F0① 回归：无索引行节点 Session 在运行中按 run 令牌放行（旧实现 401/500）。"""
    token = _secrets.token_urlsafe(16)
    db = SessionLocal()
    try:
        run = AgentFlowRun(release_id="rel-f0", status="running",
                           run_token_hash=_sha(token), trigger_kind="manual")
        db.add(run)
        db.commit()
        got = _authorized_session(db, "sess-never-indexed", token)
        assert isinstance(got, _UnindexedFlowSession)
        assert got.release_id is None  # 白名单空集：只走到 403，不放大权限
        run.status = "failed"
        db.commit()
        with pytest.raises(HTTPException) as ei:
            _authorized_session(db, "sess-never-indexed", token)
        assert ei.value.status_code == 401
        db.delete(run)
        db.commit()
    finally:
        db.close()


def test_automation_session_token_terminal_invalidation():
    """AC-003 automation 链：无 active 触发日志即终态失效；手工对话不设终态。"""
    token = _secrets.token_urlsafe(16)
    db = SessionLocal()
    try:
        idx = AgentSessionIndex(
            session_id="sess-auto-f0", user_id="dev", agent_id="a",
            trigger_kind="schedule", automation_id="auto-f0",
            session_token_hash=_sha(token),
        )
        db.add(idx)
        db.add(AutomationTriggerLog(automation_id="auto-f0", source="schedule",
                                    status="completed", session_id="sess-auto-f0"))
        db.commit()
        with pytest.raises(HTTPException) as ei:
            _authorized_session(db, "sess-auto-f0", token)
        assert ei.value.status_code == 401
        # 下一次 fire 复用 Session：新 active 日志使令牌恢复有效
        db.add(AutomationTriggerLog(automation_id="auto-f0", source="schedule",
                                    status="running", session_id="sess-auto-f0"))
        db.commit()
        got = _authorized_session(db, "sess-auto-f0", token)
        assert got.session_id == "sess-auto-f0"
        # 手工/对话 Session（无 automation 关联）不设终态
        chat = AgentSessionIndex(
            session_id="sess-chat-f0", user_id="dev", agent_id="a",
            trigger_kind="chat", session_token_hash=_sha(token),
        )
        db.add(chat)
        db.commit()
        got2 = _authorized_session(db, "sess-chat-f0", token)
        assert got2.session_id == "sess-chat-f0"
        db.delete(chat)
        db.commit()
    finally:
        db.close()


# ---------------------------------------------------------------------------
# AC-001 / AC-006：agent 目标 run-now + 暂停门
# ---------------------------------------------------------------------------


def test_run_now_agent_returns_invocation_and_settles_terminal():
    aid = _make_agent()
    ver = client.post(f"/api/agents/{aid}/versions", json={"note": "f0ac1"})
    assert ver.status_code == 201, ver.text
    vid = ver.json()["versionId"]
    rel = client.post(f"/api/agents/{aid}/releases",
                      json={"versionId": vid, "environment": "prod"})
    assert rel.status_code in (200, 201), rel.text
    db = SessionLocal()
    try:
        auto = AutomationDefinition(name=u("f0-ac1"), target_kind="agent",
                                    agent_id=aid, enabled=True, created_by="dev")
        db.add(auto)
        db.commit()
        r = client.post(f"/api/v2/automations/{auto.id}/run-now")
        assert r.status_code == 200, r.text
        body = r.json()
        log_id = body["trigger_log_id"]
        assert log_id
        assert body["status"] in ("accepted", "running")
        assert body["session_id"], "SessionIndex 必须在触发后立即可查（AC-002）"
        # watcher 真实终态对账：hermetic session_status=idle → completed
        reconcile_once(db)
        log = db.get(AutomationTriggerLog, log_id)
        assert log.status == "completed"
        db.delete(log)
        db.delete(db.get(AutomationDefinition, auto.id))
        db.commit()
    finally:
        db.close()


def test_dispatch_rejects_paused_definition():
    db = SessionLocal()
    try:
        auto = AutomationDefinition(name=u("f0-paused"), target_kind="agent",
                                    agent_id="whatever", enabled=False,
                                    created_by="dev")
        db.add(auto)
        db.commit()
        with pytest.raises(ValueError, match="disabled"):
            dispatch(db, "dev", auto, {}, source="manual")
        db.delete(auto)
        db.commit()
    finally:
        db.close()
