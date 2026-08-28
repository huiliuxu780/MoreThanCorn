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

import httpx
from fastapi.testclient import TestClient

import pytest as _pytest

from app.agent_modules import registry as module_registry
from app.db import SessionLocal
from app.main import app
from app.models import Release, Run
from app.runner import claim_and_run, start_worker
from app.runtime_providers import worker as rt_worker
from tests.test_r1_runtime_providers import FakeProvider, patch_gateway

client = TestClient(app)
start_worker()


def u(p: str) -> str:
    return f"{p}-{uuid.uuid4().hex[:6]}"


@_pytest.fixture(scope="module")
def fake_server_r2():
    """进程内 fake provider（Contract v1）：供分派测试走真实 HTTP 回环。"""
    import threading

    import uvicorn
    fake = FakeProvider()
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
    pid = f"rp-r2-{uuid.uuid4().hex[:8]}"
    r = client.post("/api/runtime-providers", json={
        "id": pid, "name": f"R2 {kind}", "kind": kind, "baseUrl": base_url})
    assert r.status_code == 201, r.text
    r2 = client.put(f"/api/runtime-providers/{pid}", json={"status": "enabled"})
    assert r2.status_code == 200
    return r2.json()


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
        if get_run_row(run_id).runtime_provider_run_id:
            return
        claim_and_run(SessionLocal())
        time.sleep(0.2)
    raise AssertionError("agent-runtime-submit 未被处理")


# ---------- Module Registry ----------

def test_registry_assets_and_fail_fast():
    mod = module_registry.get("quality-analysis", "1.0.0")
    assert {i["name"] for i in mod.logical_tools} == set(TOOL_NAMES)
    assert mod.resolve_implementation("agentscope")["entry"] == "native_quality_v0.2"
    assert mod.resolve_implementation("deepseek-harness")["bundle"]
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
    """同一 AgentVersion 分别绑定 AgentScope（稳定）与 DSH（灰度）到 sandbox。"""
    _seed_tools()
    prov_as = make_provider("agentscope", base_url)
    prov_dsh = make_provider("deepseek-harness", base_url)
    prov_ext = make_provider("external", base_url)
    disabled = make_provider("agentscope", base_url)
    client.post(f"/api/runtime-providers/{disabled['id']}/disable")

    a = make_module_agent()
    v = publish_version(a["id"])
    # 绑定必填 / 未知 / 未启用 / kind 无实现 → 拒绝
    assert client.post(f"/api/agents/{a['id']}/releases", json={
        "versionId": v["versionId"], "environment": "sandbox"}).status_code == 422
    assert client.post(f"/api/agents/{a['id']}/releases", json={
        "versionId": v["versionId"], "environment": "sandbox",
        "runtimeProviderId": "nope"}).status_code == 404
    assert client.post(f"/api/agents/{a['id']}/releases", json={
        "versionId": v["versionId"], "environment": "sandbox",
        "runtimeProviderId": disabled["id"]}).status_code == 409
    assert client.post(f"/api/agents/{a['id']}/releases", json={
        "versionId": v["versionId"], "environment": "sandbox",
        "runtimeProviderId": prov_ext["id"]}).status_code == 409
    # 同一 AgentVersion：AgentScope 稳定 + DSH 灰度并存于 sandbox（SDD 5.4）
    r1 = client.post(f"/api/agents/{a['id']}/releases", json={
        "versionId": v["versionId"], "environment": "sandbox",
        "runtimeProviderId": prov_as["id"]})
    assert r1.status_code == 201, r1.text
    r2 = client.post(f"/api/agents/{a['id']}/releases", json={
        "versionId": v["versionId"], "environment": "sandbox",
        "runtimeProviderId": prov_dsh["id"], "canaryPercent": 50})
    assert r2.status_code == 201, r2.text
    rels = [x for x in client.get(f"/api/agents/{a['id']}/releases").json()
            if x["status"] == "active" and x["environment"] == "sandbox"]
    assert len(rels) == 2
    db = SessionLocal()
    try:
        rows = db.query(Release).filter_by(agent_id=a["id"], status="active").all()
        snaps = {r.runtime_provider_id: (r.runtime_binding_snapshot or {}) for r in rows}
    finally:
        db.close()
    as_snap = snaps[prov_as["id"]]
    assert as_snap["providerKind"] == "agentscope"
    assert as_snap["module"] == {"key": "quality-analysis", "version": "1.0.0"}
    assert as_snap["moduleImplementation"]["entry"] == "native_quality_v0.2"
    assert len(as_snap["outputSchemaSha256"]) == 64
    assert snaps[prov_dsh["id"]]["moduleImplementation"]["bundle"]
    return a, v, prov_as, prov_dsh


