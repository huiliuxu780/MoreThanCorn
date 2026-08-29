"""R4（SDD 10）生产门禁（离线部分）验收。

- Golden Set：evaluators 对 POC Ground Truth 的判定正确性（passed/failed/insufficient）；
- worker 重启恢复：已受理 Run 重投 submit 不重发、恢复轮询（§16.1）；
- Run Detail 增强字段（runtime/stages/calls/usage/evidence，§15.4）；
- 运行时指标端点（token/调用/P95/cost 估算）；
- Provider 兼容矩阵（manifest 声明 × kind）。
真实模型/故障注入/egress 负向已在 R1/R3 覆盖；生产 egress/RBAC 负向见 09 套件。
"""
import json
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import pytest
import uvicorn
from fastapi.testclient import TestClient

from app.agent_modules.quality_analysis import evaluators
from app.db import SessionLocal
from app.main import app
from app.models import Run
from app.runtime_providers import worker as rt_worker
from tests.test_r1_runtime_providers import FakeProvider, QualityFake, patch_gateway
from tests.test_r2_agent_modules import (_seed_tools, make_module_agent, make_provider,
                                         publish_version)

client = TestClient(app)

GT = (Path(__file__).resolve().parents[2] / "poc" / "agent_runtime_providers" / "datasets"
      / "smoke" / "ground_truth_v0.1.jsonl")


def test_evaluator_golden_set_correctness():
    if not GT.exists():
        pytest.skip("ground truth 数据集缺失")
    def _crits(findings):
        return [{"id": k, "status": v} for k, v in (findings or {}).items()]
    rows = [json.loads(l) for l in GT.read_text(encoding="utf-8").splitlines() if l.strip()]
    rows = [r for r in rows if isinstance(r.get("expected_findings"), dict)]
    assert rows, "ground truth 为空"
    for row in rows[:5]:
        crits = _crits(row["expected_findings"])
        res = evaluators.evaluate({"criteria": crits}, {"criteria": crits})
        assert res["passed"] and res["matched"] == res["total"], row.get("sample_id")
    # 反例：把某 criterion 状态改错 → 不通过
    bad = _crits(rows[0]["expected_findings"])
    bad[0]["status"] = "failed" if bad[0]["status"] == "passed" else "passed"
    res = evaluators.evaluate({"criteria": _crits(rows[0]["expected_findings"])},
                              {"criteria": bad})
    assert not res["passed"]


@pytest.fixture(scope="module")
def fake_server_r4():
    fake = QualityFake()
    fake.auto_succeed = False  # 停在 queued，验证恢复
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


def test_worker_restart_recovery_no_resubmit(monkeypatch, fake_server_r4):
    fake, base_url = fake_server_r4
    patch_gateway(monkeypatch, base_url)
    _seed_tools()
    prov = make_provider("agentscope", base_url)
    a = make_module_agent()
    v = publish_version(a["id"])
    assert client.post(f"/api/agents/{a['id']}/releases", json={
        "versionId": v["versionId"], "environment": "sandbox",
        "runtimeProviderId": prov["id"]}).status_code == 201
    r = client.post(f"/api/agents/{a['id']}/run", json={"input": {"sample_id": "R"}, "trigger": "api"})
    run_id = r.json()["runId"]
    # 首次 submit（worker 处理）
    from app.runner import claim_and_run
    for _ in range(20):
        if SessionLocal().get(Run, run_id).runtime_provider_run_id:
            break
        claim_and_run(SessionLocal())
        time.sleep(0.1)
    base = fake.submit_count
    assert base >= 1
    # 模拟 worker 重启：重投 submit job → 不重发、只恢复轮询
    db = SessionLocal()
    try:
        from app.models import JobQueue
        db.add(JobQueue(type="agent-runtime-submit",
                        payload={"run_id": run_id, "provider_id": prov["id"]}))
        db.commit()
    finally:
        db.close()
    claim_and_run(SessionLocal())
    time.sleep(0.2)
    assert fake.submit_count == base, "重启恢复不得重新 submit"


def test_run_detail_enhanced_fields(monkeypatch):
    # 复用 R3 的同步批次产出的 Agent Run（含 runtime/stages/calls/evidence）
    from tests.test_r3_task_agent_target import _setup_batch_env, _make_agent_task
    from app.task_runner import start_task_run, execute_task_run
    from tests._quality_setup import make_asset, make_definition_version, make_rule_version

    class _Fake(QualityFake):
        pass
    fake = _Fake()
    server = uvicorn.Server(uvicorn.Config(fake.app(), host="127.0.0.1", port=0,
                                           log_level="error"))
    threading.Thread(target=server.run, daemon=True).start()
    deadline = time.time() + 10
    while not server.started and time.time() < deadline:
        time.sleep(0.05)
    base_url = f"http://127.0.0.1:{server.servers[0].sockets[0].getsockname()[1]}"
    try:
        monkeypatch.setattr("app.runtime_providers.dispatcher.DEFAULT_RUNTIME_TIMEOUT_SECONDS", 20)
        prov, a, v = _setup_batch_env(monkeypatch, base_url, fake=fake)
        asset = make_asset(client, [{"interactionId": "D1", "sample_id": "D1", "dialogues": []}])
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
        execute_task_run(tr_id)
        db = SessionLocal()
        try:
            run = db.query(Run).filter_by(task_run_id=tr_id).first()
            run_id = run.id
        finally:
            db.close()
        d = client.get(f"/api/runs/{run_id}").json()
        assert d["runtime"] and d["runtime"]["provider"] == "agentscope"
        assert d["runtime"]["runtimeVersion"]
        assert isinstance(d["calls"], list)
        assert isinstance(d["evidence"], list) and d["evidence"]
        assert d["usage"].get("total")
    finally:
        server.should_exit = True


def test_runtime_metrics_endpoint():
    m = client.get("/api/runtime-providers/metrics/aggregate").json()
    assert {"total", "succeeded", "totalTokens", "durationMs", "estimatedCostUsd"} <= set(m)
    assert m["durationMs"]["p95"] is None or m["durationMs"]["p95"] >= 0


def test_provider_compat_matrix():
    _seed_tools()
    prov = make_provider("agentscope", "http://127.0.0.1:9")
    d = client.get(f"/api/runtime-providers/{prov['id']}").json()
    assert any(c["key"] == "quality-analysis" for c in d["compatibleModules"])
    ext = make_provider("external", "http://127.0.0.1:9")
    de = client.get(f"/api/runtime-providers/{ext['id']}").json()
    assert de["compatibleModules"] == []
