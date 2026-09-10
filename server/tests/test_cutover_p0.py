"""审核返工 P0/P1 跨层测试（2026-09-09）。

覆盖：Release 资源清单→新 Session 真实装配；max_runs 无人读取也停 Schedule；
事件多派发+触发级过滤；SSE 代理忽略客户端自报用户；重跑下游计算单元。
"""
from __future__ import annotations

import pytest

from fastapi.testclient import TestClient

from app.agent_execution import start_session
from app.agentflow_executor import _downstream, _topo_order
from app.db import SessionLocal
from app.main import app
from app.models import (
    AutomationDefinition,
    AutomationTrigger,
    AutomationTriggerLog,
    DataSource,
    SkillResource,
)
from tests.test_r2_agent_modules import make_module_agent, publish_version


pytestmark = pytest.mark.live_runtime


@pytest.fixture(scope="module", autouse=True)
def _cleanup_runtime_objects():
    """P0-09 防污染：本模块进程内创建的运行时 AgentRecord/Session 在模块
    结束时经官方 DELETE 接口清除（wf_dev 收敛后运行时表与平台同库，
    live 套件不得每轮累积垃圾记录）。"""
    import httpx

    from app import agentscope_client as _rt

    created_agents: list[tuple[str, str]] = []
    created_sessions: list[tuple[str, str, str]] = []
    real_create_agent = _rt.create_agent
    real_create_session = _rt.create_session

    def tracked_agent(user_id, name, system_prompt, **cfg):
        aid = real_create_agent(user_id, name, system_prompt, **cfg)
        created_agents.append((user_id, aid))
        return aid

    def tracked_session(user_id, agent_id, cfg, kb_ids=None, internal_token=None):
        sid = real_create_session(user_id, agent_id, cfg, kb_ids,
                                  internal_token=internal_token)
        created_sessions.append((user_id, agent_id, sid))
        return sid

    _rt.create_agent = tracked_agent
    _rt.create_session = tracked_session
    yield
    _rt.create_agent = real_create_agent
    _rt.create_session = real_create_session
    for user_id, agent_id, sid in created_sessions:
        try:
            httpx.delete(f"{_rt.RUNTIME_URL}/sessions/{sid}",
                         params={"agent_id": agent_id},
                         headers={"X-User-ID": user_id}, timeout=10)
        except Exception:  # noqa: BLE001
            pass
    for user_id, aid in created_agents:
        try:
            httpx.delete(f"{_rt.RUNTIME_URL}/agent/{aid}",
                         headers={"X-User-ID": user_id}, timeout=10)
        except Exception:  # noqa: BLE001
            pass


client = TestClient(app)


def _make_skill(name: str) -> str:
    db = SessionLocal()
    try:
        s = SkillResource(
            name=name,
            description="cutover test skill",
            content=f"---\nname: {name}\ndescription: cutover test skill\n---\nbody marker {name}",
            source="upload",
            status="ready",
            category="test",
        )
        db.add(s)
        db.commit()
        return s.id
    finally:
        db.close()


def test_release_manifest_materializes_into_session_workspace():
    """P0-2：配置清单 → 版本快照 → Release → 新 Session Workspace 真实装配。"""
    sid_skill = _make_skill("cutover-manifest-skill")
    # 带鉴权连接的模型（chat_model_config 需要 credential 映射）
    from app.models import Connection, Model, ModelProvider

    db0 = SessionLocal()
    try:
        conn = Connection(name="cutover-conn", kind="api_key", protocol="llm",
                          endpoint={"base_url": "http://127.0.0.1:1/"}, secret_ref="sk-cutover-test-0000000000000000000000")
        db0.add(conn)
        db0.commit()
        prov = ModelProvider(name="cutover-prov", base_url="http://127.0.0.1:1/",
                             auth_connection_id=conn.id)
        db0.add(prov)
        db0.commit()
        model = Model(provider_id=prov.id, model_key="qwen-plus-cutover",
                      display_name="qwen-plus-cutover", capabilities=["text"], enabled=True)
        db0.add(model)
        db0.commit()
        model_id = model.id
    finally:
        db0.close()
    a = make_module_agent()
    g = client.get(f"/api/agents/{a['id']}")
    cfg = dict(g.json().get("config") or {})
    cfg["skills"] = [sid_skill]
    cfg["default_model_id"] = model_id
    pu = client.put(
        f"/api/agents/{a['id']}",
        json={"config": cfg, "expectedRevision": g.json().get("configRevision")},
    )
    assert pu.status_code == 200, pu.text
    v = publish_version(a["id"])
    r = client.post(
        f"/api/agents/{a['id']}/releases",
        json={"versionId": v["versionId"], "environment": "prod"},
    )
    assert r.status_code == 201, r.text
    db = SessionLocal()
    try:
        from app.models import Agent as AgentModel

        agent = db.get(AgentModel, a["id"])
        index = start_session(db, "dev", agent, trigger_kind="manual")
        from app import agentscope_client as rt

        skills = rt.workspace_skills("dev", index.runtime_agent_id, index.session_id)
        names = [s.get("name") for s in skills] if isinstance(skills, list) else []
        assert "cutover-manifest-skill" in names
    finally:
        db.close()


