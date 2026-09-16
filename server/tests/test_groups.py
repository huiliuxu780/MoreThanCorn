"""Group P1 回归（2026-09-15，Spec group-capability v1.1 §3.2/§4.1/§6.4）。

- 不变量 1/2：Leader 唯一且 ∈ 成员；成员（含 Leader）1..5；
- 候选约束服务端镜像：成员 Agent 须存在且未归档；
- 乐观锁：PATCH revision 冲突 409 REVISION_CONFLICT；
- ROSTER_FROZEN：active 会话存在时成员/Leader 变更 409；
- 不变量 7 双向闸门：archive 遇 active 会话 409；Agent 归档遇在用群成员 409+引用清单；
- DELETE 语义：无会话真删 / 有会话归档。
"""
from __future__ import annotations

import uuid

from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.models import Agent, AgentGroupSession

client = TestClient(app)


def u(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:6]}"


def _mk_agent(name: str | None = None, archived: bool = False) -> str:
    with SessionLocal() as db:
        a = Agent(name=name or u("ag")[:20], type="module", module_key="m",
                  module_version="1", archived=archived)
        db.add(a)
        db.commit()
        return a.id


def _mk_session(gid: str, status: str = "active") -> str:
    with SessionLocal() as db:
        s = AgentGroupSession(group_id=gid, status=status, binding_snapshot={})
        db.add(s)
        db.commit()
        return s.id


def _close_session(sid: str) -> None:
    with SessionLocal() as db:
        s = db.get(AgentGroupSession, sid)
        s.status = "closed"
        db.commit()


def _create(members: list[str], leader: str | None = None, name: str | None = None):
    body = {
        "name": u("群")[:10] if name is None else name,
        "leader_agent_id": leader or (members[0] if members else "none"),
        "members": [{"agent_id": m} for m in members],
    }
    return client.post("/api/v2/groups", json=body)


def test_create_ok_roles_and_view():
    a, b = _mk_agent(), _mk_agent()
    r = _create([a, b], leader=b)
    assert r.status_code == 200, r.text
    v = r.json()
    assert v["memberCount"] == 2 and v["revision"] == 1
    roles = {m["agentId"]: m["role"] for m in v["members"]}
    assert roles == {a: "member", b: "leader"}
    assert v["leaderAgentId"] == b
    # 列表默认可见
    lst = client.get("/api/v2/groups").json()
    assert any(i["id"] == v["id"] for i in lst["items"])


def test_create_member_count_bounds():
    a = _mk_agent()
    assert _create([]).status_code == 422
    six = [_mk_agent() for _ in range(6)]
    assert _create(six).status_code == 422


def test_create_leader_must_be_member():
    a, b = _mk_agent(), _mk_agent()
    r = _create([a], leader=b)
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "LEADER_NOT_MEMBER"


def test_create_duplicate_member():
    a = _mk_agent()
    r = client.post("/api/v2/groups", json={
        "name": u("群"), "leader_agent_id": a,
        "members": [{"agent_id": a}, {"agent_id": a}]})
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "DUPLICATE_MEMBER"


def test_create_candidate_constraints():
    a = _mk_agent()
    ghost = _mk_agent()
    with SessionLocal() as db:
        db.delete(db.get(Agent, ghost))
        db.commit()
    r = _create([a, ghost])
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "AGENT_UNAVAILABLE"
    arch = _mk_agent(archived=True)
    r2 = _create([a, arch])
    assert r2.status_code == 422
    assert r2.json()["detail"]["code"] == "AGENT_UNAVAILABLE"


def test_create_name_bounds():
    a = _mk_agent()
    assert _create([a], name="").status_code == 422
    assert _create([a], name="x" * 21).status_code == 422


def test_patch_optimistic_lock_and_rename():
    a, b = _mk_agent(), _mk_agent()
    gid = _create([a, b]).json()["id"]
    r = client.patch(f"/api/v2/groups/{gid}",
                     json={"revision": 99, "name": "新名"})
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "REVISION_CONFLICT"
    assert r.json()["detail"]["currentRevision"] == 1
    r2 = client.patch(f"/api/v2/groups/{gid}",
                      json={"revision": 1, "name": "新名"})
    assert r2.status_code == 200
    assert r2.json()["name"] == "新名" and r2.json()["revision"] == 2


def test_patch_leader_switch_ok():
    a, b = _mk_agent(), _mk_agent()
    gid = _create([a, b]).json()["id"]
    r = client.patch(f"/api/v2/groups/{gid}",
                     json={"revision": 1, "leader_agent_id": a})
    assert r.status_code == 200
    roles = {m["agentId"]: m["role"] for m in r.json()["members"]}
    assert roles[a] == "leader" and roles[b] == "member"


def test_patch_roster_frozen_with_active_session():
    a, b, c = _mk_agent(), _mk_agent(), _mk_agent()
    gid = _create([a, b]).json()["id"]
    _mk_session(gid)
    r = client.patch(f"/api/v2/groups/{gid}", json={
        "revision": 1, "members": [{"agent_id": a}, {"agent_id": c}]})
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "ROSTER_FROZEN"
    # 改名不受冻结限制
    r2 = client.patch(f"/api/v2/groups/{gid}",
                      json={"revision": 1, "name": "仍可改名"})
    assert r2.status_code == 200


