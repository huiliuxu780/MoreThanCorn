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
    aid = _make_agent()
    s = client.post("/api/ai-resources/skills",
                    json={"name": u("skill"), "content": "# SKILL\nbody", "category": "research"})
    assert s.status_code == 201, s.text
    sid = s.json()["id"]
    # picker 供给（market）
    reg = client.get("/api/registry/resources?types=skill").json()["items"]
    assert any(i["id"] == sid and i["type"] == "skill" for i in reg)
    # 安装 + 唯一约束
    assert client.post(f"/api/agents/{aid}/skills", json={"skillId": sid}).status_code == 201
    dup = client.post(f"/api/agents/{aid}/skills", json={"skillId": sid})
    assert dup.status_code == 409
    lst = client.get(f"/api/agents/{aid}/skills").json()["items"]
    assert lst and lst[0]["id"] == sid and lst[0]["metadata"]["source"] == "upload"
    # mounts-health 真校验
    mh = client.get(f"/api/agents/{aid}/mounts-health").json()["items"]
    assert any(i["kind"] == "skill" and i["valid"] for i in mh)
    # 删除防护：被安装中 → 409
    d = client.delete(f"/api/ai-resources/skills/{sid}")
    assert d.status_code == 409
    assert client.delete(f"/api/agents/{aid}/skills/{sid}").status_code == 200
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
    # timeline：装一个 skill 后两类事件合并倒序
    s = client.post("/api/ai-resources/skills", json={"name": u("tl-skill"), "content": "x"})
    sid = s.json()["id"]
    client.post(f"/api/agents/{aid}/skills", json={"skillId": sid})
    tl = client.get(f"/api/agents/{aid}/memory/timeline").json()["items"]
    kinds = {e["type"] for e in tl}
    assert kinds == {"memory_updated", "skill_installed"}
    assert tl[0]["type"] == "skill_installed"


def test_chat_turn_stream_and_run_stats():
    aid = _make_agent()
    sess = client.post(f"/api/agents/{aid}/chat/sessions", json={}).json()
    empty = client.post(f"/api/agents/{aid}/chat/sessions/{sess['id']}/turns", json={"text": "  "})
    assert empty.status_code == 422
    turn = client.post(f"/api/agents/{aid}/chat/sessions/{sess['id']}/turns",
                       json={"text": "你好，介绍一下自己", "modelId": ""})
    assert turn.status_code == 202, turn.text
    run_id = turn.json()["runId"]
    # 入队断言（worker 接线）+ 同步走分派分支执行（测试库积压旧 job，队列顺序不可靠）
    from sqlalchemy import select as _sel
    from app.models import JobQueue
    from app.runner import _dispatch_job
    db = SessionLocal()
    job = db.execute(_sel(JobQueue).where(JobQueue.type == "chat-turn")
                     .order_by(JobQueue.created_at.desc()).limit(1)).scalars().first()
    db.close()
    assert job is not None and job.payload["run_id"] == run_id
    _dispatch_job("chat-turn", job.payload)
    msgs = client.get(f"/api/agents/{aid}/chat/sessions/{sess['id']}/messages").json()["items"]
    assert len(msgs) == 2
    assert msgs[0]["role"] == "user" and msgs[1]["role"] == "assistant"
    assert msgs[1]["status"] == "done" and msgs[1]["content"].startswith("[mock:")
    assert msgs[1]["runId"] == run_id
    evs = client.get(f"/api/runs/{run_id}/events-list").json()["items"]
    types = [e["type"] for e in evs]
    assert "agent_started" in types and "llm_delta" in types
    assert "reply_sent" in types and "agent_completed" in types
    st = client.get(f"/api/agents/{aid}/run-stats").json()
    assert st["done"] == 1 and st["running"] == 0 and st["pending"] == 0
    assert st["byTrigger"].get("chat") == 1 and st["byDay"]
    # 列表统计行真数据
    row = next(i for i in client.get("/api/agents", params={"archived": "all", "pageSize": 100}).json()["items"]
               if i["id"] == aid)
    assert row["runCount"] == 1 and row["lastRunAt"]


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
    sess = client.post(f"/api/agents/{aid}/chat/sessions", json={})
    assert sess.status_code == 409
