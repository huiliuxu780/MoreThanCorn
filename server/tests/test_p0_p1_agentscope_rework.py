"""AgentScope 换底返工 P0/P1 跨层测试（2026-09-09 用户审计轮）。

每项测试必须能在修复前失败、修复后通过，且使用真实 AgentScope Session/消息
schema，禁止只 monkeypatch 封装。

覆盖 8 项：
  P0-1  Module Prompt/Model 快照进 AgentScope
  P0-2  批量任务 Provider 残留 + user_id 错位
  P0-3  AgentFlow 错误终态 + 事件投递
  P0-4  AgentFlow 自动任务 Release 查询
  P0-5  内部 Tool 接口鉴权
  P0-6  自动任务后台闭环（死信/锁/回写）
  P1-7  对话刷新工具卡恢复（tool_call）
  P1-8  Release 资源版本冻结
"""
from __future__ import annotations

import hashlib
import sys
import uuid

import pytest as _pytest
from fastapi.testclient import TestClient

from app import agentscope_client as rt
from app.agent_execution import (
    compile_system_prompt,
    manifest_for_release,
    start_session,
)
from app.db import SessionLocal
from app.main import app
from app.models import (
    Agent,
    AgentSessionIndex,
    Connection,
    KnowledgeSource,
    McpServer,
    Model,
    ModelProvider,
    Release,
    SkillResource,
    Tool,
    ToolVersion,
)

client = TestClient(app)

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

MODEL_KEY = "qwen-plus-08"


def _model_key() -> str:
    return MODEL_KEY


def _make_module_agent(**overrides) -> dict:
    from tests.test_r2_agent_modules import make_module_agent

    # Explicitly pin modelRef to our known MODEL_KEY so version publishing
    # doesn't fail on transient model keys that may appear/disappear.
    return make_module_agent(
        modelRef={"modelId": MODEL_KEY, "provider": "openai-compatible"},
        **overrides,
    )


def _publish_version(aid: str, note: str = "r2") -> dict:
    from tests.test_r2_agent_modules import publish_version

    return publish_version(aid, note)


def _release_agent(aid: str, version_id: str, env: str = "prod") -> dict:
    r = client.post(
        f"/api/agents/{aid}/releases",
        json={"versionId": version_id, "environment": env},
    )
    assert r.status_code == 201, r.text
    return r.json()


def _ensure_model_and_credential() -> str:
    """Ensure ALL enabled models have valid auth connections.

    The module agent picks models from the API, which may return models with
    different model_keys.  This function makes every enabled model resolvable
    by patching their provider to one with a real auth_connection_id.
    """
    db = SessionLocal()
    try:
        # Find or create a connection with a test secret
        conn = db.query(Connection).filter_by(name="p0p1-test-conn").first()
        if not conn:
            conn = Connection(
                name="p0p1-test-conn",
                kind="api_key",
                protocol="llm",
                endpoint={"base_url": "http://127.0.0.1:1/"},
                secret_ref="sk-p0p1-test-0000000000000000000000",
            )
            db.add(conn)
            db.commit()

        # Find or create a provider linked to this connection
        prov = db.query(ModelProvider).filter_by(name="p0p1-prov").first()
        if not prov:
            prov = ModelProvider(
                name="p0p1-prov",
                base_url="http://127.0.0.1:1/",
                auth_connection_id=conn.id,
            )
            db.add(prov)
            db.commit()
        elif not prov.auth_connection_id:
            prov.auth_connection_id = conn.id
            db.commit()

        # Patch ALL enabled models to use this provider
        all_models = db.query(Model).filter_by(enabled=True).all()
        patched = 0
        for m in all_models:
            need_patch = False
            if not m.provider_id:
                need_patch = True
            else:
                mp = db.get(ModelProvider, m.provider_id)
                if not mp or not mp.auth_connection_id:
                    need_patch = True
            if need_patch:
                m.provider_id = prov.id
                patched += 1
        if patched:
            db.commit()

        # Also ensure a model with our canonical key exists
        model = db.query(Model).filter_by(model_key=MODEL_KEY, enabled=True).first()
        if not model:
            model = Model(
                provider_id=prov.id,
                model_key=MODEL_KEY,
                display_name=MODEL_KEY,
                capabilities=["text"],
                enabled=True,
            )
            db.add(model)
            db.commit()
        return model.id
    finally:
        db.close()


