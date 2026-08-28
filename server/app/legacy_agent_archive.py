"""旧三类 Agent 只读封存（SDD 10 Phase R-Archive / ADR-R09）。

封存语义：autonomous / dialogue / expert-group 不再新建、复制、编辑、发布、部署、运行，
也不被 Schedule / AnalysisTask / Workflow 再调用；历史数据只读可查，源码经 Git ref
（tag archive/legacy-agents-20260828）与 docs/archive/legacy-agents/manifest.md 可恢复。

本模块提供：
- is_legacy_agent / assert_agent_executable：统一判定与拦截（HTTP 层映射 410）；
- LegacyAgentArchivedError：封存拒绝异常；
- collect_archive_plan / apply_archive：数据封存工具（默认 dry-run，--apply 才落库）；
- fail_stale_agent_execution：worker 分派表防呆（agent-execution 不再执行）。
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from .models import Agent, AnalysisTask, Release, Schedule

LEGACY_AGENT_TYPES = {"autonomous", "dialogue", "expert-group"}
LEGACY_ARCHIVED_CODE = "LEGACY_AGENT_ARCHIVED"
LEGACY_ARCHIVED_MESSAGE = "该旧版 Agent 已封存，仅支持历史查询"

# Workflow 画布上引用 Agent 的节点族（registry.py 中均已 deprecated）
AGENT_FAMILY_NODE_TYPES = {"agent", "agent-select", "agent-exec"}


class LegacyAgentArchivedError(Exception):
    """旧 Agent 封存后的写/运行拒绝；main.py 注册 handler 映射为 410。"""

    def __init__(self, message: str | None = None):
        self.code = LEGACY_ARCHIVED_CODE
        self.message = message or LEGACY_ARCHIVED_MESSAGE
        super().__init__(self.message)


def is_legacy_agent(agent_or_version, db: Session | None = None) -> bool:
    """判定旧三类 Agent。

    Agent 直接看 type；AgentVersion（只有 agent_id）需要 db 反查，
    反查不到（历史孤儿）按封存处理（fail closed）。
    """
    t = getattr(agent_or_version, "type", None)
    if t is not None:
        return t in LEGACY_AGENT_TYPES
    agent_id = getattr(agent_or_version, "agent_id", None)
    if agent_id is None:
        return False
    if db is None:
        raise ValueError("判定 AgentVersion 是否封存需要提供 db 会话")
    agent = db.get(Agent, agent_id)
    return agent is None or agent.type in LEGACY_AGENT_TYPES


def assert_agent_executable(agent_or_version, db: Session | None = None) -> None:
    """旧 Agent 一律拒绝执行/写入；新 Module Agent（SDD 10 R2 起）不受影响。"""
    if is_legacy_agent(agent_or_version, db):
        raise LegacyAgentArchivedError()


# ---------- 数据封存工具（R-A3：默认 dry-run，可审计，幂等，事务化） ----------

def _cap(items: list, limit: int = 50) -> list:
    """ID 摘要输出截断（不输出敏感内容）。"""
    return items[:limit] + ([f"…+{len(items) - limit} more"] if len(items) > limit else [])


def _definition_legacy_refs(db: Session, definition: dict | None) -> list[dict]:
    """扫描一个工作流定义，返回引用旧 Agent 的节点清单（只读，不改图）。"""
    hits: list[dict] = []
    nodes = ((definition or {}).get("graph", {}) or {}).get("nodes", []) or []
    for node in nodes:
        ntype = node.get("type")
        if ntype not in AGENT_FAMILY_NODE_TYPES:
            continue
        cfg = node.get("config") or {}
        if ntype == "agent-select":
            ids = list(cfg.get("primaryAgents") or [])
            if cfg.get("fallbackAgent"):
                ids.append(cfg["fallbackAgent"])
        else:
            ids = [cfg["agentCode"]] if cfg.get("agentCode") else []
        for aid in ids:
            agent = db.get(Agent, aid) if aid else None
            if agent is not None and agent.type in LEGACY_AGENT_TYPES:
                hits.append({"nodeId": node.get("id"), "type": ntype, "agentId": aid,
                             "agentName": agent.name, "agentType": agent.type})
    return hits


def workflow_legacy_refs(db: Session, workflow_id: str) -> list[dict]:
    """某工作流（草稿 + 全部已发布版本定义）中对旧 Agent 的引用清单。"""
    from .models import Workflow, WorkflowVersion
    hits: list[dict] = []
    wf = db.get(Workflow, workflow_id)
    if wf is not None:
        for h in _definition_legacy_refs(db, wf.draft_definition):
            hits.append({**h, "source": "draft"})
    for ver in db.query(WorkflowVersion).filter_by(workflow_id=workflow_id).all():
        for h in _definition_legacy_refs(db, ver.definition):
            hits.append({**h, "source": f"version:{ver.version_no}"})
    return hits


def collect_archive_plan(db: Session) -> dict:
    """只读盘点：返回将被封存改动/停用的对象与 Workflow 引用清单，不修改任何数据。"""
    agents = (db.query(Agent).filter(Agent.type.in_(LEGACY_AGENT_TYPES))
              .order_by(Agent.created_at).all())
    legacy_ids = {a.id for a in agents}
    to_archive = [a for a in agents if not a.archived]

    releases = []
    if legacy_ids:
        releases = (db.query(Release).filter(Release.agent_id.in_(legacy_ids),
                                             Release.status == "active").all())

    bound_wf_ids = {a.workflow_id for a in agents if a.workflow_id}
    # 引用旧 Agent 的工作流（草稿或版本定义含 agent 族节点指向旧 Agent）
    from .models import Workflow as _WF
    ref_wf_ids: set[str] = set()
    for wf in db.query(_WF).all():
        if workflow_legacy_refs(db, wf.id):
            ref_wf_ids.add(wf.id)

    affected_wf_ids = bound_wf_ids | ref_wf_ids
    schedules_to_disable = [s for s in db.query(Schedule).all()
                            if s.enabled and s.workflow_id in affected_wf_ids]
    tasks_to_pause = [t for t in db.query(AnalysisTask)
                      .filter(AnalysisTask.status.in_(("draft", "active"))).all()
                      if t.workflow_id in ref_wf_ids]

    return {
        "legacyAgentCount": len(agents),
        "agentsToArchive": [{"id": a.id, "name": a.name, "type": a.type} for a in to_archive],
        "releasesToOffline": [{"id": r.id, "agentId": r.agent_id, "environment": r.environment}
                              for r in releases],
        "schedulesToDisable": [{"id": s.id, "name": s.name, "workflowId": s.workflow_id}
                               for s in schedules_to_disable],
        "tasksToPause": [{"id": t.id, "name": t.name, "workflowId": t.workflow_id}
                         for t in tasks_to_pause],
        "workflowRefs": [{"workflowId": wid, "refs": _cap(workflow_legacy_refs(db, wid))}
                         for wid in sorted(affected_wf_ids - bound_wf_ids)],
    }


def apply_archive(db: Session, actor: str = "system") -> dict:
    """执行封存（单事务 + AuditLog）。幂等：重复执行改动为空、不重复写审计。

    collect_archive_plan 返回的是 ID 摘要；此处按 ID 重新载入 ORM 行后在同一事务内修改。
    """
    from .models import Agent as _Agent
    from .models import AnalysisTask as _AnalysisTask
    from .models import AuditLog
    from .models import Release as _Release
    from .models import Schedule as _Schedule
    plan = collect_archive_plan(db)
    changed: dict[str, list] = {}
    for a in db.query(_Agent).filter(
            _Agent.id.in_([x["id"] for x in plan["agentsToArchive"]] or ["-"])).all():
        a.archived = True
        changed.setdefault("archivedAgents", []).append(a.id)
    for r in db.query(_Release).filter(
            _Release.id.in_([x["id"] for x in plan["releasesToOffline"]] or ["-"])).all():
        r.status = "offline"
        changed.setdefault("offlineReleases", []).append(r.id)
    for s in db.query(_Schedule).filter(
            _Schedule.id.in_([x["id"] for x in plan["schedulesToDisable"]] or ["-"])).all():
        s.enabled = False
        changed.setdefault("disabledSchedules", []).append(s.id)
    for t in db.query(_AnalysisTask).filter(
            _AnalysisTask.id.in_([x["id"] for x in plan["tasksToPause"]] or ["-"])).all():
        t.status = "paused"
        changed.setdefault("pausedTasks", []).append(t.id)
    summary = {
        "appliedAt": datetime.now(timezone.utc).isoformat(),
        "legacyAgentCount": plan["legacyAgentCount"],
        "workflowRefWorkflows": len(plan["workflowRefs"]),
        "changed": changed,
    }
    if changed:
        db.add(AuditLog(actor=actor, action="legacy_agent.archive.apply", target_type="agent",
                        target_id="*", detail={
                            "archivedAgents": _cap(changed.get("archivedAgents", [])),
                            "offlineReleases": _cap(changed.get("offlineReleases", [])),
                            "disabledSchedules": _cap(changed.get("disabledSchedules", [])),
                            "pausedTasks": _cap(changed.get("pausedTasks", [])),
                            "workflowRefWorkflows": summary["workflowRefWorkflows"],
                        }))
    db.commit()
    return summary


# ---------- worker 分派防呆（R-A5：worker 不再注册旧 Agent 执行路径） ----------

def fail_stale_agent_execution(run_id: str | None) -> None:
    """agent-execution 任务不再执行：只把对应 Run 置为失败终态（防历史积压任务复活）。"""
    from .db import SessionLocal
    from .models import Run
    from .runner import emit
    if not run_id:
        return
    db = SessionLocal()
    try:
        run = db.get(Run, run_id)
        if run and run.status == "queued":
            run.status = "failed"
            run.error = {"code": LEGACY_ARCHIVED_CODE,
                         "message": f"{LEGACY_ARCHIVED_MESSAGE}（执行路径已解除注册）"}
            run.ended_at = datetime.now(timezone.utc)
            db.commit()
            emit(db, run.id, "agent_failed", payload={"error": run.error["message"]})
    finally:
        db.close()
