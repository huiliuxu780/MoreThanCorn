"""MTC-002B-R2：WorkItem 视觉验收夹具（安全模型重写版）。

用法（仓库根目录）：
    WF_ENV=development ALLOW_DEMO_SEED=1 server/.venv/bin/python scripts/seed_workitems_demo.py [--bulk N]

安全门控（任一不满足即退出非 0，且不执行任何 delete/insert/HTTP）：
1. WF_ENV == "development"；
2. ALLOW_DEMO_SEED == "1"（显式 opt-in）；
3. 当前数据库名严格等于 wf_dev（或经 MTC_SEED_EXPECT_DB 显式声明的专用 fixture DB）。

设计约束：
- 单一一致目标：全部经 SessionLocal（同一 DATABASE_URL）ORM 写入，**零 HTTP 调用**，
  不存在“API 与数据库不同目标”的风险；
- 精确清理：仅删除可由 marker 根对象追溯的资源（任务名/资产名/定义名/调度名/
  fire_key/idempotency_key 均带 DEMO002B- 前缀）；禁止通配旧前缀、禁止时间窗清理；
- 清理与新建在同一事务内完成，任一失败整体回滚（不留“已清理、未建成”半完成态）；
- 每轮生成唯一 namespace（DEMO002B-<ns>），验收脚本只查该 namespace；
- 测试钩子 MTC_SEED_INJECT_ERROR=1：清理后、提交前抛错，用于验证回滚（仅测试用）。
"""
from __future__ import annotations

import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "server"))

MARK = "DEMO002B"


def _gate() -> tuple[str, str]:
    """返回 (db_name, namespace)；门控失败打印原因并 exit 2（无任何副作用）。"""
    env = os.environ.get("WF_ENV", "")
    if env != "development":
        print(f"REFUSE: WF_ENV 必须为 development（当前：{env!r}）", file=sys.stderr)
        sys.exit(2)
    if os.environ.get("ALLOW_DEMO_SEED", "") != "1":
        print("REFUSE: 需要显式 opt-in ALLOW_DEMO_SEED=1", file=sys.stderr)
        sys.exit(2)
    from app.config import DATABASE_URL
    db_name = DATABASE_URL.rsplit("/", 1)[-1]
    expect = os.environ.get("MTC_SEED_EXPECT_DB", "wf_dev")
    if db_name != expect:
        print(f"REFUSE: 数据库名 {db_name!r} != 期望 {expect!r}（拒绝在非目标库写入）",
              file=sys.stderr)
        sys.exit(2)
    return db_name, uuid.uuid4().hex[:8]