def test_archive_gate_and_restore():
    a = _mk_agent()
    gid = _create([a]).json()["id"]
    sid = _mk_session(gid)
    r = client.post(f"/api/v2/groups/{gid}/archive")
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "ACTIVE_SESSION_EXISTS"
    _close_session(sid)
    r2 = client.post(f"/api/v2/groups/{gid}/archive")
    assert r2.status_code == 200 and r2.json()["archived"] is True
    # 归档后默认列表隐藏
    assert not any(i["id"] == gid for i in
                   client.get("/api/v2/groups").json()["items"])
    r3 = client.post(f"/api/v2/groups/{gid}/restore")
    assert r3.status_code == 200 and r3.json()["archived"] is False


def test_agent_archive_bidirectional_gate():
    a, b = _mk_agent(), _mk_agent()
    gid = _create([a, b], leader=b).json()["id"]
    r = client.put(f"/api/agents/{a}", json={"archived": True})
    assert r.status_code == 409
    det = r.json()["detail"]
    assert det["code"] == "AGENT_IN_USE_BY_GROUP"
    assert any(g["id"] == gid for g in det["groups"])
    # 归档组后放行
    client.post(f"/api/v2/groups/{gid}/archive")
    r2 = client.put(f"/api/agents/{a}", json={"archived": True})
    assert r2.status_code == 200


def test_delete_semantics():
    a = _mk_agent()
    gid1 = _create([a]).json()["id"]
    r1 = client.delete(f"/api/v2/groups/{gid1}")
    assert r1.status_code == 200 and r1.json().get("deleted") is True
    assert client.get(f"/api/v2/groups/{gid1}").status_code == 404

    gid2 = _create([a]).json()["id"]
    _mk_session(gid2, status="closed")
    r2 = client.delete(f"/api/v2/groups/{gid2}")
    assert r2.status_code == 200 and r2.json().get("archived") is True
    assert client.get(f"/api/v2/groups/{gid2}").json()["archived"] is True


def test_sessions_list():
    a = _mk_agent()
    gid = _create([a]).json()["id"]
    sid = _mk_session(gid)
    items = client.get(f"/api/v2/groups/{gid}/sessions").json()["items"]
    assert [i["id"] for i in items] == [sid]
    assert items[0]["status"] == "active"


# --- g063：群技能挂载 + 成员协作 SOP（D8 提前落地） -------------------------


def _mk_skill(name: str) -> str:
    from app.models import SkillResource
    with SessionLocal() as db:
        s = SkillResource(name=name, content=f"# {name}\n规则正文", status="ready")
        db.add(s)
        db.commit()
        return s.id


def test_group_skill_mount_lifecycle():
    a = _mk_agent()
    gid = _create([a]).json()["id"]
    sk = _mk_skill(u("sk"))
    r = client.post(f"/api/v2/groups/{gid}/skills", json={"skill_id": sk})
    assert r.status_code == 200
    # 重复挂载 409
    r2 = client.post(f"/api/v2/groups/{gid}/skills", json={"skill_id": sk})
    assert r2.status_code == 409
    items = client.get(f"/api/v2/groups/{gid}/skills").json()["items"]
    assert [i["skillId"] for i in items] == [sk]
    r3 = client.delete(f"/api/v2/groups/{gid}/skills/{sk}")
    assert r3.status_code == 200
    assert client.get(f"/api/v2/groups/{gid}/skills").json()["items"] == []
    # 幽灵技能 404
    assert client.post(f"/api/v2/groups/{gid}/skills",
                       json={"skill_id": "nope"}).status_code == 404


def test_sop_lifecycle_immutability_and_bind():
    a = _mk_agent()
    gid = _create([a]).json()["id"]
    r = client.post(f"/api/v2/groups/{gid}/sops",
                    json={"name": "质检交接规则", "content": "先 QA 初答再转专家"})
    assert r.status_code == 200
    sop = r.json()
    assert sop["status"] == "draft"
    # 草稿不可绑定
    rb = client.post(f"/api/v2/groups/{gid}/sop-bind", json={"sop_id": sop["id"]})
    assert rb.status_code == 409
    # 发布
    rp = client.post(f"/api/v2/groups/{gid}/sops/{sop['id']}/publish")
    assert rp.status_code == 200
    # published 只读（不可变发布语义）
    rpatch = client.patch(f"/api/v2/groups/{gid}/sops/{sop['id']}",
                          json={"name": "改不了", "content": "x"})
    assert rpatch.status_code == 409
    # 绑定 published
    rb2 = client.post(f"/api/v2/groups/{gid}/sop-bind", json={"sop_id": sop["id"]})
    assert rb2.status_code == 200
    assert rb2.json()["boundSopId"] == sop["id"]
    # 解绑
    rb3 = client.post(f"/api/v2/groups/{gid}/sop-bind", json={"sop_id": None})
    assert rb3.status_code == 200 and rb3.json()["boundSopId"] is None
    # 名称校验
    assert client.post(f"/api/v2/groups/{gid}/sops",
                       json={"name": "", "content": ""}).status_code == 422
