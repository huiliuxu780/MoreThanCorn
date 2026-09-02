"""09-SDD P0-B3：Task pause 与 Schedule 语义（P0-09）。

- paused Task 不产生新 TaskRun（INV-10）；
- Schedule 触发使用已解析 Published WorkflowVersion（经 TaskRun 链）；
- 同一 fire slot 重复 tick 不创建重复 TaskRun（INV-11）。

先红后绿。
"""
from datetime import datetime, timedelta, timezone
from pathlib import Path

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.models import (Connection, DataAsset, DataDefinition, DataDefinitionVersion,
                        Datasource, Schedule, TaskRun)
from app.runner import schedule_tick, start_worker
from tests._quality_setup import make_definition_version, make_rule_version

client = TestClient(app)
_worker = start_worker()

_TARGET = "consumer_analysis_result_acceptance"


@pytest.fixture(scope="module", autouse=True)
def _target_table():
    ddl = (Path(__file__).resolve().parents[2] / "scripts" / "sdd13-acceptance-tables.sql").read_text()
    with psycopg.connect("postgresql://rivers@127.0.0.1:5432/wf_test") as pg:
        pg.execute(ddl)
        pg.commit()
    yield


def _mk_output_binding(tag: str) -> dict:
    """SDD 13 §18：schedule 触发强制 target_table——为调度用例预置真实目标表绑定。"""
    db = SessionLocal()
    try:
        conn = Connection(name=f"sch-conn-{tag}", kind="none", protocol="postgresql",
                          endpoint={"host": "127.0.0.1", "port": 5432, "user": "rivers"},
                          secret_ref="", lifecycle="active", status="active")
        db.add(conn)
        db.flush()
        ds = Datasource(name=f"sch-ds-{tag}", type="postgresql", connection_id=conn.id,
                        location="wf_test", status="enabled")
        db.add(ds)
        db.flush()
        asset = DataAsset(name=f"sch-target-{tag}", source="postgres", datasource_id=ds.id,
                          location=_TARGET, lifecycle="Ready")
        db.add(asset)
        db.flush()
        dd = DataDefinition(name=f"sch-def-{tag}", data_asset_id=asset.id,
                            field_schema=[{"key": k, "type": "String", "required": True}
                                          for k in ("_run_id", "_task_run_id", "_task_id",
                                                    "_task_version_id", "_interaction_ref",
                                                    "_output_schema_ref", "_written_at",
                                                    "call_id", "analysis_status", "title",
                                                    "summary", "segments", "full_output")])
        db.add(dd)
        db.flush()
        dv = DataDefinitionVersion(definition_id=dd.id, version_no=1, field_schema=dd.field_schema)
        db.add(dv)
        db.flush()
        db.commit()
        # 源路径必须落在冻结 Output Schema（legacy quality_evaluation）内：
        # summary/issues 存在；其余经 $run/$system/$constant 根。
        return {"mode": "target_table", "assetId": asset.id, "definitionVersionId": dv.id,
                "writeMode": "upsert", "keyFields": ["_run_id"],
                "constants": {"status": "completed", "title": "t", "summary": "x",
                              "segments": []},
                "mapping": {"_run_id": "$run.id", "_task_run_id": "$run.taskRunId",
                            "_task_id": "$run.taskId", "_task_version_id": "$run.taskVersionId",
                            "_interaction_ref": "$run.interactionRef",
                            "_output_schema_ref": "$schema.ref",
                            "_written_at": "$system.completedAt",
                            "call_id": "$run.interactionRef",
                            "analysis_status": "$constant.status",
                            "title": "$constant.title", "summary": "$constant.summary",
                            "segments": "$constant.segments", "full_output": "$output"}}
    finally:
        db.close()


