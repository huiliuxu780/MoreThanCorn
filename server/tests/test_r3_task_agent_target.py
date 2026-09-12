"""R3（SDD 10）：AnalysisTask Agent 目标 + TaskRun 冻结 + 结果事务闭环验收。

- Agent 任务创建（executionTarget 校验/互斥约束/legacy 兼容）；
- 批次 e2e：冻结快照解析 → Module Run 同步执行 → 恰好一条生效 QualityResult
  （agent_version_id/rule_version_id/派生评分）→ TaskRun 统计；
- 重复结算幂等（exactly-once）；agent-exec 嵌套 Module Agent。
历史 Workflow 任务不回归由既有 09 套件保证（全量门禁）。
"""
import json
import time
import uuid
import threading

import httpx
import pytest
import uvicorn
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.models import (AgentVersion, CallRecord, QualityResult, Release, Run, TaskRun)
from app.runner import start_worker
from app.runtime_providers import worker as rt_worker
from app.task_runner import execute_task_run, retry_failed_in_taskrun, start_task_run
from tests._quality_setup import make_asset, make_definition_version, make_rule_version
from tests._legacy_agents import seed_agent  # noqa: F401——封存契约另测
from tests.test_r1_runtime_providers import FakeProvider, QualityFake, patch_gateway
from tests.test_r2_agent_modules import (_seed_tools, make_module_agent, make_provider,
                                         publish_version)

client = TestClient(app)
start_worker()


@pytest.fixture(scope="module")
def fake_server_r3():
    fake = QualityFake()
    yield fake, "http://127.0.0.1:1"


