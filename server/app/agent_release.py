"""Agent 发布域（SDD 02）：definition 快照 / 发布校验 / 依赖冻结 / artifact hash。"""
from __future__ import annotations

import hashlib
import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import (Agent, AgentVersion, KnowledgeSource, Model, Tool, ToolVersion, Workflow)
from .schemas import WorkflowDefinition
from .validator import validate

NAME_MAX_LEN = 20


# ---------- 快照组装 ----------

# P1-01：清单唯一定义在 agent_execution.resources_manifest（含 workflow_ids/
# agentflow_ids 回调白名单键），此处仅重导出保持旧 import 路径兼容。
from .agent_execution import resources_manifest  # noqa: E402,F401


def _module_resources(db: Session, mod, cfg: dict) -> dict:
    """09-18 端到端：Module logicalTools 并入冻结资源清单（仅 ready Tool 行）。

    此前 resources_manifest 只看 agent.config.tools，Module 领域工具从未被
    冻结/装配——模型物理上调不到 knowledge_search 等（金样本 required_tools
    恒缺失的根因）。ready 之外的工具不冻结（执行面失败关闭语义不变）。
    """
    from .models import Tool as _Tool
    res = resources_manifest(cfg)
    names = [t["name"] for t in (mod.logical_tools or [])]
    if names:
        rows = db.query(_Tool).filter(
            _Tool.name.in_(names), _Tool.status == "ready").all()
        merged = list(dict.fromkeys([*res.get("tool_ids", []), *[r.id for r in rows]]))
        res = {**res, "tool_ids": merged}
    return res


def build_definition(db: Session, agent: Agent) -> dict:
    """按类型组装 definition 快照（02 §2.5）。dialogue/group 的图拷贝完整草稿定义。

    SDD 10 R2：Module Agent 冻结 Module key/version + 完整 AgentSpec + Schema 引用
    （sha256）+ 执行/安全策略；Provider 选择不在此处（Release 时绑定）。"""
    cfg = agent.config or {}
    if agent.module_key:
        from .agent_modules import registry as module_registry
        mod = module_registry.get(agent.module_key, agent.module_version)
        # 09-17 规则 Skill 化：发布时解析当前规则 Skill 覆盖 manifest 默认 criteria
        from . import rules_skills
        try:
            _rules, _ref = rules_skills.resolve_rules(db, agent)
        except rules_skills.RulesSkillMissing as exc:
            raise ValueError(f"{exc.code}：{exc}") from exc
        try:
            spec = mod.build_agent_spec(cfg, _rules)
        except ValueError as exc:
            raise ValueError(f"AGENT_SPEC_INVALID：{exc}") from exc
        return {
            "module": {"key": mod.key, "version": mod.version},
            "agentSpec": spec,
            # 09-16：persona 纳入版本快照——此前定义缺该键，compile_system_prompt
            # 永远编译不到实例 persona（配置页「编译进 system_prompt」为虚假声明）。
            "persona": cfg.get("persona", ""),
            "inputSchema": mod.input_schema_ref,
            "outputSchema": mod.output_schema_ref,
            "executionPolicy": mod.policies["execution"],
            "securityPolicy": mod.policies["security"],
            "resources": _module_resources(db, mod, cfg),
        }
    if agent.type in ("autonomous", "custom"):
        # custom = 自定义角色 Agent（agent-create 产物，09-07 重构）：与
        # autonomous 同构的 rolePrompt 定义。此前 custom 落入 else 分支被要求
        # 绑定 Workflow → 永远无法发布（任务书 §六.8 "永远跑不起来的 Agent"）。
        return {
            "rolePrompt": cfg.get("rolePrompt", ""),
            "persona": cfg.get("persona", ""),
            "modelRef": cfg.get("modelRef") or {},
            "permissions": cfg.get("permissions") or {},
            "skills": list(cfg.get("skills") or []),
            "tools": list(cfg.get("tools") or []),
            "workflows": list(cfg.get("workflows") or []),
            "agentflows": list(cfg.get("agentflows") or []),
            "knowledges": list(cfg.get("knowledges") or []),
            "resources": resources_manifest(cfg),
        }
    wf = db.get(Workflow, agent.workflow_id) if agent.workflow_id else None
    if not wf:
        raise ValueError("dialogue/expert-group Agent 未绑定工作流，无法发布")
    return {
        "workflowId": wf.id,
        "graph": json.loads(json.dumps(wf.draft_definition)),  # 深拷贝，发布后编辑草稿不影响版本
        "members": list(cfg.get("members") or []),
    }


