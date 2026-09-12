"""09-SDD P1-B2 / P1-06：部分成功与错误恢复——行级错误可见 + 失败交互重试入口。

先红后绿：当前 TaskRun 失败行无重试入口（只能整批重跑）。
"""
import uuid

from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.models import (AnalysisTask, AnalysisTaskVersion, DataSnapshot, Run,
                        TaskRun)
from app.runner import start_worker

client = TestClient(app)
start_worker()  # 重试异步入队依赖 worker 消费


def _mk_partial_batch():
    """构造一个 partial 批次：1 成功 + 1 失败（有 Run 行，可重试）。"""
    db = SessionLocal()
    try:
        # 换底后重试仍走 Workflow 执行器：补最小已发布工作流 wf-p1p
        from app.models import Workflow, WorkflowVersion
        if not db.get(Workflow, "wf-p1p"):
            wf = Workflow(id="wf-p1p", name="wf-p1p", status="published")
            db.add(wf)
            db.flush()
            wv = WorkflowVersion(workflow_id="wf-p1p", version_no=1,
                                 definition={"graph": {"nodes": [
                                     {"id": "s", "type": "input", "name": "开始", "config": {}, "inputs": []},
                                     {"id": "e", "type": "end", "name": "结束", "config": {}, "inputs": []}],
                                     "edges": [{"id": "e1", "source": "s", "target": "e"}]}})
            db.add(wv)
            db.flush()
            wf.current_version_id = wv.id
            db.flush()
        t = AnalysisTask(name=f"P1P-{uuid.uuid4().hex[:6]}", workflow_id="wf-p1p",
                         data_asset_id="asset-p1p", status="active")
        db.add(t)
        db.flush()
        tv = AnalysisTaskVersion(task_id=t.id, version_no=1, workflow_id="wf-p1p",
                                 data_asset_id="asset-p1p")
        db.add(tv)
        db.flush()
        snap = DataSnapshot(asset_id="asset-p1p", expected_count=2, read_count=2)
        db.add(snap)
        db.flush()
        tr = TaskRun(task_id=t.id, task_version_id=tv.id, data_snapshot_id=snap.id,
                     trigger="manual", status="partial", total=2,
                     succeeded_count=1, failed_count=1)
        db.add(tr)
        db.flush()
        wv_id = db.query(WorkflowVersion).filter_by(workflow_id="wf-p1p").first().id
        ok_run = Run(workflow_id="wf-p1p", workflow_version_id=wv_id, trigger="batch", status="succeeded",
                     task_run_id=tr.id, task_id=t.id, task_version_id=tv.id,
                     interaction_ref="P1P-OK", attempt=1,
                     data_snapshot_id=snap.id, input={"interactionId": "P1P-OK"})
        bad_run = Run(workflow_id="wf-p1p", workflow_version_id=wv_id, trigger="batch", status="failed",
                      task_run_id=tr.id, task_id=t.id, task_version_id=tv.id,
                      interaction_ref="P1P-BAD", attempt=1,
                      data_snapshot_id=snap.id, input={"interactionId": "P1P-BAD"},
                      error={"message": "OUTPUT_SCHEMA_INVALID: ..."})
        db.add_all([ok_run, bad_run])
        db.commit()
        return {"task_id": t.id, "task_run_id": tr.id, "bad_run_id": bad_run.id}
    finally:
        db.close()


def _cleanup(ids):
    db = SessionLocal()
    from app.models import JobQueue, TaskRun as _TR
    # F3：Recovery 批次的 Run/TaskRun 也要先删（FK 顺序）
    rec_ids = [r[0] for r in db.query(_TR.id).filter(
        _TR.retry_of_task_run_id == ids["task_run_id"]).all()]
    for rid in rec_ids + [ids["task_run_id"]]:
        db.query(Run).filter(Run.task_run_id == rid).delete()
    db.query(_TR).filter(_TR.id.in_(rec_ids + [ids["task_run_id"]])).delete()
    db.query(DataSnapshot).filter(DataSnapshot.asset_id == "asset-p1p").delete()
    db.query(AnalysisTaskVersion).filter_by(task_id=ids["task_id"]).delete()
    db.query(AnalysisTask).filter_by(id=ids["task_id"]).delete()
    db.commit()
    db.close()


def test_task_run_reflects_partial_with_row_errors():
    ids = _mk_partial_batch()
    try:
        tr = client.get(f"/api/task-runs/{ids['task_run_id']}")
        assert tr.status_code == 200
        body = tr.json()
        assert body["status"] == "partial"
        assert body["succeeded"] == 1 and body["failed"] == 1
        runs = client.get(f"/api/task-runs/{ids['task_run_id']}/runs").json()["items"]
        failed_rows = [r for r in runs if r["status"] == "failed"]
        assert len(failed_rows) == 1
        assert failed_rows[0]["error"], "行级错误必须可见（含失败原因）"
    finally:
        _cleanup(ids)


def test_retry_failed_creates_new_attempt():
    """09 P1-06：重试建新 attempt（谱系），且异步入队后重汇父批次。"""
    import time
    ids = _mk_partial_batch()
    try:
        r = client.post(f"/api/tasks/{ids['task_id']}/runs/{ids['task_run_id']}/retry-failed")
        assert r.status_code == 202, r.text
        body = r.json()
        assert body["retried"] == 1, "应只重试失败的那条交互"
        assert body["taskRunId"] == ids["task_run_id"]
        # F3/AC-035A：Recovery TaskRun 承载 attempt=2，原批次保持终态
        rec_id = body["recoveryTaskRunId"]
        assert rec_id and rec_id != ids["task_run_id"]
        db = SessionLocal()
        try:
            deadline = time.time() + 20
            nr = None
            while time.time() < deadline:
                nr = db.query(Run).filter(
                    Run.task_run_id == rec_id,
                    Run.interaction_ref == "P1P-BAD", Run.attempt == 2).first()
                if nr:
                    break
                db.expire_all()
                time.sleep(0.3)
            assert nr is not None, "重试应创建 attempt=2 的 Run（Recovery 批次内）"
            assert nr.attempt == 2, "重试=新 attempt（INV-07 不覆盖原记录）"
            assert nr.origin_run_id == ids["bad_run_id"], "重试须指向原失败 Run（谱系）"
            old = db.get(Run, ids["bad_run_id"])
            assert old.status == "failed" and old.attempt == 1
            from app.models import TaskRun
            rec = db.get(TaskRun, rec_id)
            assert rec.retry_of_task_run_id == ids["task_run_id"]
            assert rec.run_scope == "failed_items"
        finally:
            db.close()
    finally:
        _cleanup(ids)


def test_retry_failed_idempotent_when_no_failures():
    ids = _mk_partial_batch()
    try:
        # 先把失败 Run 置为成功，则无可重试项
        db = SessionLocal()
        bad = db.get(Run, ids["bad_run_id"])
        bad.status = "succeeded"
        db.commit()
        db.close()
        r = client.post(f"/api/tasks/{ids['task_id']}/runs/{ids['task_run_id']}/retry-failed")
        assert r.status_code in (200, 202)
        assert r.json()["retried"] == 0, "无失败项时应幂等返回 0，不新建 Run"
    finally:
        _cleanup(ids)
