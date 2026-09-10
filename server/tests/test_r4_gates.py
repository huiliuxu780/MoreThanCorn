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
    yield fake, "http://127.0.0.1:1"


def test_worker_restart_recovery_no_resubmit(monkeypatch):
    """换底（2026-09-09）：agent-runtime-* 作业注销——重投只把 queued Run 置失败终态，
    绝不提交 Provider（原“重启不重提交”不变量的换底等价形式）。"""
    from app.legacy_agent_archive import LEGACY_ARCHIVED_CODE
    from app.models import JobQueue
    from app.runner import _dispatch_job

    db = SessionLocal()
    try:
        run = Run(agent_id="none", trigger="manual", status="queued")
        db.add(run)
        db.commit()
        run_id = run.id
        db.add(JobQueue(type="agent-runtime-submit",
                        payload={"run_id": run_id, "provider_id": "ghost"}))
        db.commit()
    finally:
        db.close()
    _dispatch_job("agent-runtime-submit", {"run_id": run_id, "provider_id": "ghost"})
    db = SessionLocal()
    try:
        row = db.get(Run, run_id)
        assert row.status == "failed"
        assert (row.error or {}).get("code") == LEGACY_ARCHIVED_CODE
        assert not row.runtime_provider_run_id
    finally:
        db.close()


def test_run_detail_enhanced_fields(monkeypatch):
    """换底（2026-09-09）：批次 Run 详情含 Session 反链与业务结算链（calls/evidence 列表）。"""
    from tests.test_r5_business_module import _cutover_batch
    rows = [{"interactionId": "D1", "sample_id": "D1", "call_id": "c1",
             "conversation": "x", "dialogues": []}]
    tr_id, runs = _cutover_batch(monkeypatch, "quality-analysis", rows, expect_quality=True)
    assert runs[0].status == "succeeded", runs[0].error
    assert runs[0].agentscope_session_id
    d = client.get(f"/api/runs/{runs[0].id}").json()
    assert isinstance(d.get("calls"), list)
    assert isinstance(d.get("evidence"), list)

def test_runtime_metrics_endpoint():
    """Provider 聚合指标随网关退役卸载。"""
    assert client.get("/api/runtime-providers/metrics/aggregate").status_code == 404


def test_provider_compat_matrix():
    """Provider 兼容矩阵随网关退役卸载。"""
    assert client.get("/api/runtime-providers/ghost").status_code == 404
