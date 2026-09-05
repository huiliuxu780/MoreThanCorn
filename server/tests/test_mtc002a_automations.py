"""MTC-002A 兼容层验收测试（自主任务语义收敛）。

覆盖任务书第六节 1–7、9：
1. 新旧列表接口返回相同的数据 ID；
2. 新旧详情接口读取同一条记录；
3. 通过 /api/automations 创建后可通过 /api/tasks/{id} 读取；
4. 通过旧接口创建后可通过新接口读取；
5. 新旧运行接口不会创建两次 TaskRun（Idempotency-Key 同语义）；
6. TaskRun 外键关系不变（仍指向 analysis_task / analysis_task_version）；
7. 无迁移：表名不变、无 automation*/task 新表；
9. 旧 URL / 旧 API 仍兼容（本文件全程混用新旧接口）。
Schedule / Backfill / Retry 回归由 test_p0_schedule / test_p0_taskrun / test_p1_task 覆盖。
"""
import uuid

from fastapi.testclient import TestClient
from sqlalchemy import inspect

from app.db import SessionLocal, engine
from app.main import app
from app.models import AnalysisTask, AnalysisTaskVersion, TaskRun

from ._quality_setup import (MAPPING, make_asset, make_definition_version,
                             make_quality_workflow, make_rule_version)

client = TestClient(app)

REQUIRED_DTO_KEYS = {
    "id", "name", "description", "status", "agentId", "workflowId",
    "workflowVersionId", "inputConfig", "scheduleConfig", "executionConfig",
    "createdAt", "updatedAt", "createdBy", "version",
}


def _make_task(name: str) -> tuple[str, str]:
    """直接落库一条 AnalysisTask + v1（无外键依赖列均为普通列）。"""
    db = SessionLocal()
    try:
        t = AnalysisTask(name=name, description="MTC-002A 兼容层样本",
                         data_asset_id="da-mtc002a", workflow_id="wf-mtc002a",
                         status="active")
        db.add(t)
        db.flush()
        v = AnalysisTaskVersion(task_id=t.id, version_no=1,
                                data_asset_id="da-mtc002a",
                                workflow_id="wf-mtc002a", note="v1")
        db.add(v)
        db.flush()
        t.current_version_id = v.id
        db.commit()
        return t.id, v.id
    finally:
        db.close()


def _create_payload(name: str) -> dict:
    wf_id, wv_id = make_quality_workflow(client, name=f"{name}-wf")
    asset_id = make_asset(client, rows=[
        {"interactionId": "A1", "interactionTime": "2026-09-01T10:00:00Z",
         "score": 90, "risk": "Low", "issues": [], "summary": "s"},
    ], name=f"{name}-asset")
    defv = make_definition_version(client, asset_id)
    rpv = make_rule_version(client)
    return {
        "name": name, "workflowId": wf_id, "workflowVersionPolicy": "pinned",
        "pinnedWorkflowVersionId": wv_id, "dataAssetId": asset_id,
        "dataDefinitionVersionId": defv, "resultRuleVersionId": rpv,
        "inputMapping": MAPPING, "sampling": {"mode": "all"},
        "dataWindow": {"mode": "all"},
    }


def test_list_returns_same_ids_as_legacy():
    _make_task("MTC002A-list-1")
    _make_task("MTC002A-list-2")
    new = client.get("/api/automations", params={"pageSize": 200}).json()
    old = client.get("/api/tasks", params={"pageSize": 200}).json()
    assert [i["id"] for i in new["items"]] == [i["id"] for i in old["items"]]
    assert new["total"] == old["total"]
    mine = next(i for i in new["items"] if i["name"] == "MTC002A-list-1")
    assert REQUIRED_DTO_KEYS <= set(mine.keys())


def test_detail_reads_same_record():
    tid, _vid = _make_task("MTC002A-detail")
    a = client.get(f"/api/automations/{tid}")
    o = client.get(f"/api/tasks/{tid}")
    assert a.status_code == 200 and o.status_code == 200
    a, o = a.json(), o.json()
    assert a["id"] == o["id"] and a["name"] == o["name"] and a["status"] == o["status"]
    # 版本策略 latest_published → 无 pinned 版本，保持 None（不编造）
    assert a["workflowVersionId"] is None
    assert a["version"] == 1
    assert a["scheduleConfig"] is None
    assert a["inputConfig"]["dataAssetId"] == "da-mtc002a"
    assert a["executionConfig"]["executionTarget"]["workflowId"] == "wf-mtc002a"


