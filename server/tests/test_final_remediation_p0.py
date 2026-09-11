"""最终清零轮 P0 回归测试（2026-09-10）。

逐项对应任务书 §二：
- P0-01 Knowledge 注册 fail-closed，禁止 synthetic kb_* ID；
- P0-02 模型参数从发布快照进入 SessionConfig，草稿修改不漂移；
- P0-03 Schedule 钉住 Release（重发布→重建，不漂移）；
- P0-04 Release 环境显式解析，禁止跨环境静默降级；
- P0-05 AgentFlow definition_id → version → active release 正确链路；
- P0-06 同 (agent, environment) 至多一个 active Release（DB 约束）；
- P0-07 旧 Runtime 退役不变量（无生产入口 import）；
- P0-08 内部 Tool 回调会话令牌绑定 + Release 清单白名单。

全部使用真实生产函数/真实 DB（wf_test 经 conftest），不复制实现。
"""
from __future__ import annotations

import hashlib
import threading
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app import agent_execution as ex
from app import agentscope_client as rt
from app.db import SessionLocal
from app.main import app
from app.models import (
    Agent,
    AgentFlowDefinition,
    AgentFlowRelease,
    AgentFlowVersion,
    AgentSessionIndex,
    AutomationDefinition,
    AutomationTrigger,
    Connection,
    KnowledgeSource,
    Model,
    ModelProvider,
    Release,
)

client = TestClient(app)


