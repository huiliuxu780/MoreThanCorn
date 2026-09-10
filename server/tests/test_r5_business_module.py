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
    """提交即 succeeded，输出符合 business_analysis output Schema。"""

    def __init__(self):
        super().__init__()
        self.auto_succeed = True
        self.output_builder = lambda run_id, entry: {
            "question_id": str((entry.get("request", {}).get("input") or {}).get("question_id") or run_id),
            "answer": "近 7 日热线接通率为 86.4%，环比 +1.2pct。",
            "metrics": [{"metric": "connect_rate", "value": 86.4, "unit": "%"}],
            "citations": [{"source": "metric_query", "reference": "metric:connect_rate:2026-08-22..2026-08-28",
                           "summary": "日粒度接通率聚合"}],
            "confidence": 0.9}


def test_registry_discovers_two_modules():
    keys = {m.key for m in module_registry.all_modules()}
    assert {"quality-analysis", "business-analysis"} <= keys
    biz = module_registry.get("business-analysis", "1.0.0")
    assert biz.manifest["riskClass"] == "read-only"
    assert {t["name"] for t in biz.logical_tools} == {"metric_query", "dimension_query"}
    # 目录端点暴露双 Module
    r = client.get("/api/agents/modules").json()
    assert {m["key"] for m in r["items"]} >= {"quality-analysis", "business-analysis"}


def test_business_module_readonly_run_no_quality_result(monkeypatch):
    """换底（2026-09-09）：business 批次经统一入口；只读 Module 不写 QualityResult。"""
    tr_id, runs = _cutover_batch(
        monkeypatch, "business-analysis",
        [{"interactionId": "B1", "sample_id": "B1", "call_id": "c1", "conversation": "x", "question_id": "q1"}], expect_quality=False)
    assert len(runs) == 1
    assert runs[0].status == "succeeded", runs[0].error
    assert (runs[0].output or {}).get("answer")
    db = SessionLocal()
    try:
        assert db.query(QualityResult).filter_by(run_id=runs[0].id).count() == 0
    finally:
        db.close()


def _patch_module_structured(monkeypatch, module_key: str):
    import json as _j
    from app import agentscope_client as _rt

    def fake_structured(*a, **kw):
        text = a[2] if len(a) > 2 else kw.get("input_text", "")
        try:
            payload = _j.loads(text)
        except Exception:  # noqa: BLE001
            payload = {}
        sid = str(payload.get("sample_id") or payload.get("interactionId")
                  or payload.get("question_id") or payload.get("ticket_id") or "x")
        if module_key == "business-analysis":
            out = {
                "question_id": str(payload.get("question_id") or "q1"),
                "answer": "近 7 日热线接通率为 86.4%，环比 +1.2pct。",
                "metrics": [{"metric": "connect_rate", "value": 86.4, "unit": "%"}],
                "citations": [{"source": "metric_query",
                               "reference": "metric:connect_rate:2026-08-22..2026-08-28",
                               "summary": "日粒度接通率聚合"}],
                "confidence": 0.9,
            }
        elif module_key == "ticket-automation":
            out = {
                "ticket_id": str(payload.get("ticket_id") or "TK-1"),
                "decision": "handled",
                "actions": [{"action_id": "update_tag", "tool": "ticket_update",
                             "effect": "write-reversible",
                             "idempotency_key": "idem-x-1", "executed": True,
                             "side_effect_verified": True,
                             "requiresApproval": False, "compensation": "record"}],
            }
        else:
            sid = str(payload.get("sample_id") or payload.get("interactionId") or "S1")
            out = {"sample_id": sid,
                   "findings": [{"criterion": "promise_fulfillment", "status": "passed",
                                 "confidence": 0.9, "reason": "已履约",
                                 "evidence": [{"source": "tool", "reference": "t:1",
                                               "summary": "ok"}]}],
                   "labels": {"service_type_code": "consult", "issue_codes": []},
                   "summary": "ok"}
            if sid == "S3":
                out.pop("summary")
        return {"structured_output": out, "text": "", "session_id": f"sess-{module_key}"}

    monkeypatch.setattr(_rt, "structured_run", fake_structured)



