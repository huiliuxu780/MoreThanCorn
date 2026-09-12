"""审计层3·N+1 查询计数门禁（2026-09-13，四层审计）。

方法：同一列表端点先种 SMALL=3 行计数 SELECT，再补到 LARGE=12 行重新计数，
断言语句数增量 ≤ DELTA_LIMIT —— 列表成本必须随行数 O(1)（常量级批量），
任何逐行查询（N+1）会把增量放大到 +9。比固定上界（F4 AC-045）更强：
固定上界在种子数小时可掩盖线性增长。

覆盖端点：
1. GET /api/work-items                          —— F4 统一投影（AC-045 增长率增强）
2. GET /api/runs                                —— FlowRun 列表
3. GET /api/tasks/{tid}/runs                    —— 分析批次 TaskRun 列表
4. GET /api/v2/automations/{aid}/invocations    —— Invocation 列表
5. GET /api/v2/agentflows/{fid}/runs            —— AgentFlowRun 列表
   （本轮审计发现并修复：list_flow_runs 原逐 run 查询节点行）

种子安全门（memory: seed-fixture-safety-gates）：全部行带 ``audit-n1`` 精确
marker，清理只按 marker 删除，不用时间窗，不触碰其他用例数据。
"""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event

from app.db import SessionLocal, engine
from app.main import app
from app.models import (AgentFlowDefinition, AgentFlowNodeRun, AgentFlowRelease,
                        AgentFlowRun, AgentFlowVersion, AnalysisTask,
                        AnalysisTaskVersion, AutomationTriggerLog, Run, TaskRun)

client = TestClient(app)
NOW = datetime.now(timezone.utc)
SMALL, LARGE = 3, 12
DELTA_LIMIT = 2

# 精确 marker（唯一 namespace，清理只认这些值）
M_TASK = "audit-n1-batch"
M_WF = "wf-audit-n1"
M_DA = "da-audit-n1"
M_AGENT_CHILD = "audit-n1-agent"      # TaskRun 子 Run 的 agent_id marker
M_AGENT_STANDALONE = "audit-n1-runs"  # /api/runs 独立 Run 的 marker
M_AUTO = "audit-n1-auto"
M_FLOW = "audit-n1-flow"


@contextmanager
def select_counter():
    """统计 with 块内发出的 SELECT 语句数（before_cursor_execute）。"""
    counts = {"n": 0}

    def _count(conn, cursor, statement, parameters, context, execmany):
        if statement.strip().upper().startswith("SELECT"):
            counts["n"] += 1

    event.listen(engine, "before_cursor_execute", _count)
    try:
        yield counts
    finally:
        event.remove(engine, "before_cursor_execute", _count)


@pytest.fixture(autouse=True)
def _cleanup_audit_n1_rows():
    yield
    db = SessionLocal()
    try:
        def_ids = [r[0] for r in db.query(AgentFlowDefinition.id).filter(
            AgentFlowDefinition.name == M_FLOW).all()]
        if def_ids:
            rel_ids = [r[0] for r in db.query(AgentFlowRelease.id).filter(
                AgentFlowRelease.definition_id.in_(def_ids)).all()]
            if rel_ids:
                run_ids = [r[0] for r in db.query(AgentFlowRun.id).filter(
                    AgentFlowRun.release_id.in_(rel_ids)).all()]
                if run_ids:
                    db.query(AgentFlowNodeRun).filter(
                        AgentFlowNodeRun.run_id.in_(run_ids)).delete(
                        synchronize_session=False)
                db.query(AgentFlowRun).filter(
                    AgentFlowRun.release_id.in_(rel_ids)).delete(
                    synchronize_session=False)
            db.query(AgentFlowRelease).filter(
                AgentFlowRelease.definition_id.in_(def_ids)).delete(
                synchronize_session=False)
            db.query(AgentFlowVersion).filter(
                AgentFlowVersion.definition_id.in_(def_ids)).delete(
                synchronize_session=False)
            db.query(AgentFlowDefinition).filter(
                AgentFlowDefinition.id.in_(def_ids)).delete(
                synchronize_session=False)
        db.query(AutomationTriggerLog).filter(
            AutomationTriggerLog.automation_id == M_AUTO).delete(
            synchronize_session=False)
        db.query(Run).filter(
            Run.agent_id.in_([M_AGENT_CHILD, M_AGENT_STANDALONE])).delete(
            synchronize_session=False)
        task_ids = [r[0] for r in db.query(AnalysisTask.id).filter(
            AnalysisTask.name == M_TASK).all()]
        if task_ids:
            db.query(TaskRun).filter(
                TaskRun.task_id.in_(task_ids)).delete(synchronize_session=False)
            db.query(AnalysisTaskVersion).filter(
                AnalysisTaskVersion.task_id.in_(task_ids)).delete(
                synchronize_session=False)
            db.query(AnalysisTask).filter(
                AnalysisTask.id.in_(task_ids)).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