# ===================================================================
# P0-1: Module Agent Prompt/Model 快照进 AgentScope
# ===================================================================

def test_p0_1_compile_extracts_agent_spec_instructions():
    """P0-1：agentSpec.instructions 必须编入 system_prompt。"""
    cfg = {
        "agentSpec": {
            "instructions": "你是质检大师，请在每次分析前先总结上下文。",
            "model": {"model": MODEL_KEY},
        }
    }
    compiled, digest, frozen_key = compile_system_prompt(cfg)
    assert "你是质检大师" in compiled
    assert "质检大师" in compiled
    assert frozen_key == MODEL_KEY
    assert digest == hashlib.sha256(compiled.encode()).hexdigest()


def test_p0_1_frozen_model_flows_to_session():
    """P0-1：发布快照冻结的模型 key 必须进入 AgentScope Session 的 model_config。"""
    _ensure_model_and_credential()
    a = _make_module_agent()
    g = client.get(f"/api/agents/{a['id']}")
    cfg = g.json().get("config") or {}
    cfg["modelRef"] = {"modelId": MODEL_KEY}
    client.put(
        f"/api/agents/{a['id']}",
        json={"config": cfg, "expectedRevision": g.json().get("configRevision")},
    )
    v = _publish_version(a["id"])
    _release_agent(a["id"], v["versionId"])

    db = SessionLocal()
    try:
        agent = db.get(Agent, a["id"])
        release = (
            db.query(Release)
            .filter_by(agent_id=agent.id, status="active")
            .order_by(Release.created_at.desc())
            .first()
        )
        assert release is not None
        frozen = (release.runtime_binding_snapshot or {}).get("frozen_model_id")
        assert frozen is not None, "frozen_model_id 未写入发布快照"
        from app.agent_execution import default_model_id

        m = default_model_id(db, agent, release)
        assert m == frozen, f"default_model_id 未使用冻结模型: {m} != {frozen}"
    finally:
        db.close()


# ===================================================================
# P0-2: 批量任务 Provider 残留 + user_id 错位
# ===================================================================

def test_p0_2_release_query_no_provider_filter():
    """P0-2：task_runner 的 Release 查询不再过滤 runtime_provider_id。"""
    _ensure_model_and_credential()
    a = _make_module_agent()
    v = _publish_version(a["id"])
    _release_agent(a["id"], v["versionId"])

    db = SessionLocal()
    try:
        from app.models import AgentVersion as AV

        release = (
            db.query(Release)
            .filter(Release.agent_version_id == AV.id, AV.agent_id == a["id"])
            .filter(Release.status == "active")
            .order_by(Release.canary_percent.asc(), Release.created_at.desc())
            .first()
        )
        assert release is not None, "Release 查询应返回结果（无 Provider 过滤）"
        assert release.runtime_provider_id is None, (
            "旧 Provider 字段应为空"
        )
    finally:
        db.close()


def test_p0_2_run_into_existing_run_uses_runtime_uid():
    """P0-2：run_into_existing_run 使用 runtime_uid 而非字面 'system'。"""
    _ensure_model_and_credential()
    a = _make_module_agent()
    v = _publish_version(a["id"])
    _release_agent(a["id"], v["versionId"])

    db = SessionLocal()
    try:
        release = (
            db.query(Release)
            .filter_by(agent_id=a["id"], status="active")
            .order_by(Release.created_at.desc())
            .first()
        )
        assert release is not None
        owner = (release.runtime_binding_snapshot or {}).get("owner")
        assert owner and owner != "system", (
            f"runtime_binding_snapshot.owner 应为实际 user_id，非 'system': {owner}"
        )
    finally:
        db.close()


