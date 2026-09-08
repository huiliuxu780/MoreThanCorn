"""docs/v2-design/10 §5.4：Skill 一等化验收（壳批次 P2 服务端面）。

- 挂载正文注入：agent_skill → system prompt 含 SKILL.md 正文；未挂载不含；
- 截断：>8000 字符附截断注记；
- 遗留 config.skills 名字占位保留且按名去重；
- mounts-health：未注册名字 valid=False，注册后 True；
- #skill: mention 展开取注册表描述；
- /api/skills/mounts 反查 join 正确。
"""
import uuid

from fastapi.testclient import TestClient

from app.agent_runtime import SKILL_CONTENT_LIMIT, build_mounted_skills_section
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


def test_mounted_skill_content_injected():
    aid = _make_agent()
    sid = _make_skill("# SKILL\nsecret-body-marker")
    r = client.post(f"/api/agents/{aid}/skills", json={"skillId": sid})
    assert r.status_code == 201, r.text
    db = SessionLocal()
    section = build_mounted_skills_section(db, aid, {"skills": []})
    db.close()
    assert "secret-body-marker" in section
    assert "## 挂载技能" in section
    # 未挂载 Agent 不含正文
    other = _make_agent()
    db = SessionLocal()
    section2 = build_mounted_skills_section(db, other, {"skills": []})
    db.close()
    assert "secret-body-marker" not in section2
    client.delete(f"/api/agents/{aid}/skills/{sid}")
    _cleanup_skill(sid)


def test_truncation_and_legacy_dedup():
    aid = _make_agent()
    long = "x" * (SKILL_CONTENT_LIMIT + 1000)
    sid = _make_skill(long)
    name = SessionLocal().get(SkillResource, sid).name
    client.post(f"/api/agents/{aid}/skills", json={"skillId": sid})
    db = SessionLocal()
    section = build_mounted_skills_section(db, aid, {"skills": [name, "legacy-only"]})
    db.close()
    assert "（已截断：原文超过 8000 字符）" in section
    assert section.count(f"### {name}") == 1
    assert f"- {name}" not in section  # 已注入正文的名字不再重复占位
    assert "- legacy-only" in section  # 遗留名字保留占位
    client.delete(f"/api/agents/{aid}/skills/{sid}")
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


def test_mention_expansion_uses_registry():
    from app.agent_runtime import _expand_mentions
    sid = _make_skill()
    db = SessionLocal()
    s = db.get(SkillResource, sid)
    s.description = "registry-desc-marker"
    db.commit()
    out = _expand_mentions(db, f"see #skill:{s.name} now", {})
    db.close()
    assert "registry-desc-marker" in out
    _cleanup_skill(sid)


def test_skills_mounts_endpoint():
    aid = _make_agent()
    sid = _make_skill()
    client.post(f"/api/agents/{aid}/skills", json={"skillId": sid})
    mounts = client.get("/api/skills/mounts").json()["mounts"]
    assert any(m["agentId"] == aid for m in mounts.get(sid, []))
    client.delete(f"/api/agents/{aid}/skills/{sid}")
    _cleanup_skill(sid)
