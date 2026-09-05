"""MTC-002B-R3：WorkItem 视觉验收夹具（数据库保护彻底收紧版）。

用法（仓库根目录）：
    WF_ENV=development ALLOW_DEMO_SEED=1 server/.venv/bin/python scripts/seed_workitems_demo.py [--bulk N]
    server/.venv/bin/python scripts/seed_workitems_demo.py --list-legacy-only   # 只读诊断

安全门控（任一不满足即退出非 0，且不执行任何 delete/insert/HTTP/写入 Session）：
1. WF_ENV == "development"；
2. ALLOW_DEMO_SEED == "1"（显式 opt-in）；
3. 当前数据库名 ∈ ALLOWED_SEED_DATABASES（代码内固定白名单：wf_dev / wf_fixture）。
   不接受任何运行时环境变量覆盖白名单（MTC_SEED_EXPECT_DB 已移除）。

设计约束：
- 零 HTTP 调用，ORM 单一目标（SessionLocal = 同一 DATABASE_URL）；
- 清理与新建同一事务，失败整体 rollback；
- 仅清理 marker（DEMO002B-）根对象可追溯资源；禁止时间窗清理、禁止旧通配；
- 遗留 DEMO-002B-*（R 轮旧 marker）本轮禁止自动清理，仅 --list-legacy-only 只读列出；
- 运行前只输出四行审计信息（环境/库名/白名单命中/namespace），不泄露连接串。
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
LEGACY_MARK = "DEMO-002B"
ALLOWED_SEED_DATABASES = {"wf_dev", "wf_fixture"}


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
    if db_name not in ALLOWED_SEED_DATABASES:
        print(f"REFUSE: 数据库 {db_name!r} 不在固定白名单 {sorted(ALLOWED_SEED_DATABASES)}",
              file=sys.stderr)
        sys.exit(2)
    return db_name, uuid.uuid4().hex[:8]


def _list_legacy_only() -> None:
    """只读诊断：列出遗留 DEMO-002B-* 夹具根对象与关联数量；不删除任何数据。"""
    from sqlalchemy import func, select

    from app.db import SessionLocal
    from app.models import AnalysisTask, ScheduleOccurrence, TaskRun
    db = SessionLocal()
    try:
        tasks = db.execute(select(AnalysisTask).where(
            AnalysisTask.name.like(f"{LEGACY_MARK}-%"))).scalars().all()
        print(f"legacy fixtures (read-only): {len(tasks)} root task(s)")
        for t in tasks:
            n_runs = db.execute(select(func.count(TaskRun.id)).where(
                TaskRun.task_id == t.id)).scalar() or 0
            n_occ = db.execute(select(func.count(ScheduleOccurrence.id)).where(
                ScheduleOccurrence.task_id == t.id)).scalar() or 0
            print(f"  id={t.id} name={t.name} task_runs={n_runs} occurrences={n_occ}")
        print("NOTE: 本命令只读；遗留夹具的清理需人工确认后另行处理。")
    finally:
        db.close()


def main() -> None:
    if "--list-legacy-only" in sys.argv:
        _list_legacy_only()
        return
    db_name, ns = _gate()
    bulk = 0
    if "--bulk" in sys.argv:
        bulk = int(sys.argv[sys.argv.index("--bulk") + 1])
    print("Seed environment: development")
    print(f"Target database: {db_name}")
    print("Database allowlist: matched")
    print(f"Fixture namespace: {MARK}-{ns}")

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
        # ---- 精确清理（仅本 marker 根对象可追溯；与新建同事务） ----
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

        started_at = (now - timedelta(hours=1)).astimezone(timezone.utc)
        ended_at = (now - timedelta(minutes=30)).astimezone(timezone.utc)

        def add_run(status, delivery, total, succ, fail, canc, trigger, key,
                    started=True, ended=None):
            tr = TaskRun(
                task_id=task.id, task_version_id=ver.id, status=status,
                delivery_status=delivery, trigger=trigger, total=total,
                succeeded_count=succ, failed_count=fail, skipped_count=0,
                cancelled_count=canc,
                started_at=started_at if started else None,
                ended_at=ended, idempotency_key=f"{MARK}-run-{ns}-{key}")
            db.add(tr)
            db.flush()
            return tr

        add_run("failed", "not_configured", 5, 0, 5, 0, "manual", "failed", ended=ended_at)
        add_run("cancelled", "not_configured", 3, 0, 0, 3, "api", "cancelled", ended=ended_at)
        add_run("succeeded", "not_configured", 4, 4, 0, 0, "schedule", "completed", ended=ended_at)
        add_run("running", "not_configured", 6, 2, 0, 0, "manual", "running")
        add_run("running", "succeeded", 2, 2, 0, 0, "manual", "conflict")
        # P1-01 五场景夹具：已触发 occurrence ×（running / completed / conflict）+ 断链
        occ_run_running = add_run("running", "not_configured", 3, 1, 0, 0, "schedule", "occ-running")
        occ_run_done = add_run("succeeded", "not_configured", 2, 2, 0, 0, "schedule",
                               "occ-completed", ended=ended_at)
        occ_run_conflict = add_run("running", "succeeded", 2, 2, 0, 0, "schedule", "occ-conflict")
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
                                  fire_key=f"{MARK}-occ-{ns}-unfired"))
        # uq_occurrence_schedule_planned：同 schedule 的 planned_at 必须互不相同
        for i, (key, tr) in enumerate((("fired-running", occ_run_running),
                                       ("fired-completed", occ_run_done),
                                       ("fired-conflict", occ_run_conflict))):
            db.add(ScheduleOccurrence(
                schedule_id=sched.id, task_id=task.id, status="started", task_run_id=tr.id,
                planned_at=(now - timedelta(hours=1, minutes=-5 * i)).astimezone(timezone.utc),
                timezone="Asia/Shanghai",
                fire_key=f"{MARK}-occ-{ns}-{key}"))
        # 断链：status=started 但无 TaskRun
        db.add(ScheduleOccurrence(
            schedule_id=sched.id, task_id=task.id, status="started", task_run_id=None,
            planned_at=(now - timedelta(hours=1, minutes=-15)).astimezone(timezone.utc),
            timezone="Asia/Shanghai",
            fire_key=f"{MARK}-occ-{ns}-broken"))

        if os.environ.get("MTC_SEED_INJECT_ERROR", "") == "1":
            raise RuntimeError("MTC_SEED_INJECT_ERROR：测试用注入失败（应整体回滚）")
        db.commit()
        print(f"OK: seeded namespace {MARK}-{ns} "
              f"(8 runs + {bulk} bulk + 5 occurrences)")
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        print(f"ABORT(rolled back): {exc}", file=sys.stderr)
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
