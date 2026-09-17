"""09-17 规则 Skill 化 seed：三 Module 的 manifest criteria/主数据迁成规则 Skill 包并挂载。

幂等：同名 seed Skill 的 criteria digest 未变则跳过；变了则新建版本行并把挂载切到新行。
用法：server/.venv/bin/python scripts/seed_rules_skills.py
"""
from __future__ import annotations

import hashlib
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from app.agent_modules import registry as module_registry  # noqa: E402
from app.db import SessionLocal  # noqa: E402
from app.models import Agent, AgentSkill, SkillResource  # noqa: E402

PAIRS = {
    "quality-analysis": "quality-rules",
    "business-analysis": "business-rules",
    "ticket-automation": "ticket-rules",
}


def main() -> None:
    db = SessionLocal()
    try:
        for mod_key, skill_name in PAIRS.items():
            mod = module_registry.get(mod_key)
            criteria = mod.default_spec.get("criteria") or []
            files = {"criteria.json": json.dumps(criteria, ensure_ascii=False, indent=1)}
            md_dir = pathlib.Path(mod.dir) / "master_data"
            if md_dir.is_dir():
                for f in sorted(md_dir.glob("*.json")):
                    files[f"masterdata/{f.name}"] = f.read_text(encoding="utf-8")
            prose = (
                f"---\nname: {skill_name}\n"
                f"description: {mod.manifest.get('displayName', '')} 领域规则表"
                "（结构化伴生文件 criteria.json）\ncategory: domain-rules\n---\n\n"
                f"# {mod.manifest.get('displayName', '')} 领域规则表\n\n"
                f"本 Skill 是 {mod_key} 领域 Agent 的规则资产：结构化规则表在伴生文件 "
                "criteria.json，主数据在 masterdata/。规则调整后上传新版本 zip，"
                "新任务自动用新版（版本号与摘要记入任务 asset_refs）。\n"
            )
            digest = hashlib.sha256(
                json.dumps(criteria, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
            existing = (db.query(SkillResource).filter_by(name=skill_name, source="seed")
                        .order_by(SkillResource.version.desc()).first())
            if existing and (existing.extra or {}).get("criteria_digest") == digest:
                skill = existing
            else:
                skill = SkillResource(
                    name=skill_name, description=f"{mod_key} 领域规则表", content=prose,
                    source="seed", status="ready", category="domain-rules",
                    version=(existing.version if existing else 0) + 1,
                    extra={"files": files, "criteria_digest": digest})
                db.add(skill)
                db.flush()
            same_name_ids = [r.id for r in db.query(SkillResource).filter_by(name=skill_name).all()]
            for a in db.query(Agent).filter_by(module_key=mod_key, archived=False).all():
                if not db.query(AgentSkill).filter_by(agent_id=a.id, skill_id=skill.id).first():
                    db.query(AgentSkill).filter(
                        AgentSkill.agent_id == a.id,
                        AgentSkill.skill_id.in_(same_name_ids or [""])).delete(
                            synchronize_session=False)
                    db.add(AgentSkill(agent_id=a.id, skill_id=skill.id))
        db.commit()
        print("seeded rules skills:", list(PAIRS.values()))
    finally:
        db.close()


if __name__ == "__main__":
    main()
