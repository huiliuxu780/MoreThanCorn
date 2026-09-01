"""SDD 13 PR2：受限 mapping engine / OutputBindingValidator / DataWriter / Delivery。

真实 PostgreSQL 集成（§14.8：不能只用 mock repository 证明写入正确）：
直接在 wf_test 建验收目标表，走 settle → worker → 目标表行校验 → 幂等/并发/错误分类。
"""
import threading
import uuid
from datetime import datetime, timezone

import psycopg
import pytest

from app.db import SessionLocal
from app.delivery import (process_result_delivery, reaggregate_delivery,
                          retry_delivery, retry_failed_deliveries, settle_run_success)
from app.models import (AnalysisTask, AnalysisTaskVersion, Connection, DataAsset,
                        DataDefinition, DataDefinitionVersion, Datasource, JobQueue,
                        ResultDelivery, Run, TaskRun)
from app.output_binding import (MappingExpressionError, build_ctx, build_record_payload,
                                evaluate_mapping_expr, parse_mapping_expr, payload_sha256)
from app.output_binding_validator import validate_for_edit, validate_for_start

TARGET = "consumer_analysis_result_acceptance"
TARGET_DDL = f"""
CREATE TABLE IF NOT EXISTS public.{TARGET} (
    _run_id text PRIMARY KEY,
    _task_run_id text NOT NULL,
    _task_id text NOT NULL,
    _task_version_id text NOT NULL,
    _interaction_ref text NOT NULL,
    _output_schema_ref text NOT NULL,
    _written_at timestamptz NOT NULL,
    call_id text NOT NULL,
    analysis_status text NOT NULL,
    title text NOT NULL,
    summary text NOT NULL,
    segments jsonb NOT NULL,
    full_output jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_consumer_acceptance_task_run
    ON public.{TARGET} (_task_run_id);
CREATE INDEX IF NOT EXISTS ix_consumer_acceptance_interaction
    ON public.{TARGET} (_interaction_ref);
"""

MAPPING = {
    "_run_id": "$run.id",
    "_task_run_id": "$run.taskRunId",
    "_task_id": "$run.taskId",
    "_task_version_id": "$run.taskVersionId",
    "_interaction_ref": "$run.interactionRef",
    "_output_schema_ref": "$schema.ref",
    "_written_at": "$system.completedAt",
    "call_id": "$output.call_id",
    "analysis_status": "$output.analysis_status",
    "title": "$output.title",
    "summary": "$output.summary",
    "segments": "$output.segments",
    "full_output": "$output",
}

OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "call_id": {"type": "string"},
        "analysis_status": {"type": "string"},
        "title": {"type": "string"},
        "summary": {"type": "string"},
        "segments": {"type": "array", "items": {"type": "object"}},
    },
}


# ---------- mapping engine（纯单元） ----------

def test_mapping_roots_and_paths():
    ctx = {"output": {"a": {"b": 1}, "segments": [{"x": 1}]},
           "run": {"id": "r1", "taskRunId": "tr1", "taskId": "t1",
                   "taskVersionId": "tv1", "interactionRef": "i1", "attempt": 2},
           "schema": {"ref": "ref@1", "sha256": "s"}, "system": {"completedAt": "T"},
           "constants": {"env": "sandbox"}}
    assert evaluate_mapping_expr("$output.a.b", ctx) == 1
    assert evaluate_mapping_expr("$output.segments", ctx) == [{"x": 1}]
    assert evaluate_mapping_expr("$run.id", ctx) == "r1"
    assert evaluate_mapping_expr("$run.attempt", ctx) == 2
    assert evaluate_mapping_expr("$schema.ref", ctx) == "ref@1"
    assert evaluate_mapping_expr("$system.completedAt", ctx) == "T"
    assert evaluate_mapping_expr("$constant.env", ctx) == "sandbox"
    assert evaluate_mapping_expr("$output", ctx) == ctx["output"]


def test_mapping_cast_and_default():
    ctx = {"output": {"n": "42", "missing": None}, "run": {}, "schema": {},
           "system": {}, "constants": {}}
    assert evaluate_mapping_expr("$output.n::integer", ctx) == 42
    assert evaluate_mapping_expr('$output.nope ?? "d"', ctx) == "d"
    with pytest.raises(MappingExpressionError) as ei:
        evaluate_mapping_expr("$output.n::nope", ctx)
    assert ei.value.code == "MAPPING_CAST_INVALID"


