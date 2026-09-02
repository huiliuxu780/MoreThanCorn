"""SDD-14 OAI-R3：OpenAI Agents Provider 平台绑定验收。

- POC-G01：kind=openai-agents Provider 可注册、可启用，未知 kind 仍拒绝；
- POC-G03：quality-analysis Module 声明 openai-agents 实现；
- POC-G04：sandbox Release 可绑定 OpenAI Runtime（1:1 口径不变）；
- §42 公共请求一致性：同一 Module 资产经不同 Provider 下发，agent 段（除 run 标识外）一致；
- §58 平台集成：Task → TaskRun → Run → Run.output 经 openai-agents Provider 全链路。
"""
import hashlib
import json
import threading
import time
import uuid

import pytest
import uvicorn
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.models import QualityResult, Release, Run, TaskRun
from app.task_runner import execute_task_run, start_task_run
from tests._quality_setup import make_asset, make_definition_version, make_rule_version
from tests.test_r1_runtime_providers import QualityFake, patch_gateway
from tests.test_r2_agent_modules import (_seed_tools, drive_submit, get_run_row,
                                         make_module_agent, make_provider, publish_version)

client = TestClient(app)


@pytest.fixture(scope="module")
def fake_server_sdd14():
    fake = QualityFake()
    server = uvicorn.Server(uvicorn.Config(fake.app(), host="127.0.0.1", port=0,
                                           log_level="error"))
    threading.Thread(target=server.run, daemon=True).start()
    deadline = time.time() + 10
    while not server.started and time.time() < deadline:
        time.sleep(0.05)
    assert server.started, "fake runtime server failed to start"
    port = server.servers[0].sockets[0].getsockname()[1]
    yield fake, f"http://127.0.0.1:{port}"
    server.should_exit = True


def test_poc_g01_openai_agents_provider_registers():
    pid = f"rp-oai-{uuid.uuid4().hex[:8]}"
    r = client.post("/api/runtime-providers", json={
        "id": pid, "name": "OpenAI Agents POC", "kind": "openai-agents",
        "baseUrl": "http://127.0.0.1:8303"})
    assert r.status_code == 201, r.text
    r2 = client.put(f"/api/runtime-providers/{pid}", json={"status": "enabled"})
    assert r2.status_code == 200
    assert r2.json()["kind"] == "openai-agents"
    # 未知 kind 仍然失败关闭
    r3 = client.post("/api/runtime-providers", json={
        "id": f"rp-x-{uuid.uuid4().hex[:6]}", "name": "X", "kind": "openai",
        "baseUrl": "http://x"})
    assert r3.status_code == 422


def test_poc_g03_module_declares_openai_agents_implementation():
    from app.agent_modules import registry as module_registry
    mod = module_registry.get("quality-analysis", "1.0.0")
    impl = mod.resolve_implementation("openai-agents")
    assert impl["version"] == "0.1.0"
    assert impl["entry"] == "native_quality_v0.2"


def test_poc_g04_release_binds_openai_runtime_one_provider_per_agent():
    _seed_tools()
    prov = make_provider("openai-agents", "http://fake-runtime")
    a = make_module_agent()
    v = publish_version(a["id"])
    r = client.post(f"/api/agents/{a['id']}/releases", json={
        "versionId": v["versionId"], "environment": "sandbox",
        "runtimeProviderId": prov["id"]})
    assert r.status_code == 201, r.text
    db = SessionLocal()
    try:
        rel = (db.query(Release).filter_by(agent_id=a["id"], status="active")
               .order_by(Release.created_at.desc()).first())
        snap = rel.runtime_binding_snapshot or {}
        assert rel.runtime_provider_id == prov["id"]
        assert snap["providerKind"] == "openai-agents"
        assert snap["module"] == {"key": "quality-analysis", "version": "1.0.0"}
        assert snap["moduleImplementation"]["entry"] == "native_quality_v0.2"
        assert snap["moduleImplementation"]["version"] == "0.1.0"
        assert len(snap["outputSchemaSha256"]) == 64
    finally:
        db.close()
    # 1:1 口径保持：该 Agent 再绑定其它 kind Provider → 409
    prov_as = make_provider("agentscope", "http://fake-runtime")
    r_x = client.post(f"/api/agents/{a['id']}/releases", json={
        "versionId": v["versionId"], "environment": "sandbox",
        "runtimeProviderId": prov_as["id"]})
    assert r_x.status_code == 409 and "ONE_PROVIDER_PER_AGENT" in r_x.text


def _agent_segment(body: dict) -> dict:
    """agent 段去除 run 级标识（spec.id=agent_id），保留 Provider 间必须一致的契约字段。"""
    segment = dict(body["agent"])
    segment.pop("id", None)
    return segment


