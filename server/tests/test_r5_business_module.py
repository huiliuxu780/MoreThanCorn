"""R5（SDD 10 §17 R5）：新增领域 Module——business-analysis（只读）。

- Registry 自动发现双 Module（quality-analysis + business-analysis），启动 fail-fast 校验通过；
- business-analysis Agent 创建/发布/Release 绑定/运行闭环（fake provider 产出 schema 合法输出）；
- 只读 Module 不写 QualityResult（领域结果走各自 Mapper，R5+ 落地）。
"""
import threading
import time

import uvicorn
from fastapi.testclient import TestClient

from app.agent_modules import registry as module_registry
from app.db import SessionLocal
from app.main import app
from app.models import QualityResult, Run
from app.task_runner import execute_task_run, start_task_run
from tests._quality_setup import make_asset, make_definition_version, make_rule_version
from tests.test_r1_runtime_providers import FakeProvider, patch_gateway
from tests.test_r2_agent_modules import (_model_key, _seed_tools, make_provider, publish_version)

client = TestClient(app)


class BusinessFake(FakeProvider):
    """提交即 succeeded，输出符合 business_analysis output Schema（通话业务打标）。"""

    def __init__(self):
        super().__init__()
        self.auto_succeed = True
        self.output_builder = lambda run_id, entry: {
            "sample_id": str((entry.get("request", {}).get("input") or {}).get("sample_id") or run_id),
            "service_type_code": "REPAIR",
            "customer_intents": [{"intent": "故障报修", "description": "设备故障，要求上门检修"}],
            "business_outcome": "pending",
            "follow_ups": [{"action": "安排上门检修", "reason": "已受理报修，需落实"}],
            "summary": "客户报修设备故障，坐席受理并安排上门检修。"}


def test_registry_discovers_two_modules():
    keys = {m.key for m in module_registry.all_modules()}
    assert {"quality-analysis", "business-analysis"} <= keys
    biz = module_registry.get("business-analysis", "1.0.0")
    assert biz.manifest["riskClass"] == "read-only"
    # 通话业务打标为纯通话理解，不依赖企业工具
    assert biz.logical_tools == []
    # 目录端点暴露双 Module
    r = client.get("/api/agents/modules").json()
    assert {m["key"] for m in r["items"]} >= {"quality-analysis", "business-analysis"}


def test_business_module_readonly_run_no_quality_result(monkeypatch):
    fake = BusinessFake()
    server = uvicorn.Server(uvicorn.Config(fake.app(), host="127.0.0.1", port=0, log_level="error"))
    threading.Thread(target=server.run, daemon=True).start()
    deadline = time.time() + 10
    while not server.started and time.time() < deadline:
        time.sleep(0.05)
    base_url = f"http://127.0.0.1:{server.servers[0].sockets[0].getsockname()[1]}"
    try:
        monkeypatch.setattr("app.runtime_providers.dispatcher.DEFAULT_RUNTIME_TIMEOUT_SECONDS", 20)
        patch_gateway(monkeypatch, base_url)
        _seed_tools()
        prov = make_provider("agentscope", base_url)
        r = client.post("/api/agents", json={"name": "经营分析", "moduleKey": "business-analysis",
                                             "moduleVersion": "1.0.0",
                                             "modelRef": {"modelId": _model_key(), "provider": "openai-compatible"}})
        assert r.status_code == 201, r.text
        aid = r.json()["id"]
        v = publish_version(aid)
        assert client.post(f"/api/agents/{aid}/releases", json={
            "versionId": v["versionId"], "environment": "sandbox",
            "runtimeProviderId": prov["id"]}).status_code == 201
        # 批次闭环（通话资产，仅验证分派/结果事务分流）
        asset = make_asset(client, [{"interactionId": "B1", "sample_id": "B1", "call_id": "acid-B1",
                                     "conversation": [{"sequence": 0, "speaker": "customer",
                                                       "text": "设备坏了，需要上门检修"}]}])
        defv = make_definition_version(client, asset)
        rulev = make_rule_version(client)
        t = client.post("/api/tasks", json={
            "name": "R5-biz", "executionTarget": {"type": "agent", "agentId": aid,
                                                 "versionPolicy": "latest_sandbox_release"},
            "dataAssetId": asset, "dataDefinitionVersionId": defv,
            "resultRuleVersionId": rulev,
            "inputMapping": {"sample_id": "sample_id", "call_id": "call_id",
                             "conversation": "conversation"},
            "sampling": {"mode": "all"}, "dataWindow": {"mode": "all"}}).json()
        db = SessionLocal()
        try:
            tr, _ = start_task_run(db, t["id"], trigger="manual")
            tr_id = tr.id
            db.commit()
        finally:
            db.close()
        execute_task_run(tr_id)
        db = SessionLocal()
        try:
            run = db.query(Run).filter_by(task_run_id=tr_id).first()
            assert run.status == "succeeded", run.error
            assert (run.output or {}).get("summary")
            assert (run.output or {}).get("service_type_code") == "REPAIR"
            # 只读 business Module 不写 QualityResult
            assert db.query(QualityResult).filter_by(run_id=run.id).count() == 0
        finally:
            db.close()
    finally:
        server.should_exit = True