# ---------- 种子（幂等：已有 have 行则只补到 n） ----------

def _seed_task_with_runs(n: int) -> str:
    """一个 AnalysisTask + n 个终态 TaskRun（每个带 2 条子 Run）。"""
    db = SessionLocal()
    try:
        task = db.query(AnalysisTask).filter_by(name=M_TASK).first()
        if not task:
            task = AnalysisTask(name=M_TASK, workflow_id=M_WF,
                                data_asset_id=M_DA, status="active",
                                created_by="dev")
            db.add(task)
            db.flush()
        tv = db.query(AnalysisTaskVersion).filter_by(task_id=task.id,
                                                     version_no=1).first()
        if not tv:
            tv = AnalysisTaskVersion(task_id=task.id, version_no=1,
                                     data_asset_id=M_DA, workflow_id=M_WF)
            db.add(tv)
            db.flush()
        have = db.query(TaskRun).filter_by(task_id=task.id).count()
        for i in range(have, n):
            tr = TaskRun(task_id=task.id, task_version_id=tv.id,
                         status="succeeded", total=2, succeeded_count=2,
                         processed_count=2, total_state="exact",
                         created_at=NOW, started_at=NOW, ended_at=NOW)
            db.add(tr)
            db.flush()
            for k in range(2):
                db.add(Run(task_run_id=tr.id, task_id=task.id,
                           task_version_id=tv.id,
                           interaction_ref=f"{M_AGENT_CHILD}-{i}-{k}",
                           attempt=1, agent_id=M_AGENT_CHILD,
                           status="succeeded", trigger="manual", input={},
                           created_at=NOW, started_at=NOW, ended_at=NOW,
                           duration_ms=1))
        db.commit()
        return task.id
    finally:
        db.close()


def _seed_standalone_runs(n: int) -> None:
    db = SessionLocal()
    try:
        have = db.query(Run).filter(Run.agent_id == M_AGENT_STANDALONE).count()
        for i in range(have, n):
            db.add(Run(agent_id=M_AGENT_STANDALONE, status="succeeded",
                       trigger="manual", input={},
                       interaction_ref=f"{M_AGENT_STANDALONE}-{i}", attempt=1,
                       created_at=NOW, started_at=NOW, ended_at=NOW,
                       duration_ms=1))
        db.commit()
    finally:
        db.close()


def _seed_invocations(n: int) -> None:
    db = SessionLocal()
    try:
        have = db.query(AutomationTriggerLog).filter_by(
            automation_id=M_AUTO).count()
        for i in range(have, n):
            db.add(AutomationTriggerLog(
                automation_id=M_AUTO, source="api", status="completed",
                target_kind="agent_session", target_ref=f"sess-{M_AUTO}-{i}",
                queued_at=NOW, started_at=NOW, ended_at=NOW))
        db.commit()
    finally:
        db.close()