def build_common_config(agent: Agent) -> dict:
    """CommonAgentConfig（02 §2.4）：对话体验 + 结构化记忆声明 + 知识兜底。"""
    return build_common_config_dict(agent.config or {})


def build_common_config_dict(cfg: dict) -> dict:
    """从原始 config 组装 CommonAgentConfig（草稿运行与版本快照共用）。"""
    conv = cfg.get("conversation") or {}
    return {
        "conversation": {
            "autoFollowUp": {"enabled": bool(conv.get("autoFollowUp", {}).get("enabled")),
                             "count": int(conv.get("autoFollowUp", {}).get("count") or 3)},
            "chitchatFallback": {"enabled": bool(conv.get("chitchatFallback", {}).get("enabled")),
                                 "modelId": (conv.get("chitchatFallback") or {}).get("modelId") or "",
                                 "prompt": (conv.get("chitchatFallback") or {}).get("prompt") or ""},
            # R1 修复：开场白纳入快照（此前发布时静默丢弃）
            "greeting": str(conv.get("greeting") or ""),
        },
        "memories": list(cfg.get("memoriesSchema") or []),
        "knowledgeFallback": {"knowledgeIds": list(cfg.get("knowledges") or [])},
    }


# ---------- 依赖冻结 ----------

def _resolve_tool(db: Session, ref: str) -> dict:
    t = db.get(Tool, ref) or db.execute(select(Tool).where(Tool.name == ref)).scalars().first()
    if not t:
        return {"type": "TOOL", "ref": ref, "status": "MISSING"}
    tv = db.execute(select(ToolVersion).where(ToolVersion.tool_id == t.id, ToolVersion.status == "ready")
                    .order_by(ToolVersion.version_no.desc())).scalars().first()
    if not tv:
        return {"type": "TOOL", "ref": ref, "id": t.id, "status": "NO_READY_VERSION"}
    return {"type": "TOOL", "ref": ref, "id": t.id, "version": tv.id,
            "versionNo": tv.version_no, "status": "FROZEN"}


def _resolve_workflow(db: Session, ref: str) -> dict:
    w = db.get(Workflow, ref) or db.execute(select(Workflow).where(Workflow.name == ref)).scalars().first()
    if not w:
        return {"type": "WORKFLOW", "ref": ref, "status": "MISSING"}
    return {"type": "WORKFLOW", "ref": ref, "id": w.id,
            "version": w.current_version_id, "status": "FROZEN" if w.current_version_id else "UNPUBLISHED"}


def _resolve_knowledge(db: Session, ref: str) -> dict:
    k = db.get(KnowledgeSource, ref) or db.execute(select(KnowledgeSource).where(KnowledgeSource.name == ref)).scalars().first()
    if not k:
        return {"type": "KNOWLEDGE", "ref": ref, "status": "MISSING"}
    return {"type": "KNOWLEDGE", "ref": ref, "id": k.id,
            "status": "FROZEN" if k.status == "enabled" else "DISABLED"}


