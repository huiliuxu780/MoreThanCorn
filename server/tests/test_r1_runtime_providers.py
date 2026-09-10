"""R1 Runtime Provider 网关退役断言（审核 P0-3 返工）。

换底后 AgentScope 为唯一执行底座：/api/runtime-providers 路由卸载（404），
worker 对 agent-runtime-* 作业 fail-stale（不提交任何 Provider）。
原 Provider 生命周期/轮询/取消/超时用例随功能退役，由本文件断言退役不变量。
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.models import JobQueue, Run
from app.runner import _dispatch_job

client = TestClient(app)


def test_runtime_providers_router_unmounted():
    r = client.get("/api/runtime-providers")
    assert r.status_code == 404
    r = client.post("/api/runtime-providers", json={"name": "x", "kind": "agentscope", "baseUrl": "http://127.0.0.1:1/"})
    assert r.status_code == 404


def test_agent_runtime_jobs_fail_stale_without_provider_submit():
    db = SessionLocal()
    try:
        run = Run(agent_id="none", trigger="manual", status="running")
        db.add(run)
        db.commit()
        run_id = run.id
        db.add(JobQueue(type="agent-runtime-submit", payload={"run_id": run_id, "provider_id": "ghost"}))
        db.commit()
    finally:
        db.close()
    _dispatch_job("agent-runtime-submit", {"run_id": run_id, "provider_id": "ghost"})
    db = SessionLocal()
    try:
        row = db.get(Run, run_id)
        assert row.status == "failed"
        assert not row.runtime_provider_run_id
    finally:
        db.close()


# ---- 兼容 stub：供 r2-r7 旧导入解析（Provider 功能已退役，stub 不参与断言） ----
class QualityFake:
    def __init__(self):
        self.submit_count = 0
        self.runs = {}


class FakeProvider:
    def __init__(self, base_url="http://127.0.0.1:1"):
        self.base_url = base_url
        self.submit_count = 0
        self.runs = {}


def make_provider(kind="agentscope", base_url="http://127.0.0.1:1"):
    return {"id": f"ghost-{kind}", "kind": kind, "baseUrl": base_url}


def patch_gateway(monkeypatch, base_url="http://127.0.0.1:1"):
    """Provider 网关已卸载：patch 为恒失败，防止任何测试误触旧路径。"""
    from app import runtime_providers  # noqa: F401  (module retained, unmounted)

    def _boom(*a, **k):
        raise AssertionError("runtime provider path retired")

    monkeypatch.setattr("app.runtime_providers.worker.submit_agent_runtime", _boom, raising=False)
    return QualityFake()
