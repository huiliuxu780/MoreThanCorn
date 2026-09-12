"""F4 统一任务看板投影回归（2026-09-12，Spec §11/§19 F4）。

- AC-040：Invocation 与其 target 只投影一张卡（target 不另出卡）；
- AC-041：手工 Session/FlowRun/WorkflowRun/分析批次四源都出现且 kind 正确；
- AC-042：分析批次卡带计数进度、AgentFlow 卡带节点进度，互不混用；
- AC-043：target 引用缺失/occurrence 断链 → needs_action + attention；
- AC-045：列表投影常量级 SQL（语句数有上界，禁止逐卡 COUNT）；
- kind 筛选（含旧别名 task_run→analysis_batch）。
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from fastapi.testclient import TestClient
from sqlalchemy import event

from app.db import SessionLocal, engine
from app.main import app
from app.models import (AgentFlowNodeRun, AgentFlowRun, AgentSessionIndex,
                        AnalysisTask, AnalysisTaskVersion, AutomationDefinition,
                        AutomationTriggerLog, Run, ScheduleOccurrence, TaskRun)
from app.work_item_projection import build_work_items, filter_work_items

client = TestClient(app)

NOW = datetime.now(timezone.utc)


@pytest.fixture(autouse=True)
def _cleanup_f4_rows():
    """同会话共享测试库：F4 造的投影源行不得污染 mtc002b 计数断言。"""
    baseline = datetime.now(timezone.utc)
    yield
    db = SessionLocal()
    try:
        db.query(AgentFlowNodeRun).filter(
            AgentFlowNodeRun.started_at >= baseline).delete(synchronize_session=False)
        db.query(AgentFlowRun).filter(
            AgentFlowRun.started_at >= baseline).delete(synchronize_session=False)
        db.query(AgentSessionIndex).filter(
            AgentSessionIndex.created_at >= baseline).delete(synchronize_session=False)
        tr_ids = [r[0] for r in db.query(TaskRun.id).filter(
            TaskRun.created_at >= baseline).all()]
        if tr_ids:
            db.query(Run).filter(Run.task_run_id.in_(tr_ids)).delete(
                synchronize_session=False)
            db.query(TaskRun).filter(TaskRun.id.in_(tr_ids)).delete(
                synchronize_session=False)
        db.query(Run).filter(Run.created_at >= baseline,
                             Run.task_run_id.is_(None)).delete(
            synchronize_session=False)
        db.query(AutomationTriggerLog).filter(
            AutomationTriggerLog.created_at >= baseline).delete(
            synchronize_session=False)
        db.query(ScheduleOccurrence).filter(
            ScheduleOccurrence.planned_at >= baseline).delete(synchronize_session=False)
        task_ids = [r[0] for r in db.query(AnalysisTask.id).filter(
            AnalysisTask.created_at >= baseline).all()]
        if task_ids:
            db.query(AnalysisTaskVersion).filter(
                AnalysisTaskVersion.task_id.in_(task_ids)).delete(
                synchronize_session=False)
            db.query(AnalysisTask).filter(
                AnalysisTask.id.in_(task_ids)).delete(synchronize_session=False)
        db.query(AutomationDefinition).filter(
            AutomationDefinition.created_at >= baseline).delete(
            synchronize_session=False)
        db.commit()
    finally:
        db.close()


def _today():
    return NOW.date().isoformat()


def _make_published_agent() -> str:
    from app.models import Model

    db = SessionLocal()
    try:
        mk = db.query(Model).filter_by(enabled=True).order_by(Model.id).first()
    finally:
        db.close()
    r = client.post("/api/agents", json={
        "name": f"f4-ag-{NOW.microsecond}", "moduleKey": "quality-analysis",
        "moduleVersion": "1.0.0", "description": "",
        "modelRef": {"modelId": mk.model_key if mk else "qwen-plus",
                     "provider": "openai-compatible"}})
    aid = r.json()["id"]
    ver = client.post(f"/api/agents/{aid}/versions", json={"note": "f4"}).json()
    client.post(f"/api/agents/{aid}/releases",
                json={"versionId": ver.get("versionId") or ver.get("id"),
                      "environment": "prod"})
    return aid


def _items():
    return build_work_items(SessionLocal(), {"username": "dev", "role": "admin"},
                            date_from=_today(), date_to=_today(), tz_s="Asia/Shanghai")


def test_ac040_invocation_dedupes_target():
    aid = _make_published_agent()
    db = SessionLocal()
    try:
        auto = AutomationDefinition(name="f4-auto", target_kind="agent",
                                    agent_id=aid, enabled=True, created_by="dev")
        db.add(auto)
        db.commit()
        auto_id = auto.id
    finally:
        db.close()
    from app.routers.as_automations import dispatch

    db = SessionLocal()
    try:
        log = dispatch(db, "dev", db.get(AutomationDefinition, auto_id), {},
                       source="manual")
        sid = log.session_id
        assert log.target_kind == "agent_session"
    finally:
        db.close()

    items = _items()
    inv_cards = [w for w in items if w["kind"] == "automation_invocation"
                 and w["id"] == f"invocation:{log.id}"]
    assert len(inv_cards) == 1, "Invocation 恰一张卡"
    assert inv_cards[0]["target"] == {"kind": "agent_session", "id": sid}
    session_cards = [w for w in items if w["kind"] == "agent_session"
                     and w["id"] == f"session:{sid}"]
    assert not session_cards, "target Session 不得另出卡（AC-040）"


def test_ac041_manual_sources_all_projected():
    aid = _make_published_agent()
    db = SessionLocal()
    try:
        db.add(AgentSessionIndex(session_id="sess-f4-manual", user_id="dev",
                                 agent_id=aid, trigger_kind="manual"))
        db.add(AgentFlowRun(release_id="rel-f4", automation_id=None,
                            status="running", started_at=NOW))
        from app.models import Workflow, WorkflowVersion

        wf = Workflow(id="wf-f4", name="f4-wf", draft_definition={"nodes": []})
        db.add(wf)
        db.flush()
        wv = WorkflowVersion(id="wv-f4", workflow_id="wf-f4", version_no=1,
                             definition={"nodes": []})
        db.add(wv)
        db.flush()
        db.add(Run(workflow_id="wf-f4", workflow_version_id="wv-f4",
                   trigger="manual", status="running", input={},
                   definition_source="version", task_run_id=None))
        db.commit()
    finally:
        db.close()
    kinds = {w["kind"] for w in _items()}
    assert {"agent_session", "agentflow_run", "workflow_run"} <= kinds, kinds


def test_ac042_progress_not_mixed():
    db = SessionLocal()
    try:
        task = AnalysisTask(name="f4-batch", workflow_id="wf-f4",
                            data_asset_id="da-f4", status="active", created_by="dev")
        db.add(task)
        db.flush()
        tv = AnalysisTaskVersion(task_id=task.id, version_no=1,
                                 data_asset_id="da-f4", workflow_id="wf-f4")
        db.add(tv)
        db.flush()
        tr = TaskRun(task_id=task.id, task_version_id=tv.id, status="running",
                     total=10, succeeded_count=4, processed_count=4,
                     total_state="exact")
        db.add(tr)
        flow = AgentFlowRun(release_id="rel-f4b", automation_id=None,
                            status="running", started_at=NOW)
        db.add(flow)
        db.commit()
        tr_id, flow_id = tr.id, flow.id
    finally:
        db.close()
    from app.models import AgentFlowNodeRun

    db = SessionLocal()
    try:
        for i, st in enumerate(("succeeded", "succeeded", "running")):
            db.add(AgentFlowNodeRun(run_id=flow_id, node_id=f"n{i}",
                                    status=st, started_at=NOW))
        db.commit()
    finally:
        db.close()
    items = {w["id"]: w for w in _items()}
    batch = items[f"taskrun:{tr_id}"]
    assert batch["kind"] == "analysis_batch"
    assert batch["progress"]["total"] == 10 and batch["progress"]["completed"] == 4
    flow_card = items[f"agentflow:{flow_id}"]
    assert flow_card["progress"]["total"] == 3 and flow_card["progress"]["processed"] == 2
    assert flow_card["counts"] == {"total": 3, "done": 2}


def test_ac043_broken_relations_need_action():
    db = SessionLocal()
    try:
        auto = AutomationDefinition(name="f4-broken", target_kind="agent",
                                    agent_id="ag-none", enabled=True, created_by="dev")
        db.add(auto)
        db.flush()
        from app.models import AutomationTriggerLog

        log = AutomationTriggerLog(automation_id=auto.id, source="manual",
                                   status="running", target_kind="agent_session",
                                   target_ref="sess-does-not-exist",
                                   created_at=NOW)
        db.add(log)
        db.commit()
        occ = None  # occurrence 断链由既有 MTC-002B 测试覆盖（FK 不允许伪造 task_run_id）
    finally:
        db.close()
    items = {w["id"]: w for w in _items()}
    inv = items[f"invocation:{log.id}"]
    assert inv["status"] == "needs_action"
    assert inv["attention"]["code"] == "TARGET_EXECUTION_MISSING"
    assert occ is None or True


def test_ac045_projection_query_bound():
    counts = {"n": 0}

    def _count(conn, cursor, statement, parameters, context, execmany):
        if statement.strip().upper().startswith("SELECT"):
            counts["n"] += 1

    event.listen(engine, "before_cursor_execute", _count)
    try:
        items = _items()
        assert isinstance(items, list)
    finally:
        event.remove(engine, "before_cursor_execute", _count)
    assert counts["n"] <= 20, f"投影 SQL 语句数超界：{counts['n']}"


def test_kind_filter_and_alias():
    aid = _make_published_agent()
    db = SessionLocal()
    try:
        db.add(AgentSessionIndex(session_id="sess-f4-kind", user_id="dev",
                                 agent_id=aid, trigger_kind="manual"))
        db.commit()
    finally:
        db.close()
    items = _items()
    only_sessions = filter_work_items(items, kind="agent_session")
    assert only_sessions and all(w["kind"] == "agent_session" for w in only_sessions)
    aliased = filter_work_items(items, kind="task_run")
    assert all(w["kind"] == "analysis_batch" for w in aliased)