def test_module_run_dispatch_same_spec_across_openai_and_agentscope(monkeypatch,
                                                                    fake_server_sdd14):
    """§42：同一 Module 资产下发给 openai-agents 与 agentscope，公共请求体一致。"""
    fake, base_url = fake_server_sdd14
    fake.auto_succeed = True
    patch_gateway(monkeypatch, base_url)
    _seed_tools()
    prov_oai = make_provider("openai-agents", base_url)
    prov_as = make_provider("agentscope", base_url)

    a_oai = make_module_agent()
    v_oai = publish_version(a_oai["id"])
    assert client.post(f"/api/agents/{a_oai['id']}/releases", json={
        "versionId": v_oai["versionId"], "environment": "sandbox",
        "runtimeProviderId": prov_oai["id"]}).status_code == 201
    a_as = make_module_agent()
    v_as = publish_version(a_as["id"])
    assert client.post(f"/api/agents/{a_as['id']}/releases", json={
        "versionId": v_as["versionId"], "environment": "sandbox",
        "runtimeProviderId": prov_as["id"]}).status_code == 201

    r1 = client.post(f"/api/agents/{a_oai['id']}/run",
                     json={"input": {"sample_id": "S1", "dialogues": []}, "trigger": "api"})
    assert r1.status_code == 202, r1.text
    run_oai = r1.json()["runId"]
    drive_submit(run_oai)
    r2 = client.post(f"/api/agents/{a_as['id']}/run",
                     json={"input": {"sample_id": "S1", "dialogues": []}, "trigger": "api"})
    assert r2.status_code == 202, r2.text
    run_as = r2.json()["runId"]
    drive_submit(run_as)

    assert get_run_row(run_oai).runtime_provider_id == prov_oai["id"]
    assert get_run_row(run_as).runtime_provider_id == prov_as["id"]
    req_oai = fake.runs[run_oai]["request"]
    req_as = fake.runs[run_as]["request"]
    # 路由前提：两 Provider 都收到 workflowMode 标记（native 工作流入口）
    assert req_oai["context"]["metadata"]["workflowMode"] == "native_quality_v0.2"
    assert req_as["context"]["metadata"]["workflowMode"] == "native_quality_v0.2"
    # 公共请求一致性：agent 段（除 run 级 id 外）逐字段一致
    assert _agent_segment(req_oai) == _agent_segment(req_as)
    assert {t["name"] for t in req_oai["agent"]["tools"]} == {
        "knowledge_search", "ticket_query", "sms_query", "appointment_query"}


def test_openai_provider_batch_task_end_to_end(monkeypatch, fake_server_sdd14):
    """§58：openai-agents Provider 的完整 Task 链路（批次同步执行）。"""
    fake, base_url = fake_server_sdd14
    monkeypatch.setattr("app.runtime_providers.dispatcher.DEFAULT_RUNTIME_TIMEOUT_SECONDS", 20)
    fake.auto_succeed = True
    patch_gateway(monkeypatch, base_url)
    _seed_tools()
    prov = make_provider("openai-agents", base_url)
    a = make_module_agent()
    v = publish_version(a["id"])
    r = client.post(f"/api/agents/{a['id']}/releases", json={
        "versionId": v["versionId"], "environment": "sandbox",
        "runtimeProviderId": prov["id"]})
    assert r.status_code == 201, r.text

    rows = [{"interactionId": f"OAI{i}", "sample_id": f"OAI{i}", "dialogues": []}
            for i in (1, 2)]
    asset = make_asset(client, rows)
    defv = make_definition_version(client, asset)
    rulev = make_rule_version(client)
    body = {"name": f"SDD14-{uuid.uuid4().hex[:6]}",
            "executionTarget": {"type": "agent", "agentId": a["id"],
                                "versionPolicy": "latest_sandbox_release"},
            "dataAssetId": asset, "dataDefinitionVersionId": defv,
            "resultRuleVersionId": rulev,
            "inputMapping": {"sample_id": "sample_id", "call_id": "call_id",
                             "conversation": "conversation"},
            "sampling": {"mode": "all"}, "dataWindow": {"mode": "all"}}
    t = client.post("/api/tasks", json=body)
    assert t.status_code == 201, t.text

    db = SessionLocal()
    try:
        tr, resolved = start_task_run(db, t.json()["id"], trigger="manual")
        tr_id = tr.id
        db.commit()
    finally:
        db.close()
    assert resolved["executionTarget"] == "agent"
    assert resolved["agentVersionId"] == v["versionId"]
    execute_task_run(tr_id)

    db = SessionLocal()
    try:
        tr = db.get(TaskRun, tr_id)
        assert tr.status == "succeeded", tr.error_summary
        assert tr.succeeded_count == 2
        assert tr.resolved_agent_version_id == v["versionId"]
        assert tr.resolved_release_id and tr.runtime_binding_snapshot
        runs = db.query(Run).filter_by(task_run_id=tr_id).order_by(Run.interaction_ref).all()
        assert len(runs) == 2
        for run in runs:
            assert run.status == "succeeded"
            assert run.runtime_provider_id == prov["id"]
            assert run.output is not None
            req = fake.runs[run.id]["request"]
            assert req["context"]["metadata"]["workflowMode"] == "native_quality_v0.2"
            results = (db.query(QualityResult)
                       .filter_by(run_id=run.id, is_latest=True).all())
            assert len(results) == 1, "一条 Interaction 恰好一条生效结果"
            assert results[0].agent_version_id == v["versionId"]
            assert results[0].rule_version_id == rulev
    finally:
        db.close()