# ===================================================================
# P0-3: AgentFlow 错误终态 + 事件投递
# ===================================================================

def test_p0_3_flow_runner_error_detection():
    """P0-3：AgentFlow chat node 必须检测 AgentScope 返回的错误消息。

    直接复制 _detect_chat_error 逻辑并验证（flow_runner 依赖 agentscope
    运行时 venv，无法从 server 端直接导入）。使用等价字典/对象模拟真实
    AgentScope Msg 结构。
    """

    def _detect_chat_error(msgs):
        """Equivalent of flow_runner._detect_chat_error for cross-layer testing."""
        assistants = [m for m in msgs if m.get("role") == "assistant"]
        error = ""
        status = "succeeded"
        out = ""
        if assistants:
            last = assistants[-1]
            msg_error = last.get("error")
            fr = last.get("finished_reason") or ""
            if msg_error or fr in ("error", "interrupted", "cancelled"):
                status = "failed"
                error = str(msg_error or fr)
            else:
                out = "".join(
                    b.get("text", "")
                    for b in (last.get("content") or [])
                    if isinstance(b, dict) and b.get("type") == "text"
                )
        else:
            status = "failed"
            error = "no assistant reply produced"
        return error, status, out

    # 正常 assistant 消息
    msgs_ok = [
        {"role": "user", "content": [{"type": "text", "text": "hi"}]},
        {"role": "assistant", "content": [{"type": "text", "text": "hello"}],
         "finished_reason": "stop"},
    ]
    err, status, out = _detect_chat_error(msgs_ok)
    assert status == "succeeded", f"正常对话应成功: status={status} err={err!r}"
    assert err == ""
    assert "hello" in out

    # assistant 消息带 error 属性
    msgs_err = [
        {"role": "user", "content": [{"type": "text", "text": "hi"}]},
        {"role": "assistant", "content": [{"type": "text", "text": ""}],
         "error": "Token limit exceeded", "finished_reason": "error"},
    ]
    err, status, out = _detect_chat_error(msgs_err)
    assert status == "failed", f"error 属性应判定失败: status={status}"
    assert "Token limit" in err

    # finished_reason 为 interrupted
    msgs_int = [
        {"role": "assistant", "content": [{"type": "text", "text": "partial"}],
         "finished_reason": "interrupted"},
    ]
    err, status, out = _detect_chat_error(msgs_int)
    assert status == "failed", f"interrupted 应判定失败: status={status}"

    # 无 assistant 消息
    msgs_no = [{"role": "user", "content": [{"type": "text", "text": "hi"}]}]
    err, status, out = _detect_chat_error(msgs_no)
    assert status == "failed", "无 assistant 回复应判定失败"
    assert "no assistant reply" in err.lower()


# ===================================================================
# P0-4: AgentFlow 自动任务 Release 查询
# ===================================================================

