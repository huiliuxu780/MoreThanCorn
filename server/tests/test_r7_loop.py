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
        "versionId": v["versionId"], "environment": "sandbox",
        "runtimeProviderId": prov["id"]}).status_code == 201
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
    fake = LoopFake()
    server = uvicorn.Server(uvicorn.Config(fake.app(), host="127.0.0.1", port=0, log_level="error"))
    threading.Thread(target=server.run, daemon=True).start()
    deadline = time.time() + 10
    while not server.started and time.time() < deadline:
        time.sleep(0.05)
    base_url = f"http://127.0.0.1:{server.servers[0].sockets[0].getsockname()[1]}"
    try:
        patch_gateway(monkeypatch, base_url)
        from app.task_runner import execute_task_run, retry_failed_in_taskrun, start_task_run
        a, v, prov, task = _start(base_url, monkeypatch)
        tid = task["id"]
        # 映射不完整 → 422（R7-3）
        bad = client.post("/api/tasks", json={
            "name": "bad", "executionTarget": {"type": "agent", "agentId": a["id"]},
            "dataAssetId": "x", "dataDefinitionVersionId": "y", "inputMapping": {}})
        assert bad.status_code == 422

        db = SessionLocal()
        try:
            tr, resolved = start_task_run(db, tid, trigger="manual")
            tr_id = tr.id
            db.commit()
        finally:
            db.close()
        assert resolved["agentVersionId"] == v["versionId"]
        assert resolved["providerId"] == prov["id"]
        execute_task_run(tr_id)

        db = SessionLocal()
        try:
            tr = db.get(TaskRun, tr_id)
            runs = db.query(Run).filter_by(task_run_id=tr_id).all()
            assert len(runs) == 5, "5 条数据 → 5 个 Run"
            ok_runs = [r for r in runs if r.status == "succeeded"]
            fail_runs = [r for r in runs if r.status == "failed"]
            assert len(ok_runs) == 4 and len(fail_runs) == 1
            for r in runs:  # 6 每个 Run 冻结 AgentVersion/Release/Provider
                assert r.agent_version_id == v["versionId"]
                assert r.runtime_provider_id == prov["id"]
                assert (r.runtime_snapshot or {}).get("runtimeBinding", {}).get("providerId") == prov["id"]
            for r in ok_runs:  # 7 成功 Run 恰好一条 QualityResult
                assert db.query(QualityResult).filter_by(run_id=r.id, is_latest=True).count() == 1
            assert fail_runs[0].error, "8 失败 Run 有明确失败"
            # 10 汇总一致
            db.refresh(tr)
            assert tr.succeeded_count == 4 and tr.failed_count == 1
            # 13 Run 列表可拿
            rl = client.get(f"/api/task-runs/{tr_id}/runs").json()
            assert rl["total"] == 5
        finally:
            db.close()

        # 9 重试只补失败项
        retry_failed_in_taskrun(tr_id)
        db = SessionLocal()
        try:
            runs = db.query(Run).filter_by(task_run_id=tr_id).all()
            # 失败项 S3 重试：fake 仍失败 → 仍 1 失败；成功项不新增
            by_ref = {}
            for r in runs:
                by_ref.setdefault(r.interaction_ref, []).append(r)
            for ref, rs in by_ref.items():
                succ = [r for r in rs if r.status == "succeeded"]
                assert len(succ) <= 1, "成功项不得重复"
        finally:
            db.close()

        # 11/12 新发布+新 Release 后旧 TaskRun 绑定不变；新 TaskRun 解析新版本
        v2 = publish_version(a["id"])
        assert client.post(f"/api/agents/{a['id']}/releases", json={
            "versionId": v2["versionId"], "environment": "sandbox",
            "runtimeProviderId": prov["id"]}).status_code == 201
        db = SessionLocal()
        try:
            tr = db.get(TaskRun, tr_id)
            assert tr.resolved_agent_version_id == v["versionId"], "旧批次绑定不漂移"
        finally:
            db.close()
        db = SessionLocal()
        try:
            tr2, resolved2 = start_task_run(db, tid, trigger="manual")
            db.commit()
        finally:
            db.close()
        assert resolved2["agentVersionId"] == v2["versionId"], "新批次解析新版本"
    finally:
        server.should_exit = True
