"""SDD 13 PR3：运行中心 API / occurrence 调度 / 分页筛选 / 启动闸门 / retry API。"""
import uuid
from datetime import datetime, timedelta, timezone

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.models import (AnalysisTask, AnalysisTaskVersion, Connection, DataAsset,
                        DataDefinition, DataDefinitionVersion, Datasource,
                        ResultRuleSet, ResultRuleVersion, Schedule,
                        ScheduleOccurrence, TaskRun, Workflow, WorkflowVersion)
from app.occurrences import (associate_fire, fire_key_for, mark_missed,
                             materialize_occurrences)
from app.task_runner import TaskStartError, start_task_run

client = TestClient(app)

TARGET = "consumer_analysis_result_acceptance"
MAPPING = {"_run_id": "$run.id", "_task_run_id": "$run.taskRunId",
           "_task_id": "$run.taskId", "_task_version_id": "$run.taskVersionId",
           "_interaction_ref": "$run.interactionRef", "_output_schema_ref": "$schema.ref",
           "_written_at": "$system.completedAt", "call_id": "$output.call_id",
           "analysis_status": "$output.analysis_status", "title": "$output.title",
           "summary": "$output.summary", "segments": "$output.segments",
           "full_output": "$output"}


@pytest.fixture()
def env():
    db = SessionLocal()
    tag = uuid.uuid4().hex[:6]
    # 目标表至少一行，保证 start_task_run 的 count>0
    with psycopg.connect("postgresql://rivers@127.0.0.1:5432/wf_test") as pg:
        pg.execute(
            f"INSERT INTO public.{TARGET} (_run_id,_task_run_id,_task_id,"
            "_task_version_id,_interaction_ref,_output_schema_ref,_written_at,"
            "call_id,analysis_status,title,summary,segments,full_output) "
            "VALUES (%s,'tr','t','tv','i','ref',now(),'c','done','T','S','[]','{}')",
            [f"seed-{tag}"])
        pg.commit()
    conn = Connection(name=f"op-conn-{tag}", kind="none", protocol="postgresql",
                      endpoint={"host": "127.0.0.1", "port": 5432, "user": "rivers"},
                      secret_ref="", lifecycle="active", status="active")
    db.add(conn)
    db.flush()
    ds = Datasource(name=f"op-ds-{tag}", type="postgresql", connection_id=conn.id,
                    location="wf_test", status="enabled")
    db.add(ds)
    db.flush()
    asset = DataAsset(name=f"op-target-{tag}", source="postgres", datasource_id=ds.id,
                      location=TARGET, lifecycle="Ready")
    db.add(asset)
    db.flush()
    dd = DataDefinition(name=f"op-def-{tag}", data_asset_id=asset.id, field_schema=[
        {"key": k, "type": "String", "required": True} for k in ("_run_id",)])
    db.add(dd)
    db.flush()
    dv = DataDefinitionVersion(definition_id=dd.id, version_no=1,
                               field_schema=dd.field_schema)
    db.add(dv)
    db.flush()
    # 合规工作流（含 create-record）+ 已发布版本 + 规则版本，供 start_task_run 解析
    wf = Workflow(name=f"op-wf-{tag}", status="published")
    db.add(wf)
    db.flush()
    wv = WorkflowVersion(workflow_id=wf.id, version_no=1,
                         definition={"graph": {"nodes": [
                             {"id": "in", "type": "input"},
                             {"id": "out", "type": "create-record"}]}})
    db.add(wv)
    db.flush()
    wf.current_version_id = wv.id
    rs = ResultRuleSet(name=f"op-rs-{tag}", rules={"scoreRules": [], "issueRules": []})
    db.add(rs)
    db.flush()
    rv = ResultRuleVersion(rule_set_id=rs.id, version_no=1, rules=rs.rules)
    db.add(rv)
    db.flush()
    task = AnalysisTask(name=f"op-task-{tag}", execution_target_type="workflow",
                        workflow_id=wf.id, data_asset_id=asset.id, status="active")
    db.add(task)
    db.flush()
    tv = AnalysisTaskVersion(task_id=task.id, version_no=1, workflow_id=wf.id,
                             workflow_version_policy="pinned",
                             pinned_workflow_version_id=wv.id,
                             data_asset_id=asset.id, data_definition_version_id=dv.id,
                             result_rule_version_id=rv.id, rule_policy="pinned",
                             output_mode="target_table", output_asset_id=asset.id,
                             output_definition_version_id=dv.id,
                             output_write_mode="upsert", output_key_fields=["_run_id"],
                             output_mapping=MAPPING,
                             output_contract_snapshot={"ref": "consumer@1.0.0",
                                                       "sha256": "x",
                                                       "schema": {"type": "object"}})
    db.add(tv)
    db.flush()
    task.current_version_id = tv.id
    db.commit()
    yield {"db": db, "task": task, "tv": tv, "asset": asset, "dv": dv, "tag": tag}
    db.rollback()
    db.close()