def test_mapping_rejects_forbidden_syntax():
    for expr in ("output.a", "$eval(x)", "$run.__dict__", "$output.a; drop",
                 "$table.name", "$run.id == 1"):
        with pytest.raises(MappingExpressionError):
            parse_mapping_expr(expr)


# ---------- 真实 PG 集成 ----------

@pytest.fixture(scope="module")
def pg():
    with psycopg.connect("postgresql://rivers@127.0.0.1:5432/wf_test") as conn:
        conn.execute(TARGET_DDL)
        conn.commit()
        yield conn


@pytest.fixture()
def target_env(pg):
    """Connection/Datasource/目标 DataAsset/定义版本 + Task/TaskVersion/TaskRun。"""
    db = SessionLocal()
    tag = uuid.uuid4().hex[:6]
    conn = Connection(name=f"sdd13-conn-{tag}", kind="none", protocol="postgresql",
                      endpoint={"host": "127.0.0.1", "port": 5432, "user": "rivers"},
                      secret_ref="", lifecycle="active", status="active")
    db.add(conn)
    db.flush()
    ds = Datasource(name=f"sdd13-ds-{tag}", type="postgresql", connection_id=conn.id,
                    location="wf_test", status="enabled")
    db.add(ds)
    db.flush()
    asset = DataAsset(name=f"sdd13-target-{tag}", source="postgres", datasource_id=ds.id,
                      location=TARGET, lifecycle="Ready", health="Healthy")
    db.add(asset)
    db.flush()
    dd = DataDefinition(name=f"sdd13-def-{tag}", data_asset_id=asset.id, field_schema=[
        {"key": k, "type": "String", "required": True}
        for k in ("_run_id", "_task_run_id", "_task_id", "_task_version_id",
                  "_interaction_ref", "_output_schema_ref", "_written_at",
                  "call_id", "analysis_status", "title", "summary")
    ] + [{"key": "segments", "type": "Array", "required": True},
         {"key": "full_output", "type": "Object", "required": True}])
    db.add(dd)
    db.flush()
    dv = DataDefinitionVersion(definition_id=dd.id, version_no=1,
                               field_schema=dd.field_schema, eligibility=[])
    db.add(dv)
    db.flush()
    task = AnalysisTask(name=f"sdd13-task-{tag}", execution_target_type="workflow",
                        workflow_id="wf-none", data_asset_id=asset.id, status="active")
    db.add(task)
    db.flush()
    tv = AnalysisTaskVersion(task_id=task.id, version_no=1, workflow_id="wf-none",
                             data_asset_id=asset.id, data_definition_version_id=dv.id,
                             output_mode="target_table", output_asset_id=asset.id,
                             output_definition_version_id=dv.id,
                             output_write_mode="upsert", output_key_fields=["_run_id"],
                             output_mapping=MAPPING,
                             output_contract_snapshot={"schema": OUTPUT_SCHEMA,
                                                       "ref": "consumer@1.0.0"})
    db.add(tv)
    db.flush()
    env = {"db": db, "conn": conn, "ds": ds, "asset": asset, "dv": dv,
           "task": task, "tv": tv}
    yield env
    db.rollback()
    db.close()


def _make_run(db, task, tv, tr, ref, output):
    run = Run(trigger="manual", status="succeeded",
              task_run_id=tr.id, task_id=task.id, task_version_id=tv.id,
              interaction_ref=ref, output=output,
              started_at=datetime.now(timezone.utc), ended_at=datetime.now(timezone.utc))
    db.add(run)
    db.flush()
    return run


def _snapshot_for(env):
    from app.output_binding import freeze_binding_snapshot
    snap = freeze_binding_snapshot(env["db"], env["tv"], "consumer@1.0.0", "sha-x")
    assert snap is not None
    return snap