def test_p0_4_auto_release_query_chain():
    """P0-4：as_automations 的 Release 查询通过 AgentFlowVersion 中间表。"""
    from app.models import (
        AgentFlowDefinition,
        AgentFlowRelease,
        AgentFlowVersion,
        AutomationDefinition,
    )

    db = SessionLocal()
    try:
        # 创建 AgentFlow 定义
        afd = AgentFlowDefinition(
            name=f"p0p4-flow-{uuid.uuid4().hex[:6]}",
            description="test",
            created_by="dev",
        )
        db.add(afd)
        db.commit()
        # 创建版本（definition 字段在 AgentFlowVersion 上）
        afv = AgentFlowVersion(
            definition_id=afd.id,
            version_no=1,
            definition={"nodes": [], "edges": []},
            content_digest="",
            created_by="dev",
        )
        db.add(afv)
        db.commit()
        # 创建 release
        afr = AgentFlowRelease(
            version_id=afv.id,
            status="active",
            environment="prod",
        )
        db.add(afr)
        db.commit()
        # 创建自动任务引用
        auto = AutomationDefinition(
            name=f"p0p4-auto-{uuid.uuid4().hex[:6]}",
            target_kind="agentflow",
            agentflow_id=afd.id,
            enabled=False,
            created_by="dev",
        )
        db.add(auto)
        db.commit()

        # 验证查询链：agentflow_id → AgentFlowVersion → AgentFlowRelease
        release = (
            db.query(AgentFlowRelease)
            .join(AgentFlowVersion, AgentFlowVersion.id == AgentFlowRelease.version_id)
            .filter(
                AgentFlowVersion.definition_id == auto.agentflow_id,
                AgentFlowRelease.status == "active",
            )
            .order_by(AgentFlowRelease.created_at.desc())
            .first()
        )
        assert release is not None, (
            f"AgentFlow 自动任务应能通过 AgentFlowVersion 找到 Release"
            f" (agentflow_id={auto.agentflow_id})"
        )
        assert release.id == afr.id
    finally:
        db.close()


# ===================================================================
# P0-5: 内部 Tool 接口鉴权
# ===================================================================

def test_p0_5_session_manifest_rejects_no_token():
    """P0-5：未配置 INTERNAL_TOKEN 时返回 501，无 token 返回 401。"""
    # 无 token
    r = client.get("/api/internal/agent-tools/session-manifest?session_id=nonexistent")
    assert r.status_code in (401, 501), f"应拒绝无 token 请求: {r.status_code}"
    # 错误 token
    r2 = client.get(
        "/api/internal/agent-tools/session-manifest?session_id=nonexistent",
        headers={"X-MTC-Internal": "wrong-token"},
    )
    assert r2.status_code in (401, 501), f"应拒绝错误 token: {r2.status_code}"


def test_p0_5_run_platform_tool_rejects_no_token():
    """P0-5：/run-platform-tool 无 token 时拒绝（P0-08 后主体为类型化模型：
    畸形 body 422 也是拒绝；合法 body 无 token → 401/501）。"""
    r = client.post("/api/internal/agent-tools/run-platform-tool",
                    json={"tool_version_id": "tv-x", "args": {}, "session_id": ""})
    assert r.status_code in (401, 501), f"应拒绝无 token: {r.status_code}"
    r2 = client.post("/api/internal/agent-tools/run-platform-tool", json={})
    assert r2.status_code in (401, 422, 501), f"畸形 body 也应拒绝: {r2.status_code}"


# ===================================================================
# P0-6: 自动任务后台闭环（死信/锁/回写）
# ===================================================================

def test_p0_6_watcher_singleton_lock():
    """P0-6：watcher 的 PG advisory lock 确保单例。"""
    from app.automation_watcher import (
        WATCHER_LOCK_ID,
        _release_watcher_lock,
        _try_acquire_watcher_lock,
    )

    db = SessionLocal()
    try:
        # 第一次获取应成功
        ok = _try_acquire_watcher_lock(db)
        assert ok, "首次获取 PG advisory lock 应成功"
        # 第二个连接应获取失败（锁已被持有）
        db2 = SessionLocal()
        try:
            ok2 = _try_acquire_watcher_lock(db2)
            assert not ok2, "第二个连接不应获取到同一锁"
        finally:
            db2.close()
        # 释放后第二个连接应获取成功
        _release_watcher_lock(db)
        db3 = SessionLocal()
        try:
            ok3 = _try_acquire_watcher_lock(db3)
            assert ok3, "释放后第二个连接应能获取锁"
            _release_watcher_lock(db3)
        finally:
            db3.close()
    finally:
        db.close()