def u(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


# ---------------------------------------------------------------------------
# fixtures / helpers
# ---------------------------------------------------------------------------

def _make_model(model_key: str, default_params: dict | None = None) -> tuple[str, str]:
    """带鉴权连接的真实 Model 行；返回 (model id, model_key)。"""
    db = SessionLocal()
    try:
        conn = Connection(
            name=u("conn"), kind="api_key", protocol="llm",
            endpoint={"base_url": "http://127.0.0.1:1/"},
            secret_ref=f"sk-test-{uuid.uuid4().hex}",
        )
        db.add(conn)
        db.commit()
        prov = ModelProvider(name=u("prov"), base_url="http://127.0.0.1:1/",
                             auth_connection_id=conn.id)
        db.add(prov)
        db.commit()
        model = Model(provider_id=prov.id, model_key=model_key,
                      display_name=model_key, capabilities=["text"],
                      default_params=default_params or {}, enabled=True)
        db.add(model)
        db.commit()
        return model.id, model.model_key
    finally:
        db.close()


def _make_custom_agent(model_id: str, model_key: str, name: str | None = None) -> str:
    """custom 类型（agent-create 产物语义）：modelRef.modelId 按现行前端约定
    携带 modelKey，default_model_id 携带平台 Model id——解析链必须两者都认
    （任务书 §六.7：不能靠碰巧相等工作）。"""
    db = SessionLocal()
    try:
        agent = Agent(
            name=(name or u("finAG"))[:20],
            type="custom",
            status="draft",
            config={
                "rolePrompt": "你是最终清零轮测试 Agent。",
                "modelRef": {"modelId": model_key},
                "default_model_id": model_id,
            },
        )
        db.add(agent)
        db.commit()
        return agent.id
    finally:
        db.close()


def _make_version(agent_id: str) -> str:
    r = client.post(f"/api/agents/{agent_id}/versions", json={"note": "fin"})
    assert r.status_code == 201, r.text
    body = r.json()
    return body.get("versionId") or body.get("id")


def _publish(agent_id: str, version_id: str, env: str = "prod") -> dict:
    r = client.post(
        f"/api/agents/{agent_id}/releases",
        json={"versionId": version_id, "environment": env},
    )
    assert r.status_code in (200, 201), r.text
    return r.json()


@pytest.fixture()
def fake_runtime(monkeypatch):
    """把运行时 HTTP 边界替换为可控 fake（断言平台传给运行时的真实参数）。

    不复制生产逻辑——生产函数（materialize_release/start_session/...）原样
    执行，只有跨进程 HTTP 客户端被拦截。
    """
    calls: dict = {"sessions": [], "schedules": [], "agents": [], "kb_list": [],
                   "kb_create": []}

    def create_agent(user_id, name, system_prompt, **cfg):
        calls["agents"].append({"name": name, "system_prompt": system_prompt})
        return f"rt-agent-{uuid.uuid4().hex[:10]}"

    def get_agent(user_id, agent_id):
        raise rt.RuntimeError_(404, "not found")

    def create_session(user_id, agent_id, chat_model_config,
                       knowledge_base_ids=None, internal_token=None):
        calls["sessions"].append({
            "agent_id": agent_id,
            "chat_model_config": chat_model_config,
            "knowledge_base_ids": list(knowledge_base_ids or []),
            "internal_token": internal_token,
        })
        return f"rt-session-{uuid.uuid4().hex[:10]}"

    def ensure_credential(user_id, kind, api_key, base_url):
        return f"rt-cred-{uuid.uuid4().hex[:8]}"

    def create_schedule(user_id, **body):
        calls["schedules"].append(body)
        return f"rt-sched-{uuid.uuid4().hex[:8]}"

    def patch_schedule(user_id, schedule_id, **patch):
        calls.setdefault("patched", []).append({"id": schedule_id, **patch})
        return {"ok": True}

    def delete_schedule(user_id, schedule_id):
        calls.setdefault("deleted", []).append(schedule_id)

    def list_knowledge_bases(user_id):
        calls["kb_list"].append(user_id)
        return calls.get("kb_rows", [])

    def create_knowledge_base(user_id, name, embedding_model_config):
        calls["kb_create"].append({"name": name, "cfg": embedding_model_config})
        if calls.get("kb_create_fail"):
            raise rt.RuntimeError_(500, "embedding provider unreachable")
        return f"rt-kb-{uuid.uuid4().hex[:10]}"

    def upload_workspace_skill(*a, **k):
        return None

    def add_workspace_mcp(*a, **k):
        return None

    monkeypatch.setattr(rt, "create_agent", create_agent)
    monkeypatch.setattr(rt, "get_agent", get_agent)
    monkeypatch.setattr(rt, "update_agent", lambda *a, **k: {})
    monkeypatch.setattr(rt, "create_session", create_session)
    monkeypatch.setattr(rt, "ensure_credential", ensure_credential)
    monkeypatch.setattr(rt, "create_schedule", create_schedule)
    monkeypatch.setattr(rt, "patch_schedule", patch_schedule)
    monkeypatch.setattr(rt, "delete_schedule", delete_schedule)
    monkeypatch.setattr(rt, "list_knowledge_bases", list_knowledge_bases)
    monkeypatch.setattr(rt, "create_knowledge_base", create_knowledge_base)
    monkeypatch.setattr(rt, "upload_workspace_skill", upload_workspace_skill)
    monkeypatch.setattr(rt, "add_workspace_mcp", add_workspace_mcp)
    return calls


# ---------------------------------------------------------------------------
# P0-01 Knowledge fail-closed
# ---------------------------------------------------------------------------

def test_p0_01_kb_registration_failure_blocks_publish(fake_runtime):
    """注册失败（无鉴权/网络）→ 发布被阻止；绝不产生 synthetic kb_* ID。"""
    model_id, model_key = _make_model(u("qwen-fin"))
    aid = _make_custom_agent(model_id, model_key)
    db = SessionLocal()
    try:
        ks = KnowledgeSource(name=u("ks"), kind="vector", status="enabled",
                             embedding_model_id=None)  # 缺 embedding 配置
        db.add(ks)
        db.commit()
        a = db.get(Agent, aid)
        a.config = {**(a.config or {}), "knowledges": [ks.id]}
        db.commit()
        ks_id = ks.id
    finally:
        db.close()

    vid = _make_version(aid)
    r = client.post(f"/api/agents/{aid}/releases",
                    json={"versionId": vid, "environment": "prod"})
    assert r.status_code == 422, r.text
    assert "KNOWLEDGE_PROVIDER_UNAVAILABLE" in r.text

    # 发布被整体回滚：不存在 active release，更没有伪造 binding
    db = SessionLocal()
    try:
        actives = db.query(Release).filter_by(agent_id=aid, status="active").all()
        assert actives == []
        for rel in db.query(Release).filter_by(agent_id=aid).all():
            frozen = (rel.runtime_binding_snapshot or {}).get("_frozen_knowledges") or {}
            for kid, fk in frozen.items():
                assert fk.get("runtime_kb_id") != f"kb_{kid}"
    finally:
        db.delete(db.get(KnowledgeSource, ks_id))
        db.commit()
        db.close()


def test_p0_01_kb_success_freezes_real_runtime_id(fake_runtime):
    """注册成功 → 冻结的是 AgentScope 返回的真实 ID；幂等走官方 list。"""
    model_id, model_key = _make_model(u("qwen-fin"))
    emb_id, _emb_key = _make_model("text-embedding-v3")
    aid = _make_custom_agent(model_id, model_key)
    db = SessionLocal()
    try:
        ks = KnowledgeSource(name=u("ks"), kind="vector", status="enabled",
                             embedding_model_id=emb_id)
        db.add(ks)
        db.commit()
        a = db.get(Agent, aid)
        a.config = {**(a.config or {}), "knowledges": [ks.id]}
        db.commit()
        ks_id = ks.id
    finally:
        db.close()

    vid = _make_version(aid)
    rel = _publish(aid, vid)
    db = SessionLocal()
    try:
        row = db.get(Release, rel["releaseId"])
        frozen = (row.runtime_binding_snapshot or {})["_frozen_knowledges"][ks_id]
        assert frozen["runtime_kb_id"].startswith("rt-kb-"), frozen
        assert frozen["mount_status"] == "mounted"
        # embedding 配置含官方必填字段（旧实现缺 credential_id/dimensions 恒 422）
        cfg = fake_runtime["kb_create"][0]["cfg"]
        assert cfg["credential_id"] and cfg["dimensions"] > 0
    finally:
        db.delete(db.get(KnowledgeSource, ks_id))
        db.commit()
        db.close()


def test_p0_01_session_never_passes_platform_or_synthetic_kb_id(fake_runtime):
    """start_session 只传真实 runtime KB id；遗留 synthetic/平台 id 被丢弃。"""
    model_id, model_key = _make_model(u("qwen-fin"))
    aid = _make_custom_agent(model_id, model_key)
    vid = _make_version(aid)
    rel = _publish(aid, vid)
    db = SessionLocal()
    try:
        row = db.get(Release, rel["releaseId"])
        snap = dict(row.runtime_binding_snapshot or {})
        # 伪造一个遗留 binding：platform id 直传 + synthetic kb_ id
        snap["_frozen_knowledges"] = {
            "ks-platform-id": {"runtime_kb_id": "ks-platform-id",
                               "mount_status": "mounted"},
            "ks-synthetic": {"runtime_kb_id": "kb_ks-synthetic",
                             "mount_status": "mounted"},
            "ks-real": {"runtime_kb_id": "rt-kb-real-1",
                        "mount_status": "mounted"},
            "ks-disabled": {"runtime_kb_id": "rt-kb-off",
                            "mount_status": "disabled"},
        }
        snap["resources"] = {**(snap.get("resources") or {}),
                             "knowledge_ids": ["ks-platform-id", "ks-synthetic",
                                               "ks-real", "ks-disabled"]}
        row.runtime_binding_snapshot = snap
        row.runtime_binding_snapshot = dict(snap)  # JSONB 变更标记
        db.commit()
        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(row, "runtime_binding_snapshot")
        db.commit()

        agent = db.get(Agent, aid)
        idx = ex.start_session(db, "dev", agent, trigger_kind="manual")
        sent = fake_runtime["sessions"][-1]["knowledge_base_ids"]
        assert sent == ["rt-kb-real-1"], sent
    finally:
        db.close()


# ---------------------------------------------------------------------------
# P0-02 模型参数冻结
# ---------------------------------------------------------------------------

def test_p0_02_model_params_come_from_release_snapshot(fake_runtime):
    """发布快照参数进入 SessionConfig；草稿/Model 行事后修改不漂移。"""
    model_id, model_key = _make_model(
        u("qwen-fin"),
        default_params={"temperature": 0.3, "max_tokens": 2048,
                        "top_p": 0.9, "timeout": 90, "bogus_key": "x"})
    aid = _make_custom_agent(model_id, model_key)
    vid = _make_version(aid)
    rel = _publish(aid, vid)

    # 发布后修改 Model 行参数与 Agent 草稿——均不得影响已发布执行
    db = SessionLocal()
    try:
        m = db.get(Model, model_id)
        m.default_params = {"temperature": 1.9}
        a = db.get(Agent, aid)
        a.config = {**(a.config or {}),
                    "modelRef": {"modelId": model_id,
                                 "params": {"temperature": 1.8}}}
        db.commit()

        row = db.get(Release, rel["releaseId"])
        snap = row.runtime_binding_snapshot or {}
        assert snap["frozen_model_id"] == model_id
        params = snap["frozen_model_params"]
        assert params == {"temperature": 0.3, "max_tokens": 2048, "top_p": 0.9}
        assert snap["frozen_exec_timeout_seconds"] == 90.0
        assert "bogus_key" not in params  # 白名单过滤

        agent = db.get(Agent, aid)
        idx = ex.start_session(db, "dev", agent, trigger_kind="manual")
        cfg = fake_runtime["sessions"][-1]["chat_model_config"]
        assert cfg["parameters"] == {"temperature": 0.3, "max_tokens": 2048,
                                     "top_p": 0.9}
        assert cfg["model"] == m.model_key
        assert idx.release_id == rel["releaseId"]
    finally:
        db.close()


def test_p0_02_split_model_params_whitelist():
    params, timeout = ex.split_model_params(
        {"temperature": 0.5, "timeout": 30, "unknown": 1, "top_p": None}
    )
    assert params == {"temperature": 0.5}
    assert timeout == 30.0


def test_p0_02_thinking_params_freeze_per_agent(fake_runtime):
    """每 Agent 深度思考开关：modelRef.params 的 thinking_enable/thinking_budget
    在发布时冻结进 release 快照，并原样进入运行时 SessionConfig（09-11 治理轮 P1）。"""
    model_id, model_key = _make_model(u("qwen-think"), default_params={})
    aid = _make_custom_agent(model_id, model_key)
    db = SessionLocal()
    try:
        a = db.get(Agent, aid)
        a.config = {**(a.config or {}),
                    "modelRef": {"modelId": model_key,
                                 "params": {"thinking_enable": True,
                                            "thinking_budget": 8192}}}
        db.commit()
    finally:
        db.close()
    vid = _make_version(aid)
    rel = _publish(aid, vid)

    db = SessionLocal()
    try:
        row = db.get(Release, rel["releaseId"])
        params = (row.runtime_binding_snapshot or {})["frozen_model_params"]
        assert params == {"thinking_enable": True, "thinking_budget": 8192}, params
        agent = db.get(Agent, aid)
        ex.start_session(db, "dev", agent, trigger_kind="manual")
        cfg = fake_runtime["sessions"][-1]["chat_model_config"]
        assert cfg["parameters"] == {"thinking_enable": True, "thinking_budget": 8192}
    finally:
        db.close()


# ---------------------------------------------------------------------------
# P0-03 Schedule 钉住 Release
# ---------------------------------------------------------------------------

def test_p0_03_schedule_pins_release_and_rebuilds_on_republish(fake_runtime):
    from app.routers.as_automations import _sync_schedule

    model_id, model_key = _make_model(u("qwen-fin"), default_params={"temperature": 0.2})
    aid = _make_custom_agent(model_id, model_key)
    vid = _make_version(aid)
    rel1 = _publish(aid, vid)

    db = SessionLocal()
    try:
        auto = AutomationDefinition(name=u("fin-sched"), target_kind="agent",
                                    agent_id=aid, enabled=True,
                                    session_policy="fresh", created_by="dev")
        db.add(auto)
        db.commit()
        db.add(AutomationTrigger(automation_id=auto.id, kind="schedule",
                                 config={"cron": "0 9 * * *",
                                         "timezone": "Asia/Shanghai"},
                                 enabled=True))
        db.commit()

        _sync_schedule(db, "dev", auto)
        assert auto.runtime_schedule_id, "Schedule 未创建"
        assert auto.runtime_release_id == rel1["releaseId"], "Schedule 未钉住 Release"
        sched = fake_runtime["schedules"][-1]
        assert sched["chat_model_config"]["parameters"] == {"temperature": 0.2}
        first_sched_id = auto.runtime_schedule_id

        # 重新发布 → 下一次 sync 必须删旧建新（钉住新 Release，不漂移）
        vid2 = _make_version(aid)
        rel2 = _publish(aid, vid2)
        assert rel2["releaseId"] != rel1["releaseId"]
        _sync_schedule(db, "dev", auto)
        assert auto.runtime_release_id == rel2["releaseId"]
        assert auto.runtime_schedule_id != first_sched_id
        assert first_sched_id in fake_runtime.get("deleted", [])
        assert len(fake_runtime["schedules"]) == 2

        # 同 Release 再次 sync → 仅 patch，不重建
        _sync_schedule(db, "dev", auto)
        assert len(fake_runtime["schedules"]) == 2
        assert any(p["id"] == auto.runtime_schedule_id
                   for p in fake_runtime.get("patched", []))

        db.delete(db.get(AutomationDefinition, auto.id))
        db.commit()
    finally:
        db.close()


# ---------------------------------------------------------------------------
# P0-04 环境显式
# ---------------------------------------------------------------------------

def test_p0_04_environment_strict_no_silent_downgrade(fake_runtime):
    model_id, model_key = _make_model(u("qwen-fin"))
    aid = _make_custom_agent(model_id, model_key)
    vid = _make_version(aid)
    _publish(aid, vid, env="sandbox")  # 仅 sandbox

    db = SessionLocal()
    try:
        agent = db.get(Agent, aid)
        with pytest.raises(ValueError, match="prod"):
            ex.resolve_runtime_agent(db, "dev", agent, environment="prod")
        rid, rel = ex.resolve_runtime_agent(db, "dev", agent, environment="sandbox")
        assert rid and rel.environment == "sandbox"
        with pytest.raises(ValueError):
            ex.resolve_runtime_agent(db, "dev", agent, environment="staging")

        # prod 发布后：prod 解析只命中 prod Release
        rel_prod = _publish(aid, vid, env="prod")
        _rid, rel2 = ex.resolve_runtime_agent(db, "dev", agent, environment="prod")
        assert rel2.id == rel_prod["releaseId"]
    finally:
        db.close()


# ---------------------------------------------------------------------------
# P0-05 AgentFlow definition_id 解析
# ---------------------------------------------------------------------------

def test_p0_05_agentflow_definition_resolves_via_version_chain():
    from app.agentflow_executor import resolve_agentflow_release

    db = SessionLocal()
    try:
        d = AgentFlowDefinition(name=u("finflow"), created_by="dev")
        db.add(d)
        db.commit()
        v = AgentFlowVersion(definition_id=d.id, version_no=1,
                             definition={"nodes": [], "edges": []},
                             content_digest="x", created_by="dev")
        db.add(v)
        db.commit()
        rel = AgentFlowRelease(version_id=v.id, definition_id=d.id,
                               environment="sandbox", status="active")
        db.add(rel)
        db.commit()

        # 旧 bug：把 definition_id 当 version_id 查 → 必然 miss；
        # 正确链路 definition → version → active release
        got = resolve_agentflow_release(db, definition_id=d.id)
        assert got.id == rel.id
        got2 = resolve_agentflow_release(db, release_id=rel.id)
        assert got2.id == rel.id
        with pytest.raises(ValueError):
            resolve_agentflow_release(db, definition_id=u("nope"))
        # version_id 冒充 definition_id 不得命中
        with pytest.raises(ValueError):
            resolve_agentflow_release(db, definition_id=v.id)
    finally:
        db.close()


# ---------------------------------------------------------------------------
# P0-06 active Release 唯一性（DB 约束 + 并发）
# ---------------------------------------------------------------------------

def test_p0_06_db_rejects_second_active_release_same_env():
    db = SessionLocal()
    try:
        model_id, model_key = _make_model(u("qwen-fin"))
        aid = _make_custom_agent(model_id, model_key)
        vid = _make_version(aid)
        rel = _publish(aid, vid, env="prod")
        # 直接插入第二条 active prod Release → 唯一索引拒绝
        with pytest.raises(IntegrityError):
            db.execute(text(
                "INSERT INTO release (id, agent_id, agent_version_id, environment,"
                " status, canary_percent, created_by, created_at)"
                " VALUES (:id, :aid, :vid, 'prod', 'active', 0, 'dev', NOW())"
            ), {"id": uuid.uuid4().hex[:32], "aid": aid, "vid": vid})
            db.commit()
        db.rollback()
        actives = db.query(Release).filter_by(agent_id=aid, environment="prod",
                                              status="active").count()
        assert actives == 1
        assert db.get(Release, rel["releaseId"]) is not None
    finally:
        db.close()


def test_p0_06_concurrent_publish_keeps_single_active(fake_runtime):
    """两个线程同时发布同一 Agent 同一环境 → 恰好一条 active。"""
    model_id, model_key = _make_model(u("qwen-fin"))
    aid = _make_custom_agent(model_id, model_key)
    vid = _make_version(aid)
    errors: list = []

    def publish_once():
        try:
            r = client.post(f"/api/agents/{aid}/releases",
                            json={"versionId": vid, "environment": "prod"})
            assert r.status_code in (200, 201, 409), r.text
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=publish_once) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert not errors, errors
    db = SessionLocal()
    try:
        actives = db.query(Release).filter_by(agent_id=aid, environment="prod",
                                              status="active").all()
        assert len(actives) == 1, [a.id for a in actives]
    finally:
        db.close()


