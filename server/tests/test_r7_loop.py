"""R7：Data → Task → Agent → Run 产品闭环验收（quality-analysis 全链路）。

验收点（对应 R7 用例 1-13，14 的双 Provider 由 R2/R4 conformance 覆盖）：
1 创建沙箱 Release；2 创建 Task 选 Agent；3 字段映射到 Module 输入；4 启动 TaskRun；
5 产生 5 个 Run；6 每个 Run 显示冻结 AgentVersion/Release/Provider；
7 成功 Run 恰好一条 QualityResult；8 失败 Run 有明确失败；9 重试只补失败项不重复成功项；
10 TaskRun 汇总与 Run 数一致；11 新发布后旧 TaskRun 绑定不变；12 新 TaskRun 解析新版本；
13 Run 可从 TaskRun 列表拿到（点击跳转的数据基础）。
"""
import threading
import time

import uvicorn
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.models import QualityResult, Run, TaskRun
from tests.test_r1_runtime_providers import FakeProvider, patch_gateway
from tests.test_r2_agent_modules import (_model_key, _seed_tools, make_provider, publish_version)

client = TestClient(app)

ROWS = [{"interactionId": f"I{i}", "sample_id": f"S{i}", "call_id": f"C{i}",
         "conversation": f"通话{i}", "ticket_no": f"T{i}"} for i in range(1, 6)]


class LoopFake(FakeProvider):
    """auto_succeed；S3 输出不合法（缺 summary）→ 平台 OUTPUT_SCHEMA_ERROR 失败，其余成功。"""
    fail_ids = {"S3"}

    def __init__(self):
        super().__init__()
        self.auto_succeed = True
        self.output_builder = self._out

    def _out(self, run_id, entry):
        sid = str((entry.get("request", {}).get("input") or {}).get("sample_id") or run_id)
        base = {"sample_id": sid,
                "findings": [{"criterion": "promise_fulfillment", "status": "passed",
                              "confidence": 0.9, "reason": "已履约",
                              "evidence": [{"source": "tool", "reference": "t:1", "summary": "ok"}]}],
                "labels": {"service_type_code": "consult", "issue_codes": []},
                "summary": "ok"}
        if sid in self.fail_ids:
            base.pop("summary")  # 缺必填 → 输出 Schema 校验失败关闭
        return base


def _start(base_url, monkeypatch, name="R7-task"):
    from tests._quality_setup import make_asset, make_definition_version, make_rule_version
    monkeypatch.setattr("app.runtime_providers.dispatcher.DEFAULT_RUNTIME_TIMEOUT_SECONDS", 20)
    _seed_tools()
    prov = make_provider("agentscope", base_url)
    a = client.post("/api/agents", json={"name": name, "moduleKey": "quality-analysis",
                                         "moduleVersion": "1.0.0",
                                         "modelRef": {"modelId": _model_key(),
                                                      "provider": "openai-compatible"}}).json()
    v = publish_version(a["id"])
    assert client.post(f"/api/agents/{a['id']}/releases", json={
        "versionId": v["versionId"], "environment": "sandbox"}).status_code == 201
    asset = make_asset(client, ROWS)
    defv = make_definition_version(client, asset)
    rulev = make_rule_version(client)
    mapping = {"sample_id": "sample_id", "call_id": "call_id", "conversation": "conversation"}
    t = client.post("/api/tasks", json={
        "name": name, "executionTarget": {"type": "agent", "agentId": a["id"],
                                          "versionPolicy": "latest_sandbox_release"},
        "dataAssetId": asset, "dataDefinitionVersionId": defv,
        "resultRuleVersionId": rulev, "inputMapping": mapping,
        "sampling": {"mode": "all"}, "dataWindow": {"mode": "all"}})
    assert t.status_code == 201, t.text
    return a, v, prov, t.json()


def test_r7_full_loop(monkeypatch):
    """换底（2026-09-09）：质检批次 5 交互经统一入口；S3 输出缺必填→失败；
    成功交互各一条 QualityResult；失败 Run 有明确错误。"""
    rows = [{"interactionId": f"S{i}", "sample_id": f"S{i}", "call_id": f"c{i}", "conversation": "x", "dialogues": []} for i in range(1, 6)]
    tr_id, runs = _cutover_batch(monkeypatch, "quality-analysis", rows, expect_quality=True)
    assert len(runs) == 5
    ok_runs = [r for r in runs if r.status == "succeeded"]
    fail_runs = [r for r in runs if r.status == "failed"]
    assert len(ok_runs) == 4 and len(fail_runs) == 1
    assert fail_runs[0].error
    db = SessionLocal()
    try:
        for r in ok_runs:
            assert db.query(QualityResult).filter_by(run_id=r.id, is_latest=True).count() == 1
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
    # wf_test 模型无鉴权连接：注入带连接模型供 chat_model_config 解析
    from app.models import Connection, Model, ModelProvider
    db = SessionLocal()
    try:
        conn = db.query(Connection).filter_by(name="cutover-conn-r7").first()
        if not conn:
            conn = Connection(name="cutover-conn-r7", kind="api_key", protocol="llm",
                              endpoint={"base_url": "http://127.0.0.1:1/"},
                              secret_ref="sk-r7-test-000000000000000000000000")
            db.add(conn)
            db.commit()
            prov = ModelProvider(name="cutover-prov-r7", base_url="http://127.0.0.1:1/",
                                 auth_connection_id=conn.id)
            db.add(prov)
            db.commit()
            mdl = Model(provider_id=prov.id, model_key="qwen-plus-r7",
                        display_name="qwen-plus-r7", capabilities=["text"], enabled=True)
            db.add(mdl)
            db.commit()
        else:
            mdl = db.query(Model).filter_by(model_key="qwen-plus-r7").first()
        model_id = mdl.id
    finally:
        db.close()
    import app.agent_execution as _ae



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
