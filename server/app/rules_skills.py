"""09-17 规则 Skill 化（用户拍板）：领域规则从代码 manifest 迁到 Skill 包伴生 criteria.json。

- manifest.requiredRulesSkill 声明必需规则 Skill 名；
- run 开工 / 会话开启时解析该 Agent 已挂载的规则 Skill，取 criteria.json 覆盖 manifest 默认 criteria；
- 冻结 asset_refs={rules_skill:{skill_id,name,version,content_digest}} 进 run/session——
  「这单按哪版规则跑的事」可查（复现凭据）；
- fail-closed：声明了却未挂载/包内缺 criteria.json → RulesSkillMissing（路由层 409），
  禁止无规则裸跑。
"""
from __future__ import annotations

import hashlib
import json

from sqlalchemy.orm import Session

from .models import Agent, AgentSkill, SkillResource


class RulesSkillMissing(Exception):
    """必需规则 Skill 缺失/不合规（fail-closed，路由层转 409）。"""

    code = "RULES_SKILL_MISSING"


def required_rules_skill_name(agent: Agent) -> str | None:
    if not agent.module_key:
        return None
    from .agent_modules import registry as module_registry
    try:
        mod = module_registry.get(agent.module_key, agent.module_version)
    except KeyError:
        return None
    return (mod.manifest or {}).get("requiredRulesSkill") or None


def resolve_rules(db: Session, agent: Agent) -> tuple[list | None, dict | None]:
    """返回 (criteria 列表, 资产引用)；无声明返回 (None, None)。"""
    name = required_rules_skill_name(agent)
    if not name:
        return None, None
    row = (db.query(SkillResource)
           .join(AgentSkill, AgentSkill.skill_id == SkillResource.id)
           .filter(AgentSkill.agent_id == agent.id,
                   SkillResource.name == name,
                   SkillResource.status == "ready")
           .order_by(SkillResource.version.desc()).first())
    if row is None:
        raise RulesSkillMissing(
            f"Agent 未挂载必需规则 Skill：{name}；上传并挂载后再开工/开会话")
    files = (row.extra or {}).get("files") or {}
    raw = files.get("criteria.json")
    if not raw:
        raise RulesSkillMissing(f"规则 Skill {name} 包内缺 criteria.json（规则表必须结构化）")
    try:
        criteria = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RulesSkillMissing(f"规则 Skill {name} 的 criteria.json 非合法 JSON：{exc}") from exc
    if not isinstance(criteria, list):
        raise RulesSkillMissing(f"规则 Skill {name} 的 criteria.json 须为数组（可为空=该领域无准则表）")
    ref = {
        "skill_id": row.id,
        "name": row.name,
        "version": row.version,
        "content_digest": hashlib.sha256((row.content or "").encode()).hexdigest(),
    }
    return criteria, ref


def criteria_prompt_block(criteria: list) -> str:
    """run 时注入指令的规则段（简洁行格式；raw JSON 实测干扰模型判断致金样本回退）。"""
    lines = []
    for c in criteria:
        if not isinstance(c, dict):
            continue
        cid = c.get("id") or ""
        desc = str(c.get("description") or "").replace("\n", " ")
        lines.append(f"- {cid}：{desc}")
    return ("\n\n## 当前规则准则（来自挂载的规则 Skill，版本已记入本任务）\n"
            + "\n".join(lines))
