"""F2 AutomationInvocation 回归（2026-09-12，Spec §7/§12.3/§13.1）。

- AC-010/011：同 key 同 payload 返回同一 Invocation；同 key 异 payload 409；
- run-now 202 + Invocation DTO + statusUrl（AC-001 形状）；
- 暂停定义 → REJECTED 且错误码 AUTOMATION_DISABLED，并释放幂等键（AC-006）；
- cancel：agent 目标中断 + cancel_requested_at，watcher 按其结算 cancelled（AC-003 族）；
- queued→running 翻转与终态映射（agentflow 目标，watcher 对账）；
- retry：终态后新 Invocation（retry_of_id/attempt+1），非终态 409。

真实 Agent 目标经 hermetic 运行时边界（conftest）；跨栈由 P5 live 覆盖。
"""
from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from app import agentscope_client as rt
from app import legacy_route_stats  # noqa: F401 —— 确保模块已加载
from app.automation_watcher import reconcile_once
from app.db import SessionLocal
from app.main import app
from app.models import (
    AgentFlowRun,
    AgentSessionIndex,
    AutomationDefinition,
    AutomationTriggerLog,
)

client = TestClient(app)


def u(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def _make_published_agent() -> str:
    from app.models import Model

    db = SessionLocal()
    try:
        mk = db.query(Model).filter_by(enabled=True).order_by(Model.id).first()
    finally:
        db.close()
    r = client.post("/api/agents", json={
        "name": u("f2AG")[:20], "moduleKey": "quality-analysis", "moduleVersion": "1.0.0",
        "description": "",
        "modelRef": {"modelId": mk.model_key if mk else "qwen-plus",
                     "provider": "openai-compatible"}})
    assert r.status_code in (200, 201), r.text
    aid = r.json()["id"]
    ver = client.post(f"/api/agents/{aid}/versions", json={"note": "f2"}).json()
    vid = ver.get("versionId") or ver.get("id")
    rel = client.post(f"/api/agents/{aid}/releases",
                      json={"versionId": vid, "environment": "prod"})
    assert rel.status_code in (200, 201), rel.text
    return aid


def _make_automation(aid: str, enabled: bool = True) -> str:
    db = SessionLocal()
    try:
        auto = AutomationDefinition(name=u("f2-auto"), target_kind="agent",
                                    agent_id=aid, enabled=enabled, created_by="dev")
        db.add(auto)
        db.commit()
        return auto.id
    finally:
        db.close()


def test_ac010_idempotency_same_key_same_payload(monkeypatch):
    aid = _make_published_agent()
    auto_id = _make_automation(aid)
    key = u("idem")
    r1 = client.post(f"/api/v2/automations/{auto_id}/run-now",
                     headers={"Idempotency-Key": key})
    assert r1.status_code == 202, r1.text
    inv1 = r1.json()
    assert inv1["statusUrl"] == f"/api/v2/invocations/{inv1['invocationId']}"
    r2 = client.post(f"/api/v2/automations/{auto_id}/run-now",
                     headers={"Idempotency-Key": key})
    assert r2.status_code == 202
    assert r2.json()["invocationId"] == inv1["invocationId"], "同 key 同 payload 返回原 Invocation"

    # Invocation DTO 形状（Spec §7.2/§12.3）
    d = client.get(f"/api/v2/invocations/{inv1['invocationId']}")
    assert d.status_code == 200
    dto = d.json()
    assert dto["id"] == inv1["invocationId"]
    assert dto["status"] == "RUNNING"
    assert dto["target"]["kind"] == "agent_session"
    assert dto["target"]["id"] == inv1.get("sessionId")
    assert dto["attempt"] == 1 and dto["retryOfId"] is None
    assert dto["startedAt"], "agent 目标派发成功即真实开始"


def test_ac011_idempotency_payload_mismatch(monkeypatch):
    aid = _make_published_agent()
    auto_id = _make_automation(aid)
    # 真实 409：同 key 异 payload 走外部 API 触发端（独立 key，不与 run-now 混用）
    from app.routers.as_automations import _http_status_for_dispatch_error

    assert _http_status_for_dispatch_error(
        ValueError("[IDEMPOTENCY_PAYLOAD_MISMATCH] x")) == 409
    api_key = client.post(f"/api/v2/automations/{auto_id}/api-keys").json()
    key_id, raw = api_key["id"], api_key["key"]
    key = u("idem-mm")
    h = {"Authorization": f"Bearer {raw}", "Idempotency-Key": key}
    p1 = client.post(f"/api/v2/external/automations/{key_id}/invoke", json={"v": 1}, headers=h)
    assert p1.status_code == 202, p1.text
    p2 = client.post(f"/api/v2/external/automations/{key_id}/invoke", json={"v": 2}, headers=h)
    assert p2.status_code == 409, p2.text
    assert "IDEMPOTENCY_PAYLOAD_MISMATCH" in p2.text


def test_ac006_paused_rejected_with_error_code_and_key_freed():
    aid = _make_published_agent()
    auto_id = _make_automation(aid, enabled=False)
    key = u("idem-paused")
    r = client.post(f"/api/v2/automations/{auto_id}/run-now",
                    headers={"Idempotency-Key": key})
    assert r.status_code == 409
    assert "AUTOMATION_DISABLED" in r.text
    db = SessionLocal()
    try:
        row = (db.query(AutomationTriggerLog)
               .filter_by(automation_id=auto_id).order_by(
                   AutomationTriggerLog.created_at.desc()).first())
        assert row.status == "rejected"
        assert row.error_code == "AUTOMATION_DISABLED"
        assert row.idempotency_key is None, "REJECTED 释放幂等键"
        db.delete(row)
        db.delete(db.get(AutomationDefinition, auto_id))
        db.commit()
    finally:
        db.close()


def test_agent_invocation_cancel_flow(monkeypatch):
    aid = _make_published_agent()
    auto_id = _make_automation(aid)
    interrupts: list = []
    monkeypatch.setattr(rt, "interrupt_session",
                        lambda uid, rid, sid: interrupts.append(sid) or {"ok": True})
    r = client.post(f"/api/v2/automations/{auto_id}/run-now")
    assert r.status_code == 202
    inv = r.json()["invocationId"]
    canc = client.post(f"/api/v2/invocations/{inv}/cancel")
    assert canc.status_code == 202, canc.text
    assert canc.json()["cancelRequested"] is True
    assert interrupts, "agent 目标取消必须中断 Session"
    db = SessionLocal()
    try:
        log = db.get(AutomationTriggerLog, inv)
        assert log.cancel_requested_at is not None
    finally:
        db.close()
    # watcher 对账：hermetic session_status=idle + cancel_requested → cancelled
    db = SessionLocal()
    try:
        reconcile_once(db)
        log = db.get(AutomationTriggerLog, inv)
        assert log.status == "cancelled"
        assert log.ended_at is not None
    finally:
        db.close()


def test_watcher_queued_to_running_and_cancelled_mapping():
    """agentflow 目标：queued→running 翻转；fr cancelled → invocation cancelled。"""
    db = SessionLocal()
    try:
        aid = _make_published_agent()
        auto = AutomationDefinition(name=u("f2-q"), target_kind="agentflow",
                                    agentflow_id="flow-x", enabled=True,
                                    created_by="dev")
        db.add(auto)
        db.flush()
        fr = AgentFlowRun(release_id="rel-f2", status="running", trigger_kind="manual")
        db.add(fr)
        db.flush()
        log = AutomationTriggerLog(automation_id=auto.id, source="schedule",
                                   status="queued", target_kind="agentflow_run",
                                   target_ref=fr.id, agentflow_run_id=fr.id,
                                   queued_at=fr.started_at)
        db.add(log)
        db.commit()
        log_id, auto_id, fr_id = log.id, auto.id, fr.id
    finally:
        db.close()
    db = SessionLocal()
    try:
        reconcile_once(db)
        log = db.get(AutomationTriggerLog, log_id)
        assert log.status == "running"
        assert log.started_at is not None, "QUEUED→RUNNING 必须带 started_at"
        # 目标取消 → invocation cancelled
        fr = db.get(AgentFlowRun, fr_id)
        fr.status = "cancelled"
        fr.ended_at = fr.started_at
        db.commit()
        reconcile_once(db)
        log = db.get(AutomationTriggerLog, log_id)
        assert log.status == "cancelled"
        assert log.ended_at is not None
        db.delete(log)
        db.delete(fr)
        db.delete(db.get(AutomationDefinition, auto_id))
        db.commit()
    finally:
        db.close()


def test_retry_creates_new_invocation_with_lineage():
    aid = _make_published_agent()
    auto_id = _make_automation(aid)
    r1 = client.post(f"/api/v2/automations/{auto_id}/run-now")
    inv = r1.json()["invocationId"]
    # 非终态 409
    early = client.post(f"/api/v2/invocations/{inv}/retry")
    assert early.status_code == 409
    # 置终态后重试
    db = SessionLocal()
    try:
        log = db.get(AutomationTriggerLog, inv)
        log.status = "failed"
        log.ended_at = log.started_at
        db.commit()
    finally:
        db.close()
    r2 = client.post(f"/api/v2/invocations/{inv}/retry")
    assert r2.status_code == 202, r2.text
    body = r2.json()
    assert body["retryOfId"] == inv
    assert body["attempt"] == 2
    assert body["invocationId"] != inv
    # lineage 落库可查
    d = client.get(f"/api/v2/invocations/{body['invocationId']}").json()
    assert d["retryOfId"] == inv and d["attempt"] == 2
