"""R-Archive：Phase D-1 观测/评测封存后的契约（SDD 10 ADR-R09）。

原"评测真实运行/指标随运行增长"行为封存于 tag archive/legacy-agents-20260828；
本文件验证：历史指标只读可查、评测写路径 410、只读列表保留、generate-prompt 工具保留。
"""
from fastapi.testclient import TestClient

from app.main import app
from tests._legacy_agents import seed_agent, seed_version

client = TestClient(app)


def test_d1_agent_metrics_read_on_history():
    """历史 Agent 指标只读可查（无新增运行时计数稳定）。"""
    a = seed_agent()
    m = client.get(f"/api/agents/{a['id']}/metrics").json()
    assert {"total", "succeeded", "failed", "successRate", "avgDurationMs",
            "totalTokens", "firstToken"} <= set(m)
    assert m["total"] == 0 and m["firstToken"]["samples"] == 0


def test_d1_eval_writes_blocked_reads_preserved():
    a = seed_agent()
    assert client.post(f"/api/agents/{a['id']}/eval-samples",
                       json={"name": "问好了", "input": {"userQuery": "你好"}}).status_code == 410
    assert client.post(f"/api/agents/{a['id']}/eval-run", json={}).status_code == 410
    lst = client.get(f"/api/agents/{a['id']}/eval-samples")
    assert lst.status_code == 200 and lst.json()["items"] == []


def test_d1_generate_prompt_endpoint():
    """generate-prompt 不绑定具体 Agent，属于通用工具能力，保留。"""
    r = client.post("/api/agents/generate-prompt", json={"name": "测试助手", "hint": "客服"})
    assert r.status_code == 201
    assert isinstance(r.json()["prompt"], str) and len(r.json()["prompt"]) > 0


def test_d1_versions_carry_frozen_members():
    """专家组成员冻结摘要随版本返回（历史数据只读渲染）。"""
    member = seed_agent(name="冻结成员")
    a = seed_agent(name="冻结组")
    seed_version(a["id"], dependency_snapshot={
        "items": [{"type": "AGENT", "ref": member["id"], "version": "v-seed-1"}]})
    versions = client.get(f"/api/agents/{a['id']}/versions").json()
    assert versions[0]["frozenMembers"] == [{"ref": member["id"], "version": "v-seed-1"}]
