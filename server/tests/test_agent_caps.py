"""09-07 Agent 能力重构验收：Skill/记忆/对话/run-stats 一等实体 API。

- registry kind=skill：创建/列表/picker 供给/删除防护（agent_skill 引用 409）；
- per-agent Skill 安装：唯一约束 409 + mounts-health 真校验；
- 记忆：保存即版本快照 + revisions + timeline（记忆+Skill 事件合并）；
- 对话：turn 入队 → worker 流式执行（mock 模型）→ llm_delta/agent_completed 事件 +
  消息终态 done；run-stats 聚合（byTrigger=chat / done=1 / byDay 非空）；
- 附件上传与下载；archived Agent 写入口 409。
"""
import uuid

from fastapi.testclient import TestClient

import pytest as _pytest

from app.db import SessionLocal
from app.main import app
from app.models import Agent, Model, ModelProvider

client = TestClient(app)


def u(p: str) -> str:
    return f"{p}-{uuid.uuid4().hex[:6]}"


@_pytest.fixture(scope="module", autouse=True)
def mock_model():
    """启用态模型（base_url 空 → 非生产 mock 对话路径）。"""
    db = SessionLocal()
    prov = ModelProvider(name=u("prov"), base_url="")
    db.add(prov)
    db.commit()
    m = Model(provider_id=prov.id, model_key=u("mock-key"), display_name="mock",
              enabled=True)
    db.add(m)
    db.commit()
    mid = m.id
    db.close()
    yield mid
    db = SessionLocal()
    db.delete(db.get(Model, mid))
    db.commit()
    db.close()


def _make_agent() -> str:
    r = client.post("/api/agents", json={"name": u("capAG")[:20], "moduleKey": "quality-analysis"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_skill_registry_and_install():
    """换底（2026-09-09）：Skill 库/registry 保留；安装接口 410 退役（挂载归 Workspace）。"""
    aid = _make_agent()
    s = client.post("/api/ai-resources/skills",
                    json={"name": u("skill"), "content": "# SKILL\nbody", "category": "research"})
    assert s.status_code == 201, s.text
    sid = s.json()["id"]
    reg = client.get("/api/registry/resources?types=skill").json()["items"]
    assert any(i["id"] == sid and i["type"] == "skill" for i in reg)
    # 退役：安装/卸载 410，指引 Session Workspace
    r = client.post(f"/api/agents/{aid}/skills", json={"skillId": sid})
    assert r.status_code == 410
    assert "Workspace" in r.json()["detail"]
    assert client.delete(f"/api/agents/{aid}/skills/{sid}").status_code == 410
    # 无挂载 → 删除 Skill 不再 409
    assert client.delete(f"/api/ai-resources/skills/{sid}").status_code == 200


def test_memory_versions_and_timeline():
    aid = _make_agent()
    m0 = client.get(f"/api/agents/{aid}/memory").json()
    assert m0["version"] == 1 and m0["content"] == ""
    r1 = client.put(f"/api/agents/{aid}/memory", json={"content": "记忆二版", "note": "init"})
    assert r1.status_code == 200 and r1.json()["version"] == 2
    client.put(f"/api/agents/{aid}/memory", json={"content": "记忆三版"})
    revs = client.get(f"/api/agents/{aid}/memory/revisions").json()["items"]
    assert [r["version"] for r in revs][:2] == [3, 2]
    # 换底：skill_installed 事件随挂载退役消失；timeline 仅记忆事件
    tl = client.get(f"/api/agents/{aid}/memory/timeline").json()["items"]
    kinds = {e["type"] for e in tl}
    assert kinds == {"memory_updated"}


def test_chat_turn_retired_410_after_cutover():
    """换底（2026-09-09）：自建对话执行退役——turns 返回 410 并指引 v2 入口；
    空消息仍 422（校验先于退役）。对话事实归 AgentScope Session。"""
    aid = _make_agent()
    # 退役端点：创建与消息读取均 410
    assert client.post(f"/api/agents/{aid}/chat/sessions", json={}).status_code == 410
    db = SessionLocal()
    try:
        from app.models import AgentChatSession
        row = AgentChatSession(agent_id=aid, title="legacy")
        db.add(row)
        db.commit()
        sid = row.id
    finally:
        db.close()
    empty = client.post(f"/api/agents/{aid}/chat/sessions/{sid}/turns", json={"text": "  "})
    assert empty.status_code == 422
    turn = client.post(f"/api/agents/{aid}/chat/sessions/{sid}/turns",
                       json={"text": "你好", "modelId": ""})
    assert turn.status_code == 410
    assert "/api/v2/agents" in turn.json()["detail"]
    assert client.get(f"/api/agents/{aid}/chat/sessions/{sid}/messages").status_code == 410
def test_chat_upload_and_download():
    aid = _make_agent()
    up = client.post(f"/api/agents/{aid}/chat/uploads",
                     files={"file": ("note.txt", b"hello attach", "text/plain")})
    assert up.status_code == 201, up.text
    fid = up.json()["id"]
    dl = client.get(f"/api/agent-caps/uploads/{fid}")
    assert dl.status_code == 200 and dl.content == b"hello attach"


def test_archived_agent_write_guard():
    aid = _make_agent()
    db = SessionLocal()
    a = db.get(Agent, aid)
    a.archived = True
    db.commit()
    db.close()
    assert client.put(f"/api/agents/{aid}/memory", json={"content": "x"}).status_code == 409
    # 退役优先于归档守卫：自建对话创建已 410
    sess = client.post(f"/api/agents/{aid}/chat/sessions", json={})
    assert sess.status_code == 410