def _mk_active_task(wf_name="sch-wf") -> str:
    import uuid
    wf = client.post("/api/workflows", json={"name": wf_name}).json()
    d = client.get(f"/api/workflows/{wf['id']}").json()["definition"]
    s = next(n for n in d["graph"]["nodes"] if n["type"] == "input")
    e = next(n for n in d["graph"]["nodes"] if n["type"] == "end")
    # SDD 13：输出形态对齐 consumer 目标表 mapping（schedule 触发强制 target_table）
    d["graph"]["nodes"].append({"id": "n_cr", "type": "create-record", "name": "q",
                                "config": {}, "inputs": [
        # 质检 Schema 必填（任务主链 legacy 校验）+ 目标表 mapping 源字段
        {"name": "score", "type": "number", "source": {"kind": "fixed", "value": 80}},
        {"name": "risk", "type": "string", "source": {"kind": "fixed", "value": "Low"}},
        {"name": "issues", "type": "array", "source": {"kind": "fixed", "value": []}},
        {"name": "call_id", "type": "string", "source": {"kind": "fixed", "value": "sch-call"}},
        {"name": "analysis_status", "type": "string", "source": {"kind": "fixed", "value": "completed"}},
        {"name": "title", "type": "string", "source": {"kind": "fixed", "value": "t"}},
        {"name": "summary", "type": "string", "source": {"kind": "fixed", "value": "x"}},
        {"name": "segments", "type": "array", "source": {"kind": "fixed", "value": []}}]})
    d["graph"]["edges"] = [x for x in d["graph"]["edges"]
                           if not (x["source"] == s["id"] and x["target"] == e["id"])]
    d["graph"]["edges"] += [{"id": "e1", "source": s["id"], "target": "n_cr"},
                            {"id": "e2", "source": "n_cr", "target": e["id"]}]
    client.put(f"/api/workflows/{wf['id']}/draft",
               json={"definition": d, "baseRevision": d["workflow"]["draftRevision"]})
    pub = client.post(f"/api/workflows/{wf['id']}/publish").json()
    assert pub
    asset = client.post("/api/data-assets", json={
        "name": "sch-asset", "rows": [{"interactionId": "S-1", "text": "t"}]}).json()
    defv = make_definition_version(client, asset["id"])
    rpv = make_rule_version(client)
    task = client.post("/api/tasks", json={
        "name": "sch-task", "workflowId": wf["id"], "workflowVersionPolicy": "pinned",
        "pinnedWorkflowVersionId": pub["versionId"], "dataAssetId": asset["id"],
        "dataDefinitionVersionId": defv, "resultRuleVersionId": rpv,
        "outputBinding": _mk_output_binding(uuid.uuid4().hex[:6])}).json()
    return task["id"]


def _force_due(sid: str):
    db = SessionLocal()
    try:
        sch = db.get(Schedule, sid)
        sch.enabled = True
        sch.next_run_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()
    finally:
        db.close()


def _task_run_count(tid: str) -> int:
    db = SessionLocal()
    try:
        return db.query(TaskRun).filter_by(task_id=tid).count()
    finally:
        db.close()


def test_paused_task_not_triggered_by_schedule():
    tid = _mk_active_task("sch-wf-pause")
    sch = client.post(f"/api/tasks/{tid}/schedule", json={"cron": "* * * * *"}).json()
    client.post(f"/api/tasks/{tid}/status", json={"status": "paused"})
    _force_due(sch["id"])
    schedule_tick()
    assert _task_run_count(tid) == 0  # INV-10


def test_schedule_fire_key_dedup():
    tid = _mk_active_task("sch-wf-dup")
    sch = client.post(f"/api/tasks/{tid}/schedule", json={"cron": "* * * * *"}).json()
    due_slot = datetime.now(timezone.utc) - timedelta(seconds=1)
    db = SessionLocal()
    try:
        s = db.get(Schedule, sch["id"])
        s.next_run_at = due_slot
        db.commit()
    finally:
        db.close()
    schedule_tick()
    assert _task_run_count(tid) == 1
    # 模拟重复 tick：把 next_run_at 拨回同一到期时刻（相同 fire key）→ 不得重复创建
    db = SessionLocal()
    try:
        s = db.get(Schedule, sch["id"])
        s.next_run_at = due_slot
        db.commit()
    finally:
        db.close()
    schedule_tick()
    assert _task_run_count(tid) == 1  # INV-11


def test_schedule_run_uses_published_version():
    tid = _mk_active_task("sch-wf-ver")
    sch = client.post(f"/api/tasks/{tid}/schedule", json={"cron": "* * * * *"}).json()
    _force_due(sch["id"])
    schedule_tick()
    import time as _t
    deadline = _t.time() + 20
    runs = []
    while _t.time() < deadline:
        runs = client.get(f"/api/tasks/{tid}/runs").json()["items"]
        if runs and runs[0]["status"] in ("succeeded", "partial", "failed"):
            break
        _t.sleep(0.3)
    assert runs and runs[0]["status"] == "succeeded"
    trid = runs[0]["id"]
    items = client.get(f"/api/task-runs/{trid}/runs").json()["items"]
    assert items and all(x["workflowVersionId"] for x in items)  # 版本非空=已发布版本


def test_workflow_schedule_without_published_version_fails():
    wf = client.post("/api/workflows", json={"name": "sch-wf-nopub"}).json()
    r = client.post("/api/schedules", json={"workflowId": wf["id"], "cron": "* * * * *",
                                            "enabled": False})
    assert r.status_code == 201
    sid = r.json()["id"]
    _force_due(sid)
    db = SessionLocal()
    try:
        s0 = db.get(Schedule, sid)
        failed0 = s0.failed_count
    finally:
        db.close()
    schedule_tick()
    db = SessionLocal()
    try:
        s = db.get(Schedule, sid)
        assert s.failed_count == failed0 + 1  # 未发布草稿不得被调度执行
    finally:
        db.close()