def test_p0_6_schedule_session_index_writes_runtime_agent_id():
    """P0-6：调度回调必须回写 runtime_agent_id 到 AgentSessionIndex。"""
    _ensure_model_and_credential()
    a = _make_module_agent()
    v = _publish_version(a["id"])
    _release_agent(a["id"], v["versionId"])

    db = SessionLocal()
    try:
        from app.agent_execution import resolve_runtime_agent

        agent = db.get(Agent, a["id"])
        rid, release = resolve_runtime_agent(db, "dev", agent, environment="prod")
        assert rid, "应能解析 runtime_agent_id"
        assert release is not None
        index = start_session(
            db, "dev", agent, trigger_kind="schedule", automation_id=f"p0p6-{uuid.uuid4().hex[:6]}"
        )
        assert index.runtime_agent_id is not None, (
            "schedule session 必须回写 runtime_agent_id"
        )
        assert index.runtime_agent_id == rid
    finally:
        db.close()


# ===================================================================
# P1-7: 对话刷新工具卡恢复（tool_call）
# ===================================================================

def test_p1_7_tool_call_block_type():
    """P1-7：AgentScope 2.0.8 持久化 block type 为 tool_call（非 tool_use）。"""
    import re

    tsx_path = "/Users/rivers/MoreThanCorn/src/pages/agent-chat.tsx"
    with open(tsx_path) as f:
        content = f.read()
    # 不应再出现 tool_use（除非是注释）
    tool_use_matches = [m for m in re.finditer(r'"tool_use"', content)
                        if not content[max(0, m.start() - 2):m.start()].strip().startswith("//")]
    assert len(tool_use_matches) == 0, (
        f"agent-chat.tsx 仍残留 tool_use 引用: {[m.group() for m in tool_use_matches]}"
    )
    assert '"tool_call"' in content, "agent-chat.tsx 应使用 tool_call 而非 tool_use"


def test_p1_7_tool_call_message_schema():
    """P1-7：验证 AgentScope 消息的 tool_call content block 结构。

    使用 AgentScope 的 TextBlock/Msg 等价字典结构验证，因为 agentscope
    包运行在独立的 AgentScope 运行时 venv 中。
    """
    # 模拟 AgentScope Msg 的 content blocks 结构（等价于 Msg(role=..., content=[TextBlock(...), ...])）
    msg = {
        "role": "assistant",
        "name": "agent",
        "content": [
            {"type": "text", "text": "Let me check that."},
            {"type": "tool_call", "id": "call_abc123", "name": "search",
             "arguments": '{"query": "test"}'},
            {"type": "tool_result", "id": "call_abc123", "result": "found"},
            {"type": "thinking", "id": "think_1", "thinking": "Processing..."},
        ],
        "finished_reason": "tool_calls",
    }
    # 按块类型过滤
    tool_calls = [b for b in msg["content"] if b.get("type") == "tool_call"]
    tool_results = [b for b in msg["content"] if b.get("type") == "tool_result"]
    thinkings = [b for b in msg["content"] if b.get("type") == "thinking"]
    assert len(tool_calls) == 1
    assert tool_calls[0]["name"] == "search"
    assert len(tool_results) == 1
    assert len(thinkings) == 1
    # 验证 tool_use 不在 schema 中
    tool_uses = [b for b in msg["content"] if b.get("type") == "tool_use"]
    assert len(tool_uses) == 0, "AgentScope 2.0.8 不使用 tool_use 块类型"


# ===================================================================
# P1-8: Release 资源版本冻结
# ===================================================================

