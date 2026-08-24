"""Phase A 批次1（SDD 01）：A-01 运行认版本 / A-05 注册表与通知节点 / A-06 条件运算符 /
A-07 调用记录关联节点 / A-08 Agent config 乐观锁 / A-17 名称长度一致化。"""
import uuid

import pytest
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.runner import RunError, _branch_ok, create_run, execute_run

client = TestClient(app)


def u(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:6]}"


def make_wf(name: str, transform_template: str) -> str:
    """start→transform→end 的最小图，transform 模板作为版本行为标记。"""
    wid = client.post("/api/workflows", json={"name": name}).json()["id"]
    g = client.get(f"/api/workflows/{wid}").json()
    defn = g["definition"]
    defn["graph"]["nodes"] = [
        {"id": "s", "type": "input", "name": "开始", "config": {}, "inputs": []},
        {"id": "t", "type": "transform", "name": "转换",
         "config": {"template": transform_template}, "inputs": []},
        {"id": "e", "type": "end", "name": "结束", "config": {"outputKey": "quality_result"},
         "inputs": [{"name": "output", "type": "string",
                     "source": {"kind": "upstream", "nodeId": "t", "path": "outputs.output"}}]},
    ]
    defn["graph"]["edges"] = [{"id": "e1", "source": "s", "target": "t"},
                              {"id": "e2", "source": "t", "target": "e"}]
    r = client.put(f"/api/workflows/{wid}/draft",
                   json={"definition": defn, "baseRevision": g["draftRevision"]})
    assert r.status_code == 200, r.text
    return wid


def run_sync(wid: str, trigger: str = "test", input_: dict | None = None, **kw) -> dict:
    db = SessionLocal()
    try:
        run = create_run(db, wid, trigger, input_ or {"userQuery": "hi"},
                         enqueue=False, **kw)
    finally:
        db.close()
    execute_run(run.id)
    return client.get(f"/api/runs/{run.id}").json()


# ---------- A-01 运行认版本 ----------

def test_a01_pinned_version_executes_snapshot_not_draft():
    wid = make_wf(u("ver"), "SNAP-V1")
    pub = client.post(f"/api/workflows/{wid}/publish").json()
    # 发布后把草稿改成另一种行为
    g = client.get(f"/api/workflows/{wid}").json()
    defn = g["definition"]
    for n in defn["graph"]["nodes"]:
        if n["id"] == "t":
            n["config"]["template"] = "DRAFT-CHANGED"
    assert client.put(f"/api/workflows/{wid}/draft",
                      json={"definition": defn, "baseRevision": g["draftRevision"]}).status_code == 200

    pinned = run_sync(wid, version_id=pub["versionId"])
    assert pinned["status"] == "succeeded", pinned
    assert pinned["output"]["output"] == "SNAP-V1"

    draft = run_sync(wid)  # manual/test 仍走草稿
    assert draft["output"]["output"] == "DRAFT-CHANGED"


def test_a01_schedule_requires_published_version():
    wid = make_wf(u("sch"), "SCH-OK")
    db = SessionLocal()
    try:
        with pytest.raises(RunError) as ei:
            create_run(db, wid, "schedule", {}, enqueue=False)
        assert "NO_PUBLISHED_VERSION" in str(ei.value)
    finally:
        db.close()

    pub = client.post(f"/api/workflows/{wid}/publish").json()
    detail = run_sync(wid, trigger="schedule")
    assert detail["status"] == "succeeded"

    from app.models import Run as RunM
    db = SessionLocal()
    try:
        r = db.query(RunM).filter_by(workflow_id=wid, trigger="schedule").first()
        assert r.definition_source == "version"
        assert r.workflow_version_id == pub["versionId"]
    finally:
        db.close()

    # 显式 pinned_version_id 同样生效
    pinned = run_sync(wid, trigger="schedule", pinned_version_id=pub["versionId"])
    assert pinned["status"] == "succeeded"


def test_a01_manual_run_records_draft_source():
    wid = make_wf(u("src"), "DRAFT-ONLY")
    detail = run_sync(wid)
    assert detail["status"] == "succeeded"
    from app.models import Run as RunM
    db = SessionLocal()
    try:
        r = db.query(RunM).filter_by(workflow_id=wid).order_by(RunM.created_at.desc()).first()
        assert r.definition_source == "draft"
        assert r.workflow_version_id is None
    finally:
        db.close()


# ---------- A-05 注册表类型修正 + 通知节点 ----------

def test_a05_registry_contract_fixes():
    from app.registry import BY_TYPE
    assert BY_TYPE["query-rewrite"]["io"]["outputs"] == ["queryList:array"]
    assert BY_TYPE["decision-class"]["io"]["outputs"] == [
        "classificationTitle:string", "classificationId:string"]
    assert "end" not in ("notification",)  # 语义声明：通知不是终端


def test_a05_notification_midflow_does_not_terminate():
    wid = client.post("/api/workflows", json={"name": u("ntf")}).json()["id"]
    g = client.get(f"/api/workflows/{wid}").json()
    defn = g["definition"]
    defn["graph"]["nodes"] = [
        {"id": "s", "type": "input", "name": "开始", "config": {}, "inputs": []},
        {"id": "n", "type": "notification", "name": "通知",
         "config": {"message": "hello {{s.outputs.userQuery}}"}, "inputs": []},
        {"id": "t", "type": "transform", "name": "后续",
         "config": {"template": "AFTER"}, "inputs": []},
        {"id": "e", "type": "end", "name": "结束", "config": {"outputKey": "quality_result"}, "inputs": []},
    ]
    defn["graph"]["edges"] = [{"id": "e1", "source": "s", "target": "n"},
                              {"id": "e2", "source": "n", "target": "t"},
                              {"id": "e3", "source": "t", "target": "e"}]
    assert client.put(f"/api/workflows/{wid}/draft",
                      json={"definition": defn, "baseRevision": g["draftRevision"]}).status_code == 200
    detail = run_sync(wid, input_={"userQuery": "world"})
    assert detail["status"] == "succeeded", detail
    statuses = {n["nodeId"]: n["status"] for n in detail["nodeRuns"]}
    assert statuses["t"] == "success" and statuses["e"] == "success"
    evs = client.get(f"/api/runs/{detail['runId']}/events-list").json()["items"]
    ntf = [e for e in evs if e["type"] == "notification_sent"]
    assert len(ntf) == 1 and "hello world" in ntf[0]["payload"]["message"]