# ---------------------------------------------------------------------------
# P0-07 旧 Runtime 退役不变量
# ---------------------------------------------------------------------------

def test_p0_07_no_production_import_of_runtime_providers_worker():
    """业务结算走中立模块；生产入口不得 import runtime_providers.worker。"""
    import app.agent_execution as ae
    import app.agent_runtime as art
    import app.run_settlement as rs
    import inspect

    ae_src = inspect.getsource(ae)
    art_src = inspect.getsource(art)
    assert "runtime_providers.worker" not in ae_src
    assert "runtime_providers.worker" not in art_src
    assert hasattr(rs, "settle_module_result")
    # 中立结算模块不依赖 runtime_providers
    rs_src = inspect.getsource(rs)
    assert "runtime_providers" not in rs_src.replace(
        "从 runtime_providers.worker 迁出", "")


def test_p0_07_legacy_chat_dead_code_removed():
    import inspect

    from app import agent_chat

    src = inspect.getsource(agent_chat)
    assert not hasattr(agent_chat, "execute_chat_turn")
    assert not hasattr(agent_chat, "resolve_model_key")
    # 不得再 import 旧执行引擎/worker 链路（docstring 提及退役历史不算）
    code = "\n".join(ln for ln in src.splitlines()
                     if not ln.strip().startswith(("#", '"""', "-")))
    assert "from .agent_runtime import" not in code
    assert "JobQueue" not in code