def main() -> None:
    db_name, ns = _gate()
    bulk = 0
    if "--bulk" in sys.argv:
        bulk = int(sys.argv[sys.argv.index("--bulk") + 1])
    print(f"TARGET DB: {db_name} | namespace: {MARK}-{ns} | bulk: {bulk}")
    print("RISK: 将清理并重建该 namespace 的夹具对象（marker 可追溯），不影响其他数据。")

    from sqlalchemy import delete as sql_delete
    from sqlalchemy import select
    from zoneinfo import ZoneInfo

    from app.db import SessionLocal
    from app.models import (AnalysisTask, AnalysisTaskVersion, DataAsset,
                            DataDefinition, DataDefinitionVersion, ResultRuleSet,
                            ResultRuleVersion, Schedule, ScheduleOccurrence, TaskRun,
                            Workflow)

    sh = ZoneInfo("Asia/Shanghai")
    now = datetime.now(sh)
    db = SessionLocal()
    try:
        # ---- 精确清理（marker 根对象追溯；与新建同事务） ----
        old_tasks = [t.id for t in db.execute(select(AnalysisTask).where(
            AnalysisTask.name.like(f"{MARK}-%"))).scalars().all()]
        if old_tasks:
            db.execute(sql_delete(TaskRun).where(TaskRun.task_id.in_(old_tasks)))
            db.execute(sql_delete(ScheduleOccurrence).where(
                ScheduleOccurrence.task_id.in_(old_tasks)))
            db.execute(sql_delete(Schedule).where(Schedule.task_id.in_(old_tasks)))
            db.execute(sql_delete(AnalysisTaskVersion).where(
                AnalysisTaskVersion.task_id.in_(old_tasks)))
            db.execute(sql_delete(AnalysisTask).where(AnalysisTask.id.in_(old_tasks)))
        old_defs = [d.id for d in db.execute(select(DataDefinition).where(
            DataDefinition.name.like(f"{MARK}-%"))).scalars().all()]
        if old_defs:
            db.execute(sql_delete(DataDefinitionVersion).where(
                DataDefinitionVersion.definition_id.in_(old_defs)))
            db.execute(sql_delete(DataDefinition).where(DataDefinition.id.in_(old_defs)))
        db.execute(sql_delete(DataAsset).where(DataAsset.name.like(f"{MARK}-%")))

        # ---- 依赖的真实对象（同库查询，不伪造） ----
        wf = db.execute(select(Workflow).where(
            Workflow.status == "published").limit(1)).scalars().first()
        if wf is None:
            raise RuntimeError("目标库没有已发布 Workflow，拒绝伪造执行目标")
        rset = db.execute(select(ResultRuleSet).where(
            ResultRuleSet.status == "published").limit(1)).scalars().first()
        rrv = None
        if rset is not None:
            rrv = db.execute(select(ResultRuleVersion).where(
                ResultRuleVersion.rule_set_id == rset.id,
                ResultRuleVersion.version_no == rset.version).limit(1)).scalars().first()

        # ---- 新建夹具（单一 namespace） ----
        asset = DataAsset(name=f"{MARK}-asset-{ns}", source="manual", location="",
                          lifecycle="Ready", health="Healthy",
                          rows=[{"interactionId": "D1",
                                 "interactionTime": "2026-09-05T10:00:00Z",
                                 "score": 90, "risk": "Low",
                                 "issues": [], "summary": "demo"}])
        db.add(asset)
        db.flush()
        ddef = DataDefinition(name=f"{MARK}-def-{ns}", data_asset_id=asset.id,
                              field_schema=[
                                  {"key": "interactionId", "type": "String", "required": True},
                                  {"key": "score", "type": "Number", "required": False}],
                              lifecycle="Ready")
        db.add(ddef)
        db.flush()
        dver = DataDefinitionVersion(definition_id=ddef.id, version_no=1,
                                     field_schema=ddef.field_schema)
        db.add(dver)
        db.flush()

        task = AnalysisTask(name=f"{MARK}-{ns}", created_by="dev", updated_by="dev",
                            data_asset_id=asset.id, data_definition_id=ddef.id,
                            workflow_id=wf.id, status="active")
        db.add(task)
        db.flush()
        ver = AnalysisTaskVersion(task_id=task.id, version_no=1, data_asset_id=asset.id,
                                  data_definition_version_id=dver.id, workflow_id=wf.id,
                                  rule_policy="pinned",
                                  result_rule_version_id=rrv.id if rrv else None,
                                  result_rule_set_id=rset.id if rset else None)
        db.add(ver)
        db.flush()
        task.current_version_id = ver.id

        def add_run(status, delivery, total, succ, fail, canc, trigger, key,
                    started=True, ended=None):
            tr = TaskRun(
                task_id=task.id, task_version_id=ver.id, status=status,
                delivery_status=delivery, trigger=trigger, total=total,
                succeeded_count=succ, failed_count=fail, skipped_count=0,
                cancelled_count=canc,
                started_at=(now - timedelta(hours=1)).astimezone(timezone.utc) if started else None,
                ended_at=ended, idempotency_key=f"{MARK}-run-{ns}-{key}")
            db.add(tr)
            return tr

        ended_at = (now - timedelta(minutes=30)).astimezone(timezone.utc)
        add_run("failed", "not_configured", 5, 0, 5, 0, "manual", "failed", ended=ended_at)
        add_run("cancelled", "not_configured", 3, 0, 0, 3, "api", "cancelled", ended=ended_at)
        add_run("succeeded", "not_configured", 4, 4, 0, 0, "schedule", "completed", ended=ended_at)
        add_run("running", "not_configured", 6, 2, 0, 0, "manual", "running")
        add_run("running", "succeeded", 2, 2, 0, 0, "manual", "conflict")
        for i in range(bulk):
            add_run("queued", "not_configured", 2, 0, 0, 0, "manual", f"bulk{i}", started=False)

        sched = Schedule(task_id=task.id, workflow_id=None, name=f"{MARK}-sched-{ns}",
                         cron_expr="0 0 1 1 *", timezone="Asia/Shanghai", enabled=True)
        db.add(sched)
        db.flush()
        plan = now + timedelta(hours=2)
        db.add(ScheduleOccurrence(schedule_id=sched.id, task_id=task.id, status="planned",
                                  planned_at=plan.astimezone(timezone.utc),
                                  timezone="Asia/Shanghai",
                                  fire_key=f"{MARK}-occ-{ns}"))

        if os.environ.get("MTC_SEED_INJECT_ERROR", "") == "1":
            raise RuntimeError("MTC_SEED_INJECT_ERROR：测试用注入失败（应整体回滚）")
        db.commit()
        print(f"OK: seeded namespace {MARK}-{ns} (5 runs + {bulk} bulk + 1 occurrence)")
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        print(f"ABORT(rolled back): {exc}", file=sys.stderr)
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
