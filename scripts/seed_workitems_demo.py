"""MTC-002B-R：可重置的 WorkItem 视觉验收夹具（仅开发库 wf_dev）。

用法（仓库根目录）：server/.venv/bin/python scripts/seed_workitems_demo.py

- 幂等/可重置：先按标记删除旧夹具（schedule 名 DEMO-002B-*、fire_key 前缀 demo-002b-/seed-、
  TaskRun.idempotency_key 前缀 demo-002b-，以及一次性清理 2026-09-05 首版未标记种子），再重建；
- 夹具挂在独立自主任务 DEMO-002B-<suffix> 下，不污染真实开发数据；
- 产出五泳道样本：排队中（未触发 occurrence）、失败/取消（failed+cancelled）、
  已完成（succeeded+not_configured）、执行中（running 无终态子 Run）；
  需要操作由真实冲突批次或 running+delivery=succeeded 夹具提供。
"""
from __future__ import annotations

import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "server"))

import json  # noqa: E402
import urllib.request  # noqa: E402

from sqlalchemy import select  # noqa: E402
from zoneinfo import ZoneInfo  # noqa: E402

from app.db import SessionLocal  # noqa: E402
from app.models import (AnalysisTask, AnalysisTaskVersion, DataAsset,  # noqa: E402
                        DataDefinition, DataDefinitionVersion, Schedule,
                        ScheduleOccurrence, TaskRun, Workflow)

SH = ZoneInfo("Asia/Shanghai")
MARK = "demo-002b"


def _cleanup(db) -> int:
    """按依赖顺序用核心 DELETE 清理旧夹具（ORM 无 relationship，删除顺序不可靠）。"""
    from sqlalchemy import delete as sql_delete
    removed = 0
    occs = db.execute(select(ScheduleOccurrence.id).where(
        ScheduleOccurrence.fire_key.like(f"{MARK}-%")
        | ScheduleOccurrence.fire_key.like("seed-%"))).scalars().all()
    if occs:
        db.execute(sql_delete(ScheduleOccurrence).where(
            ScheduleOccurrence.id.in_([o for o in occs])))
        removed += len(occs)
    scheds = db.execute(select(Schedule.id).where(
        Schedule.name.like("DEMO-002B-%") | Schedule.name.in_(["mtc002b-seed"]))).scalars().all()
    if scheds:
        db.execute(sql_delete(Schedule).where(Schedule.id.in_([s_ for s_ in scheds])))
        removed += len(scheds)
    runs = db.execute(select(TaskRun.id).where(
        TaskRun.idempotency_key.like(f"{MARK}-%"))).scalars().all()
    legacy = db.execute(select(TaskRun.id).where(
        TaskRun.created_at >= datetime(2026, 9, 5, 14, 0, tzinfo=timezone.utc),
        TaskRun.created_at <= datetime(2026, 9, 5, 14, 10, tzinfo=timezone.utc),
        TaskRun.status.in_(["failed", "cancelled", "succeeded"]),
        TaskRun.trigger.in_(["manual", "api", "schedule"]))).scalars().all()
    run_ids = [r for r in runs] + [r for r in legacy if r not in runs]
    if run_ids:
        db.execute(sql_delete(TaskRun).where(TaskRun.id.in_(run_ids)))
        removed += len(run_ids)
    defs = db.execute(select(DataDefinition.id).where(
        DataDefinition.name.like("DEMO-002B-def-%"))).scalars().all()
    def_ids = [d for d in defs]
    if def_ids:
        db.execute(sql_delete(DataDefinitionVersion).where(
            DataDefinitionVersion.definition_id.in_(def_ids)))
        db.execute(sql_delete(DataDefinition).where(DataDefinition.id.in_(def_ids)))
        removed += len(def_ids)
    assets = db.execute(select(DataAsset.id).where(
        DataAsset.name.like("DEMO-002B-asset-%"))).scalars().all()
    if assets:
        db.execute(sql_delete(DataAsset).where(DataAsset.id.in_([a for a in assets])))
        removed += len(assets)
    demos = db.execute(select(AnalysisTask.id).where(
        AnalysisTask.name.like("DEMO-002B-%"))).scalars().all()
    demo_ids = [t for t in demos]
    if demo_ids:
        db.execute(sql_delete(AnalysisTaskVersion).where(
            AnalysisTaskVersion.task_id.in_(demo_ids)))
        db.execute(sql_delete(AnalysisTask).where(AnalysisTask.id.in_(demo_ids)))
        removed += len(demo_ids)
    db.commit()
    return removed