def freeze_dependencies(db: Session, agent: Agent, definition: dict) -> dict:
    """02 §2.6：发布时把资源引用解析为确定版本/状态，运行时不得漂移。

    SDD 10 R2：Module Agent 追加 AGENT_MODULE / MODULE_IMPLEMENTATION / MASTER_DATA /
    INPUT_SCHEMA / OUTPUT_SCHEMA 依赖类型；逻辑工具解析到平台 Tool 的 ready 版本。"""
    items: list[dict] = []
    if agent.module_key:
        from .agent_modules import registry as module_registry
        mod = module_registry.get(agent.module_key, agent.module_version)
        spec = definition.get("agentSpec") or {}
        items.append({"type": "AGENT_MODULE", "ref": f"{mod.key}@{mod.version}",
                      "version": mod.version, "status": "FROZEN",
                      "inputSchemaSha256": mod.input_schema_ref["sha256"],
                      "outputSchemaSha256": mod.output_schema_ref["sha256"]})
        for kind, impl in sorted(mod.manifest["implementations"].items()):
            items.append({"type": "MODULE_IMPLEMENTATION", "ref": f"{mod.key}@{kind}",
                          "version": impl.get("version"), "status": "FROZEN"})
        for t in spec.get("tools", []):
            items.append(_resolve_tool(db, t["name"]))
        mid = (spec.get("model") or {}).get("model")
        if mid:
            m = db.execute(select(Model).where(Model.model_key == mid)).scalars().first()
            items.append({"type": "MODEL", "ref": mid,
                          "status": "FROZEN" if (m and m.enabled) else "MISSING",
                          "version": m.version if m else None})
        for md in spec.get("master_data", []):
            items.append({"type": "MASTER_DATA", "ref": f"{md['name']}@{md['version']}",
                          "version": md["version"], "status": "FROZEN"})
        items.append({"type": "INPUT_SCHEMA", "ref": mod.input_schema_ref["id"],
                      "version": mod.version, "status": "FROZEN"})
        items.append({"type": "OUTPUT_SCHEMA", "ref": mod.output_schema_ref["id"],
                      "version": mod.version, "status": "FROZEN"})
        return {"items": items}
    if agent.type in ("autonomous", "custom"):
        for tref in definition.get("tools", []):
            items.append(_resolve_tool(db, tref))
        for wref in definition.get("workflows", []):
            items.append(_resolve_workflow(db, wref))
        for kref in definition.get("knowledges", []):
            items.append(_resolve_knowledge(db, kref))
        mid = (definition.get("modelRef") or {}).get("modelId")
        if mid:
            m = db.execute(select(Model).where(Model.model_key == mid)).scalars().first()
            items.append({"type": "MODEL", "ref": mid,
                          "status": "FROZEN" if (m and m.enabled) else "MISSING",
                          "version": m.version if m else None})
    else:
        for aref in definition.get("members", []):
            a = db.get(Agent, aref)
            items.append({"type": "AGENT", "ref": aref,
                          "status": "FROZEN" if (a and a.id != agent.id) else "MISSING",
                          # 冻结成员当前部署版本；无部署版本则运行期回退草稿并留痕 member_unfrozen
                          "version": (a.sandbox_version_id or a.prod_version_id) if a else None})
        for n in (definition.get("graph") or {}).get("graph", {}).get("nodes", []):
            cfg = n.get("config") or {}
            if n.get("type") == "tool" and cfg.get("toolVersionId"):
                tv = db.get(ToolVersion, cfg["toolVersionId"])
                items.append({"type": "TOOL", "ref": cfg["toolVersionId"],
                              "status": "FROZEN" if tv else "MISSING",
                              "version": cfg["toolVersionId"]})
            if n.get("type") == "knowledge-retrieval" and cfg.get("knowledgeSourceId"):
                items.append(_resolve_knowledge(db, cfg["knowledgeSourceId"]))
            if n.get("type") == "llm":
                mid = (cfg.get("modelRef") or {}).get("modelId")
                if mid:
                    m = db.execute(select(Model).where(Model.model_key == mid)).scalars().first()
                    items.append({"type": "MODEL", "ref": mid,
                                  "status": "FROZEN" if (m and m.enabled) else "MISSING",
                                  "version": m.version if m else None})
    return {"items": items}


def artifact_hash(definition: dict, common: dict, deps: dict) -> str:
    blob = json.dumps({"definition": definition, "commonConfig": common, "dependencies": deps},
                      sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode()).hexdigest()


# ---------- 发布校验（02 §4） ----------

