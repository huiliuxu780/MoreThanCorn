"""R5/R6（SDD 10 §9.2）：ticket-automation 写型 Module 骨架（只读验证，不接真实写操作）。

- Registry 发现三 Module（quality/business/ticket）；
- ticket Agent 创建/发布/Release 绑定/运行闭环（fake provider 产出 schema 合法 action-ledger）；
- 写型策略字段强制：每个写动作带 idempotency_key + side_effect_verified（Schema 强制）；
- 写型 Module 不写 QualityResult（领域结果=ActionLedger，R6+ 落地）。
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


class TicketFake(FakeProvider):
    """提交即 succeeded，输出符合 ticket_automation output Schema（写动作带幂等+核验）。"""

    def __init__(self):
        super().__init__()
        self.auto_succeed = True
        self.output_builder = lambda run_id, entry: {
            "ticket_id": str((entry.get("request", {}).get("input") or {}).get("ticket_id") or run_id),
            "decision": "handled",
            "actions": [
                {"action_id": "update_tag", "tool": "ticket_update", "effect": "write-reversible",
                 "idempotency_key": f"idem-{run_id}-1", "executed": True,
                 "side_effect_verified": True, "requiresApproval": False, "compensation": "record"},
            ]}


def test_registry_discovers_three_modules():
    keys = {m.key for m in module_registry.all_modules()}
    assert {"quality-analysis", "business-analysis", "ticket-automation"} <= keys
    t = module_registry.get("ticket-automation", "1.0.0")
    assert t.manifest["riskClass"] == "write"
    effects = {x["name"]: x["effect"] for x in t.logical_tools}
    assert effects["ticket_query"] == "read"
    assert effects["ticket_close"] == "write-irreversible"
    r = client.get("/api/agents/modules").json()
    assert {m["key"] for m in r["items"]} >= {"quality-analysis", "business-analysis", "ticket-automation"}


def test_ticket_write_policy_fields_and_no_quality_result(monkeypatch):
    fake = TicketFake()
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
        for tn in ("ticket_query", "ticket_update", "ticket_close"):
            client.post("/api/ai-resources/tools", json={"name": tn, "kind": "builtin",
                                                        "spec": {"kind": "echo"}, "tested": True})
        prov = make_provider("agentscope", base_url)
        r = client.post("/api/agents", json={"name": "退款工单", "moduleKey": "ticket-automation",
                                             "moduleVersion": "1.0.0",
                                             "modelRef": {"modelId": _model_key(), "provider": "openai-compatible"}})
        assert r.status_code == 201, r.text
        aid = r.json()["id"]
        v = publish_version(aid)
        assert client.post(f"/api/agents/{aid}/releases", json={
            "versionId": v["versionId"], "environment": "sandbox",
            "runtimeProviderId": prov["id"]}).status_code == 201
        asset = make_asset(client, [{"interactionId": "T1", "ticket_id": "TK-1"}])
        defv = make_definition_version(client, asset)
        rulev = make_rule_version(client)
        t = client.post("/api/tasks", json={
            "name": "R6-ticket", "executionTarget": {"type": "agent", "agentId": aid,
                                                    "versionPolicy": "latest_sandbox_release"},
            "dataAssetId": asset, "dataDefinitionVersionId": defv,
            "resultRuleVersionId": rulev, "inputMapping": {"ticket_id": "ticket_id"},
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
            out = run.output or {}
            # 写型策略字段强制（Schema 已保证存在，这里断言语义）
            for a in out.get("actions", []):
                assert a.get("idempotency_key"), "写动作必须带平台幂等键"
                assert a.get("side_effect_verified") is True, "执行后必须核验副作用"
            # 写型 Module 不写 QualityResult
            assert db.query(QualityResult).filter_by(run_id=run.id).count() == 0
        finally:
            db.close()
    finally:
        server.should_exit = True