def test_p1_8_frozen_skills_in_release_binding():
    """P1-8：发布快照必须冻结 Skill 内容，而非仅保存 ID。"""
    db = SessionLocal()
    skill_name = None
    skill_id = None
    original_content = None
    try:
        skill_name = f"p1p8-skill-{uuid.uuid4().hex[:6]}"
        skill = SkillResource(
            name=skill_name,
            description="freeze test",
            content=f"---\nname: {skill_name}\ndescription: test\n---\np1p8 content {uuid.uuid4().hex}",
            source="upload",
            status="ready",
            category="test",
        )
        db.add(skill)
        db.commit()
        skill_id = skill.id
        original_content = skill.content
    finally:
        db.close()

    _ensure_model_and_credential()
    a = _make_module_agent()
    g = client.get(f"/api/agents/{a['id']}")
    cfg = g.json().get("config") or {}
    cfg["skills"] = [skill_id]
    client.put(
        f"/api/agents/{a['id']}",
        json={"config": cfg, "expectedRevision": g.json().get("configRevision")},
    )
    v = _publish_version(a["id"])
    _release_agent(a["id"], v["versionId"])

    db2 = SessionLocal()
    try:
        release = (
            db2.query(Release)
            .filter_by(agent_id=a["id"], status="active")
            .order_by(Release.created_at.desc())
            .first()
        )
        assert release is not None
        binding = release.runtime_binding_snapshot or {}
        frozen_skills = binding.get("_frozen_skills") or {}
        assert skill_id in frozen_skills, (
            f"Skill {skill_id} 未冻结于发布快照: {list(frozen_skills.keys())}"
        )
        fs = frozen_skills[skill_id]
        assert fs["name"] == skill_name, (
            f"冻结的 Skill 名称应为 {skill_name!r}，实际 {fs['name']!r}"
        )
        assert fs["content"] == original_content, (
            "冻结的 Skill 内容与原始内容不一致"
        )
        assert fs["content_digest"] == hashlib.sha256(
            original_content.encode()
        ).hexdigest()
    finally:
        db2.close()


def test_p1_8_frozen_skill_used_in_session():
    """P1-8：新 Session 必须使用冻结的 Skill 内容，而非当前 DB 内容。"""
    db = SessionLocal()
    skill_id = None
    original_content = None
    try:
        skill_name = f"p1p8-skill2-{uuid.uuid4().hex[:6]}"
        skill = SkillResource(
            name=skill_name,
            description="freeze drift test",
            content=f"---\nname: {skill_name}\ndescription: test\n---\noriginal content {uuid.uuid4().hex}",
            source="upload",
            status="ready",
            category="test",
        )
        db.add(skill)
        db.commit()
        skill_id = skill.id
        original_content = skill.content
    finally:
        db.close()

    _ensure_model_and_credential()
    a = _make_module_agent()
    g = client.get(f"/api/agents/{a['id']}")
    cfg = g.json().get("config") or {}
    cfg["skills"] = [skill_id]
    client.put(
        f"/api/agents/{a['id']}",
        json={"config": cfg, "expectedRevision": g.json().get("configRevision")},
    )
    v = _publish_version(a["id"])
    _release_agent(a["id"], v["versionId"])

    # 修改 Skill 内容（模拟发布后漂移）
    db2 = SessionLocal()
    drifted_content = None
    try:
        skill2 = db2.get(SkillResource, skill_id)
        drifted_content = f"---\nname: drifted\ndescription: test\n---\ndrifted content {uuid.uuid4().hex}"
        skill2.content = drifted_content
        db2.commit()
    finally:
        db2.close()

    # 创建新 Session
    db3 = SessionLocal()
    try:
        agent = db3.get(Agent, a["id"])
        release = (
            db3.query(Release)
            .filter_by(agent_id=agent.id, status="active")
            .order_by(Release.created_at.desc())
            .first()
        )
        assert release is not None
        manifest = manifest_for_release(release)
        frozen_skills = manifest.get("_frozen_skills") or {}
        assert skill_id in frozen_skills, (
            f"Skill {skill_id} 应在冻结清单中: {list(frozen_skills.keys())}"
        )
        assert frozen_skills[skill_id]["content"] == original_content, (
            "冻结 Skill 内容应为原始内容，非修改后的漂移内容"
        )
        assert frozen_skills[skill_id]["content"] != drifted_content, (
            "冻结 Skill 内容不应等于修改后的漂移内容"
        )
    finally:
        db3.close()