def test_p0_07_main_does_not_import_runtime_providers_router():
    import inspect

    from app import main

    src = inspect.getsource(main)
    code_lines = [ln for ln in src.splitlines()
                  if not ln.strip().startswith("#")]
    assert not any("runtime_providers" in ln for ln in code_lines)


def test_p0_07_run_session_backlink_uses_dedicated_column():
    """Session 反链写专名列 agentscope_session_id，不再借 provider 字段。"""
    import inspect

    from app import agent_execution as ae

    src = inspect.getsource(ae.run_into_existing_run)
    assert "agentscope_session_id" in src
    assert "runtime_provider_run_id" not in src


# ---------------------------------------------------------------------------
# P0-08 内部 Tool 回调鉴权
# ---------------------------------------------------------------------------

@pytest.fixture()
def internal_token_env(monkeypatch):
    from app.routers import as_flows_board as fb

    monkeypatch.setattr(fb, "INTERNAL_TOKEN", "fin-internal-token")
    return "fin-internal-token"


def _make_bound_session(release_id: str | None, token: str | None,
                        user_id: str = "dev") -> str:
    sid = f"rt-session-{uuid.uuid4().hex[:10]}"
    db = SessionLocal()
    try:
        idx = AgentSessionIndex(
            session_id=sid, user_id=user_id, agent_id="fin-agent-x",
            release_id=release_id, trigger_kind="manual",
            session_token_hash=(hashlib.sha256(token.encode()).hexdigest()
                                if token else None),
        )
        db.add(idx)
        db.commit()
        return sid
    finally:
        db.close()


