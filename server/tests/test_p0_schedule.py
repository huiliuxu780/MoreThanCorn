"""09-SDD P0-B3：Task pause 与 Schedule 语义（P0-09）。

- paused Task 不产生新 TaskRun（INV-10）；
- Schedule 触发使用已解析 Published WorkflowVersion（经 TaskRun 链）；
- 同一 fire slot 重复 tick 不创建重复 TaskRun（INV-11）。

先红后绿。
"""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.models import Schedule, TaskRun
from app.runner import schedule_tick, start_worker

client = TestClient(app)
_worker = start_worker()


def _mk_active_task(wf_name="sch-wf") -> str:
    wf = client.post("/api/workflows", json={"name": wf_name}).json()
    d = client.get(f"/api/workflows/{wf['id']}").json()["definition"]
    s = next(n for n in d["graph"]["nodes"] if n["type"] == "input")
    e = next(n for n in d["graph"]["nodes"] if n["type"] == "end")
    d["graph"]["nodes"].append({"id": "n_cr", "type": "create-record", "name": "q",
                                "config": {}, "inputs": [
        {"name": "score", "type": "number", "source": {"kind": "fixed", "value": 80}},
        {"name": "risk", "type": "string", "source": {"kind": "fixed", "value": "Low"}},
        {"name": "issues", "type": "array", "source": {"kind": "fixed", "value": []}},
        {"name": "summary", "type": "string", "source": {"kind": "fixed", "value": "x"}}]})
    d["graph"]["edges"] = [x for x in d["graph"]["edges"]
                           if not (x["source"] == s["id"] and x["target"] == e["id"])]
    d["graph"]["edges"] += [{"id": "e1", "source": s["id"], "target": "n_cr"},
                            {"id": "e2", "source": "n_cr", "target": e["id"]}]
    client.put(f"/api/workflows/{wf['id']}/draft",
               json={"definition": d, "baseRevision": d["workflow"]["draftRevision"]})
    assert client.post(f"/api/workflows/{wf['id']}/publish").status_code == 201
    asset = client.post("/api/data-assets", json={
        "name": "sch-asset", "rows": [{"interactionId": "S-1", "text": "t"}]}).json()
    task = client.post("/api/tasks", json={"name": "sch-task", "workflowId": wf["id"],
                                           "dataAssetId": asset["id"]}).json()
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
