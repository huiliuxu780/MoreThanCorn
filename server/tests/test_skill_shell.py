"""docs/v2-design/10 §5.4：Skill 一等化验收（壳批次 P2 服务端面）。

P0-07（2026-09-10）：旧 Runtime 的 prompt 注入族（build_mounted_skills_section/
SKILL_CONTENT_LIMIT/_expand_mentions）已随自建 ReAct 引擎退役删除——Skill 装配
唯一路径 = Release 冻结清单 → AgentScope Workspace 上传（test_cutover_p0 覆盖）。
本文件保留：退役不变量断言 + 仍存活的 mounts-health / mounts 兼容读端点。
"""
import uuid

from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.models import Agent, AgentSkill, SkillResource

client = TestClient(app)


def u(p: str) -> str:
    return f"{p}-{uuid.uuid4().hex[:6]}"


def _make_agent() -> str:
    r = client.post("/api/agents", json={"name": u("skAG")[:20], "moduleKey": "quality-analysis"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _make_skill(content: str = "# SKILL\nbody line") -> str:
    r = client.post("/api/ai-resources/skills",
                    json={"name": u("sk"), "content": content, "source": "upload"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _cleanup_skill(sid: str) -> None:
    db = SessionLocal()
    for link in db.query(AgentSkill).filter_by(skill_id=sid).all():
        db.delete(link)
    s = db.get(SkillResource, sid)
    if s:
        db.delete(s)
    db.commit()
    db.close()


def test_legacy_prompt_injection_retired():
    """P0-07 退役不变量：旧 prompt 注入/截断/mention 展开函数已删除，
    任何"挂载正文进 system prompt"的第二装配路径不得复活。"""
    from app import agent_runtime

    for retired in ("build_mounted_skills_section", "SKILL_CONTENT_LIMIT",
                    "_expand_mentions", "_autonomous_loop", "_build_tools"):
        assert not hasattr(agent_runtime, retired), (
            f"{retired} 已退役删除，不得复活（Skill 装配唯一路径=AgentScope Workspace）"
        )


def test_skill_install_endpoint_stays_retired():
    aid = _make_agent()
    sid = _make_skill("# SKILL\nsecret-body-marker")
    r = client.post(f"/api/agents/{aid}/skills", json={"skillId": sid})
    assert r.status_code == 410
    _cleanup_skill(sid)


def test_mounts_health_registry_validation():
    aid = _make_agent()
    ghost = u("ghost")
    db = SessionLocal()
    a = db.get(Agent, aid)
    a.config = {**(a.config or {}), "skills": [ghost]}
    db.commit()
    db.close()
    items = client.get(f"/api/agents/{aid}/mounts-health").json()["items"]
    row = next(i for i in items if i["kind"] == "skill" and i["name"] == ghost)
    assert row["valid"] is False
    # 注册同名后转 True
    sid = _make_skill()
    db = SessionLocal()
    s = db.get(SkillResource, sid)
    s.name = ghost
    db.commit()
    db.close()
    items = client.get(f"/api/agents/{aid}/mounts-health").json()["items"]
    row = next(i for i in items if i["kind"] == "skill" and i["name"] == ghost)
    assert row["valid"] is True
    _cleanup_skill(sid)


def test_skills_mounts_endpoint():
    """换底（2026-09-09）：/api/skills/mounts 保留兼容读（历史反查），新挂载不再写入。"""
    aid = _make_agent()
    sid = _make_skill()
    assert client.post(f"/api/agents/{aid}/skills", json={"skillId": sid}).status_code == 410
    mounts = client.get("/api/skills/mounts").json()["mounts"]
    assert mounts.get(sid, []) == []
    _cleanup_skill(sid)