def test_p0_08_session_token_required_and_bound(internal_token_env):
    token = uuid.uuid4().hex
    sid = _make_bound_session(None, token)
    other_sid = _make_bound_session(None, uuid.uuid4().hex)
    h = {"X-MTC-Internal": internal_token_env}

    # 无会话令牌 → 401（共享 Token 存在≠完整鉴权）
    r = client.get("/api/internal/agent-tools/session-manifest",
                   params={"session_id": sid}, headers=h)
    assert r.status_code == 401

    # 错误令牌 → 401
    r = client.get("/api/internal/agent-tools/session-manifest",
                   params={"session_id": sid},
                   headers={**h, "X-MTC-Session-Token": "wrong"})
    assert r.status_code == 401

    # A 会话令牌访问 B 会话 → 401
    r = client.get("/api/internal/agent-tools/session-manifest",
                   params={"session_id": other_sid},
                   headers={**h, "X-MTC-Session-Token": token})
    assert r.status_code == 401

    # 正确令牌 → 200
    r = client.get("/api/internal/agent-tools/session-manifest",
                   params={"session_id": sid},
                   headers={**h, "X-MTC-Session-Token": token})
    assert r.status_code == 200

    # 外部请求（无共享 Token）→ 401/501，绝不放行
    r = client.get("/api/internal/agent-tools/session-manifest",
                   params={"session_id": sid},
                   headers={"X-MTC-Session-Token": token})
    assert r.status_code in (401, 501)


