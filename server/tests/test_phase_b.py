"""R-Archive：Phase B 发布闭环封存后的契约（SDD 10 ADR-R09）。

原"不可变版本/部署回滚/运行认版本/依赖冻结"执行行为封存于 tag
archive/legacy-agents-20260828；本文件验证：版本/发布/运行/删除写路径 410，
历史版本与 Release（含灰度、成员冻结摘要）只读渲染不受影响。
"""
from fastapi.testclient import TestClient

from app.main import app
from tests._legacy_agents import seed_agent, seed_release, seed_version, uniq

client = TestClient(app)


def test_b_version_create_blocked():
    a = seed_agent()
    r = client.post(f"/api/agents/{a['id']}/versions", json={"note": "第一次"})
    assert r.status_code == 410, r.text
    assert r.json()["code"] == "LEGACY_AGENT_ARCHIVED"


def test_b_release_blocked():
    a = seed_agent()
    v = seed_version(a["id"])
    r = client.post(f"/api/agents/{a['id']}/releases",
                    json={"versionId": v["id"], "environment": "sandbox"})
    assert r.status_code == 410, r.text


def test_b_run_all_triggers_blocked():
    a = seed_agent()
    for trigger in ("test", "manual", "api", "schedule"):
        r = client.post(f"/api/agents/{a['id']}/run",
                        json={"input": {}, "trigger": trigger})
        assert r.status_code == 410, (trigger, r.text)


def test_b_agent_delete_blocked():
    a = seed_agent()
    assert client.delete(f"/api/agents/{a['id']}").status_code == 410


def test_b_version_release_read_rendering():
    """历史版本/部署列表与详情只读渲染（含灰度记录）。"""
    a = seed_agent()
    v1 = seed_version(a["id"])
    v2 = seed_version(a["id"])
    seed_release(a["id"], v1["id"], environment="prod")
    seed_release(a["id"], v2["id"], environment="prod", canary_percent=50)
    lst = client.get(f"/api/agents/{a['id']}/versions").json()
    assert [x["versionNo"] for x in lst] == [2, 1]
    assert all(len(x["artifactHash"]) == 64 for x in lst)
    det = client.get(f"/api/agents/{a['id']}/versions/{v1['id']}").json()
    assert det["definition"]["rolePrompt"] == "seeded"
    assert det["dependencySnapshot"] == {"items": []}
    rels = client.get(f"/api/agents/{a['id']}/releases").json()
    by_canary = {(r["canaryPercent"], r["status"]) for r in rels}
    assert (0, "active") in by_canary and (50, "active") in by_canary
    assert all(r["versionNo"] in (1, 2) for r in rels)


def test_b_frozen_members_rendering_preserved():
    """版本列表的成员冻结摘要渲染保留（历史数据只读）。"""
    member = seed_agent(atype="dialogue")
    a = seed_agent(name=uniq("组"))
    seed_version(a["id"], dependency_snapshot={
        "items": [{"type": "AGENT", "ref": member["id"], "version": "frozen-v1"}]})
    versions = client.get(f"/api/agents/{a['id']}/versions").json()
    fm = versions[0]["frozenMembers"]
    assert fm == [{"ref": member["id"], "version": "frozen-v1"}]
