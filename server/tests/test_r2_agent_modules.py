"""R2（SDD 10）：Agent Module 框架与质检 Module 验收。

- Module Registry（fail-fast / Spec 校验 / Schema 哈希固化）；
- Module Agent 创建（moduleKey；旧三类保持 410）；
- 版本发布冻结 Module+AgentSpec+Schema 哈希+依赖（含新依赖类型）；
- Release Runtime Binding（同一 AgentVersion 分别绑定 AgentScope/DSH sandbox，DSH 走 canary）；
- 运行分派走 R1 worker：请求体来自冻结 Spec，双 Provider agent 段哈希一致（平台侧口径）。
"""
import hashlib
import json
import time
import uuid
from datetime import datetime, timezone

import pytest
import httpx
from fastapi.testclient import TestClient

import pytest as _pytest

from app.agent_modules import registry as module_registry
from app.db import SessionLocal
from app.main import app
from app.models import Release, Run
from app.runner import claim_and_run, start_worker
from app.runtime_providers import worker as rt_worker
from tests.test_r1_runtime_providers import FakeProvider, QualityFake, patch_gateway

client = TestClient(app)
start_worker()


def u(p: str) -> str:
    return f"{p}-{uuid.uuid4().hex[:6]}"


@_pytest.fixture(scope="module")
def fake_server_r2():
    """进程内 fake provider（Contract v1）：供分派测试走真实 HTTP 回环。"""
    import threading

    import uvicorn
    fake = QualityFake()  # 输出符合 Module Schema（R3 结果事务要求）
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


def _model_key() -> str:
    r = client.get("/api/registry/models").json()
    models = r["items"] if isinstance(r, dict) else r
    return models[0]["modelKey"] if models else "qwen-max"


TOOL_NAMES = ["knowledge_search", "ticket_query", "sms_query", "appointment_query"]


def _seed_tools() -> None:
    """模块逻辑工具 → 平台 Tool（含 ready 版本），供发布冻结解析。"""
    for name in TOOL_NAMES:
        existing = client.get("/api/ai-resources/tools", params={"search": name}).json()
        items = existing.get("items") if isinstance(existing, dict) else existing
        if any((i.get("name") == name) for i in (items or [])):
            continue
        r = client.post("/api/ai-resources/tools",
                        json={"name": name, "kind": "builtin",
                              "spec": {"kind": "echo"}, "tested": True})
        assert r.status_code in (200, 201), r.text