def test_p0_08_platform_tool_enforces_release_manifest(internal_token_env,
                                                       fake_runtime):
    """run-platform-tool 只允许该 Session Release 冻结清单内的 ToolVersion。"""
    from app.models import Tool, ToolVersion

    model_id, model_key = _make_model(u("qwen-fin"))
    aid = _make_custom_agent(model_id, model_key)
    db = SessionLocal()
    try:
        tool = Tool(name=u("fintool"), description="fin", kind="http")
        db.add(tool)
        db.commit()
        tv = ToolVersion(tool_id=tool.id, version_no=1, status="ready",
                         input_schema={"type": "object", "properties": {}},
                         spec={"type": "http",
                               "endpoint": {"base_url": "http://127.0.0.1:1/"}})
        db.add(tv)
        db.commit()
        a = db.get(Agent, aid)
        a.config = {**(a.config or {}), "tools": [tool.id]}
        db.commit()
        tool_id, tv_id = tool.id, tv.id
    finally:
        db.close()

    vid = _make_version(aid)
    rel = _publish(aid, vid)

    token = uuid.uuid4().hex
    sid = _make_bound_session(rel["releaseId"], token)
    h = {"X-MTC-Internal": internal_token_env, "X-MTC-Session-Token": token}

    # 清单外 ToolVersion → 403
    r = client.post("/api/internal/agent-tools/run-platform-tool",
                    json={"tool_version_id": u("tv"), "args": {},
                          "session_id": sid}, headers=h)
    assert r.status_code == 403

    # 清单内 ToolVersion → 通过鉴权到达执行层（执行层失败≠鉴权失败）
    r = client.post("/api/internal/agent-tools/run-platform-tool",
                    json={"tool_version_id": tv_id, "args": {},
                          "session_id": sid}, headers=h)
    assert r.status_code != 403, r.text
    assert r.status_code != 401, r.text


