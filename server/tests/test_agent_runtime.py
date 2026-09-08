"""R-Archive：旧 Agent 运行层封存后的存活契约。

原"三型运行/挂载消费/护栏/发布同步"行为已整体封存（tag archive/legacy-agents-20260828，
行为规格见 docs/archive/legacy-agents/manifest.md），本文件只保留仍有效的运行层契约；
封存矩阵全量用例见 test_legacy_agent_archive.py。
"""
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.models import JobQueue, Run
from tests._legacy_agents import seed_agent, uniq

client = TestClient(app)


def test_run_agent_entry_blocked_no_job_no_run():
    """运行入口 410；不创建 Run、不入队 agent-execution。"""
    a = seed_agent(config={"rolePrompt": "x", "modelRef": {"modelId": ""}})
    db = SessionLocal()
    try:
        jobs_before = db.query(JobQueue).filter_by(type="agent-execution").count()
    finally:
        db.close()
    r = client.post(f"/api/agents/{a['id']}/run", json={"input": {"userQuery": "hi"}})
    assert r.status_code == 410, r.text
    assert r.json()["code"] == "LEGACY_AGENT_ARCHIVED"
    db = SessionLocal()
    try:
        assert db.query(Run).filter_by(agent_id=a["id"]).count() == 0
        assert db.query(JobQueue).filter_by(type="agent-execution").count() == jobs_before
    finally:
        db.close()


def test_mounts_health_read_semantics_preserved():
    """历史挂载体检（mounts-health）保持只读可用，失效项照实标记。

    docs/v2-design/10 §5.3：config.skills 名字对照注册表——未注册 valid=False，
    注册同名 Skill 后转 True（旧"恒 True"契约废止）。
    """
    tool = client.post("/api/tools", json={"name": uniq("echo-arch"), "kind": "builtin",
                                           "spec": {"kind": "echo"}}).json()
    skill_name = uniq("s1")[:64]
    a = seed_agent(config={"skills": [skill_name], "tools": [tool["name"], "ghost-tool"],
                           "workflows": ["不存在的流"], "knowledges": []})
    items = client.get(f"/api/agents/{a['id']}/mounts-health").json()["items"]
    by = {(i["kind"], i["name"]): i["valid"] for i in items}
    assert by[("tool", tool["name"])] is True
    assert by[("tool", "ghost-tool")] is False
    assert by[("workflow", "不存在的流")] is False
    assert by[("skill", skill_name)] is False
    sid = client.post("/api/ai-resources/skills",
                      json={"name": skill_name, "content": "# S"}).json()["id"]
    items = client.get(f"/api/agents/{a['id']}/mounts-health").json()["items"]
    by = {(i["kind"], i["name"]): i["valid"] for i in items}
    assert by[("skill", skill_name)] is True
    client.delete(f"/api/ai-resources/skills/{sid}")


def test_run_unknown_agent_404():
    r = client.post("/api/agents/nope/run", json={"input": {}})
    assert r.status_code == 404