def make_module_agent(**overrides) -> dict:
    payload = {"name": u("质检"), "moduleKey": "quality-analysis", "moduleVersion": "1.0.0",
               "description": "", "modelRef": {"modelId": _model_key(),
                                               "provider": "openai-compatible"},
               **overrides}
    r = client.post("/api/agents", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


def make_provider(kind: str, base_url: str) -> dict:
    """换底（2026-09-09）：Runtime Provider 网关已卸载；stub 仅供旧测试签名兼容。"""
    return {"id": f"ghost-{kind}-{uuid.uuid4().hex[:6]}", "name": f"ghost {kind}",
            "kind": kind, "baseUrl": base_url, "status": "enabled"}


def publish_version(aid: str, note: str = "r2") -> dict:
    r = client.post(f"/api/agents/{aid}/versions", json={"note": note})
    assert r.status_code == 201, r.text
    return r.json()


def get_run_row(run_id: str) -> Run:
    db = SessionLocal()
    try:
        db.expire_all()
        return db.get(Run, run_id)
    finally:
        db.close()


def drive_submit(run_id: str, timeout: float = 15.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if get_run_row(run_id).agentscope_session_id:
            return
        claim_and_run(SessionLocal())
        time.sleep(0.2)
    raise AssertionError("agent-runtime-submit 未被处理")


# ---------- Module Registry ----------

def test_registry_assets_and_fail_fast():
    mod = module_registry.get("quality-analysis", "1.0.0")
    assert {i["name"] for i in mod.logical_tools} == set(TOOL_NAMES)
    assert mod.resolve_implementation("agentscope")["entry"] == "native_quality_v0.2"
    # 09-17：deepseek-harness 运行时已退役，manifest 不再声明该实现
    with pytest.raises(KeyError):
        mod.resolve_implementation("deepseek-harness")
    # Schema 哈希引用稳定（同输入同哈希；发布冻结以此为凭据）
    assert mod.input_schema_ref["sha256"] == module_registry.get("quality-analysis").input_schema_ref["sha256"]
    # Spec 校验：criteria 缺 tool_policy 被拒
    bad = dict(mod.default_spec)
    bad["criteria"] = [{"id": "x", "description": "y"}]
    issues = module_registry.validate_spec("quality-analysis", "1.0.0", bad)
    assert any("tool_policy" in i["message"] for i in issues)
    with _pytest.raises(module_registry.ModuleRegistryError):
        module_registry.get("nope-module")
    with _pytest.raises(KeyError):
        mod.resolve_implementation("unknown-provider")


def test_default_spec_stays_module_owned():
    """实例不可改写 criteria/tools/master_data（Module 版本资产，防同版本语义漂移）。"""
    mod = module_registry.get("quality-analysis", "1.0.0")
    spec = mod.build_agent_spec({"modelRef": {"modelId": _model_key()},
                                 "purpose": "售后热线",
                                 "criteria": [{"id": "hacked", "description": "x",
                                               "tool_policy": "forbidden"}]})
    assert [c["id"] for c in spec["criteria"]] == ["abusive_language", "knowledge_accuracy",
                                                   "promise_fulfillment"]
    assert "售后热线" in spec["instructions"]


# ---------- Module Agent 创建与发布 ----------

def test_create_module_agent_and_publish_version():
    _seed_tools()
    a = make_module_agent()
    assert a["type"] == "module" and a["moduleKey"] == "quality-analysis"
    # 旧三类创建仍封存
    assert client.post("/api/agents", json={"name": u("旧"),
                                            "type": "autonomous"}).status_code == 410
    assert client.post("/api/agents", json={"name": u("无模块")}).status_code == 410
    assert client.post("/api/agents", json={
        "name": u("错模块"), "moduleKey": "nope"}).status_code == 422
    # 列表/详情暴露 module 字段
    lst = client.get("/api/agents", params={"search": a["name"]}).json()["items"]
    assert any(i["moduleKey"] == "quality-analysis" for i in lst)
    # 无模型不可发布
    a2 = make_module_agent(modelRef={})
    r = client.post(f"/api/agents/{a2['id']}/versions", json={})
    assert r.status_code == 409
    assert "MODEL_REQUIRED" in {i["code"] for i in r.json()["detail"]["issues"]}
    # 发布：冻结 Module+AgentSpec+Schema 哈希+依赖
    v = publish_version(a["id"])
    assert len(v["artifactHash"]) == 64
    det = client.get(f"/api/agents/{a['id']}/versions/{v['versionId']}").json()
    assert det["definition"]["module"] == {"key": "quality-analysis", "version": "1.0.0"}
    spec = det["definition"]["agentSpec"]
    assert spec["model"]["model"] == _model_key()
    assert [c["id"] for c in spec["criteria"]] == ["abusive_language", "knowledge_accuracy",
                                                   "promise_fulfillment"]
    assert len(det["definition"]["outputSchema"]["sha256"]) == 64
    types = {i["type"] for i in det["dependencySnapshot"]["items"]}
    assert {"AGENT_MODULE", "MODULE_IMPLEMENTATION", "TOOL", "MODEL",
            "MASTER_DATA", "INPUT_SCHEMA", "OUTPUT_SCHEMA"} <= types
    # 同配置重复发布 → artifact hash 稳定（SDD 02 语义延续）
    v2 = publish_version(a["id"], note="again")
    assert v2["artifactHash"] == v["artifactHash"]


def _setup_dual_release(base_url: str):
    """换底（2026-09-09）：Release 不再绑定 Provider；返回 (a, v, stub, stub)。"""
    _seed_tools()
    a = make_module_agent()
    v = publish_version(a["id"])
    r = client.post(f"/api/agents/{a['id']}/releases", json={
        "versionId": v["versionId"], "environment": "prod"})
    assert r.status_code == 201, r.text
    stub = {"id": "stub-provider", "kind": "agentscope"}
    return a, v, stub, stub


def test_release_binds_runtime_provider_one_provider_per_agent():
    """换底（2026-09-09）：Release 无需 Provider；新全量 Release 替换旧 active。"""
    a = make_module_agent()
    v = publish_version(a["id"])
    r1 = client.post(f"/api/agents/{a['id']}/releases",
                     json={"versionId": v["versionId"], "environment": "prod"})
    assert r1.status_code == 201, r1.text
    v2 = publish_version(a["id"], note="second")
    r2 = client.post(f"/api/agents/{a['id']}/releases",
                     json={"versionId": v2["versionId"], "environment": "prod"})
    assert r2.status_code == 201, r2.text
    rels = client.get(f"/api/agents/{a['id']}/releases").json()
    actives = [x for x in (rels if isinstance(rels, list) else rels.get("items", []))
               if x.get("status") == "active" and x.get("environment") == "prod"]
    assert len(actives) == 1


def test_module_run_uses_unified_agentscope_entry(monkeypatch):
    """换底（2026-09-09）：Module Agent 执行经统一入口（AgentScope Session），
    不再入队 agent-runtime-submit；Run 保留业务链并带 Session 反链。"""
    from types import SimpleNamespace

    calls = {}

    def fake_run_structured(db, uid, agent, text, schema, **kw):
        calls["agent"] = agent.id
        calls["schema"] = schema
        calls["trigger"] = kw.get("trigger_kind")
        return SimpleNamespace(session_id="sess-unified-test"), {
            "structured_output": {"sample_id": "S1", "findings": [{"criterion": "abusive_language", "status": "passed", "confidence": 0.9, "reason": "ok", "evidence": []}], "labels": {"service_type_code": None, "issue_codes": []}, "summary": "ok"},
            "text": "",
        }

    monkeypatch.setattr("app.agent_execution.run_structured", fake_run_structured)
    base_url = "http://127.0.0.1:1"
    a, v, prov_as, _prov_dsh = _setup_dual_release(base_url)
    r = client.post(f"/api/agents/{a['id']}/run",
                    json={"input": {"sample_id": "S1", "dialogues": []}, "trigger": "api"})
    assert r.status_code == 202, r.text
    run_id = r.json()["runId"]
    row = get_run_row(run_id)
    assert row.status == "succeeded"
    assert row.agentscope_session_id == "sess-unified-test"
    assert (row.output or {}).get("findings")[0]["status"] == "passed"
    assert calls["agent"] == a["id"]
    from app.models import JobQueue
    db = SessionLocal()
    try:
        mine = [j for j in db.query(JobQueue).filter_by(type="agent-runtime-submit").all()
                if (j.payload or {}).get("run_id") == run_id]
    finally:
        db.close()
    assert mine == []
