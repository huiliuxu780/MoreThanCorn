"""09-17 规则 Skill 化：解析/fail-closed/spec 覆盖/指令注入 单测。"""
from __future__ import annotations

import json

import pytest

from app import rules_skills
from app.agent_modules import registry as module_registry
from app.db import SessionLocal
from app.models import Agent, AgentSkill, SkillResource


def _mk_skill(db, name="quality-rules", criteria=None, version=1):
    skill = SkillResource(
        name=name, description="t", content="# t", source="seed", status="ready",
        version=version,
        extra={"files": {"criteria.json": json.dumps(
            criteria if criteria is not None else [
                {"id": "abusive_language", "description": "辱骂核验",
                 "tool_policy": []},
            ], ensure_ascii=False)}})
    db.add(skill)
    db.flush()
    return skill


def _mk_module_agent(db, module_key="quality-analysis"):
    a = Agent(name="rules-t", type="module", module_key=module_key,
              module_version="1.0.0", config={})
    db.add(a)
    db.flush()
    return a


def test_resolve_rules_override_and_ref():
    with SessionLocal() as db:
        _t_override(db)


def _t_override(db):
    a = _mk_module_agent(db)
    skill = _mk_skill(db)
    db.add(AgentSkill(agent_id=a.id, skill_id=skill.id))
    db.flush()
    try:
        criteria, ref = rules_skills.resolve_rules(db, a)
        assert criteria and criteria[0]["id"] == "abusive_language"
        assert ref["name"] == "quality-rules" and ref["version"] == 1
        assert len(ref["content_digest"]) == 64
    finally:
        db.rollback()


def test_resolve_rules_fail_closed_when_missing():
    with SessionLocal() as db:
        _t_missing(db)


def _t_missing(db):
    a = _mk_module_agent(db)
    try:
        with pytest.raises(rules_skills.RulesSkillMissing):
            rules_skills.resolve_rules(db, a)
    finally:
        db.rollback()


def test_resolve_rules_fail_closed_when_no_criteria_file():
    with SessionLocal() as db:
        _t_nocriteria(db)


def _t_nocriteria(db):
    a = _mk_module_agent(db)
    skill = SkillResource(name="quality-rules", content="# t", source="seed",
                          status="ready", version=1, extra={"files": {}})
    db.add(skill)
    db.flush()
    db.add(AgentSkill(agent_id=a.id, skill_id=skill.id))
    db.flush()
    try:
        with pytest.raises(rules_skills.RulesSkillMissing):
            rules_skills.resolve_rules(db, a)
    finally:
        db.rollback()


def test_build_agent_spec_criteria_override():
    mod = module_registry.get("quality-analysis", "1.0.0")
    base = mod.build_agent_spec({})
    crit = {**mod.default_spec["criteria"][0], "id": "criterion_x"}
    over = mod.build_agent_spec({}, [crit])
    assert {c["id"] for c in base["criteria"]} != {"x"}
    assert {c["id"] for c in over["criteria"]} == {"criterion_x"}


def test_criteria_prompt_block_contains_rules():
    block = rules_skills.criteria_prompt_block(
        [{"id": "x", "description": "核验 X"}])
    assert "当前规则准则" in block and "- x：核验 X" in block


def test_non_module_agent_no_rules():
    with SessionLocal() as db:
        _t_nonmodule(db)


def _t_nonmodule(db):
    a = Agent(name="custom-t", type="custom", config={})
    db.add(a)
    db.flush()
    try:
        assert rules_skills.resolve_rules(db, a) == (None, None)
    finally:
        db.rollback()