def test_max_runs_watcher_stops_schedule_without_history_read(monkeypatch):
    """P0-4：无人读取历史时，watcher 依据 schedule sessions 停 Schedule。"""
    from app import agentscope_client as rt
    from app.automation_watcher import reconcile_once

    calls: list[dict] = []

    def fake_patch(user_id, schedule_id, **patch):
        calls.append({"schedule_id": schedule_id, **patch})
        return {}

    def fake_sessions(user_id, schedule_id):
        return [
            {"session_id": f"{schedule_id}-s{i}", "created_at": "2026-09-09T00:00:00Z"}
            for i in range(2)
        ]

    monkeypatch.setattr(rt, "patch_schedule", fake_patch)
    monkeypatch.setattr(rt, "schedule_sessions", fake_sessions)
    db = SessionLocal()
    try:
        # 清理历史残留（测试库跨跑持久）
        from app.models import AgentSessionIndex as _Idx
        db.query(_Idx).filter(_Idx.session_id.like("%-s0")).delete(synchronize_session=False)
        db.query(_Idx).filter(_Idx.session_id.like("%-s1")).delete(synchronize_session=False)
        db.query(AutomationDefinition).filter(
            AutomationDefinition.name.like("cutover-maxruns%")
        ).delete(synchronize_session=False)
        db.commit()
        auto = AutomationDefinition(
            name="cutover-maxruns",
            target_kind="agent",
            agent_id="none",
            enabled=True,
            max_runs=1,
            runtime_schedule_id="sched-test",
            created_by="dev",
        )
        db.add(auto)
        db.commit()
        reconcile_once(db)
        assert any(c.get("enabled") is False for c in calls)
        db.delete(db.get(AutomationDefinition, auto.id))
        db.commit()
    finally:
        db.close()


def test_event_multi_dispatch_with_trigger_level_rules():
    """P0-4：同源两自动任务不同触发级过滤，匹配者均派发（无 break）。"""
    from app.routers.as_automations import ingest

    db = SessionLocal()
    try:
        # Create a real test agent with active release so dispatch() can resolve runtime
        agent = make_module_agent(name="cutovr-ev-agent")
        agent_id = agent["id"]
        # Publish version
        ver = client.post(f"/api/agents/{agent_id}/versions", json={"note": "cutover test"}).json()
        ver_id = ver.get("versionId") or ver.get("id")
        # Create release (payload uses camelCase)
        # P0-04: automations are prod executions — dispatch strictly requires
        # an active prod release (no silent sandbox downgrade)
        rel = client.post(f"/api/agents/{agent_id}/releases", json={"versionId": ver_id, "environment": "prod"})
        assert rel.status_code in (200, 201), rel.text

        src = DataSource(name="cutover-src", kind="webhook", config={})
        db.add(src)
        db.commit()
        ids = []
        for i, topic in [("refund", "refund"), ("billing", "billing")]:
            auto = AutomationDefinition(
                name=f"cutover-ev-{i}",
                target_kind="agent",
                agent_id=agent_id,
                enabled=True,
                created_by="dev",
            )
            db.add(auto)
            db.commit()
            db.add(
                AutomationTrigger(
                    automation_id=auto.id,
                    kind="event",
                    config={
                        "data_source_id": src.id,
                        "filter": {"field": "topic", "op": "eq", "value": topic},
                        "mapping": {"topic": "topic"},
                    },
                )
            )
            db.commit()
            ids.append(auto.id)
        ev = ingest(db, src, {"topic": "refund", "id": "evt-multi-1"}, dedupe_key="evt-multi-1")
        logs = (
            db.query(AutomationTriggerLog)
            .filter_by(source="event")
            .order_by(AutomationTriggerLog.created_at.desc())
            .limit(2)
            .all()
        )
        dispatched = [l for l in logs if l.status in ("running", "completed", "failed")]
        # refund 任务派发；billing 任务因触发级过滤不派发
        assert ev.status == "dispatched"
        assert any(l.automation_id == ids[0] for l in dispatched)
        assert not any(l.automation_id == ids[1] for l in dispatched)
        for aid in ids:
            db.delete(db.get(AutomationDefinition, aid))
        db.delete(src)
        db.commit()
    finally:
        db.close()


def test_stream_proxy_ignores_client_user_header(monkeypatch):
    """P0-5：客户端伪造 X-User-ID 被忽略；代理以服务端鉴权身份连接上游。"""
    import threading
    from http.server import BaseHTTPRequestHandler, HTTPServer

    from app import agentscope_client as rt

    seen: dict[str, str] = {}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            seen["user"] = self.headers.get("X-User-ID", "")
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            self.wfile.write(b"data: {}\n\n")
            self.wfile.flush()

        def log_message(self, *args):  # noqa: D102
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    port = server.server_address[1]
    t = threading.Thread(target=server.handle_request, daemon=True)
    t.start()
    monkeypatch.setattr(
        rt, "stream_url", lambda sid, runtime_id: f"http://127.0.0.1:{port}/stream"
    )
    db = SessionLocal()
    try:
        from app.models import Agent as AgentModel
        from app.models import AgentSessionIndex

        agent = db.query(AgentModel).order_by(AgentModel.created_at.desc()).first()
        db.query(AgentSessionIndex).filter_by(session_id="proxy-test-session").delete(
            synchronize_session=False
        )
        db.commit()
        db.add(
            AgentSessionIndex(
                session_id="proxy-test-session",
                user_id="dev",
                agent_id=agent.id,
                runtime_agent_id="rt-proxy",
                trigger_kind="manual",
            )
        )
        db.commit()
        aid = agent.id
    finally:
        db.close()
    r = client.get(
        f"/api/v2/agents/{aid}/sessions/proxy-test-session/stream",
        headers={"X-User-ID": "evil-impersonator"},
    )
    assert r.status_code == 200
    t.join(timeout=5)
    server.server_close()
    assert seen.get("user") == "dev"


def test_rerun_downstream_computation():
    """P0-1：重跑目标+下游集合与拓扑序单元验证。"""
    edges = [{"from": "n1", "to": "n2"}, {"from": "n2", "to": "n3"}]
    assert _downstream("n1", edges) == {"n2", "n3"}
    assert _downstream("n3", edges) == set()
    assert _topo_order(["n3", "n1", "n2"], edges) == ["n1", "n2", "n3"]
