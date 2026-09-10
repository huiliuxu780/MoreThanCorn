"""审计返工 P0-1（2026-09-10 二轮）：自动任务「可执行对象」统一判定（后端侧）。

唯一判定（与前端 src/lib/executable-targets.ts 同语义）：
- Agent：未归档 且 存在 active prod Release（/api/agents 下发 executable 字段）；
- Workflow：status == published（或显式固定已发布版本）；
- AgentFlow：resolve_agentflow_release 能解析出 active Release。

覆盖任务书要求的测试：
1. 未归档但无 active prod Release 的 Agent → 列表 executable=false（选择器不可见）；
2. 直接调用后端保存该 Agent → 422 TARGET_NOT_EXECUTABLE；
3. 归档 Agent → 422 TARGET_ARCHIVED；
4. 有 active prod Release 的 Agent → executable=true、可保存、可 run-now；
5. Workflow 草稿 → 422 TARGET_NOT_EXECUTABLE；published → 可保存；
6. AgentFlow 无 active Release → 422 TARGET_NOT_EXECUTABLE；有 → 可保存。
"""
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.models import (AgentFlowDefinition, AgentFlowRelease, AgentFlowVersion,
                        Workflow)

from ._legacy_agents import seed_agent, seed_release, seed_version, uniq

client = TestClient(app)


def _payload(**kw) -> dict:
    base = {"name": uniq("audit-exec"), "target_kind": "agent",
            "prompt_template": "处理 {{value}}", "triggers": []}
    base.update(kw)
    return base


def _make_executable_agent() -> str:
    a = seed_agent(atype="custom")
    v = seed_version(a["id"])
    seed_release(a["id"], v["id"], environment="prod", status="active")
    return a["id"]


def test_agents_list_executable_flag_matches_release_state():
    draft = seed_agent(atype="custom")            # 未归档、无 Release
    prod_id = _make_executable_agent()             # 未归档、active prod
    arch = seed_agent(atype="custom", archived=True)
    av = seed_version(arch["id"])
    seed_release(arch["id"], av["id"], environment="prod", status="active")  # 归档但有 Release
    sandbox_only = seed_agent(atype="custom")
    sv = seed_version(sandbox_only["id"])
    seed_release(sandbox_only["id"], sv["id"], environment="sandbox", status="active")  # 仅 sandbox

    r = client.get("/api/agents", params={"pageSize": 500, "archived": "all"})
    assert r.status_code == 200
    items = {x["id"]: x for x in r.json()["items"]}
    assert items[draft["id"]]["executable"] is False
    assert items[prod_id]["executable"] is True
    assert items[arch["id"]]["executable"] is False
    assert items[sandbox_only["id"]]["executable"] is False


def test_save_rejects_unarchived_agent_without_prod_release():
    a = seed_agent(atype="custom")
    r = client.post("/api/v2/automations", json=_payload(agent_id=a["id"]))
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "TARGET_NOT_EXECUTABLE"


def test_save_rejects_archived_agent():
    a = seed_agent(atype="custom", archived=True)
    r = client.post("/api/v2/automations", json=_payload(agent_id=a["id"]))
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "TARGET_ARCHIVED"


def test_executable_agent_saves_and_runs_now():
    aid_agent = _make_executable_agent()
    r = client.post("/api/v2/automations", json=_payload(agent_id=aid_agent))
    assert r.status_code in (200, 201), r.text
    auto_id = r.json()["id"]
    try:
        rn = client.post(f"/api/v2/automations/{auto_id}/run-now")
        assert rn.status_code == 200, rn.text
        assert rn.json()["trigger_log_id"]
        hist = client.get(f"/api/v2/automations/{auto_id}/history")
        assert hist.status_code == 200
        assert any(h["id"] == rn.json()["trigger_log_id"] for h in hist.json()["items"])
    finally:
        assert client.delete(f"/api/v2/automations/{auto_id}").status_code == 200


def test_save_rejects_draft_workflow_and_accepts_published():
    db = SessionLocal()
    try:
        wf = Workflow(name=uniq("audit-wf"), status="draft",
                      draft_definition={"nodes": [], "edges": []})
        db.add(wf)
        db.commit()
        wf_id = wf.id
        r = client.post("/api/v2/automations",
                        json=_payload(target_kind="workflow", agent_id=None,
                                      workflow_id=wf_id, prompt_template=""))
        assert r.status_code == 422
        assert r.json()["detail"]["code"] == "TARGET_NOT_EXECUTABLE"

        wf.status = "published"
        db.commit()
    finally:
        db.close()
    r2 = client.post("/api/v2/automations",
                     json=_payload(target_kind="workflow", agent_id=None,
                                   workflow_id=wf_id, prompt_template=""))
    assert r2.status_code in (200, 201), r2.text
    assert client.delete(f"/api/v2/automations/{r2.json()['id']}").status_code == 200


def test_save_rejects_agentflow_without_active_release_and_accepts_with():
    db = SessionLocal()
    try:
        d = AgentFlowDefinition(name=uniq("audit-flow"), created_by="dev")
        db.add(d)
        db.commit()
        d_id = d.id
        # 仅有 definition+version、无 active Release → TARGET_NOT_EXECUTABLE
        v = AgentFlowVersion(definition_id=d.id, version_no=1,
                             definition={"nodes": [], "edges": []},
                             content_digest="x", created_by="dev")
        db.add(v)
        db.commit()
        r = client.post("/api/v2/automations",
                        json=_payload(target_kind="agentflow", agent_id=None,
                                      agentflow_id=d_id, prompt_template=""))
        assert r.status_code == 422
        assert r.json()["detail"]["code"] == "TARGET_NOT_EXECUTABLE"

        rel = AgentFlowRelease(version_id=v.id, definition_id=d.id,
                               environment="sandbox", status="active")
        db.add(rel)
        db.commit()
    finally:
        db.close()
    r2 = client.post("/api/v2/automations",
                     json=_payload(target_kind="agentflow", agent_id=None,
                                   agentflow_id=d_id, prompt_template=""))
    assert r2.status_code in (200, 201), r2.text
    assert client.delete(f"/api/v2/automations/{r2.json()['id']}").status_code == 200