def test_validator_edit_full_issues(target_env):
    db = target_env["db"]
    binding = {"mode": "target_table", "assetId": target_env["asset"].id,
               "definitionVersionId": target_env["dv"].id, "writeMode": "upsert",
               "keyFields": ["_run_id"], "mapping": MAPPING, "failurePolicy": "separate_delivery_status"}
    rep = validate_for_edit(db, binding, output_schema=OUTPUT_SCHEMA,
                            output_schema_ref="consumer@1.0.0")
    assert rep["valid"], rep["issues"]
    assert rep["resolved"]["targetTable"] == f"public.{TARGET}"

    bad = dict(binding, mapping=dict(MAPPING, nope_col="$output.title"),
               keyFields=["_run_id", "ghost"])
    rep2 = validate_for_edit(db, bad, output_schema=OUTPUT_SCHEMA)
    codes = {i["code"] for i in rep2["issues"]}
    assert "TARGET_COLUMN_MISSING" in codes
    assert "KEY_FIELDS_MISSING" in codes
    assert not rep2["valid"]

    # 键存在但目标库无覆盖唯一约束 → 拒绝保存生产 binding
    nokey = dict(binding, keyFields=["_interaction_ref"])
    rep2b = validate_for_edit(db, nokey, output_schema=OUTPUT_SCHEMA)
    assert any(i["code"] == "KEY_NO_UNIQUE_CONSTRAINT" for i in rep2b["issues"])

    badsrc = dict(binding, mapping=dict(MAPPING, title="$output.not_there"))
    rep3 = validate_for_edit(db, badsrc, output_schema=OUTPUT_SCHEMA)
    assert any(i["code"] == "MAPPING_SOURCE_MISSING" for i in rep3["issues"])

    same = dict(binding)
    rep4 = validate_for_edit(db, same, output_schema=OUTPUT_SCHEMA,
                             input_asset_id=target_env["asset"].id)
    assert any(i["code"] == "INPUT_EQUALS_OUTPUT" for i in rep4["issues"])


def test_settle_and_real_write(target_env, pg):
    db = target_env["db"]
    snap = _snapshot_for(target_env)
    tr = TaskRun(task_id=target_env["task"].id, task_version_id=target_env["tv"].id,
                 trigger="manual", status="running", total=1,
                 output_binding_snapshot=snap, delivery_status="pending")
    db.add(tr)
    db.flush()
    output = {"call_id": "c1", "analysis_status": "done", "title": "T",
              "summary": "S", "segments": [{"id": "s1", "text": "你好"}]}
    run = _make_run(db, target_env["task"], target_env["tv"], tr, "sample-001", output)
    settle_run_success(db, run)
    db.commit()

    delivery = db.query(ResultDelivery).filter_by(run_id=run.id).one()
    assert delivery.status == "pending"
    assert delivery.payload_sha256 == payload_sha256(delivery.record_payload)
    assert db.query(JobQueue).filter_by(type="result-delivery").count() >= 1

    process_result_delivery({"delivery_id": delivery.id})
    db.expire_all()
    delivery = db.get(ResultDelivery, delivery.id)
    assert delivery.status == "succeeded", delivery.error
    tr = db.get(TaskRun, tr.id)
    assert tr.delivery_status == "succeeded"
    assert tr.delivery_succeeded_count == 1

    with pg.cursor() as cur:
        cur.execute(f"SELECT _run_id, _task_run_id, _task_version_id, _interaction_ref, "
                    f"_output_schema_ref, segments, full_output, _written_at "
                    f"FROM public.{TARGET} WHERE _run_id = %s", [run.id])
        row = cur.fetchone()
    assert row is not None
    assert row[1] == tr.id and row[2] == target_env["tv"].id
    assert row[3] == "sample-001" and row[4] == "consumer@1.0.0"
    # JSONB 数组/对象不得字符串截断或双重编码（§14.4）
    assert row[5] == [{"id": "s1", "text": "你好"}]
    assert row[6]["title"] == "T"
    assert row[7] is not None

    # 重试投递 3 次：目标表仍只有一条（§14.4 幂等）
    for _ in range(3):
        process_result_delivery({"delivery_id": delivery.id})
    with pg.cursor() as cur:
        cur.execute(f"SELECT count(*) FROM public.{TARGET} WHERE _run_id = %s", [run.id])
        assert cur.fetchone()[0] == 1


