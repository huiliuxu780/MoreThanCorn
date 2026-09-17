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


def test_patch_roster_with_active_session():
    """09-16 c 改拍：active 会话内成员增删放行（新成员自下一会话入会），Leader 仍冻结。"""
    a, b, c = _mk_agent(), _mk_agent(), _mk_agent()
    gid = _create([a, b]).json()["id"]
    _mk_session(gid)
    # 成员增删：放行
    r = client.patch(f"/api/v2/groups/{gid}", json={
        "revision": 1, "members": [{"agent_id": a}, {"agent_id": c}]})
    assert r.status_code == 200
    assert {m["agentId"] for m in r.json()["members"]} == {a, c}
    # 换 Leader：仍冻结
    r1 = client.patch(f"/api/v2/groups/{gid}", json={
        "revision": 2, "leader_agent_id": c})
    assert r1.status_code == 409
    assert r1.json()["detail"]["code"] == "ROSTER_FROZEN"
    # 改名不受冻结限制
    r2 = client.patch(f"/api/v2/groups/{gid}",
                      json={"revision": 2, "name": "仍可改名"})
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


def test_turn_budget_gate():
    a = _mk_agent()
    gid = _create([a]).json()["id"]
    from app.models import AgentGroupSession
    with SessionLocal() as db:
        gs = AgentGroupSession(group_id=gid, status="active",
                               binding_snapshot={}, turn_count=0, max_team_turns=1)
        db.add(gs)
        db.commit()
        gsid = gs.id
    # 第一回合放行（无运行时亦应在预算闸门之后才失败；这里只断言计数与闸门顺序）
    with SessionLocal() as db:
        gs = db.get(AgentGroupSession, gsid)
        assert gs.turn_count == 0
    # 手工置满预算 → 409 BUDGET_EXCEEDED
    with SessionLocal() as db:
        gs = db.get(AgentGroupSession, gsid)
        gs.turn_count = 1
        db.commit()
    r = client.post(f"/api/v2/groups/{gid}/sessions/{gsid}/turns",
                    json={"text": "x"})
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "BUDGET_EXCEEDED"


def test_automation_group_target_dispatch(monkeypatch):
    from app.routers import as_groups as ag_mod
    from app import agentscope_client as rt_mod
    from app.models import AgentGroupSession, AgentSessionIndex

    a = _mk_agent()
    gid = _create([a]).json()["id"]

    calls = {}

    def fake_open(db, g, uid, *, reuse_active=False):
        calls["gid"] = g
        with SessionLocal() as d:
            gs = AgentGroupSession(group_id=g, status="active",
                                   binding_snapshot={}, leader_session_id="ldr-1")
            d.add(gs)
            d.commit()
            d.add(AgentSessionIndex(session_id="ldr-1", user_id=uid,
                                    agent_id=a, runtime_agent_id="rt-1",
                                    trigger_kind="group", group_session_id=gs.id))
            d.commit()
            return gs

    monkeypatch.setattr(ag_mod, "open_group_session", fake_open)
    monkeypatch.setattr(rt_mod, "chat_trigger",
                        lambda *args, **kw: calls.setdefault("trigger", args))

    r = client.post("/api/v2/automations", json={
        "name": u("ga"), "target_kind": "group", "group_id": gid,
        "prompt_template": "汇报状态", "triggers": []})
    assert r.status_code in (200, 201), r.text
    aid = r.json()["id"]
    r2 = client.post(f"/api/v2/automations/{aid}/run-now")
    assert r2.status_code in (200, 202), r2.text
    assert calls.get("gid") == gid
    assert "trigger" in calls
    # 幽灵 group 创建校验
    r3 = client.post("/api/v2/automations", json={
        "name": u("gb"), "target_kind": "group", "group_id": "nope",
        "prompt_template": "x", "triggers": []})
    assert r3.status_code == 422


def test_board_group_filter():
    from app.models import AgentGroupSession, AgentSessionIndex
    a = _mk_agent()
    gid = _create([a]).json()["id"]
    with SessionLocal() as db:
        gs = AgentGroupSession(group_id=gid, status="closed", binding_snapshot={})
        db.add(gs)
        db.commit()
        gsid = gs.id
        db.add(AgentSessionIndex(session_id=u("s"), user_id="dev", agent_id=a,
                                 runtime_agent_id="rt-1", trigger_kind="group",
                                 group_session_id=gsid))
        db.commit()
    opts = client.get("/api/board/filter-options").json()
    assert any(g["value"] == gid for g in opts["groups"])
    rows = client.get(f"/api/board/tasks?group={gid}").json()
    assert rows["total"] >= 1
    assert all(r.get("group_id") == gid for r in rows["items"])
    rows_all = client.get("/api/board/tasks?group=other").json()
    assert rows_all["total"] == 0