def _seed_agentflow_runs(n: int) -> str:
    """AgentFlow 全链（definition→version→release）+ n 个 run（每个 2 节点行）。"""
    db = SessionLocal()
    try:
        d = db.query(AgentFlowDefinition).filter_by(name=M_FLOW).first()
        if not d:
            d = AgentFlowDefinition(name=M_FLOW, created_by="dev")
            db.add(d)
            db.flush()
            v = AgentFlowVersion(definition_id=d.id, version_no=1,
                                 definition={"nodes": [], "edges": []},
                                 content_digest="audit-n1", created_by="dev")
            db.add(v)
            db.flush()
            rel = AgentFlowRelease(version_id=v.id, definition_id=d.id,
                                   environment="sandbox", status="active")
            db.add(rel)
            db.flush()
        else:
            rel = db.query(AgentFlowRelease).filter_by(definition_id=d.id).first()
        have = db.query(AgentFlowRun).filter(
            AgentFlowRun.release_id == rel.id).count()
        for i in range(have, n):
            r = AgentFlowRun(release_id=rel.id, trigger_kind="manual",
                             status="succeeded", input={},
                             started_at=NOW, ended_at=NOW)
            db.add(r)
            db.flush()
            for k in range(2):
                db.add(AgentFlowNodeRun(run_id=r.id, node_id=f"n{k}",
                                        attempt=1, status="succeeded",
                                        started_at=NOW, ended_at=NOW))
        db.commit()
        return d.id
    finally:
        db.close()


def _window_params() -> dict:
    """work-items 显式 ±1 天窗口：跨时区/跨日运行测试也保证种子落窗。"""
    tz = ZoneInfo("Asia/Shanghai")
    today = datetime.now(tz).date()
    return {"dateFrom": (today - timedelta(days=1)).isoformat(),
            "dateTo": (today + timedelta(days=1)).isoformat(),
            "pageSize": "200"}


def _gate(getter, seeder, label: str, count_items) -> None:
    """双阶段计数门禁 + 种子生效自检（防空列表假绿）。"""
    seeder(SMALL)
    with select_counter() as c1:
        r1 = getter()
    assert r1.status_code == 200, r1.text
    n1 = count_items(r1.json())
    seeder(LARGE)
    with select_counter() as c2:
        r2 = getter()
    assert r2.status_code == 200, r2.text
    n2 = count_items(r2.json())
    assert n2 >= n1 + (LARGE - SMALL), (
        f"{label}: 种子未生效，行数 {n1}→{n2}（期望 ≥ +{LARGE - SMALL}）")
    delta = c2["n"] - c1["n"]
    assert delta <= DELTA_LIMIT, (
        f"{label}: 行数 {SMALL}→{LARGE} 时 SELECT 数 {c1['n']}→{c2['n']}"
        f"（增量 {delta} > {DELTA_LIMIT}），疑似 N+1")


# ---------- 门禁 ----------

def test_work_items_list_no_nplus1():
    _gate(lambda: client.get("/api/work-items", params=_window_params()),
          _seed_task_with_runs, "GET /api/work-items",
          lambda j: j["total"])


def test_runs_list_no_nplus1():
    _gate(lambda: client.get("/api/runs",
                             params={"agentId": M_AGENT_STANDALONE}),
          _seed_standalone_runs, "GET /api/runs",
          lambda j: len(j))


def test_task_runs_list_no_nplus1():
    tid_holder: list[str] = []

    def _seed(n: int) -> None:
        tid_holder[:] = [_seed_task_with_runs(n)]

    _gate(lambda: client.get(f"/api/tasks/{tid_holder[0]}/runs"),
          _seed, "GET /api/tasks/{tid}/runs",
          lambda j: j["total"])


def test_invocations_list_no_nplus1():
    _gate(lambda: client.get(f"/api/v2/automations/{M_AUTO}/invocations"),
          _seed_invocations, "GET /api/v2/automations/{aid}/invocations",
          lambda j: j["total"])


def test_agentflow_runs_list_no_nplus1():
    fid_holder: list[str] = []

    def _seed(n: int) -> None:
        fid_holder[:] = [_seed_agentflow_runs(n)]

    _gate(lambda: client.get(f"/api/v2/agentflows/{fid_holder[0]}/runs"),
          _seed, "GET /api/v2/agentflows/{fid}/runs",
          lambda j: len(j["items"]))