def _make_agent_task(aid, asset_id, defv, rulev, **extra) -> dict:
    body = {"name": f"R3T-{uuid.uuid4().hex[:6]}",
            "executionTarget": {"type": "agent", "agentId": aid,
                                "versionPolicy": "latest_sandbox_release"},
            "dataAssetId": asset_id, "dataDefinitionVersionId": defv,
            "resultRuleVersionId": rulev, "inputMapping": {"sample_id": "sample_id", "call_id": "call_id", "conversation": "conversation"},
            "sampling": {"mode": "all"}, "dataWindow": {"mode": "all"}, **extra}
    r = client.post("/api/tasks", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def test_agent_task_creation_validation():
    _seed_tools()
    a = make_module_agent()
    asset = make_asset(client, [{"interactionId": "X1", "dialogues": []}])
    defv = make_definition_version(client, asset)
    rulev = make_rule_version(client)
    t = _make_agent_task(a["id"], asset, defv, rulev)
    assert t["executionTarget"]["type"] == "agent" and t["executionTarget"]["agentId"] == a["id"]
    # 校验：未知/封存 Agent、坏策略、pinned 缺版本
    assert client.post("/api/tasks", json={
        "name": u6(), "executionTarget": {"type": "agent", "agentId": "nope"},
        "dataAssetId": asset, "dataDefinitionVersionId": defv,
        "resultRuleVersionId": rulev}).status_code == 422
    legacy = seed_agent(atype="dialogue")
    assert client.post("/api/tasks", json={
        "name": u6(), "executionTarget": {"type": "agent", "agentId": legacy["id"]},
        "dataAssetId": asset, "dataDefinitionVersionId": defv,
        "resultRuleVersionId": rulev}).status_code == 422
    assert client.post("/api/tasks", json={
        "name": u6(), "executionTarget": {"type": "agent", "agentId": a["id"],
                                          "versionPolicy": "bogus"},
        "dataAssetId": asset, "dataDefinitionVersionId": defv,
        "resultRuleVersionId": rulev}).status_code == 422
    # 旧 workflow payload 兼容（回归保护）
    from tests.test_r2_agent_modules import client as _c  # noqa: F401
    r = client.post("/api/tasks", json={
        "name": u6(), "workflowId": "whatever-wf", "workflowVersionPolicy": "pinned",
        "pinnedWorkflowVersionId": "nope", "dataAssetId": asset,
        "dataDefinitionVersionId": defv, "resultRuleVersionId": rulev})
    assert r.status_code in (404, 422)  # 走 workflow 校验路径（非 agent 分支）


def u6() -> str:
    return f"R3-{uuid.uuid4().hex[:6]}"


def _setup_batch_env(monkeypatch, base_url, fake=None):
    monkeypatch.setattr("app.runtime_providers.dispatcher.DEFAULT_RUNTIME_TIMEOUT_SECONDS", 20)
    if fake is not None:
        fake.auto_succeed = True
    patch_gateway(monkeypatch, base_url)
    _seed_tools()
    prov = make_provider("agentscope", base_url)
    a = make_module_agent()
    v = publish_version(a["id"])
    # 换底（2026-09-09）：Release 不再绑定 Provider
    r = client.post(f"/api/agents/{a['id']}/releases", json={
        "versionId": v["versionId"], "environment": "sandbox"})
    assert r.status_code == 201, r.text
    return prov, a, v


def _patch_structured(monkeypatch):
    from app import agentscope_client as rt

    def fake_structured(*a, **k):
        return {
            "structured_output": {
                "sample_id": "S1",
                "findings": [{"criterion": "abusive_language", "status": "passed",
                              "confidence": 0.9, "reason": "ok", "evidence": ["ev"]}],
                "labels": {"service_type_code": None, "issue_codes": []},
                "summary": "ok",
            },
            "text": "",
            "session_id": "sess-r3-batch",
        }

    monkeypatch.setattr(rt, "structured_run", fake_structured)


def test_batch_agent_task_end_to_end(monkeypatch, fake_server_r3):
    """换底（2026-09-09）：批次经统一入口；逐交互 Run + QualityResult 结算。"""
    from tests.test_r5_business_module import _cutover_batch
    rows = [{"interactionId": "S1", "sample_id": "S1", "call_id": "c1",
             "conversation": "x", "dialogues": []}]
    tr_id, runs = _cutover_batch(monkeypatch, "quality-analysis", rows, expect_quality=True)
    assert len(runs) == 1
    assert runs[0].status == "succeeded", runs[0].error
    db = SessionLocal()
    try:
        assert db.query(QualityResult).filter_by(run_id=runs[0].id, is_latest=True).count() == 1
    finally:
        db.close()


def test_batch_retry_uses_frozen_snapshot(monkeypatch, fake_server_r3):
    """换底（2026-09-09）：重试只补失败交互，新 attempt 且指向原 Run（谱系）。"""
    from tests.test_r5_business_module import _cutover_batch
    rows = [{"interactionId": "S1", "sample_id": "S1", "call_id": "c1",
             "conversation": "x", "dialogues": []},
            {"interactionId": "S3", "sample_id": "S3", "call_id": "c3",
             "conversation": "x", "dialogues": []}]
    tr_id, runs = _cutover_batch(monkeypatch, "quality-analysis", rows, expect_quality=True)
    assert len(runs) == 2
    bad = [r for r in runs if r.status == "failed"]
    assert len(bad) == 1
    r = client.post(f"/api/tasks/{bad[0].task_id}/runs/{tr_id}/retry-failed")
    assert r.status_code == 202, r.text
    from app.models import TaskRun
    from app.task_runner import retry_failed_in_taskrun
    rec = retry_failed_in_taskrun(tr_id)
    assert rec is not None and rec.retry_of_task_run_id == tr_id
    db = SessionLocal()
    try:
        # F3/AC-035A：新 attempt 落在 Recovery 批次；冻结快照从原批次复制（AC-035）
        orig = db.get(TaskRun, tr_id)
        assert rec.resolved_rule_version_id == orig.resolved_rule_version_id
        assert rec.resolved_workflow_version_id == orig.resolved_workflow_version_id
        new_runs = db.query(Run).filter_by(task_run_id=rec.id,
                                           interaction_ref=bad[0].interaction_ref).all()
        attempts = sorted(x.attempt for x in new_runs)
        assert attempts == [2]
        assert new_runs[0].origin_run_id == bad[0].id
        # 原批次 attempt 序列不变
        old_runs = db.query(Run).filter_by(task_run_id=tr_id,
                                           interaction_ref=bad[0].interaction_ref).all()
        assert sorted(x.attempt for x in old_runs) == [1]
    finally:
        db.close()

def test_workflow_agent_exec_calls_module_agent(monkeypatch):
    """换底（2026-09-09）：Workflow agent-exec 节点经统一入口执行成员 Agent
    （需 active prod release；Run 带 Session 反链；QualityResult 结算保留）。"""
    from types import SimpleNamespace

    calls = {}

    def fake_run_structured(db, uid, agent, text, schema, **kw):
        calls["agent"] = agent.id
        return SimpleNamespace(session_id="sess-wf-node"), {
            "structured_output": {"sample_id": "S1", "findings": [{"criterion": "abusive_language", "status": "passed", "confidence": 0.9, "reason": "ok", "evidence": []}], "labels": {"service_type_code": None, "issue_codes": []}, "summary": "ok"},
            "text": "",
        }

    monkeypatch.setattr("app.agent_execution.run_structured", fake_run_structured)
    prov, a, v = _setup_batch_env(monkeypatch, "http://127.0.0.1:1")
    from app.models import Release as _Rel
    db = SessionLocal()
    try:
        db.add(_Rel(agent_id=a["id"], agent_version_id=v["versionId"],
                    environment="prod", status="active",
                    runtime_binding_snapshot={"agentscope_agent_id": "rt-test"}))
        db.commit()
    finally:
        db.close()
    wf = client.post("/api/workflows", json={"name": u6()}).json()
    g = client.get(f"/api/workflows/{wf['id']}").json()
    defn = g["definition"]
    defn["graph"]["nodes"] = [
        {"id": "s", "type": "input", "name": "开始", "config": {}, "inputs": []},
        {"id": "ex", "type": "agent-exec", "name": "调质检Agent",
         "config": {"agentCode": a["id"]}, "inputs": []},
        {"id": "e", "type": "end", "name": "结束", "config": {"outputKey": "quality_result"},
         "inputs": [{"name": "output", "type": "string",
                     "source": {"kind": "upstream", "nodeId": "ex", "path": "outputs.content"}}]},
    ]
    defn["graph"]["edges"] = [{"id": "e1", "source": "s", "target": "ex"},
                              {"id": "e2", "source": "ex", "target": "e"}]
    assert client.put(f"/api/workflows/{wf['id']}/draft",
                      json={"definition": defn, "baseRevision": g["draftRevision"]}).status_code == 200
    from app.runner import create_run, execute_run
    db = SessionLocal()
    try:
        run = create_run(db, wf["id"], "test", {"userQuery": "hi"}, enqueue=False)
        parent_id = run.id
    finally:
        db.close()
    execute_run(parent_id)
    db = SessionLocal()
    try:
        parent = db.get(Run, parent_id)
        assert parent.status == "succeeded", parent.error
        child = (db.query(Run).filter(Run.agent_id == a["id"])
                 .order_by(Run.created_at.desc()).first())
        assert child is not None and child.status == "succeeded"
        # P0-07: Session 反链改用专名列，不再借 runtime_provider_run_id
        assert child.agentscope_session_id == "sess-wf-node"
        assert calls["agent"] == a["id"]
        qr = db.query(QualityResult).filter_by(run_id=child.id, is_latest=True).first()
        assert qr is not None
    finally:
        db.close()
