"""09-16 封存执行面闸门回归（agent-archive-gap 开工）。

六闸：创建版本(既有)/发布/run-now/dispatch(既有)/脚本 waker(既有)/分析任务保存，
外加会话开启与批次启动两闸。断言错误码 AGENT_ARCHIVED。
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.models import Agent, AgentVersion, DataAsset

client = TestClient(app)


def _mk_agent(name: str) -> str:
    with SessionLocal() as db:
        a = Agent(name=name, type="module", module_key="m", module_version="1")
        db.add(a)
        db.commit()
        return a.id


def _mk_custom_agent(name: str) -> str:
    r = client.post("/api/agents", json={
        "type": "custom", "name": name, "description": "gate fixture"})
    assert r.status_code == 201, r.text
    aid = r.json()["id"]
    client.put(f"/api/agents/{aid}", json={"config": {
        "rolePrompt": "gate", "modelRef": {"modelId": "qwen-plus",
                                            "provider": "openai-compatible"}}})
    return aid


def _mk_version(aid: str) -> str:
    r = client.post(f"/api/agents/{aid}/versions", json={})
    assert r.status_code == 201, r.text
    return r.json()["versionId"]


def _archive(aid: str) -> None:
    r = client.put(f"/api/agents/{aid}", json={"archived": True})
    assert r.status_code == 200, r.text


def test_release_gate():
    aid = _mk_custom_agent("ag-rel-gate")
    _mk_version(aid)
    _archive(aid)
    r = client.post(f"/api/agents/{aid}/releases", json={})
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "AGENT_ARCHIVED"


def test_run_now_gate():
    aid = _mk_agent("ag-run-gate")
    _archive(aid)
    r = client.post(f"/api/agents/{aid}/run", json={})
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "AGENT_ARCHIVED"


def test_session_gate():
    aid = _mk_agent("ag-sess-gate")
    _archive(aid)
    r = client.post(f"/api/v2/agents/{aid}/sessions", json={})
    assert r.status_code == 422
    assert "AGENT_ARCHIVED" in r.text


def test_analysis_task_bind_gate():
    aid = _mk_agent("ag-task-gate")
    with SessionLocal() as db:
        asset = DataAsset(name="asset-gate", location="t")
        db.add(asset)
        db.commit()
        asset_id = asset.id
    _archive(aid)
    r = client.post("/api/analysis-tasks", json={
        "name": "gate-task", "dataAssetId": asset_id,
        "executionTarget": {"type": "agent", "agentId": aid}})
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "AGENT_ARCHIVED"


def test_task_run_gate():
    from app.models import AnalysisTask, AnalysisTaskVersion
    aid = _mk_agent("ag-trun-gate")
    with SessionLocal() as db:
        asset = DataAsset(name="asset-gate2", location="t")
        db.add(asset)
        db.commit()
        t = AnalysisTask(name="gate-task-run", status="active",
                         execution_target_type="agent", agent_id=aid,
                         data_asset_id=asset.id)
        db.add(t)
        db.commit()
        tv = AnalysisTaskVersion(task_id=t.id, version_no=1,
                                 execution_target_type="agent", agent_id=aid,
                                 data_asset_id=asset.id)
        db.add(tv)
        db.commit()
        t.current_version_id = tv.id
        db.commit()
        tid = t.id
    _archive(aid)
    r2 = client.post(f"/api/analysis-tasks/{tid}/runs", json={})
    assert r2.status_code == 409
    assert r2.json()["detail"]["code"] == "AGENT_ARCHIVED"