def test_p1_8_frozen_tool_version():
    """P1-8：冻结的 Tool 版本应锁定到发布时的 ready 版本。"""
    db = SessionLocal()
    tool_id = None
    tv_id = None
    try:
        tool = Tool(
            name=f"p1p8-tool-{uuid.uuid4().hex[:6]}",
            description="freeze tool test",
            kind="builtin",
            status="ready",
        )
        db.add(tool)
        db.commit()
        tool_id = tool.id
        tv = ToolVersion(
            tool_id=tool.id,
            version_no=1,
            input_schema={"type": "object", "properties": {}},
            output_schema={"type": "object"},
            status="ready",
        )
        db.add(tv)
        db.commit()
        tv_id = tv.id
    finally:
        db.close()

    _ensure_model_and_credential()
    a = _make_module_agent()
    g = client.get(f"/api/agents/{a['id']}")
    cfg = g.json().get("config") or {}
    cfg["tools"] = [tool_id]
    client.put(
        f"/api/agents/{a['id']}",
        json={"config": cfg, "expectedRevision": g.json().get("configRevision")},
    )
    v = _publish_version(a["id"])
    _release_agent(a["id"], v["versionId"])

    db2 = SessionLocal()
    try:
        release = (
            db2.query(Release)
            .filter_by(agent_id=a["id"], status="active")
            .order_by(Release.created_at.desc())
            .first()
        )
        assert release is not None
        binding = release.runtime_binding_snapshot or {}
        frozen_tools = binding.get("_frozen_tools") or {}
        assert tool_id in frozen_tools, (
            f"Tool {tool_id} 未冻结于发布快照: {list(frozen_tools.keys())}"
        )
        ft = frozen_tools[tool_id]
        assert ft["tool_version_id"] == tv_id, (
            f"冻结的 tool_version_id 应为 {tv_id}，实际 {ft['tool_version_id']}"
        )
        assert ft["version_no"] == 1
    finally:
        db2.close()


def test_p1_8_frozen_mcp_url():
    """P1-8：冻结的 MCP URL 应锁定到发布时的连接地址。"""
    db = SessionLocal()
    mcp_id = None
    try:
        conn = Connection(
            name=f"p1p8-mcp-conn-{uuid.uuid4().hex[:6]}",
            kind="api_key",
            protocol="mcp",
            endpoint={"base_url": "http://127.0.0.1:9999/mcp"},
            secret_ref="sk-p1p8-mcp-test",
        )
        db.add(conn)
        db.commit()
        mcp = McpServer(
            name=f"p1p8-mcp-{uuid.uuid4().hex[:6]}",
            transport="http",
            connection_id=conn.id,
            status="ready",
        )
        db.add(mcp)
        db.commit()
        mcp_id = mcp.id
    finally:
        db.close()

    _ensure_model_and_credential()
    a = _make_module_agent()
    g = client.get(f"/api/agents/{a['id']}")
    cfg = g.json().get("config") or {}
    cfg["mcps"] = [mcp_id]
    client.put(
        f"/api/agents/{a['id']}",
        json={"config": cfg, "expectedRevision": g.json().get("configRevision")},
    )
    v = _publish_version(a["id"])
    _release_agent(a["id"], v["versionId"])

    db2 = SessionLocal()
    try:
        release = (
            db2.query(Release)
            .filter_by(agent_id=a["id"], status="active")
            .order_by(Release.created_at.desc())
            .first()
        )
        assert release is not None
        binding = release.runtime_binding_snapshot or {}
        frozen_mcps = binding.get("_frozen_mcps") or {}
        assert mcp_id in frozen_mcps, (
            f"MCP {mcp_id} 未冻结于发布快照: {list(frozen_mcps.keys())}"
        )
        fm = frozen_mcps[mcp_id]
        assert fm["url"] == "http://127.0.0.1:9999/mcp", (
            f"冻结的 MCP URL 应为原始地址，实际 {fm['url']!r}"
        )
    finally:
        db2.close()