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

def build_definition(db: Session, agent: Agent) -> dict:
    """按类型组装 definition 快照（02 §2.5）。dialogue/group 的图拷贝完整草稿定义。"""
    cfg = agent.config or {}
    if agent.type == "autonomous":
        return {
            "rolePrompt": cfg.get("rolePrompt", ""),
            "modelRef": cfg.get("modelRef") or {},
            "skills": list(cfg.get("skills") or []),
            "tools": list(cfg.get("tools") or []),
            "workflows": list(cfg.get("workflows") or []),
            "knowledges": list(cfg.get("knowledges") or []),
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
    """02 §2.6：发布时把资源引用解析为确定版本/状态，运行时不得漂移。"""
    items: list[dict] = []
    if agent.type == "autonomous":
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

    if agent.type == "autonomous":
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
