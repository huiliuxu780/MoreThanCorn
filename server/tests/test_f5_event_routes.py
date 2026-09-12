"""F5 EventRoute/EventDelivery 回归（2026-09-13，Spec §10/§12.6/§19 F5）。

覆盖：
- route CRUD：revision 递增 / DELETE=归档语义 / destination 强一致校验 /
  legacy automation_trigger 只读投影（409 LEGACY_TRIGGER_READONLY）；
- ingest 命中 EventRoute → XOR 派发：automation→恰 1 Invocation；
  analysis_task→恰 1 TaskRun（trigger=event + source_event_id/event_delivery_id
  全链路反链），互不包裹；
- AC-023/024：filtered/deduped/dead 流水证据（route_outcomes），
  GET /event-deliveries?sourceEventId= 附证据块；
- retry 只接受 FAILED/DEAD；重发使用创建时冻结的 mapped_input + route_revision
  （route 编辑后 retry 不漂移）；
- watcher 接线：_retry_dead_deliveries route 分支到期重发（修复从未被调用的缺陷）；
- completion_policy=terminal → RUNNING，reconcile_terminal_deliveries 按目标
  终态结算；目标反链缺失 → dead。

种子安全门：全部行带 f5- 精确 marker；清理由 autouse fixture 按 marker 执行。
_production_task 配方移植自 tests/test_p0_schedule.py（SDD13 §18 target_table）。
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.models import (AnalysisTask, AutomationDefinition, AutomationTrigger,
                        AutomationTriggerLog, Connection, DataAsset,
                        DataDefinition, DataDefinitionVersion, DataSource,
                        DataSourceEvent, Datasource, EventDelivery, EventRoute,
                        Run, TaskRun)
from tests._legacy_agents import seed_agent, seed_release, seed_version, uniq
from tests._quality_setup import (make_definition_version, make_quality_task,
                                  make_rule_version)
from tests.conftest import TEST_DB_NAME, pg_dsn

client = TestClient(app)
NOW = datetime.now(timezone.utc)
_TARGET = "consumer_analysis_result_acceptance"


@pytest.fixture(scope="module", autouse=True)
def _target_table():
    """SDD13 §18：target_table 绑定校验物理表存在（DDL 同 test_p0_schedule）。"""
    ddl = (Path(__file__).resolve().parents[2] / "scripts" /
           "sdd13-acceptance-tables.sql").read_text()
    with psycopg.connect(pg_dsn()) as pg:
        pg.execute(ddl)
        pg.commit()
    yield


@pytest.fixture(autouse=True)
def _cleanup_f5_rows():
    yield
    db = SessionLocal()
    try:
        src_ids = [r[0] for r in db.query(DataSource.id).filter(
            DataSource.name.like("f5-src-%")).all()]
        if src_ids:
            ev_ids = [r[0] for r in db.query(DataSourceEvent.id).filter(
                DataSourceEvent.source_id.in_(src_ids)).all()]
            if ev_ids:
                db.query(EventDelivery).filter(
                    EventDelivery.event_id.in_(ev_ids)).delete(
                    synchronize_session=False)
                db.query(DataSourceEvent).filter(
                    DataSourceEvent.id.in_(ev_ids)).delete(synchronize_session=False)
            db.query(EventRoute).filter(
                EventRoute.source_id.in_(src_ids)).delete(synchronize_session=False)
            db.query(EventRoute).filter(
                EventRoute.source_id.like("f5-orph-%")).delete(
                synchronize_session=False)
            db.query(DataSource).filter(
                DataSource.id.in_(src_ids)).delete(synchronize_session=False)
        auto_ids = [r[0] for r in db.query(AutomationDefinition.id).filter(
            AutomationDefinition.name.like("f5-auto-%")).all()]
        if auto_ids:
            db.query(AutomationTriggerLog).filter(
                AutomationTriggerLog.automation_id.in_(auto_ids)).delete(
                synchronize_session=False)
            db.query(AutomationTrigger).filter(
                AutomationTrigger.automation_id.in_(auto_ids)).delete(
                synchronize_session=False)
            db.query(AutomationDefinition).filter(
                AutomationDefinition.id.in_(auto_ids)).delete(
                synchronize_session=False)
        tr_ids = [r[0] for r in db.query(TaskRun.id).filter(
            TaskRun.trigger == "event").all()]
        if tr_ids:
            db.query(Run).filter(Run.task_run_id.in_(tr_ids)).delete(
                synchronize_session=False)
            db.query(TaskRun).filter(TaskRun.id.in_(tr_ids)).delete(
                synchronize_session=False)
        task_ids = [r[0] for r in db.query(AnalysisTask.id).filter(
            AnalysisTask.name.like("f5-task-%")).all()]
        if task_ids:
            db.query(AnalysisTask).filter(
                AnalysisTask.id.in_(task_ids)).delete(synchronize_session=False)
        # 输出绑定夹具行（_mk_output_binding，f5-bind- 前缀）
        def_ids = [r[0] for r in db.query(DataDefinition.id).filter(
            DataDefinition.name.like("f5-bind-%")).all()]
        if def_ids:
            db.query(DataDefinitionVersion).filter(
                DataDefinitionVersion.definition_id.in_(def_ids)).delete(
                synchronize_session=False)
            db.query(DataDefinition).filter(
                DataDefinition.id.in_(def_ids)).delete(synchronize_session=False)
        # FK 顺序：DataAsset 引用 Datasource，必须先删 asset 再删 datasource
        db.query(DataAsset).filter(
            DataAsset.name.like("f5-bind-%")).delete(synchronize_session=False)
        db.query(Datasource).filter(
            Datasource.name.like("f5-bind-%")).delete(synchronize_session=False)
        db.query(Connection).filter(
            Connection.name.like("f5-bind-%")).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


# ---------- 夹具 ----------

def _mk_source(kind: str = "webhook") -> dict:
    r = client.post("/api/v2/data-sources",
                    json={"name": uniq("f5-src"), "kind": kind, "config": {}})
    assert r.status_code == 200, r.text
    return r.json()


def _mk_automation(max_runs: int | None = None) -> str:
    """可执行自动任务（published agent + active prod release）。"""
    a = seed_agent(atype="custom")
    v = seed_version(a["id"])
    seed_release(a["id"], v["id"], environment="prod", status="active")
    body = {"name": uniq("f5-auto"), "target_kind": "agent", "agent_id": a["id"],
            "prompt_template": "处理 {{value}}", "triggers": []}
    if max_runs is not None:
        body["max_runs"] = max_runs
    r = client.post("/api/v2/automations", json=body)
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def _mk_route(sid: str, dest_kind: str, dest_id: str, **kw) -> dict:
    body = {"sourceId": sid, "destination": {"kind": dest_kind, "id": dest_id}}
    body.update(kw)
    r = client.post("/api/v2/event-routes", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def _mk_output_binding(tag: str) -> dict:
    """SDD13 §18：生产触发强制 target_table（配方移植自 test_p0_schedule）。"""
    db = SessionLocal()
    try:
        conn = Connection(name=f"f5-bind-conn-{tag}", kind="none",
                          protocol="postgresql",
                          endpoint={"host": "127.0.0.1", "port": 5432,
                                    "user": "rivers"},
                          secret_ref="", lifecycle="active", status="active")
        db.add(conn)
        db.flush()
        ds = Datasource(name=f"f5-bind-ds-{tag}", type="postgresql",
                        connection_id=conn.id, location=TEST_DB_NAME,
                        status="enabled")
        db.add(ds)
        db.flush()
        asset = DataAsset(name=f"f5-bind-target-{tag}", source="postgres",
                          datasource_id=ds.id, location=_TARGET,
                          lifecycle="Ready")
        db.add(asset)
        db.flush()
        dd = DataDefinition(name=f"f5-bind-def-{tag}", data_asset_id=asset.id,
                            field_schema=[{"key": k, "type": "String",
                                           "required": True}
                                          for k in ("_run_id", "_task_run_id",
                                                    "_task_id", "_task_version_id",
                                                    "_interaction_ref",
                                                    "_output_schema_ref",
                                                    "_written_at", "call_id",
                                                    "analysis_status", "title",
                                                    "summary", "segments",
                                                    "full_output")])
        db.add(dd)
        db.flush()
        dv = DataDefinitionVersion(definition_id=dd.id, version_no=1,
                                   field_schema=dd.field_schema)
        db.add(dv)
        db.flush()
        db.commit()
        return {"mode": "target_table", "assetId": asset.id,
                "definitionVersionId": dv.id,
                "writeMode": "upsert", "keyFields": ["_run_id"],
                "constants": {"status": "completed", "title": "t", "summary": "x",
                              "segments": []},
                "mapping": {"_run_id": "$run.id", "_task_run_id": "$run.taskRunId",
                            "_task_id": "$run.taskId",
                            "_task_version_id": "$run.taskVersionId",
                            "_interaction_ref": "$run.interactionRef",
                            "_output_schema_ref": "$schema.ref",
                            "_written_at": "$system.completedAt",
                            "call_id": "$run.interactionRef",
                            "analysis_status": "$constant.status",
                            "title": "$constant.title",
                            "summary": "$constant.summary",
                            "segments": "$constant.segments",
                            "full_output": "$output"}}
    finally:
        db.close()


def _mk_production_task() -> str:
    """target_table 绑定的可生产触发分析任务（trigger=event 走 §18 门槛）。"""
    wf = client.post("/api/workflows", json={"name": uniq("f5-wf")}).json()
    d = client.get(f"/api/workflows/{wf['id']}").json()["definition"]
    s = next(n for n in d["graph"]["nodes"] if n["type"] == "input")
    e = next(n for n in d["graph"]["nodes"] if n["type"] == "end")
    d["graph"]["nodes"].append({"id": "n_cr", "type": "create-record", "name": "q",
                                "config": {}, "inputs": [
        {"name": "score", "type": "number", "source": {"kind": "fixed", "value": 80}},
        {"name": "risk", "type": "string", "source": {"kind": "fixed", "value": "Low"}},
        {"name": "issues", "type": "array", "source": {"kind": "fixed", "value": []}},
        {"name": "call_id", "type": "string", "source": {"kind": "fixed", "value": "f5"}},
        {"name": "analysis_status", "type": "string",
         "source": {"kind": "fixed", "value": "completed"}},
        {"name": "title", "type": "string", "source": {"kind": "fixed", "value": "t"}},
        {"name": "summary", "type": "string", "source": {"kind": "fixed", "value": "x"}},
        {"name": "segments", "type": "array",
         "source": {"kind": "fixed", "value": []}}]})
    d["graph"]["edges"] = [x for x in d["graph"]["edges"]
                           if not (x["source"] == s["id"] and x["target"] == e["id"])]
    d["graph"]["edges"] += [{"id": "e1", "source": s["id"], "target": "n_cr"},
                            {"id": "e2", "source": "n_cr", "target": e["id"]}]
    client.put(f"/api/workflows/{wf['id']}/draft",
               json={"definition": d,
                     "baseRevision": d["workflow"]["draftRevision"]})
    pub = client.post(f"/api/workflows/{wf['id']}/publish").json()
    assert pub
    asset = client.post("/api/data-assets", json={
        "name": uniq("f5-asset"),
        "rows": [{"interactionId": "F5-1", "text": "t"}]}).json()
    defv = make_definition_version(client, asset["id"])
    rpv = make_rule_version(client)
    resp = client.post("/api/tasks", json={
        "name": uniq("f5-task"), "workflowId": wf["id"],
        "workflowVersionPolicy": "pinned",
        "pinnedWorkflowVersionId": pub["versionId"],
        "dataAssetId": asset["id"], "dataDefinitionVersionId": defv,
        "resultRuleVersionId": rpv,
        "outputBinding": _mk_output_binding(uuid.uuid4().hex[:6])})
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _deliveries(event_id: str) -> list[dict]:
    r = client.get("/api/v2/event-deliveries", params={"sourceEventId": event_id})
    assert r.status_code == 200, r.text
    return r.json()


# ---------- route CRUD ----------

def test_route_crud_revision_archive_and_validation():
    src = _mk_source()
    aid = _mk_automation()
    route = _mk_route(src["id"], "automation", aid,
                      eventType="ticket.created",
                      filter={"version": 1,
                              "expression": {"field": "type", "op": "eq",
                                             "value": "ticket"}},
                      mapping={"version": 1, "fields": {"value": "body.text"}},
                      dedupe={"keyPath": "id", "windowSeconds": 3600})
    assert route["revision"] == 1 and route["origin"] == "event_route"
    assert route["destination"] == {"kind": "automation", "id": aid}
    assert route["dedupe"] == {"keyPath": "id", "windowSeconds": 3600}
    assert route["completionMeaning"]
    # PUT → revision 递增（Spec §12.6）
    r2 = client.put(f"/api/v2/event-routes/{route['id']}",
                    json={"eventType": "ticket.updated"})
    assert r2.status_code == 200, r2.text
    assert r2.json()["revision"] == 2
    assert r2.json()["eventType"] == "ticket.updated"
    # destination 强一致：不存在的实体 422
    bad = client.post("/api/v2/event-routes",
                      json={"sourceId": src["id"],
                            "destination": {"kind": "automation", "id": "nope"}})
    assert bad.status_code == 422
    assert bad.json()["detail"]["code"] == "DESTINATION_NOT_FOUND"
    bad_kind = client.post("/api/v2/event-routes",
                           json={"sourceId": src["id"],
                                 "destination": {"kind": "workflow", "id": aid}})
    assert bad_kind.status_code == 422
    bad_src = client.post("/api/v2/event-routes",
                          json={"sourceId": "nope",
                                "destination": {"kind": "automation", "id": aid}})
    assert bad_src.status_code == 422
    # DELETE = 归档语义：默认列表消失，includeArchived 可见，PUT 拒绝
    rd = client.delete(f"/api/v2/event-routes/{route['id']}")
    assert rd.status_code == 200 and rd.json()["archived"] is True
    listed = client.get("/api/v2/event-routes",
                        params={"sourceId": src["id"]}).json()["items"]
    assert route["id"] not in [x["id"] for x in listed]
    listed_all = client.get("/api/v2/event-routes",
                            params={"sourceId": src["id"],
                                    "includeArchived": "yes"}).json()["items"]
    arch = [x for x in listed_all if x["id"] == route["id"]]
    assert arch and arch[0]["archived"] is True and arch[0]["enabled"] is False
    assert client.put(f"/api/v2/event-routes/{route['id']}",
                      json={"eventType": "x"}).status_code == 409


def test_legacy_trigger_projection_readonly():
    src = _mk_source()
    aid = _mk_automation()
    db = SessionLocal()
    try:
        trig = AutomationTrigger(automation_id=aid, kind="event", enabled=True,
                                 config={"data_source_id": src["id"],
                                         "mapping": {"value": "body.text"}})
        db.add(trig)
        db.commit()
        tid = trig.id
    finally:
        db.close()
    items = client.get("/api/v2/event-routes",
                       params={"sourceId": src["id"]}).json()["items"]
    legacy = [x for x in items if x["id"] == tid]
    assert legacy and legacy[0]["origin"] == "automation_trigger"
    assert legacy[0]["destination"] == {"kind": "automation", "id": aid}
    assert legacy[0]["mapping"]["fields"] == {"value": "body.text"}
    # 单查也投影；修改走 automations trigger API（409 指引）
    assert client.get(f"/api/v2/event-routes/{tid}").status_code == 200
    r = client.put(f"/api/v2/event-routes/{tid}", json={"eventType": "x"})
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "LEGACY_TRIGGER_READONLY"
    assert client.delete(f"/api/v2/event-routes/{tid}").status_code == 409


# ---------- ingest XOR 派发 ----------

def test_webhook_automation_branch_xor():
    src = _mk_source()
    aid = _mk_automation()
    route = _mk_route(src["id"], "automation", aid,
                      mapping={"version": 1, "fields": {"value": "body.text"}})
    payload = {"id": uniq("evt"), "type": "ticket",
               "body": {"text": "五一去哪玩"}}
    r = client.post(f"/api/v2/ingress/webhook/{src['id']}", json=payload,
                    headers={"X-Source-Token": src["webhook_token"]})
    assert r.status_code == 200, r.text
    event_id = r.json()["event_id"]
    body = _deliveries(event_id)
    assert body["total"] == 1
    d = body["items"][0]
    assert d["status"] == "COMPLETED"          # accepted 策略：受理即完成
    assert d["destinationKind"] == "automation"
    assert d["routeId"] == route["id"] and d["routeRevision"] == 1
    assert d["invocationId"] and d["taskRunId"] is None   # XOR
    assert d["completionPolicy"] == "accepted" and d["completionMeaning"]
    # Invocation 真实落库且 source=event、input=映射产物
    db = SessionLocal()
    try:
        lg = db.get(AutomationTriggerLog, d["invocationId"])
        assert lg is not None and lg.source == "event"
        assert (lg.input or {}).get("value") == "五一去哪玩"
        ev = db.get(DataSourceEvent, event_id)
        assert ev.status == "dispatched"
        outcomes = ev.route_outcomes or []
        assert any(o["routeId"] == route["id"] and o["result"] == "delivered"
                   and o["deliveryId"] == d["id"] for o in outcomes)
    finally:
        db.close()
    # sourceEventId 流水查询附证据块（AC-023/024 可区分）
    assert body["sourceEvent"]["routeOutcomes"] == outcomes


def test_analysis_branch_taskrun_backrefs():
    src = _mk_source()
    tid = _mk_production_task()
    route = _mk_route(src["id"], "analysis_task", tid)
    r = client.post(f"/api/v2/data-sources/{src['id']}/test-event",
                    json={"id": uniq("evt"), "type": "batch-window"})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "dispatched", r.json()
    body = _deliveries(r.json()["event_id"])
    d = body["items"][0]
    assert d["status"] == "COMPLETED"
    assert d["destinationKind"] == "analysis_task"
    assert d["taskRunId"] and d["invocationId"] is None   # XOR：不包 Invocation
    db = SessionLocal()
    try:
        tr = db.get(TaskRun, d["taskRunId"])
        assert tr is not None and tr.trigger == "event"
        assert tr.source_event_id == r.json()["event_id"]
        assert tr.event_delivery_id == d["id"]
        # 不创建无业务价值的 Invocation 包裹（Spec §10.1）
        n_inv = db.query(AutomationTriggerLog).filter(
            AutomationTriggerLog.id == d["invocationId"]).count() \
            if d["invocationId"] else 0
        assert n_inv == 0
    finally:
        db.close()


def test_analysis_branch_failure_schedules_retry():
    """platform_only 任务（无 target_table）→ §18 门槛拒发：delivery FAILED+退避。"""
    src = _mk_source()
    task = make_quality_task(client, name=uniq("f5-task"))
    _mk_route(src["id"], "analysis_task", task["id"])
    r = client.post(f"/api/v2/data-sources/{src['id']}/test-event",
                    json={"id": uniq("evt")})
    body = _deliveries(r.json()["event_id"])
    d = body["items"][0]
    assert d["status"] == "FAILED"
    assert "target_table" in (d["error"] or "")
    assert d["attempts"] == 1 and d["nextRetryAt"]
    assert body["sourceEvent"]["status"] == "failed"  # 诚实观测，不冒充 filtered


# ---------- filter / dedupe 证据 ----------

def test_filter_and_dedupe_evidence():
    src = _mk_source()
    aid = _mk_automation()
    route = _mk_route(src["id"], "automation", aid,
                      filter={"version": 1,
                              "expression": {"field": "type", "op": "eq",
                                             "value": "ticket"}},
                      dedupe={"keyPath": "biz_key", "windowSeconds": 3600})
    # 1) filter 不命中 → filtered 证据，无 delivery
    r1 = client.post(f"/api/v2/data-sources/{src['id']}/test-event",
                     json={"id": uniq("evt"), "type": "other", "biz_key": "K1"})
    b1 = _deliveries(r1.json()["event_id"])
    assert b1["total"] == 0
    assert b1["sourceEvent"]["status"] == "filtered"
    o1 = b1["sourceEvent"]["routeOutcomes"]
    assert any(o["routeId"] == route["id"] and o["result"] == "filtered"
               for o in o1)
    # 2) 命中 → delivered
    r2 = client.post(f"/api/v2/data-sources/{src['id']}/test-event",
                     json={"id": uniq("evt"), "type": "ticket", "biz_key": "K1"})
    b2 = _deliveries(r2.json()["event_id"])
    assert b2["total"] == 1
    first_delivery = b2["items"][0]["id"]
    # 3) 同 biz_key 窗口内再来（不同 source event）→ deduped 证据，不新增派发
    r3 = client.post(f"/api/v2/data-sources/{src['id']}/test-event",
                     json={"id": uniq("evt"), "type": "ticket", "biz_key": "K1"})
    b3 = _deliveries(r3.json()["event_id"])
    assert b3["total"] == 0
    assert b3["sourceEvent"]["error"] == "deduped"
    o3 = b3["sourceEvent"]["routeOutcomes"]
    assert any(o["result"] == "deduped" and o["deliveryId"] == first_delivery
               for o in o3)


# ---------- retry ----------

def test_retry_guards_frozen_revision_and_mapping():
    src = _mk_source()
    aid = _mk_automation(max_runs=0)  # MAX_RUNS_REACHED → dispatch 必败
    route = _mk_route(src["id"], "automation", aid,
                      mapping={"version": 1, "fields": {"value": "v1"}})
    r = client.post(f"/api/v2/data-sources/{src['id']}/test-event",
                    json={"id": uniq("evt"), "v1": "OLD"})
    d = _deliveries(r.json()["event_id"])["items"][0]
    assert d["status"] == "FAILED"
    # 守卫：非 FAILED/DEAD 不可 retry
    db = SessionLocal()
    try:
        row = db.get(EventDelivery, d["id"])
        row.status = "completed"
        db.commit()
    finally:
        db.close()
    g = client.post(f"/api/v2/event-deliveries/{d['id']}/retry")
    assert g.status_code == 409
    assert g.json()["detail"]["code"] == "RETRY_STATUS_INVALID"
    # 还原 failed，编辑 route（revision 2 + 新 mapping），retry 必须用冻结 rev1+OLD 输入
    db = SessionLocal()
    try:
        row = db.get(EventDelivery, d["id"])
        row.status = "failed"
        db.commit()
    finally:
        db.close()
    r2 = client.put(f"/api/v2/event-routes/{route['id']}",
                    json={"mapping": {"version": 1, "fields": {"value": "v9"}}})
    assert r2.json()["revision"] == 2
    # 放开 max_runs 让重发成功，验证冻结输入而非新 mapping
    db = SessionLocal()
    try:
        auto = db.get(AutomationDefinition, aid)
        auto.max_runs = None
        db.commit()
    finally:
        db.close()
    rr = client.post(f"/api/v2/event-deliveries/{d['id']}/retry")
    assert rr.status_code == 200, rr.text
    out = rr.json()
    assert out["status"] == "COMPLETED"
    assert out["routeRevision"] == 1, "retry 不得漂移到 route 新版本"
    assert out["invocationId"] != d["invocationId"]
    db = SessionLocal()
    try:
        lg = db.get(AutomationTriggerLog, out["invocationId"])
        # 冻结的 mapped_input（v1→OLD），不是编辑后的 v9 映射
        assert (lg.input or {}).get("value") == "OLD"
    finally:
        db.close()


def test_retry_dead_accepted():
    src = _mk_source()
    aid = _mk_automation()
    _mk_route(src["id"], "automation", aid)
    r = client.post(f"/api/v2/data-sources/{src['id']}/test-event",
                    json={"id": uniq("evt")})
    d = _deliveries(r.json()["event_id"])["items"][0]
    db = SessionLocal()
    try:
        row = db.get(EventDelivery, d["id"])
        row.status = "dead"
        row.dead_reason = "manual-test"
        db.commit()
    finally:
        db.close()
    rr = client.post(f"/api/v2/event-deliveries/{d['id']}/retry")
    assert rr.status_code == 200
    assert rr.json()["status"] == "COMPLETED"
    assert rr.json()["deadReason"] is None


# ---------- watcher 接线 ----------

def test_watcher_retry_route_branch():
    """修复实证：_retry_dead_deliveries 此前从未被调用；route 分支到期重发。"""
    from app.routers.as_automations import _retry_dead_deliveries
    src = _mk_source()
    aid = _mk_automation(max_runs=0)
    _mk_route(src["id"], "automation", aid)
    r = client.post(f"/api/v2/data-sources/{src['id']}/test-event",
                    json={"id": uniq("evt")})
    d = _deliveries(r.json()["event_id"])["items"][0]
    assert d["status"] == "FAILED" and d["attempts"] == 1
    db = SessionLocal()
    try:
        row = db.get(EventDelivery, d["id"])
        row.next_retry_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()
        n = _retry_dead_deliveries(db)
        assert n >= 1
        row = db.get(EventDelivery, d["id"])
        assert row.attempts == 2 and row.status == "failed"  # max_runs=0 仍败
        # 放开限制 + 再次到期 → 重发成功
        auto = db.get(AutomationDefinition, aid)
        auto.max_runs = None
        row.next_retry_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()
        _retry_dead_deliveries(db)
        row = db.get(EventDelivery, d["id"])
        assert row.status == "completed" and row.next_retry_at is None
        assert row.invocation_id
    finally:
        db.close()


# ---------- terminal 策略结算 ----------

def test_terminal_policy_reconcile():
    from app.routers.event_routes import reconcile_terminal_deliveries
    src = _mk_source()
    aid = _mk_automation()
    _mk_route(src["id"], "automation", aid, completionPolicy="terminal")
    r = client.post(f"/api/v2/data-sources/{src['id']}/test-event",
                    json={"id": uniq("evt")})
    d = _deliveries(r.json()["event_id"])["items"][0]
    assert d["status"] == "RUNNING", "terminal 策略：受理≠完成"
    assert d["completionPolicy"] == "terminal"
    db = SessionLocal()
    try:
        lg = db.get(AutomationTriggerLog, d["invocationId"])
        lg.status = "completed"
        lg.ended_at = datetime.now(timezone.utc)
        db.commit()
        n = reconcile_terminal_deliveries(db)
        assert n >= 1
        row = db.get(EventDelivery, d["id"])
        assert row.status == "completed"
        # 目标反链缺失 → dead（需人工）
        row2 = EventDelivery(event_id=row.event_id,
                             source="event", status="running",
                             completion_policy="terminal",
                             destination_kind="automation",
                             destination_id=aid, invocation_id="fake-missing")
        db.add(row2)
        db.commit()
        reconcile_terminal_deliveries(db)
        assert row2.status == "dead" and "missing" in row2.dead_reason
        db.delete(row2)
        db.commit()
    finally:
        db.close()


def test_watcher_recovers_stale_pending():
    """F5 可靠性：进程中断遗留的陈旧 pending（>10min）纳入 watcher 恢复轨道；
    目标已删除 → dead（活体 wf_dev 实抓此类 09-09 遗留行 db6faa52…）。"""
    from app.routers.as_automations import _retry_dead_deliveries
    src = _mk_source()
    db = SessionLocal()
    try:
        ev = DataSourceEvent(source_id=src["id"], dedupe_key=uniq("f5-stale"),
                             payload={}, status="received")
        db.add(ev)
        db.flush()
        old = datetime.now(timezone.utc) - timedelta(minutes=30)
        d = EventDelivery(event_id=ev.id, source="event", status="pending",
                          trigger_id="f5-stale-trig",
                          automation_id="f5-stale-auto-missing",
                          created_at=old, updated_at=old)
        db.add(d)
        db.commit()
        did = d.id
        _retry_dead_deliveries(db)
        row = db.get(EventDelivery, did)
        assert row.status == "dead"
        assert "deleted or disabled" in (row.dead_reason or "")
        # 新鲜 pending（未超时）不被误恢复
        d2 = EventDelivery(event_id=ev.id, source="event", status="pending",
                           trigger_id="f5-stale-trig2",
                           automation_id="f5-stale-auto-missing2")
        db.add(d2)
        db.commit()
        _retry_dead_deliveries(db)
        db.refresh(d2)
        assert d2.status == "pending"
        db.delete(d2)
        db.commit()
    finally:
        db.close()
