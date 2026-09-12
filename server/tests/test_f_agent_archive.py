"""Agent 封存（archive）闸门回归（2026-09-12）。

语义：封存 = 列表隐藏（既有）+ **新执行链路全面拒绝（本轮补齐）**：
- 创建版本 / 发布 → 409 AGENT_ARCHIVED；
- 自动任务 dispatch（agent 目标）→ REJECTED/AGENT_ARCHIVED；
- 脚本保存校验与运行时构建 → 拒绝封存 waker；
- DAG flow 版本保存 → 节点引用封存 Agent 拒绝；
- 引用清单端点（封存前确认）。
分析任务侧「已归档 Agent 不可作为执行目标」为既有闸门（P0-B），本文件不重复。
"""
from __future__ import annotations

import uuid

from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.models import Agent, AutomationTriggerLog, Model

client = TestClient(app)


def u(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def _make_agent(archived: bool = False) -> str:
    db = SessionLocal()
    try:
        a = Agent(name=u("archAG")[:20], type="custom", status="draft",
                  config={"rolePrompt": "x", "modelRef": {}},
                  archived=archived)
        db.add(a)
        db.commit()
        return a.id
    finally:
        db.close()


def test_archived_agent_cannot_create_version_or_release():
    aid = _make_agent(archived=True)
    v = client.post(f"/api/agents/{aid}/versions", json={"note": "x"})
    assert v.status_code == 409
    assert "AGENT_ARCHIVED" in v.text
    r = client.post(f"/api/agents/{aid}/releases", json={"versionId": "whatever"})
    assert r.status_code == 409
    assert "AGENT_ARCHIVED" in r.text


def test_active_agent_lifecycle_unaffected():
    aid = _make_agent(archived=False)
    # 未封存 Agent 不受闸门影响（版本创建可达校验层——本用例只验证不 409 AGENT_ARCHIVED）
    v = client.post(f"/api/agents/{aid}/versions", json={"note": "x"})
    assert "AGENT_ARCHIVED" not in v.text


def test_references_endpoint_counts():
    from app.models import AnalysisTask, AnalysisTaskVersion, AutomationDefinition

    aid = _make_agent()
    db = SessionLocal()
    try:
        db.add(AutomationDefinition(name=u("ref-auto"), target_kind="agent",
                                    agent_id=aid, enabled=True, created_by="dev"))
        # 分析任务：合法形状（check ck_task_target_type 要求 v1 带执行目标）
        t = AnalysisTask(name=u("ref-task"), description="arch refs",
                         data_asset_id="da-arch", workflow_id="wf-arch",
                         status="active")
        db.add(t)
        db.flush()
        v = AnalysisTaskVersion(task_id=t.id, version_no=1,
                                data_asset_id="da-arch",
                                execution_target_type="agent", agent_id=aid,
                                agent_version_policy="latest_prod_release",
                                note="v1")
        db.add(v)
        db.flush()
        t.current_version_id = v.id
        db.commit()
    finally:
        db.close()
    r = client.get(f"/api/agents/{aid}/references")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["automations"]["count"] == 1
    assert body["analysisTasks"]["count"] == 1
    assert body["automations"]["samples"] and "ref-auto" in body["automations"]["samples"][0]


def test_references_404_for_unknown_agent():
    assert client.get("/api/agents/does-not-exist/references").status_code == 404


def test_archived_agent_dispatch_rejected():
    """封存 Agent 的自动任务触发 → REJECTED/AGENT_ARCHIVED（不消耗 max_runs 配额）。"""
    from app.models import AutomationDefinition

    aid = _make_agent(archived=True)
    db = SessionLocal()
    try:
        auto = AutomationDefinition(name=u("arch-auto"), target_kind="agent",
                                    agent_id=aid, enabled=True, max_runs=5,
                                    created_by="dev")
        db.add(auto)
        db.commit()
        auto_id = auto.id
    finally:
        db.close()
    r = client.post(f"/api/v2/automations/{auto_id}/run-now")
    assert r.status_code == 409, r.text
    assert "AGENT_ARCHIVED" in r.text
    db = SessionLocal()
    try:
        row = (db.query(AutomationTriggerLog)
               .filter_by(automation_id=auto_id).order_by(
                   AutomationTriggerLog.created_at.desc()).first())
        assert row.status == "rejected"
        assert row.error_code == "AGENT_ARCHIVED"
        db.refresh(db.get(AutomationDefinition, auto_id))
        # 拒绝不消耗配额：archived 检查在原子门之前
        assert db.get(AutomationDefinition, auto_id).auto_run_count == 0
        db.delete(row)
        db.delete(db.get(AutomationDefinition, auto_id))
        db.commit()
    finally:
        db.close()
