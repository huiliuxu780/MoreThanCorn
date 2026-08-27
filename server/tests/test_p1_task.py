"""09-SDD P1-B4 / P1-01：任务管理补全——历史窗口回填 + 任务级调度查询。

先红后绿：当前无回填端点；任务无调度列表端点。
"""
import time
import uuid

from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.runner import start_worker

client = TestClient(app)
start_worker()  # 幂等单例：回填批次依赖 worker 消费（独立运行本文件时也需要）


def _quality_wf():
    """确定性质检工作流：create-record 产出合法 QualityEvaluation。"""
    wf = client.post("/api/workflows", json={"name": f"P1T-{uuid.uuid4().hex[:6]}"}).json()
    d = client.get(f"/api/workflows/{wf['id']}").json()
    defn = d["definition"]
    defn["graph"]["nodes"] = [
        {"id": "n_start", "type": "input", "name": "开始", "config": {}, "inputs": []},
        {"id": "n_rec", "type": "create-record", "name": "落质检", "config": {"outputKey": "quality_result"}, "inputs": [
            {"name": "score", "type": "number", "source": {"kind": "input", "path": "score"}},
            {"name": "risk", "type": "string", "source": {"kind": "input", "path": "risk"}},
            {"name": "issues", "type": "array", "source": {"kind": "input", "path": "issues"}},
            {"name": "summary", "type": "string", "source": {"kind": "input", "path": "summary"}},
        ]},
    ]
    defn["graph"]["edges"] = [{"id": "e1", "source": "n_start", "target": "n_rec"}]
    client.put(f"/api/workflows/{wf['id']}/draft",
               json={"definition": defn, "baseRevision": d["draftRevision"]})
    pub = client.post(f"/api/workflows/{wf['id']}/publish", json={}).json()
    return wf["id"], pub["versionId"]


MAPPING = {"interactionId": "interactionId", "score": "score", "risk": "risk",
           "issues": "issues", "summary": "summary"}


def _wait_task_run(trid, timeout=30):
    deadline = time.time() + timeout
    while time.time() < deadline:
        t = client.get(f"/api/task-runs/{trid}").json()
        if t["status"] in ("succeeded", "partial", "failed", "cancelled"):
            return t
        time.sleep(0.3)
    raise AssertionError(f"task-run {trid} 未到终态")


def test_task_schedule_listing():
    wf_id, wv_id = _quality_wf()
    asset = client.post("/api/data-assets", json={"name": "P1T-sched", "rows": [
        {"interactionId": "S1", "score": 90, "risk": "Low", "issues": [], "summary": "ok"}]}).json()
    task = client.post("/api/tasks", json={
        "name": "P1T-调度任务", "workflowId": wf_id, "workflowVersionPolicy": "pinned",
        "pinnedWorkflowVersionId": wv_id, "dataAssetId": asset["id"], "inputMapping": MAPPING,
        "sampling": {"mode": "all"}, "dataWindow": {"mode": "all"}}).json()
    client.post(f"/api/tasks/{task['id']}/schedule", json={"cron": "0 9 * * *"})
    r = client.get(f"/api/tasks/{task['id']}/schedules")
    assert r.status_code == 200, r.text
    assert len(r.json()["items"]) >= 1, "任务应能列出自己的调度"


def test_backfill_processes_window_subset():
    """回填指定历史窗口：仅窗口内的交互被处理。"""
    wf_id, wv_id = _quality_wf()
    # 3 条：2 条在 2026-08-01 窗口内，1 条在窗口外（2026-07-01）
    rows = [
        {"interactionId": "BF-1", "interactionTime": "2026-08-01T10:00:00Z", "score": 90, "risk": "Low", "issues": [], "summary": "in"},
        {"interactionId": "BF-2", "interactionTime": "2026-08-02T10:00:00Z", "score": 80, "risk": "Low", "issues": [], "summary": "in"},
        {"interactionId": "BF-3", "interactionTime": "2026-07-01T10:00:00Z", "score": 70, "risk": "Low", "issues": [], "summary": "out"},
    ]
    asset = client.post("/api/data-assets", json={
        "name": "P1T-回填", "rows": rows, "timeField": "interactionTime"}).json()
    task = client.post("/api/tasks", json={
        "name": "P1T-回填任务", "workflowId": wf_id, "workflowVersionPolicy": "pinned",
        "pinnedWorkflowVersionId": wv_id, "dataAssetId": asset["id"], "inputMapping": MAPPING,
        "sampling": {"mode": "all"}, "dataWindow": {"mode": "all"}}).json()
    r = client.post(f"/api/tasks/{task['id']}/backfill",
                    json={"window": {"start": "2026-08-01", "end": "2026-08-31"}})
    assert r.status_code == 202, r.text
    tr = _wait_task_run(r.json()["taskRunId"])
    assert tr["total"] == 2, f"回填窗口应只含 2 条（实际 {tr['total']}）"
    assert tr["succeeded"] == 2
    refs = {x["interactionRef"] for x in client.get(f"/api/task-runs/{tr['id']}/runs").json()["items"]}
    assert refs == {"BF-1", "BF-2"}, f"窗口外的 BF-3 不应被处理：{refs}"