def main() -> None:
    db = SessionLocal()
    try:
        removed = _cleanup(db)
        suffix = uuid.uuid4().hex[:6]
        name = f"DEMO-002B-{suffix}"
        # 真实已发布工作流（启动批次需要可解析的 published version）
        pub = db.execute(select(Workflow).where(
            Workflow.status == "published").limit(1)).scalars().first()
        wf_id = pub.id if pub else "wf-demo"
        task = AnalysisTask(name=name, created_by="dev", updated_by="dev",
                            data_asset_id="da-demo", workflow_id=wf_id, status="active")
        db.add(task)
        db.flush()
        ver = AnalysisTaskVersion(task_id=task.id, version_no=1, data_asset_id="da-demo",
                                  workflow_id=wf_id, rule_policy="pinned")
        db.add(ver)
        db.flush()
        task.current_version_id = ver.id
        db.flush()

        # 真实单行数据资产（经 API 创建，reader 可读）→ 允许 verify 脚本启动新批次制造 SSE 变化
        req = urllib.request.Request(
            "http://127.0.0.1:8120/api/data-assets",
            data=json.dumps({"name": f"DEMO-002B-asset-{suffix}",
                             "rows": [{"interactionId": "D1",
                                       "interactionTime": "2026-09-05T10:00:00Z",
                                       "score": 90, "risk": "Low",
                                       "issues": [], "summary": "demo"}],
                             "timeField": "interactionTime"}).encode(),
            headers={"Content-Type": "application/json"}, method="POST")
        asset_id = json.load(urllib.request.urlopen(req))["id"]
        task.data_asset_id = asset_id
        ver.data_asset_id = asset_id
        # 发布一个数据定义版本（P0-08 启动闸门要求非空）
        req = urllib.request.Request(
            "http://127.0.0.1:8120/api/data-definitions",
            data=json.dumps({"name": f"DEMO-002B-def-{suffix}", "assetId": asset_id,
                             "fieldSchema": [
                                 {"key": "interactionId", "type": "String", "required": True},
                                 {"key": "score", "type": "Number", "required": False},
                                 {"key": "risk", "type": "String", "required": False},
                                 {"key": "issues", "type": "Array", "required": False},
                                 {"key": "summary", "type": "String", "required": False}]}).encode(),
            headers={"Content-Type": "application/json"}, method="POST")
        def_id = json.load(urllib.request.urlopen(req))["id"]
        req = urllib.request.Request(
            f"http://127.0.0.1:8120/api/data-definitions/{def_id}/publish",
            data=b"{}", headers={"Content-Type": "application/json"}, method="POST")
        ver.data_definition_version_id = json.load(urllib.request.urlopen(req))["versionId"]
        task.data_definition_id = def_id
        # 钉住一个真实已发布规则版本（启动闸门：pinned 需 result_rule_version_id）
        from app.models import ResultRuleSet, ResultRuleVersion
        rset = db.execute(select(ResultRuleSet).where(
            ResultRuleSet.status == "published").limit(1)).scalars().first()
        if rset is not None:
            rrv = db.execute(select(ResultRuleVersion).where(
                ResultRuleVersion.rule_set_id == rset.id,
                ResultRuleVersion.version_no == rset.version).limit(1)).scalars().first()
            if rrv is not None:
                ver.result_rule_version_id = rrv.id
                ver.result_rule_set_id = rset.id
        db.flush()

        now = datetime.now(SH)

        def add_run(status, delivery, total, succ, fail, canc, trigger, key):
            started = (now - timedelta(hours=1)).astimezone(timezone.utc)
            ended = (now - timedelta(minutes=30)).astimezone(timezone.utc)
            tr = TaskRun(task_id=task.id, task_version_id=ver.id, status=status,
                         delivery_status=delivery, trigger=trigger, total=total,
                         succeeded_count=succ, failed_count=fail, skipped_count=0,
                         cancelled_count=canc,
                         started_at=started if status != "queued" else None,
                         ended_at=ended if status in ("succeeded", "failed", "cancelled") else None,
                         idempotency_key=f"{MARK}-{key}")
            db.add(tr)
            return tr

        add_run("failed", "not_configured", 5, 0, 5, 0, "manual", "failed")
        add_run("cancelled", "not_configured", 3, 0, 0, 3, "api", "cancelled")
        add_run("succeeded", "not_configured", 4, 4, 0, 0, "schedule", "completed")
        add_run("running", "not_configured", 6, 2, 0, 0, "manual", "running")
        # 冲突样本：execution running + delivery succeeded → 需要操作
        add_run("running", "succeeded", 2, 2, 0, 0, "manual", "conflict")

        # 排队中证据=尚未到期的 planned occurrence（允许跨天；verify 会用日期控件定位其业务日）
        plan = now + timedelta(hours=2)
        # 年度 cron：避免调度器按小时 materialize 噪声；单条 occurrence 即排队中证据
        sched = Schedule(task_id=task.id, workflow_id=None, name=f"DEMO-002B-{suffix}",
                         cron_expr="0 0 1 1 *", timezone="Asia/Shanghai", enabled=True)
        db.add(sched)
        db.flush()
        db.add(ScheduleOccurrence(schedule_id=sched.id, task_id=task.id, status="planned",
                                  planned_at=plan.astimezone(timezone.utc),
                                  timezone="Asia/Shanghai",
                                  fire_key=f"{MARK}-occ-{suffix}"))
        db.commit()
        print(f"reset: removed={removed}; seeded task={name} (5 runs + 1 occurrence)")
    finally:
        db.close()


if __name__ == "__main__":
    main()