def _cutover_batch(monkeypatch, module_key: str, rows, expect_quality: bool):
    """换底批测助手：统一入口同步执行；structured_run 与 default_model_id 注入。"""
    import json as _j
    from app import agentscope_client as _rt
    import app.agent_execution as _ae
    from app.models import Connection, Model, ModelProvider
    from app.task_runner import start_task_run, execute_task_run
    from tests._quality_setup import make_asset, make_definition_version, make_rule_version

    def fake_structured(*a, **kw):
        text = a[2] if len(a) > 2 else kw.get("input_text", "")
        try:
            payload = _j.loads(text)
        except Exception:  # noqa: BLE001
            payload = {}
        sid = str(payload.get("sample_id") or payload.get("interactionId")
                  or payload.get("question_id") or payload.get("ticket_id") or "x")
        if module_key == "business-analysis":
            out = {"question_id": str(payload.get("question_id") or "q1"),
                   "answer": "近 7 日热线接通率为 86.4%。",
                   "metrics": [{"metric": "connect_rate", "value": 86.4, "unit": "%"}],
                   "citations": [{"source": "metric_query", "reference": "m:1", "summary": "s"}],
                   "confidence": 0.9}
        elif module_key == "ticket-automation":
            out = {"ticket_id": str(payload.get("ticket_id") or "TK-1"),
                   "decision": "handled",
                   "actions": [{"action_id": "a1", "tool": "ticket_update",
                                "effect": "write-reversible", "idempotency_key": "k1",
                                "executed": True, "side_effect_verified": True,
                                "requiresApproval": False, "compensation": "record"}]}
        else:
            sid = str(payload.get("sample_id") or payload.get("interactionId") or "S1")
            out = {"sample_id": sid,
                   "findings": [{"criterion": "promise_fulfillment", "status": "passed",
                                 "confidence": 0.9, "reason": "ok",
                                 "evidence": [{"source": "tool", "reference": "t:1", "summary": "ok"}]}],
                   "labels": {"service_type_code": "consult", "issue_codes": []},
                   "summary": "ok"}
            if sid == "S3":
                out.pop("summary")
        return {"structured_output": out, "text": "", "session_id": f"sess-{module_key}-{sid}"}

    monkeypatch.setattr(_rt, "structured_run", fake_structured)
    db = SessionLocal()
    try:
        conn = db.query(Connection).filter_by(name=f"cc-{module_key}").first()
        if not conn:
            conn = Connection(name=f"cc-{module_key}", kind="api_key", protocol="llm",
                              endpoint={"base_url": "http://127.0.0.1:1/"},
                              secret_ref="sk-cc-test-00000000000000000000000")
            db.add(conn)
            db.commit()
            prov = ModelProvider(name=f"cp-{module_key}", base_url="http://127.0.0.1:1/",
                                 auth_connection_id=conn.id)
            db.add(prov)
            db.commit()
            mdl = Model(provider_id=prov.id, model_key=f"qm-{module_key}",
                        display_name=f"qm-{module_key}", capabilities=["text"], enabled=True)
            db.add(mdl)
            db.commit()
        else:
            mdl = db.query(Model).filter_by(model_key=f"qm-{module_key}").first()
        model_id = mdl.id
    finally:
        db.close()
    _seed_tools()
    r = client.post("/api/agents", json={"name": f"B-{module_key[:12]}", "moduleKey": module_key,
                                         "moduleVersion": "1.0.0",
                                         "modelRef": {"modelId": _model_key(), "provider": "openai-compatible"}})
    assert r.status_code == 201, r.text
    aid = r.json()["id"]
    v = publish_version(aid)
    rr = client.post(f"/api/agents/{aid}/releases", json={"versionId": v["versionId"], "environment": "sandbox"})
    assert rr.status_code == 201, rr.text
    asset = make_asset(client, rows)
    defv = make_definition_version(client, asset)
    rulev = make_rule_version(client)
    t = client.post("/api/tasks", json={
        "name": f"T-{module_key}", "executionTarget": {"type": "agent", "agentId": aid,
                                                     "versionPolicy": "latest_sandbox_release"},
        "dataAssetId": asset, "dataDefinitionVersionId": defv,
        "resultRuleVersionId": rulev, "inputMapping": {"sample_id": "sample_id", "call_id": "call_id", "conversation": "conversation", "question_id": "question_id", "ticket_id": "ticket_id", "dialogues": "dialogues"},
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
        runs = db.query(Run).filter_by(task_run_id=tr_id).all()
        return tr_id, runs
    finally:
        db.close()