def test_member_config_override_in_binding(monkeypatch):
    from app import agentscope_client as rt_mod
    captured = {}

    def fake_group_session(uid, body, timeout=60.0):
        captured.update(body)
        return {"runtime_team_id": "t1", "leader_session_id": "ldr",
                "member_sessions": []}

    monkeypatch.setattr(rt_mod, "group_session", fake_group_session)
    # 需要已发布 Agent：复用 release 构造
    from app.models import Agent, AgentVersion, Release
    with SessionLocal() as db:
        a = Agent(name=u("ov")[:20], type="module", module_key="m", module_version="1")
        db.add(a)
        db.commit()
        aid = a.id
        v = AgentVersion(agent_id=aid, version_no=1, definition={}, dependency_snapshot={}, artifact_hash="h")
        db.add(v)
        db.commit()
        r = Release(agent_id=aid, agent_version_id=v.id, environment="prod",
                    status="active", runtime_provider_id=None,
                    runtime_binding_snapshot={
                        "agentscope_agent_id": "rt-ov",
                        "frozen_model_id": "qwen-plus",
                        "chat_model_config": {"model": "qwen-plus"},
                        "resources": {}, "_frozen_skills": {}, "_frozen_mcps": {},
                        "_frozen_tools": {}, "_frozen_knowledges": {},
                    })
        db.add(r)
        db.commit()
    gid = client.post("/api/v2/groups", json={
        "name": u("ovg"), "leader_agent_id": aid,
        "members": [{"agent_id": aid,
                     "config": {"chat_model_config": {"model": "qwen-max"},
                                "knowledge_ids": ["kb-1"]}}]}).json()["id"]
    r2 = client.post(f"/api/v2/groups/{gid}/sessions")
    assert r2.status_code == 200, r2.text
    leader = captured["leader"]
    assert leader["chat_model_config"]["model"] == "qwen-max"
    assert leader["knowledge_ids"] == ["kb-1"]


def test_watcher_ticks_error_sources(monkeypatch):
    """09-16 数据链路修复回归：error 源不得永久停 tick（曾单次网络抖动 parked 致死）。"""
    from app.automation_watcher import reconcile_once
    from app.routers import as_automations
    from app.models import DataSource

    with SessionLocal() as db:
        src = DataSource(name=u("errsrc"), kind="api_pull", status="error",
                         config={"interval_seconds": 300},
                         cursor={})
        db.add(src)
        db.commit()
        src_id = src.id
    ticked = []
    monkeypatch.setattr(as_automations, "tick_poll_source",
                        lambda db_, s: ticked.append(s.id))
    try:
        with SessionLocal() as db:
            reconcile_once(db)
    except Exception:
        pass
    assert src_id in ticked
    with SessionLocal() as db:
        db.delete(db.get(DataSource, src_id))
        db.commit()


def _webhook_src_with_signing(secret: str):
    from app.kms import kms_encrypt
    from app.models import DataSource
    import hashlib as _hl
    with SessionLocal() as db:
        src = DataSource(name=u("whsign"), kind="webhook", status="active",
                         auth_token_hash=_hl.sha256(b"tok123").hexdigest(),
                         signing_secret_enc=kms_encrypt(secret))
        db.add(src)
        db.commit()
        return src.id


def test_webhook_signature_w1_w3():
    import hashlib as _hl
    import hmac as _hmac
    import time as _t
    sid = _webhook_src_with_signing("sec-abc")
    body = b'{"type":"t1","id":"i1","data":1}'
    ts = str(int(_t.time()))
    sig = _hmac.new(b"sec-abc", f"{ts}.".encode() + body, _hl.sha256).hexdigest()
    r = client.post(f"/api/v2/ingress/webhook/{sid}", content=body,
                    headers={"Content-Type": "application/json",
                             "x-source-token": "tok123",
                             "x-mtc-signature": f"t={ts},v1={sig}"})
    assert r.status_code == 200, r.text
    # 错签拒绝
    r2 = client.post(f"/api/v2/ingress/webhook/{sid}", content=body,
                     headers={"Content-Type": "application/json",
                              "x-source-token": "tok123",
                              "x-mtc-signature": f"t={ts},v1={'0'*64}"})
    assert r2.status_code == 401
    # 过期时间戳拒绝（W2）
    old_ts = str(int(_t.time()) - 600)
    old_sig = _hmac.new(b"sec-abc", f"{old_ts}.".encode() + body, _hl.sha256).hexdigest()
    r3 = client.post(f"/api/v2/ingress/webhook/{sid}", content=body,
                     headers={"Content-Type": "application/json",
                              "x-source-token": "tok123",
                              "x-mtc-signature": f"t={old_ts},v1={old_sig}"})
    assert r3.status_code == 401


def test_webhook_cloudevents_and_eventbridge_token():
    import hashlib as _hl
    from app.models import DataSource
    with SessionLocal() as db:
        src = DataSource(name=u("whce"), kind="webhook", status="active",
                         auth_token_hash=_hl.sha256(b"ebtok").hexdigest())
        db.add(src)
        db.commit()
        sid = src.id
    ce = {"specversion": "1.0", "id": "ce-1", "source": "acs.oss",
          "type": "oss:ObjectCreated", "time": "2026-09-16T10:00:00Z",
          "data": {"bucket": "b1", "key": "k1"}}
    r = client.post(f"/api/v2/ingress/webhook/{sid}", json=ce,
                    headers={"x-eventbridge-signature-token": "ebtok"})
    assert r.status_code == 200, r.text
    # dedupe：同 ce.id 重投不新建事件
    r2 = client.post(f"/api/v2/ingress/webhook/{sid}", json=ce,
                     headers={"x-eventbridge-signature-token": "ebtok"})
    assert r2.status_code == 200
    from app.models import DataSourceEvent
    with SessionLocal() as db:
        n = db.query(DataSourceEvent).filter_by(source_id=sid).count()
    assert n == 1
    # 信封缺必备属性拒绝
    bad = {"specversion": "1.0", "id": "ce-2"}
    r3 = client.post(f"/api/v2/ingress/webhook/{sid}", json=bad,
                     headers={"x-eventbridge-signature-token": "ebtok"})
    assert r3.status_code == 422