def test_validate_endpoint_reports_full_issues(env):
    r = client.post("/api/tasks/output-binding/validate", json={
        "executionTarget": {"type": "workflow", "workflowId": "wf-x"},
        "inputAssetId": env["asset"].id,
        "outputBinding": {"mode": "target_table", "assetId": env["asset"].id,
                          "definitionVersionId": env["dv"].id, "writeMode": "upsert",
                          "keyFields": ["_run_id"], "mapping": MAPPING}})
    assert r.status_code == 200
    body = r.json()
    # 输入==输出默认拒绝（其余检查可能因表存在而通过）
    assert any(i["code"] == "INPUT_EQUALS_OUTPUT" for i in body["issues"])

    r2 = client.post("/api/tasks/output-binding/validate", json={
        "outputBinding": {"mode": "target_table", "assetId": "nope",
                          "definitionVersionId": "nope", "keyFields": [], "mapping": {}}})
    assert r2.json()["valid"] is False
    assert any(i["code"] == "ASSET_MISSING" for i in r2.json()["issues"])


def test_start_gate_requires_target_table_for_production_triggers(env):
    db = env["db"]
    # platform_only 版本：schedule 触发必须拒绝
    tv2 = AnalysisTaskVersion(task_id=env["task"].id, version_no=2, workflow_id="wf-x",
                              data_asset_id=env["asset"].id,
                              data_definition_version_id=env["dv"].id,
                              output_mode="platform_only")
    db.add(tv2)
    db.flush()
    env["task"].current_version_id = tv2.id
    db.commit()
    with pytest.raises(TaskStartError) as ei:
        start_task_run(db, env["task"].id, trigger="schedule")
    assert ei.value.status_code == 422
    # 恢复 target_table 版本后 manual 可启动（数据源真实可达）
    env["task"].current_version_id = env["tv"].id
    db.commit()
    tr, _res = start_task_run(db, env["task"].id, trigger="manual")
    assert tr.output_binding_snapshot is not None
    assert tr.delivery_status == "pending"


def test_occurrence_materialize_missed_and_associate(env):
    db = env["db"]
    sch = Schedule(name=f"op-sch-{env['tag']}", task_id=env["task"].id,
                   cron_expr="0 * * * *", timezone="Asia/Shanghai", enabled=True)
    db.add(sch)
    db.commit()
    n = materialize_occurrences(db)
    assert n >= 1
    occs = db.query(ScheduleOccurrence).filter_by(schedule_id=sch.id).all()
    assert all(o.status == "planned" for o in occs)
    assert len({o.fire_key for o in occs}) == len(occs)

    # 超宽限未触发 → missed
    occs[0].planned_at = datetime.now(timezone.utc) - timedelta(minutes=10)
    occs[0].fire_key = fire_key_for(sch.id, occs[0].planned_at)
    db.commit()
    assert mark_missed(db) >= 1
    db.expire_all()
    assert db.get(ScheduleOccurrence, occs[0].id).status == "missed"

    # 触发关联：fire_key 幂等回填 task_run_id
    tr = TaskRun(task_id=env["task"].id, task_version_id=env["tv"].id,
                 trigger="schedule", status="queued")
    db.add(tr)
    db.commit()
    occ2 = db.get(ScheduleOccurrence, occs[1].id)
    associate_fire(db, sch.id, occ2.planned_at, tr.id)
    db.expire_all()
    occ2 = db.get(ScheduleOccurrence, occs[1].id)
    assert occ2.status == "started" and occ2.task_run_id == tr.id

    # 停用 → 未触发 planned 变 cancelled（不静默删除）
    sch.enabled = False
    db.commit()
    materialize_occurrences(db)
    db.expire_all()
    left = db.query(ScheduleOccurrence).filter_by(schedule_id=sch.id).all()
    assert any(o.status == "cancelled" for o in left)


def test_today_board_columns_and_priority(env):
    db = env["db"]
    now = datetime.now(timezone.utc)
    mk = lambda status, dstatus: TaskRun(
        task_id=env["task"].id, task_version_id=env["tv"].id, trigger="manual",
        status=status, delivery_status=dstatus, total=2, succeeded_count=2,
        started_at=now - timedelta(minutes=2), created_at=now - timedelta(minutes=2))
    tr_run = mk("running", "not_configured")
    tr_del = mk("succeeded", "running")
    tr_att = mk("succeeded", "failed")
    tr_done = mk("succeeded", "succeeded")
    db.add_all([tr_run, tr_del, tr_att, tr_done])
    db.commit()
    r = client.get("/api/operations/task-runs/today",
                   params={"timezone": "UTC"})
    assert r.status_code == 200
    board = r.json()
    stages = {c["id"]: c["stage"] for c in
              [x for col in board["columns"].values() for x in col]}
    assert stages[tr_run.id] == "running"
    assert stages[tr_del.id] == "delivering"
    assert stages[tr_att.id] == "attention"
    assert stages[tr_done.id] == "completed"
    assert board["summary"]["attention"] >= 1

    # 筛选：attention only
    r2 = client.get("/api/operations/task-runs/today",
                    params={"timezone": "UTC", "attention": "only"})
    ids = {c["id"] for c in r2.json()["columns"]["attention"]}
    assert tr_att.id in ids and tr_run.id not in ids