def test_release_binds_runtime_provider_and_dual_provider_sandbox():
    _setup_dual_release("http://fake-runtime")


def test_module_run_dispatch_same_agent_hash_across_providers(monkeypatch, fake_server_r2):
    fake, base_url = fake_server_r2
    a, v, prov_as, prov_dsh = _setup_dual_release(base_url)
    patch_gateway(monkeypatch, base_url)

    # api 触发（无版本）→ 按桶解析稳定/灰度 Release 绑定（两者同版本：请求体应一致）
    r = client.post(f"/api/agents/{a['id']}/run",
                    json={"input": {"sample_id": "S1", "dialogues": []}, "trigger": "api"})
    assert r.status_code == 202, r.text
    run_as = r.json()["runId"]
    drive_submit(run_as)
    row = get_run_row(run_as)
    assert row.runtime_provider_id in (prov_as["id"], prov_dsh["id"])
    assert row.agent_version_id == v["versionId"]
    assert row.runtime_request_hash
    req_as = fake.runs[run_as]["request"]
    assert req_as["context"]["metadata"]["workflowMode"] == "native_quality_v0.2"
    assert "insufficient_evidence" in req_as["agent"]["instructions"]
    assert {t["name"] for t in req_as["agent"]["tools"]} == set(TOOL_NAMES)
    assert req_as["agent"]["output_schema"].get("$schema")

    # 显式版本 + DSH Provider → 同一 AgentVersion 的请求体 agent 段哈希完全一致
    r2 = client.post(f"/api/agents/{a['id']}/run",
                     json={"input": {"sample_id": "S1", "dialogues": []}, "trigger": "test",
                           "versionId": v["versionId"], "providerId": prov_dsh["id"]})
    assert r2.status_code == 202, r2.text
    run_dsh = r2.json()["runId"]
    drive_submit(run_dsh)
    assert get_run_row(run_dsh).runtime_provider_id == prov_dsh["id"]
    req_dsh = fake.runs[run_dsh]["request"]
    agent_hash = lambda body: hashlib.sha256(  # noqa: E731
        json.dumps(body["agent"], ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    assert agent_hash(req_as) == agent_hash(req_dsh)

    # 终态闭环：Provider 成功 → 平台 Run succeeded（R3 落 QualityResult）
    fake.runs[run_as]["status"] = "succeeded"
    rt_worker.poll_agent_runtime({"run_id": run_as, "provider_id": prov_as["id"]})
    assert get_run_row(run_as).status == "succeeded"
    assert get_run_row(run_as).output


def test_platform_fixture_hash_drift_guard():
    """钉扎 fixture（双 Runtime conformance 共用）与模块资产保持一致：
    任何人改动 spec.default / Schema 而未重钉 fixture，三侧（平台+两 Runtime）测试同时失败。"""
    from quality_runtime_contract import (AgentExecutionSpec, MasterDataRef, ModelSpec,
                                          RuntimeExecuteRequest, ToolRef)
    from app.agent_modules.base import MODULE_DIR
    fdir = MODULE_DIR / "quality_analysis" / "fixtures"
    payload = json.loads((fdir / "platform_request_v1.json").read_text())
    RuntimeExecuteRequest.model_validate(payload)  # 严格契约可解析
    pinned = (fdir / "platform_request_v1.agent_sha256").read_text().strip()
    assert hashlib.sha256(json.dumps(payload["agent"], ensure_ascii=False,
                                     sort_keys=True).encode()).hexdigest() == pinned
    mod = module_registry.get("quality-analysis", "1.0.0")
    spec = mod.build_agent_spec({"modelRef": {"modelId": "qwen3.8-max",
                                              "provider": "openai-compatible"}})
    rebuilt = AgentExecutionSpec(
        id="qa-agent-fixture", version="1", instructions=spec["instructions"],
        model=ModelSpec(provider=spec["model"]["provider"], model=spec["model"]["model"],
                        parameters=spec["model"]["parameters"]),
        tools=[ToolRef(**t) for t in spec["tools"]],
        master_data=[MasterDataRef(**m) for m in spec["master_data"]],
        output_schema=mod.output_schema)
    rebuilt_hash = hashlib.sha256(json.dumps(rebuilt.model_dump(mode="json"),
                                             ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    assert rebuilt_hash == pinned, "模块资产漂移：需同步重钉 fixtures/platform_request_v1"


def test_run_resolution_rejects_unreleased_and_requires_preview_provider():
    a = make_module_agent()
    # 未发布：api 触发 422 NO_RELEASED_VERSION
    r = client.post(f"/api/agents/{a['id']}/run", json={"input": {}, "trigger": "api"})
    assert r.status_code == 422 and "NO_RELEASED_VERSION" in r.text
    # 草稿预览必须显式 providerId
    r2 = client.post(f"/api/agents/{a['id']}/run", json={"input": {}, "trigger": "test"})
    assert r2.status_code == 409 and "PREVIEW_PROVIDER_REQUIRED" in r2.text
    prov = make_provider("agentscope", "http://127.0.0.1:9")
    r3 = client.post(f"/api/agents/{a['id']}/run",
                     json={"input": {}, "trigger": "test", "providerId": prov["id"]})
    assert r3.status_code == 202
    row = get_run_row(r3.json()["runId"])
    assert row.definition_source == "draft" and row.runtime_provider_id == prov["id"]
    assert row.agent_version_id is None


def test_run_uses_canary_provider_binding(monkeypatch):
    """灰度 Release 绑定 DSH 时，api 触发按桶落到 DSH（100% canary → 全部 DSH）。"""
    def _dead(provider, transport=None):
        def handler(request):
            return httpx.Response(500, text="no egress in this test")
        from app.runtime_providers.client import RuntimeGatewayClient as _G
        return _G(provider.base_url, transport=httpx.MockTransport(handler), check_egress=False)
    import httpx as _httpx
    monkeypatch.setattr(rt_worker, "build_gateway", _dead)
    _seed_tools()
    prov_as = make_provider("agentscope", "http://127.0.0.1:9")
    prov_dsh = make_provider("deepseek-harness", "http://127.0.0.1:9")
    a = make_module_agent()
    v = publish_version(a["id"])
    assert client.post(f"/api/agents/{a['id']}/releases", json={
        "versionId": v["versionId"], "environment": "sandbox",
        "runtimeProviderId": prov_as["id"]}).status_code == 201
    assert client.post(f"/api/agents/{a['id']}/releases", json={
        "versionId": v["versionId"], "environment": "sandbox",
        "runtimeProviderId": prov_dsh["id"], "canaryPercent": 100}).status_code == 201
    r = client.post(f"/api/agents/{a['id']}/run", json={"input": {}, "trigger": "api"})
    assert r.status_code == 202
    # 未投递 worker：Run 已按桶预解析 Provider 绑定
    assert get_run_row(r.json()["runId"]).runtime_provider_id == prov_dsh["id"]