def test_p0_08_session_manifest_lists_only_release_tools(internal_token_env,
                                                         fake_runtime):
    from app.models import Tool, ToolVersion

    model_id, model_key = _make_model(u("qwen-fin"))
    aid = _make_custom_agent(model_id, model_key)
    db = SessionLocal()
    try:
        tool = Tool(name=u("fintool2"), description="fin2", kind="http")
        db.add(tool)
        db.commit()
        tv = ToolVersion(tool_id=tool.id, version_no=1, status="ready",
                         input_schema={"type": "object", "properties": {}},
                         spec={"type": "http",
                               "endpoint": {"base_url": "http://127.0.0.1:1/"}})
        db.add(tv)
        db.commit()
        a = db.get(Agent, aid)
        a.config = {**(a.config or {}), "tools": [tool.id]}
        db.commit()
        tv_id = tv.id
    finally:
        db.close()

    vid = _make_version(aid)
    rel = _publish(aid, vid)
    token = uuid.uuid4().hex
    sid = _make_bound_session(rel["releaseId"], token)
    r = client.get("/api/internal/agent-tools/session-manifest",
                   params={"session_id": sid},
                   headers={"X-MTC-Internal": internal_token_env,
                            "X-MTC-Session-Token": token})
    assert r.status_code == 200
    tool_version_ids = [t["tool_version_id"] for t in r.json()["tool_ids"]]
    assert tv_id in tool_version_ids


def test_p0_08_start_session_mints_unique_token(fake_runtime):
    """每个新 Session 签发独立令牌；平台只存哈希，原文交运行时。"""
    model_id, model_key = _make_model(u("qwen-fin"))
    aid = _make_custom_agent(model_id, model_key)
    vid = _make_version(aid)
    _publish(aid, vid)
    db = SessionLocal()
    try:
        agent = db.get(Agent, aid)
        idx = ex.start_session(db, "dev", agent, trigger_kind="manual")
        raw = fake_runtime["sessions"][-1]["internal_token"]
        assert raw and idx.session_token_hash
        assert idx.session_token_hash == hashlib.sha256(raw.encode()).hexdigest()
        idx2 = ex.start_session(db, "dev", agent, trigger_kind="manual")
        raw2 = fake_runtime["sessions"][-1]["internal_token"]
        assert raw2 != raw
    finally:
        db.close()