def test_history_pagination_and_filters(env):
    db = env["db"]
    now = datetime.now(timezone.utc)
    for i in range(7):
        db.add(TaskRun(task_id=env["task"].id, task_version_id=env["tv"].id,
                       trigger="manual" if i % 2 == 0 else "api",
                       status="succeeded" if i < 5 else "failed",
                       delivery_status="succeeded",
                       created_at=now - timedelta(minutes=i + 10)))
    db.commit()
    r = client.get("/api/operations/task-runs",
                   params={"pageSize": 3, "page": 1, "taskId": env["task"].id})
    body = r.json()
    assert len(body["items"]) == 3 and body["total"] == 7
    r2 = client.get("/api/operations/task-runs",
                    params={"status": "failed", "pageSize": 50, "taskId": env["task"].id})
    assert all(i["execution"]["status"] == "failed" for i in r2.json()["items"])
    r3 = client.get("/api/operations/task-runs",
                    params={"sort": "createdAt", "taskId": env["task"].id})
    assert r3.status_code == 200
    r4 = client.get("/api/operations/task-runs", params={"sort": "evil"})
    assert r4.status_code == 422


def test_task_run_detail_and_deliveries_and_retry(env):
    db = env["db"]
    snap = {"mode": "target_table", "assetId": env["asset"].id, "table": TARGET,
            "schemaName": "public", "writeMode": "upsert", "keyFields": ["_run_id"],
            "mapping": MAPPING, "outputSchemaRef": "consumer@1.0.0"}
    tr = TaskRun(task_id=env["task"].id, task_version_id=env["tv"].id, trigger="manual",
                 status="succeeded", delivery_status="failed", delivery_failed_count=1,
                 output_binding_snapshot=snap, started_at=datetime.now(timezone.utc))
    db.add(tr)
    db.flush()
    from app.models import ResultDelivery, Run
    run = Run(trigger="manual", status="succeeded", task_run_id=tr.id,
              task_id=env["task"].id, task_version_id=env["tv"].id,
              interaction_ref="op-1", output={"call_id": "c"})
    db.add(run)
    db.flush()
    from app.output_binding import payload_sha256
    payload = {"_run_id": run.id}
    d = ResultDelivery(run_id=run.id, task_run_id=tr.id, task_id=env["task"].id,
                       interaction_ref="op-1", status="failed",
                       idempotency_key=f"result-delivery:{run.id}",
                       record_payload=payload, payload_sha256=payload_sha256(payload),
                       error={"code": "TARGET_TABLE_MISSING", "message": "boom"})
    db.add(d)
    db.commit()

    r = client.get(f"/api/operations/task-runs/{tr.id}")
    assert r.status_code == 200
    det = r.json()
    assert det["delivery"]["status"] == "failed"
    assert det["frozen"]["outputBinding"]["table"] == TARGET

    r2 = client.get(f"/api/operations/task-runs/{tr.id}/deliveries")
    assert r2.json()["items"][0]["status"] == "failed"

    r3 = client.get(f"/api/operations/task-runs/{tr.id}/failure-analysis")
    cats = {c["key"]: c for c in r3.json()["categories"]}
    assert cats["target"]["count"] == 1

    # retry API：failed → accepted；非 failed → skipped
    r4 = client.post(f"/api/result-deliveries/{d.id}/retry")
    assert r4.status_code == 202 and r4.json()["accepted"] == 1
    r5 = client.post(f"/api/result-deliveries/{d.id}/retry")
    assert r5.json()["skipped"] == 1
    r6 = client.post(f"/api/task-runs/{tr.id}/retry-failed-deliveries")
    assert r6.status_code == 202


def test_runs_pagination_filters(env):
    db = env["db"]
    from app.models import Run
    tr = TaskRun(task_id=env["task"].id, task_version_id=env["tv"].id,
                 trigger="manual", status="running",
                 output_binding_snapshot={"outputSchemaRef": "consumer@1.0.0"})
    db.add(tr)
    db.flush()
    for i in range(12):
        db.add(Run(trigger="manual", status="succeeded" if i % 3 else "failed",
                   task_run_id=tr.id, task_id=env["task"].id,
                   task_version_id=env["tv"].id, interaction_ref=f"ref-{i:02d}"))
    db.commit()
    r = client.get(f"/api/task-runs/{tr.id}/runs", params={"pageSize": 5, "page": 2})
    body = r.json()
    assert len(body["items"]) == 5 and body["total"] == 12
    assert body["items"][0]["outputSchemaRef"] == "consumer@1.0.0"
    r2 = client.get(f"/api/task-runs/{tr.id}/runs", params={"status": "failed"})
    assert all(i["status"] == "failed" for i in r2.json()["items"])
    r3 = client.get(f"/api/task-runs/{tr.id}/runs", params={"q": "ref-01"})
    assert r3.json()["total"] == 1
