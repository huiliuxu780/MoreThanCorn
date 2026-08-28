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
    server = uvicorn.Server(uvicorn.Config(fake.app(), host="127.0.0.1", port=0,
                                           log_level="error"))
    threading.Thread(target=server.run, daemon=True).start()
    deadline = time.time() + 10
    while not server.started and time.time() < deadline:
        time.sleep(0.05)
    assert server.started
    port = server.servers[0].sockets[0].getsockname()[1]
    yield fake, f"http://127.0.0.1:{port}"
    server.should_exit = True


def _make_agent_task(aid, asset_id, defv, rulev, **extra) -> dict:
    body = {"name": f"R3T-{uuid.uuid4().hex[:6]}",
            "executionTarget": {"type": "agent", "agentId": aid,
                                "versionPolicy": "latest_sandbox_release"},
            "dataAssetId": asset_id, "dataDefinitionVersionId": defv,
            "resultRuleVersionId": rulev, "inputMapping": {},
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
    r = client.post(f"/api/agents/{a['id']}/releases", json={
        "versionId": v["versionId"], "environment": "sandbox",
        "runtimeProviderId": prov["id"]})
    assert r.status_code == 201, r.text
    return prov, a, v


def test_batch_agent_task_end_to_end(monkeypatch, fake_server_r3):
    fake, base_url = fake_server_r3
    prov, a, v = _setup_batch_env(monkeypatch, base_url, fake=fake)
    rows = [{"interactionId": f"S{i}", "sample_id": f"S{i}", "dialogues": []}
            for i in (1, 2)]
    asset = make_asset(client, rows)
    defv = make_definition_version(client, asset)
    rulev = make_rule_version(client)
    t = _make_agent_task(a["id"], asset, defv, rulev)

    db = SessionLocal()
    try:
        tr, resolved = start_task_run(db, t["id"], trigger="manual")
        tr_id = tr.id
        db.commit()
    finally:
        db.close()
    assert resolved["executionTarget"] == "agent" and resolved["agentVersionId"] == v["versionId"]
    execute_task_run(tr_id)
    db = SessionLocal()
    try:
        tr = db.get(TaskRun, tr_id)
        assert tr.status == "succeeded", tr.error_summary
        assert tr.succeeded_count == 2
        # 冻结快照不漂移
        assert tr.resolved_agent_version_id == v["versionId"]
        assert tr.resolved_release_id and tr.runtime_binding_snapshot
        runs = db.query(Run).filter_by(task_run_id=tr_id).order_by(Run.interaction_ref).all()
        assert len(runs) == 2
        for run in runs:
            assert run.status == "succeeded" and run.agent_id == a["id"]
            assert run.agent_version_id == v["versionId"]
            assert run.runtime_provider_id == prov["id"]
            results = (db.query(QualityResult)
                       .filter_by(run_id=run.id, is_latest=True).all())
            assert len(results) == 1, "一条 Interaction 恰好一条生效结果"
            qr = results[0]
            assert qr.agent_version_id == v["versionId"]
            assert qr.rule_version_id == rulev
            assert qr.derived_result and qr.score == 100  # 空规则集：平台派生而非 Agent 给分
            assert db.get(AgentVersion, qr.agent_version_id) is not None
            assert fake.runs[run.id]["request"]["context"]["metadata"]["workflowMode"]
        # exactly-once：重复结算不产生第二条；CallRecord 由 model/tool 结束事件映射
        from datetime import datetime, timezone
        from quality_runtime_contract import TraceEvent
        run0 = runs[0]
        state_stub = type("S", (), {"trace": [
            TraceEvent(sequence=5, timestamp=datetime.now(timezone.utc),
                       type="ModelCallEndEvent", name="m",
                       metadata={"input_tokens": 3, "output_tokens": 4}),
            TraceEvent(sequence=6, timestamp=datetime.now(timezone.utc),
                       type="ToolCallEndEvent", name="knowledge_search")]})()
        rt_worker._settle_module_result(db, run0, state_stub)
        assert db.query(QualityResult).filter_by(run_id=run0.id, is_latest=True).count() == 1
        kinds = {c.kind for c in db.query(CallRecord).filter_by(run_id=run0.id).all()}
        assert {"model", "tool"} <= kinds
    finally:
        db.close()


def test_batch_retry_uses_frozen_snapshot(monkeypatch, fake_server_r3):
    fake, base_url = fake_server_r3
    prov, a, v = _setup_batch_env(monkeypatch, base_url, fake=fake)
    rows = [{"interactionId": "R1", "sample_id": "R1", "dialogues": []}]
    asset = make_asset(client, rows)
    defv = make_definition_version(client, asset)
    rulev = make_rule_version(client)
    t = _make_agent_task(a["id"], asset, defv, rulev)
    db = SessionLocal()
    try:
        tr, _ = start_task_run(db, t["id"], trigger="manual")
        tr_id = tr.id
        db.commit()
    finally:
        db.close()
    # 注入一次提交失败 → Run 失败 → 批次 failed
    fake.fail_status = 500
    execute_task_run(tr_id)
    db = SessionLocal()
    try:
        tr = db.get(TaskRun, tr_id)
        assert tr.status == "failed"
    finally:
        db.close()
    # 重试：沿用冻结快照（resolved_agent_version/release 不变）→ 成功重汇
    retry_failed_in_taskrun(tr_id)
    db = SessionLocal()
    try:
        tr = db.get(TaskRun, tr_id)
        db.refresh(tr)
        assert tr.status == "succeeded", tr.error_summary
        assert tr.resolved_agent_version_id == v["versionId"]
        assert tr.resolved_release_id
        results = db.query(QualityResult).filter(QualityResult.run_id.in_(
            [r.id for r in db.query(Run).filter_by(task_run_id=tr_id).all()])).all()
        assert all(q.agent_version_id == v["versionId"] for q in results)
    finally:
        db.close()


def test_workflow_agent_exec_calls_module_agent(monkeypatch, fake_server_r3):
    """R3-5：父 Workflow Run → agent-exec NodeRun → 子 Module Agent Run（同步、阶段不造假 NodeRun）。"""
    fake, base_url = fake_server_r3
    prov, a, v = _setup_batch_env(monkeypatch, base_url, fake=fake)
    # 独立工作流：start → agent-exec(引用 Module Agent) → end
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
        assert child.runtime_provider_id == prov["id"]
        assert child.agent_version_id == v["versionId"]
        qr = db.query(QualityResult).filter_by(run_id=child.id, is_latest=True).first()
        assert qr is not None and qr.agent_version_id == v["versionId"]
        # 领域阶段不造假平台 NodeRun：子 Run 无 node_run
        from app.models import NodeRun
        assert db.query(NodeRun).filter_by(run_id=child.id).count() == 0
    finally:
        db.close()
