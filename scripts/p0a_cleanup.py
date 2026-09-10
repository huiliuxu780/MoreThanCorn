"""P0-A 旧 Agent 清耦合（2026-09-10 返工轮）。

任务书 §三：
1. 备份/导出依赖清单（pg_dump 已先行：/tmp/wf_dev_backup_pre_p0a_20260910.sql）；
2. 5 个历史 Module Agent 归档并退出产品运行面；
3. 旧 active sandbox Release（openai-agents/deepseek-harness）全部停止；
   归档 Agent 的 prod active Release 一并 rolled_back（产品面不再有任何指向
   历史 Module Agent 的 active Release）；
4. 业务分析-通话打标-OpenAI 含真实业务配置 → 先迁移为新的正式 AgentScope-native
   custom Agent（经真实 API：创建→版本→prod 发布），再归档旧实例；
5. 旧 active Task 暂停（paused），不再产生运行；
6. 历史 TaskVersion/Run/QualityResult/Session 只读保留，不级联删除；
7. 遗留 runtime provider（deepseek-harness/openai-agents）DB 注册表下线（disabled）；
8. 上轮验收遗留的测试 Skill（frontmatter-验收技能×2 / zip-验收技能）物理删除
   （确认无挂载引用；客服话术质检技能保留并随迁移带走）；
9. 输出清理前/后精确清单 JSON。

Usage: server/.venv/bin/python scripts/p0a_cleanup.py
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import httpx

sys.path.insert(0, "/Users/rivers/MoreThanCorn/server")

from sqlalchemy import select  # noqa: E402

from app.db import SessionLocal  # noqa: E402
from app.models import (  # noqa: E402
    Agent,
    AgentRuntimeProvider,
    AgentSessionIndex,
    AgentSkill,
    AgentVersion,
    AnalysisTask,
    AuditLog,
    AutomationDefinition,
    Release,
    Run,
    Schedule,
    SkillResource,
    TaskRun,
)

BASE = "http://127.0.0.1:8120"
EVIDENCE = Path("/Users/rivers/MoreThanCorn/research/morethancorn/11-p0-rework-20260910/evidence")

LEGACY_AGENTS = {
    "3782d2fef86a48b383b4fe83b2c6b6e1": ("DSH消费者分析", "测试/回归资产（B1 金样本基准载体），退出产品运行面；历史只读保留"),
    "e8f98f40b1e94f4fb5cc6d167e54e5c2": ("DSH规则质检", "测试/回归资产（B1 金样本基准载体），退出产品运行面；历史只读保留"),
    "2ec32968e295437a878a17300d1cf84c": ("质检-OpenAI POC", "POC（openai-agents 运行时已于 09-04 下线），退出产品运行面"),
    "e2787f2ba3c441ac934ff2ee2a3636fd": ("业务分析-OpenAI POC", "POC（openai-agents 运行时已于 09-04 下线），退出产品运行面"),
    "b1f603c36d294308a74b6750c55aafd6": ("业务分析-通话打标-OpenAI", "含真实业务配置（通话打标指令+qwen3.8-max+质检技能挂载）→ 已迁移为新正式 AgentScope Agent，旧实例归档"),
}
LEGACY_PROVIDER_IDS = {
    "c56c081e5cd84d1991bb1170cd794901": "deepseek-harness",
    "cf5ff394fc514f0d94b3d57ce7089d71": "openai-agents",
}
ACCEPTANCE_LEFTOVER_SKILLS = {
    "e40e7331d2184a93b20a933057f0092a": "frontmatter-验收技能",
    "8eeed7cfc1304688be1f6228bacd4a51": "frontmatter-验收技能",
    "d24f3052967942af8f397db1064930e8": "zip-验收技能",
}
DEMO_SCHEDULE_ID = "d525c47611314922a241ef6e92d61017"  # DEMO002B-sched-b5f8b1a2（enabled）
CARRY_SKILL_ID = "4674a22b2e60400b98ef855ebe868e60"  # 客服话术质检技能 → 随迁移带走
SOURCE_VERSION_ID = "5be8641213074b5b968158c0d29fabb2"  # 通话打标旧模块版本（instructions 来源）


def _iso(dt) -> str | None:
    return dt.isoformat() if dt else None


def collect_inventory(db) -> dict:
    """依赖清单：任务书 §三要求覆盖的全部对象族。"""
    agents = db.execute(select(Agent)).scalars().all()
    inv: dict = {"collected_at": datetime.now(timezone.utc).isoformat(), "agents": []}
    for a in agents:
        versions = db.execute(select(AgentVersion).filter_by(agent_id=a.id)).scalars().all()
        releases = db.execute(select(Release).filter_by(agent_id=a.id)).scalars().all()
        sess_idx = db.execute(select(AgentSessionIndex).filter_by(agent_id=a.id)).scalars().all()
        tasks = db.execute(select(AnalysisTask).filter_by(agent_id=a.id)).scalars().all()
        task_ids = [t.id for t in tasks]
        task_runs = db.execute(select(TaskRun).where(TaskRun.task_id.in_(task_ids))).scalars().all() if task_ids else []
        run_ids = [tr.id for tr in task_runs]
        runs = db.execute(select(Run).where(Run.agent_id == a.id)).scalars().all()
        mounts = db.execute(select(AgentSkill).filter_by(agent_id=a.id)).scalars().all()
        automations = db.execute(select(AutomationDefinition).filter_by(agent_id=a.id)).scalars().all()
        inv["agents"].append({
            "id": a.id, "name": a.name, "type": a.type, "status": a.status,
            "archived": bool(a.archived), "module_key": a.module_key,
            "config_keys": sorted((a.config or {}).keys()),
            "versions": [{"id": v.id, "version_no": v.version_no, "created_at": _iso(v.created_at)} for v in versions],
            "releases": [{"id": r.id, "environment": r.environment, "status": r.status,
                          "runtime_provider_id": r.runtime_provider_id,
                          "runtime_profile": r.runtime_profile,
                          "has_binding_snapshot": bool(r.runtime_binding_snapshot),
                          "agentscope_agent_id": (r.runtime_binding_snapshot or {}).get("agentscope_agent_id"),
                          "created_at": _iso(r.created_at)} for r in releases],
            "session_index": [{"id": s.id, "session_id": s.session_id,
                               "runtime_agent_id": s.runtime_agent_id} for s in sess_idx],
            "analysis_tasks": [{"id": t.id, "name": t.name, "status": t.status} for t in tasks],
            "task_run_count": len(task_runs),
            "task_run_ids_sample": run_ids[:5],
            "run_count": len(runs),
            "skill_mounts": [{"skill_id": m.skill_id} for m in mounts],
            "automations": [{"id": m.id, "name": m.name, "enabled": m.enabled} for m in automations],
        })
    # 全局对象
    inv["runtime_providers"] = [
        {"id": p.id, "kind": p.kind, "status": p.status, "base_url": p.base_url}
        for p in db.execute(select(AgentRuntimeProvider)).scalars().all()]
    inv["skills"] = [
        {"id": s.id, "name": s.name, "source": s.source}
        for s in db.execute(select(SkillResource)).scalars().all()]
    inv["schedules"] = [
        {"id": s.id, "name": s.name, "enabled": s.enabled, "cron_expr": s.cron_expr, "task_id": s.task_id}
        for s in db.execute(select(Schedule)).scalars().all()]
    inv["workflow_target_tasks"] = [
        {"id": t.id, "name": t.name, "status": t.status, "workflow_id": t.workflow_id}
        for t in db.execute(select(AnalysisTask).filter(AnalysisTask.agent_id.is_(None))).scalars().all()]
    from app.models import QualityResult
    inv["counts"] = {
        "run": db.execute(select(Run.id)).scalars().all().__len__(),
        "quality_result": len(db.execute(select(QualityResult.id)).scalars().all()),
        "task_run": len(db.execute(select(TaskRun.id)).scalars().all()),
        "automation_definition": len(db.execute(select(AutomationDefinition.id)).scalars().all()),
    }
    # AgentScope 侧（原生表，与平台同库 wf_dev）
    from sqlalchemy import text
    for tbl in ("agents", "sessions", "messages", "schedules", "skills", "mcps", "knowledge_bases"):
        try:
            inv.setdefault("agentscope_native", {})[tbl] = db.execute(text(f"SELECT count(*) FROM {tbl}")).scalar()
        except Exception as exc:  # noqa: BLE001
            inv.setdefault("agentscope_native", {})[tbl] = f"ERR:{exc}"
    return inv


def migrate_call_tagging(db) -> dict:
    """把通话打标的真实业务配置迁移为新的正式 AgentScope-native custom Agent。"""
    src_version = db.get(AgentVersion, SOURCE_VERSION_ID)
    instructions = ((src_version.definition or {}).get("agentSpec") or {}).get("instructions") or ""
    if not instructions.strip():
        raise SystemExit("FATAL: 源版本 instructions 为空，拒绝迁移")
    # 幂等：已迁移过则直接返回
    existing = db.execute(select(Agent).where(Agent.name == "业务分析-通话打标",
                                              Agent.type == "custom")).scalars().first()
    if existing and not existing.archived:
        return {"agent_id": existing.id, "status": "already-migrated"}
    with httpx.Client(base_url=BASE, timeout=120) as c:
        r = c.post("/api/agents", json={
            "type": "custom",
            "name": "业务分析-通话打标",
            "description": "逐通话业务打标（服务类型/客户意图/业务结果/跟进机会）；自历史实例 业务分析-通话打标-OpenAI 迁移的正式 AgentScope Agent",
            "rolePrompt": instructions,
            "modelRef": {"modelId": "qwen3.8-max"},
            "skills": [CARRY_SKILL_ID],
        })
        r.raise_for_status()
        aid = r.json()["id"]
        r = c.post(f"/api/agents/{aid}/versions", json={"note": "P0-A 迁移自 业务分析-通话打标-OpenAI（5be86412 业务配置）"})
        if r.status_code != 201:
            raise SystemExit(f"FATAL: 版本创建失败 {r.status_code} {r.text[:300]}")
        vid = r.json()["versionId"]
        r = c.post(f"/api/agents/{aid}/releases", json={"environment": "prod", "versionId": vid})
        if r.status_code != 201:
            raise SystemExit(f"FATAL: prod 发布失败 {r.status_code} {r.text[:300]}")
        rel = r.json()
    return {"agent_id": aid, "version_id": vid, "release": rel, "status": "migrated"}


def cleanup(db) -> dict:
    """单事务清理 + AuditLog 留痕，幂等。"""
    actions: dict = {"archived_agents": [], "stopped_releases": [], "paused_tasks": [],
                     "disabled_providers": [], "disabled_schedules": [], "deleted_skills": [],
                     "kept": []}
    now = datetime.now(timezone.utc)
    for aid, (name, reason) in LEGACY_AGENTS.items():
        a = db.get(Agent, aid)
        if not a:
            continue
        if not a.archived:
            a.archived = True
            a.updated_at = now
            actions["archived_agents"].append({"id": aid, "name": name, "reason": reason})
        for rel in db.execute(select(Release).filter_by(agent_id=aid, status="active")).scalars().all():
            rel.status = "rolled_back"
            actions["stopped_releases"].append({
                "id": rel.id, "agent": name, "environment": rel.environment,
                "runtime_provider_id": rel.runtime_provider_id,
                "reason": "P0-A：旧 Agent 退出产品运行面，active Release 清零"})
        for t in db.execute(select(AnalysisTask).filter_by(agent_id=aid, status="active")).scalars().all():
            t.status = "paused"
            t.updated_at = now
            actions["paused_tasks"].append({"id": t.id, "name": t.name,
                                            "reason": "P0-A：目标 Agent 归档，停止继续产生运行"})
    for pid, kind in LEGACY_PROVIDER_IDS.items():
        p = db.get(AgentRuntimeProvider, pid)
        if p and p.status != "disabled":
            p.status = "disabled"
            actions["disabled_providers"].append({"id": pid, "kind": kind,
                                                  "reason": "B4 收尾：遗留运行时 DB 注册表下线（运行时已退役）"})
    sch = db.get(Schedule, DEMO_SCHEDULE_ID)
    if sch and sch.enabled:
        sch.enabled = False
        actions["disabled_schedules"].append({"id": sch.id, "name": sch.name,
                                              "reason": "DEMO 任务调度停用，防止未来自动产生运行（任务行按用户规则只读保留）"})
    for sid, sname in ACCEPTANCE_LEFTOVER_SKILLS.items():
        s = db.get(SkillResource, sid)
        if not s:
            continue
        mounted = db.execute(select(AgentSkill).filter_by(skill_id=sid)).scalars().first()
        if mounted:
            actions["kept"].append({"kind": "skill", "id": sid, "name": sname,
                                    "reason": "仍有挂载引用，拒绝删除"})
            continue
        db.delete(s)
        actions["deleted_skills"].append({"id": sid, "name": sname,
                                          "reason": "09-08 验收轮遗留测试数据，无挂载引用，物理删除"})
    db.add(AuditLog(actor="质量管理员", action="p0a.legacy_agent_cleanup", target_type="agent",
                    target_id="p0a-batch", detail={"agents": list(LEGACY_AGENTS), **actions},
                    created_at=now))
    db.commit()
    return actions


def orphan_fk_scan(db) -> list[dict]:
    from sqlalchemy import text
    checks = [
        ("analysis_task.workflow_id→workflow", "SELECT t.id, t.name, t.workflow_id FROM analysis_task t LEFT JOIN workflow w ON w.id=t.workflow_id WHERE t.workflow_id IS NOT NULL AND w.id IS NULL"),
        ("release.agent_version_id→agent_version", "SELECT r.id FROM release r LEFT JOIN agent_version v ON v.id=r.agent_version_id WHERE v.id IS NULL"),
        ("agent_session_index.agent_id→agent", "SELECT s.id FROM agent_session_index s LEFT JOIN agent a ON a.id=s.agent_id WHERE a.id IS NULL"),
        ("task_run.task_id→analysis_task", "SELECT tr.id FROM task_run tr LEFT JOIN analysis_task t ON t.id=tr.task_id WHERE t.id IS NULL"),
        ("agent_skill.skill_id→skill", "SELECT m.agent_id FROM agent_skill m LEFT JOIN skill s ON s.id=m.skill_id WHERE s.id IS NULL"),
        ("schedule.task_id→analysis_task", "SELECT s.id FROM schedule s LEFT JOIN analysis_task t ON t.id=s.task_id WHERE s.task_id IS NOT NULL AND t.id IS NULL"),
        ("release.runtime_provider_id→provider", "SELECT r.id FROM release r LEFT JOIN agent_runtime_provider p ON p.id=r.runtime_provider_id WHERE r.runtime_provider_id IS NOT NULL AND p.id IS NULL"),
    ]
    out = []
    for label, sql in checks:
        rows = db.execute(text(sql)).fetchall()
        out.append({"check": label, "orphan_count": len(rows),
                    "sample": [list(map(str, r)) for r in rows[:5]]})
    return out


def main() -> None:
    db = SessionLocal()
    before = collect_inventory(db)
    before["orphan_fk_scan"] = orphan_fk_scan(db)
    (EVIDENCE / "p0a-inventory-before.json").write_text(
        json.dumps(before, ensure_ascii=False, indent=2, default=str))
    print("== inventory-before written ==")

    mig = migrate_call_tagging(db)
    print("== migration ==", json.dumps(mig, ensure_ascii=False)[:400])

    actions = cleanup(db)
    print("== cleanup actions ==", json.dumps(actions, ensure_ascii=False, indent=1, default=str)[:3000])

    db.expire_all()
    after = collect_inventory(db)
    after["orphan_fk_scan"] = orphan_fk_scan(db)
    after["migration"] = mig
    after["cleanup_actions"] = actions
    (EVIDENCE / "p0a-inventory-after.json").write_text(
        json.dumps(after, ensure_ascii=False, indent=2, default=str))
    print("== inventory-after written ==")
    db.close()


if __name__ == "__main__":
    main()