def validate_publish(db: Session, agent: Agent, definition: dict, common: dict) -> list[dict]:
    issues: list[dict] = []
    if not agent.name or not agent.name.strip():
        issues.append({"code": "NAME_REQUIRED", "message": "Agent 名称不能为空", "path": "name"})
    if len(agent.name or "") > NAME_MAX_LEN:
        issues.append({"code": "NAME_TOO_LONG", "message": f"Agent 名称不能超过 {NAME_MAX_LEN} 字", "path": "name"})

    if agent.module_key:
        # SDD 10 R2：Module Agent 发布校验——模型必填且存在启用；Spec 结构已由
        # build_definition 经 Module Spec Schema 强校验（不合即 AGENT_SPEC_INVALID 409）
        spec = definition.get("agentSpec") or {}
        model_key = (spec.get("model") or {}).get("model")
        if not model_key or model_key == "unset":
            issues.append({"code": "MODEL_REQUIRED", "message": "Module Agent 实例必须配置 modelRef.modelId",
                           "path": "config.modelRef"})
        else:
            m = db.execute(select(Model).where(Model.model_key == model_key)).scalars().first()
            if not m or not m.enabled:
                issues.append({"code": "MODEL_INVALID", "message": f"模型 {model_key} 不存在或已停用",
                               "path": "config.modelRef"})
    elif agent.type in ("autonomous", "custom"):
        if not (definition.get("rolePrompt") or "").strip():
            issues.append({"code": "PROMPT_REQUIRED", "message": "角色能力描述（Prompt）不能为空", "path": "definition.rolePrompt"})
        mid = (definition.get("modelRef") or {}).get("modelId")
        if not mid:
            issues.append({"code": "MODEL_REQUIRED", "message": "未选择主模型", "path": "definition.modelRef"})
        else:
            m = db.execute(select(Model).where(Model.model_key == mid)).scalars().first()
            if not m or not m.enabled:
                issues.append({"code": "MODEL_INVALID", "message": f"模型 {mid} 不存在或已停用", "path": "definition.modelRef"})
    else:
        try:
            defn = WorkflowDefinition.model_validate(definition["graph"])
            rep = validate(defn)
            for i in rep.issues:
                issues.append({"code": "GRAPH_INVALID", "message": i.message, "path": f"graph({i.nodeId})"})
        except Exception as exc:  # noqa: BLE001
            issues.append({"code": "GRAPH_INVALID", "message": f"图定义无法解析：{exc}", "path": "graph"})
        for aref in definition.get("members", []):
            a = db.get(Agent, aref)
            if not a:
                issues.append({"code": "MEMBER_MISSING", "message": f"成员 Agent {aref} 不存在", "path": "members"})
            elif a.id == agent.id:
                issues.append({"code": "MEMBER_SELF", "message": "成员不能是自身", "path": "members"})

    # 记忆声明结构校验
    seen = set()
    for mem in common.get("memories", []):
        if not mem.get("name"):
            issues.append({"code": "MEMORY_INVALID", "message": "记忆变量缺少名称", "path": "memories"})
        elif mem["name"] in seen:
            issues.append({"code": "MEMORY_DUPLICATE", "message": f"记忆变量 {mem['name']} 重复", "path": "memories"})
        seen.add(mem.get("name"))
    return issues


def next_version_no(db: Session, agent_id: str) -> int:
    return db.query(AgentVersion).filter_by(agent_id=agent_id).count() + 1


# ---------- 统一发布事务（P0-06：并发安全 + 物化原子性） ----------

class ConcurrentPublishError(RuntimeError):
    """两次并发发布竞争同一 (agent, environment)；数据库唯一索引拒绝了第二条。"""


def publish_release(
    db, *, actor: str, agent: Agent, version, environment: str, canary_percent: int = 0
):
    """THE one publish path (agents.py 与 as_agents.py 共用，P1-01 去重).

    事务保证：
    1. Agent 行锁串行化同一 Agent 的并发发布；
    2. 数据库部分唯一索引（g051）硬保证同 (agent, environment) 至多一条
       active 稳定 Release + 至多一条 active 灰度 Release；
    3. materialize_release 在事务内执行——物化失败（如
       KNOWLEDGE_PROVIDER_UNAVAILABLE / MODEL_UNFROZEN）整体回滚，
       不会留下半激活的 Release。
    """
    from sqlalchemy.exc import IntegrityError

    from . import agent_execution as ex
    from .models import Release

    if environment not in ("sandbox", "prod"):
        raise ValueError("environment 必须是 sandbox|prod")
    db.query(Agent).filter_by(id=agent.id).with_for_update().first()
    actives = (
        db.query(Release)
        .filter_by(agent_id=agent.id, environment=environment, status="active")
        .all()
    )
    if canary_percent > 0:
        # 灰度部署：只替换已有灰度，稳定版保持（SDD E-2.3）
        for r in actives:
            if r.canary_percent:
                r.status = "rolled_back"
    else:
        # 全量部署：同环境全部 active（含灰度）→ rolled_back
        for r in actives:
            r.status = "rolled_back"
    rel = Release(
        agent_id=agent.id,
        agent_version_id=version.id,
        environment=environment,
        canary_percent=canary_percent,
        created_by=actor,
        runtime_binding_snapshot={},
    )
    db.add(rel)
    if canary_percent == 0:
        if environment == "sandbox":
            agent.sandbox_version_id = version.id
        else:
            agent.prod_version_id = version.id
    agent.status = "published"
    try:
        db.flush()
        ex.materialize_release(db, actor, rel)  # 成功路径内部 commit
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ConcurrentPublishError(
            f"并发发布被数据库唯一约束拒绝（agent={agent.id}, env={environment}）：{exc}"
        ) from exc
    except Exception:
        db.rollback()
        raise
    db.refresh(rel)
    return rel