def test_create_via_new_api_readable_via_legacy():
    payload = _create_payload("MTC002A-new-create")
    r = client.post("/api/automations", json=payload)
    assert r.status_code == 201, r.text
    dto = r.json()
    assert dto["name"] == payload["name"] and dto["version"] == 1
    assert dto["workflowVersionId"] == payload["pinnedWorkflowVersionId"]
    o = client.get(f"/api/tasks/{dto['id']}")
    assert o.status_code == 200
    assert o.json()["name"] == payload["name"]
    assert o.json()["taskVersion"]["versionNo"] == 1


def test_create_via_legacy_readable_via_new_api():
    payload = _create_payload("MTC002A-old-create")
    r = client.post("/api/tasks", json=payload)
    assert r.status_code == 201, r.text
    tid = r.json()["id"]
    a = client.get(f"/api/automations/{tid}")
    assert a.status_code == 200
    assert a.json()["name"] == payload["name"]


def test_update_via_new_api_visible_in_legacy():
    payload = _create_payload("MTC002A-update")
    tid = client.post("/api/tasks", json=payload).json()["id"]
    r = client.put(f"/api/automations/{tid}", json={"name": "MTC002A-renamed"})
    assert r.status_code == 200, r.text
    assert r.json()["version"] == 2
    o = client.get(f"/api/tasks/{tid}").json()
    assert o["name"] == "MTC002A-renamed"
    assert o["taskVersion"]["versionNo"] == 2


def test_runs_endpoints_do_not_double_create():
    payload = _create_payload("MTC002A-runs")
    tid = client.post("/api/automations", json=payload).json()["id"]
    key = f"mtc002a-idem-{uuid.uuid4().hex}"
    r1 = client.post(f"/api/automations/{tid}/runs", json={},
                     headers={"Idempotency-Key": key})
    assert r1.status_code == 202, r1.text
    run_id = r1.json()["taskRunId"]
    # 旧接口同 key：幂等返回同一条 TaskRun，不新建
    r2 = client.post(f"/api/tasks/{tid}/runs", json={},
                     headers={"Idempotency-Key": key})
    assert r2.status_code == 202, r2.text
    assert r2.json()["taskRunId"] == run_id
    # 新接口列表与旧接口列表一致且仅一条
    n = client.get(f"/api/automations/{tid}/runs").json()
    o = client.get(f"/api/tasks/{tid}/runs").json()
    assert [x["id"] for x in n["items"]] == [x["id"] for x in o["items"]]
    assert n["total"] == 1
    db = SessionLocal()
    try:
        assert db.query(TaskRun).filter_by(task_id=tid).count() == 1
    finally:
        db.close()


def test_no_migration_and_fk_unchanged():
    insp = inspect(engine)
    tables = set(insp.get_table_names())
    assert "analysis_task" in tables and "analysis_task_version" in tables
    assert "task_run" in tables and "run" in tables
    # 本轮不新增 Task 表 / automation 表
    assert not any(t == "task" or t.startswith("automation") for t in tables)
    tr_refs = {fk["referred_table"] for fk in insp.get_foreign_keys("task_run")}
    assert {"analysis_task", "analysis_task_version"} <= tr_refs
    v_refs = {fk["referred_table"] for fk in insp.get_foreign_keys("analysis_task_version")}
    assert v_refs == {"analysis_task"}


def test_legacy_schedules_endpoint_shared():
    payload = _create_payload("MTC002A-sched")
    tid = client.post("/api/tasks", json=payload).json()["id"]
    assert client.post(f"/api/tasks/{tid}/schedule",
                       json={"cron": "0 9 * * *"}).status_code == 200
    n = client.get(f"/api/automations/{tid}/schedules").json()
    o = client.get(f"/api/tasks/{tid}/schedules").json()
    assert n == o
    assert len(n["items"]) == 1
    # DTO 的 scheduleConfig 与调度列表同源
    dto = client.get(f"/api/automations/{tid}").json()
    assert dto["scheduleConfig"] is not None
    assert dto["scheduleConfig"]["cron"] == "0 9 * * *"