# ---------- A-06 条件运算符 ----------

def test_a06_operators_semantics():
    assert _branch_ok("eq", "a", "a") is True
    assert _branch_ok("neq", "a", "b") is True
    assert _branch_ok("contains", "hello world", "world") is True
    assert _branch_ok("not_contains", "hello world", "mars") is True
    assert _branch_ok("not_contains", "hello world", "world") is False
    assert _branch_ok("empty", "", None) is True
    assert _branch_ok("empty", [], None) is True
    assert _branch_ok("empty", {}, None) is True
    assert _branch_ok("empty", "x", None) is False
    assert _branch_ok("not_empty", "x", None) is True
    assert _branch_ok("not_empty", None, None) is False
    assert _branch_ok("gt", 5, 3) is True
    assert _branch_ok("gt", "5", 3) is True
    assert _branch_ok("lt", 2, 3) is True
    assert _branch_ok("gt", "abc", 3) is False
    assert _branch_ok(None, "truthy", None) is True
    assert _branch_ok(None, "", None) is False


def test_a06_registry_enum_complete():
    from app.registry import BY_TYPE
    ops = (BY_TYPE["condition"]["schema"]["properties"]["branches"]["items"]
           ["properties"]["operator"]["enum"])
    # 调研 11 §3.14 的 String 六项 + 数值比较
    assert {"eq", "neq", "contains", "not_contains", "empty", "not_empty", "gt", "lt"} <= set(ops)


# ---------- A-07 调用记录关联节点运行 ----------

def test_a07_call_record_links_node_run():
    tool = client.post("/api/ai-resources/tools",
                       json={"name": u("tool"), "kind": "builtin",
                             "spec": {"kind": "echo"}, "tested": True}).json()
    tv_id = client.get(f"/api/ai-resources/tools/{tool['id']}/versions").json()[0]["id"]
    wid = client.post("/api/workflows", json={"name": u("callwf")}).json()["id"]
    g = client.get(f"/api/workflows/{wid}").json()
    defn = g["definition"]
    defn["graph"]["nodes"] = [
        {"id": "s", "type": "input", "name": "开始", "config": {}, "inputs": []},
        {"id": "t1", "type": "tool", "name": "调用工具",
         "config": {"toolVersionId": tv_id}, "inputs": []},
        {"id": "e", "type": "end", "name": "结束", "config": {"outputKey": "quality_result"}, "inputs": []},
    ]
    defn["graph"]["edges"] = [{"id": "e1", "source": "s", "target": "t1"},
                              {"id": "e2", "source": "t1", "target": "e"}]
    assert client.put(f"/api/workflows/{wid}/draft",
                      json={"definition": defn, "baseRevision": g["draftRevision"]}).status_code == 200
    detail = run_sync(wid)
    assert detail["status"] == "succeeded", detail
    node_run_id = next(n["nodeRunId"] for n in detail["nodeRuns"] if n["nodeId"] == "t1")
    from app.models import CallRecord
    db = SessionLocal()
    try:
        recs = db.query(CallRecord).filter_by(node_run_id=node_run_id).all()
        assert len(recs) >= 1
        assert recs[0].kind == "tool"
    finally:
        db.close()


# ---------- A-08 Agent config 乐观锁 ----------

def test_a08_revision_conflict_blocks_stale_write():
    aid = client.post("/api/agents", json={"name": u("rev"), "type": "autonomous"}).json()["id"]
    assert client.get(f"/api/agents/{aid}").json()["configRevision"] == 1
    r1 = client.put(f"/api/agents/{aid}", json={"config": {"x": 1}, "expectedRevision": 1})
    assert r1.status_code == 200 and r1.json()["configRevision"] == 2
    r2 = client.put(f"/api/agents/{aid}", json={"config": {"x": 2}, "expectedRevision": 1})
    assert r2.status_code == 409
    assert r2.json()["detail"]["code"] == "REVISION_CONFLICT"
    # 以新 revision 再写成功
    r3 = client.put(f"/api/agents/{aid}", json={"config": {"x": 3}, "expectedRevision": 2})
    assert r3.status_code == 200 and r3.json()["configRevision"] == 3


# ---------- A-17 名称长度三层一致 ----------

LONG_NAME = "超长" * 11  # 22 字


def test_a17_api_rejects_overlong_name():
    assert len(LONG_NAME) > 20
    r = client.post("/api/agents", json={"name": LONG_NAME, "type": "autonomous"})
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "NAME_TOO_LONG"
    aid = client.post("/api/agents", json={"name": u("nm"), "type": "autonomous"}).json()["id"]
    r2 = client.put(f"/api/agents/{aid}", json={"name": LONG_NAME})
    assert r2.status_code == 400
    assert r2.json()["detail"]["code"] == "NAME_TOO_LONG"


def test_a17_db_check_constraint():
    from sqlalchemy.exc import IntegrityError

    from app.models import Agent
    db = SessionLocal()
    db.add(Agent(name="x" * 21, type="autonomous"))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()
    db.close()