def test_concurrent_workers_single_write(target_env, pg):
    db = target_env["db"]
    snap = _snapshot_for(target_env)
    tr = TaskRun(task_id=target_env["task"].id, task_version_id=target_env["tv"].id,
                 trigger="manual", status="running", total=1,
                 output_binding_snapshot=snap)
    db.add(tr)
    db.flush()
    run = _make_run(db, target_env["task"], target_env["tv"], tr, "sample-conc",
                    {"call_id": "c2", "analysis_status": "done", "title": "T2",
                     "summary": "S2", "segments": []})
    settle_run_success(db, run)
    db.commit()
    did = db.query(ResultDelivery).filter_by(run_id=run.id).one().id

    threads = [threading.Thread(target=process_result_delivery, args=({"delivery_id": did},))
               for _ in range(2)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    with pg.cursor() as cur:
        cur.execute(f"SELECT count(*) FROM public.{TARGET} WHERE _run_id = %s", [run.id])
        assert cur.fetchone()[0] == 1


def test_permanent_error_failed_and_retry_guard(target_env):
    db = target_env["db"]
    snap = _snapshot_for(target_env)
    snap = dict(snap, table="missing_table_xyz")
    tr = TaskRun(task_id=target_env["task"].id, task_version_id=target_env["tv"].id,
                 trigger="manual", status="running", total=1,
                 output_binding_snapshot=snap)
    db.add(tr)
    db.flush()
    run = _make_run(db, target_env["task"], target_env["tv"], tr, "sample-err",
                    {"call_id": "c3", "analysis_status": "done", "title": "T3",
                     "summary": "S3", "segments": []})
    settle_run_success(db, run)
    db.commit()
    delivery = db.query(ResultDelivery).filter_by(run_id=run.id).one()
    ok, issues = validate_for_start(db, snap)
    assert not ok and any(i["code"] == "TARGET_TABLE_MISSING" for i in issues)

    process_result_delivery({"delivery_id": delivery.id})
    db.expire_all()
    delivery = db.get(ResultDelivery, delivery.id)
    assert delivery.status == "failed"
    assert delivery.error["code"] == "TARGET_TABLE_MISSING"
    tr = db.get(TaskRun, tr.id)
    assert tr.delivery_status == "failed"

    # 重试投递只允许 failed/dead_letter，且不改 payload
    sha_before = delivery.payload_sha256
    res = retry_delivery(db, delivery.id, "tester")
    assert res["accepted"] == 1
    delivery = db.get(ResultDelivery, delivery.id)
    assert delivery.status == "pending" and delivery.payload_sha256 == sha_before

    # 批量重试接口
    delivery.status = "failed"
    db.commit()
    res2 = retry_failed_deliveries(db, tr.id, "tester")
    assert res2["accepted"] == 1


def test_platform_only_no_delivery(target_env):
    db = target_env["db"]
    tr = TaskRun(task_id=target_env["task"].id, task_version_id=target_env["tv"].id,
                 trigger="manual", status="running", total=1,
                 output_binding_snapshot=None)
    db.add(tr)
    db.flush()
    run = _make_run(db, target_env["task"], target_env["tv"], tr, "sample-po",
                    {"call_id": "c4"})
    settle_run_success(db, run)
    db.commit()
    assert db.query(ResultDelivery).filter_by(run_id=run.id).count() == 0
    reaggregate_delivery(db, tr)
    assert tr.delivery_status == "not_configured"


def test_mapping_error_fails_run_not_half_delivery(target_env):
    db = target_env["db"]
    snap = _snapshot_for(target_env)
    snap = dict(snap, mapping=dict(MAPPING, title="$output.missing_field"))
    tr = TaskRun(task_id=target_env["task"].id, task_version_id=target_env["tv"].id,
                 trigger="manual", status="running", total=1,
                 output_binding_snapshot=snap)
    db.add(tr)
    db.flush()
    run = _make_run(db, target_env["task"], target_env["tv"], tr, "sample-map",
                    {"call_id": "c5", "segments": []})
    settle_run_success(db, run)
    db.commit()
    assert run.status == "failed"
    assert run.error["code"] == "MAPPING_SOURCE_MISSING"
    assert db.query(ResultDelivery).filter_by(run_id=run.id).count() == 0
