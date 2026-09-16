"""Group（多 Agent 群聊协作组）P1：定义实体 CRUD + 治理闸门。

Spec: docs/product-domain/group-capability-spec.md v1.1 §4.1（APPROVED）。
P1 子集：群 CRUD/改名/归档双向闸门/会话列表；开聊装配/turns/聚合流/confirm/
interrupt = P2（/mtc/group-session 与聚合 SSE）。
不变量落点：1 Leader 唯一且 ∈ 成员；2 成员（含 Leader）1..5；7 归档双向闸门；
成员/Leader 变更仅允许在无 active 会话时（binding_snapshot 冻结语义，§4.1 PATCH）。
候选约束服务端镜像：成员 Agent 须存在且未归档（发布冻结校验在开聊，不变量 3）。
"""
from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..auth import require_operator, require_role
from ..db import get_db
from ..models import (
    Agent,
    AgentGroup,
    AgentGroupMember,
    AgentGroupSession,
    AgentGroupSessionMember,
    AgentGroupSkill,
    AgentGroupSop,
    AgentSessionIndex,
)

router = APIRouter(prefix="/api/v2/groups", tags=["groups"])

MEMBER_MIN, MEMBER_MAX = 1, 5  # 不变量 2（D5：含 Leader 共 1..5）


class MemberBody(BaseModel):
    agent_id: str
    config: dict = Field(default_factory=dict)


class GroupCreateBody(BaseModel):
    name: str
    description: str | None = None
    leader_agent_id: str
    members: list[MemberBody]


class TurnBody(BaseModel):
    text: str


class GroupPatchBody(BaseModel):
    revision: int  # 乐观锁必填（Spec §4.1 PATCH）
    name: str | None = None
    description: str | None = None
    leader_agent_id: str | None = None
    members: list[MemberBody] | None = None


def _check_name(name: str) -> str:
    clean = (name or "").strip()
    if not clean or len(clean) > 20:
        raise HTTPException(422, detail={"code": "GROUP_NAME_INVALID",
                                         "message": "群名称须为 1-20 字"})
    return clean


def _validate_roster(db: Session, leader_id: str,
                     members: list[MemberBody]) -> None:
    """不变量 1/2 + 候选约束服务端镜像（存在+未归档）。"""
    ids = [m.agent_id for m in members]
    if not (MEMBER_MIN <= len(ids) <= MEMBER_MAX):
        raise HTTPException(422, detail={"code": "MEMBER_COUNT_INVALID",
                                         "message": f"成员（含 Leader）须 {MEMBER_MIN}-{MEMBER_MAX} 位"})
    if len(set(ids)) != len(ids):
        raise HTTPException(422, detail={"code": "DUPLICATE_MEMBER",
                                         "message": "成员不可重复"})
    if leader_id not in set(ids):
        raise HTTPException(422, detail={"code": "LEADER_NOT_MEMBER",
                                         "message": "Leader 必须是成员之一"})
    agents = {a.id: a for a in db.query(Agent).filter(Agent.id.in_(set(ids))).all()}
    for aid in set(ids):
        a = agents.get(aid)
        if not a or a.archived:
            raise HTTPException(422, detail={"code": "AGENT_UNAVAILABLE",
                                             "message": f"Agent {aid} 不存在或已归档"})


def _active_session(db: Session, gid: str) -> AgentGroupSession | None:
    return (db.query(AgentGroupSession)
            .filter(AgentGroupSession.group_id == gid,
                    AgentGroupSession.status == "active").first())


def _view(db: Session, g: AgentGroup) -> dict[str, Any]:
    members = (db.query(AgentGroupMember)
               .filter(AgentGroupMember.group_id == g.id)
               .order_by(AgentGroupMember.created_at).all())
    agents = {a.id: a.name for a in db.query(Agent).filter(
        Agent.id.in_([m.agent_id for m in members] or [""])).all()}
    active = _active_session(db, g.id)
    return {
        "id": g.id,
        "name": g.name,
        "description": g.description,
        "leaderAgentId": g.leader_agent_id,
        "avatar": g.avatar,
        "archived": bool(g.archived),
        "revision": g.revision,
        "memberCount": len(members),
        "members": [{"agentId": m.agent_id, "role": m.role, "config": m.config,
                     "agentName": agents.get(m.agent_id, "")} for m in members],
        "activeSessionId": active.id if active else None,
        "createdAt": g.created_at.isoformat() if g.created_at else None,
        "updatedAt": g.updated_at.isoformat() if g.updated_at else None,
    }


def _get_group(db: Session, gid: str) -> AgentGroup:
    g = db.get(AgentGroup, gid)
    if not g:
        raise HTTPException(404, "group not found")
    return g


@router.get("")
def list_groups(page: int = 1, pageSize: int = 20, archived: str = "",
                db: Session = Depends(get_db),
                _user: dict = Depends(require_role())):
    q = db.query(AgentGroup)
    if archived == "true":
        q = q.filter(AgentGroup.archived.is_(True))
    elif archived != "all":
        q = q.filter(AgentGroup.archived.is_(False))
    total = q.count()
    rows = (q.order_by(AgentGroup.updated_at.desc())
            .offset((max(1, page) - 1) * pageSize).limit(pageSize).all())
    return {"total": total, "items": [_view(db, g) for g in rows]}


@router.post("")
def create_group(body: GroupCreateBody, db: Session = Depends(get_db),
                 _user: dict = Depends(require_operator)):
    name = _check_name(body.name)
    _validate_roster(db, body.leader_agent_id, body.members)
    g = AgentGroup(name=name, description=body.description,
                   leader_agent_id=body.leader_agent_id)
    db.add(g)
    db.flush()
    for m in body.members:
        db.add(AgentGroupMember(
            group_id=g.id, agent_id=m.agent_id,
            role="leader" if m.agent_id == body.leader_agent_id else "member",
            config=m.config))
    db.commit()
    return _view(db, g)


@router.get("/{gid}")
def get_group(gid: str, db: Session = Depends(get_db),
              _user: dict = Depends(require_role())):
    return _view(db, _get_group(db, gid))


@router.patch("/{gid}")
def patch_group(gid: str, body: GroupPatchBody, db: Session = Depends(get_db),
                _user: dict = Depends(require_operator)):
    g = _get_group(db, gid)
    if body.revision != g.revision:
        raise HTTPException(409, detail={"code": "REVISION_CONFLICT",
                                         "message": "Group 已被更新，请刷新后重试",
                                         "currentRevision": g.revision})
    roster_changed = body.members is not None or (
        body.leader_agent_id is not None and body.leader_agent_id != g.leader_agent_id)
    if roster_changed and _active_session(db, g.id):
        raise HTTPException(409, detail={"code": "ROSTER_FROZEN",
                                         "message": "存在 active 群会话，成员/Leader 已冻结；先关聊再改"})
    if body.name is not None:
        g.name = _check_name(body.name)
    if body.description is not None:
        g.description = body.description
    if body.members is not None:
        leader = body.leader_agent_id or g.leader_agent_id
        _validate_roster(db, leader, body.members)
        db.query(AgentGroupMember).filter(
            AgentGroupMember.group_id == g.id).delete()
        for m in body.members:
            db.add(AgentGroupMember(
                group_id=g.id, agent_id=m.agent_id,
                role="leader" if m.agent_id == leader else "member",
                config=m.config))
        g.leader_agent_id = leader
    elif body.leader_agent_id is not None:
        # 仅换 Leader：须 ∈ 现成员
        cur = {m.agent_id: m for m in db.query(AgentGroupMember)
               .filter(AgentGroupMember.group_id == g.id).all()}
        if body.leader_agent_id not in cur:
            raise HTTPException(422, detail={"code": "LEADER_NOT_MEMBER",
                                             "message": "Leader 必须是成员之一"})
        for m in cur.values():
            m.role = "leader" if m.agent_id == body.leader_agent_id else "member"
        g.leader_agent_id = body.leader_agent_id
    g.revision += 1
    db.commit()
    return _view(db, g)


@router.delete("/{gid}")
def delete_group(gid: str, db: Session = Depends(get_db),
                 _user: dict = Depends(require_operator)):
    g = _get_group(db, gid)
    has_sessions = (db.query(AgentGroupSession)
                    .filter(AgentGroupSession.group_id == g.id).count() > 0)
    if has_sessions:
        # 删除=归档语义（会话/流水可追溯，Spec §4.1 DELETE）
        g.archived = True
        g.revision += 1
        db.commit()
        return {"id": g.id, "archived": True}
    db.query(AgentGroupMember).filter(AgentGroupMember.group_id == g.id).delete()
    db.delete(g)
    db.commit()
    return {"id": gid, "deleted": True}


@router.post("/{gid}/archive")
def archive_group(gid: str, db: Session = Depends(get_db),
                  _user: dict = Depends(require_operator)):
    g = _get_group(db, gid)
    if _active_session(db, g.id):
        raise HTTPException(409, detail={"code": "ACTIVE_SESSION_EXISTS",
                                         "message": "存在 active 群会话，先关聊再归档"})
    g.archived = True
    g.revision += 1
    db.commit()
    return _view(db, g)


@router.post("/{gid}/restore")
def restore_group(gid: str, db: Session = Depends(get_db),
                  _user: dict = Depends(require_operator)):
    g = _get_group(db, gid)
    g.archived = False
    g.revision += 1
    db.commit()
    return _view(db, g)


@router.get("/{gid}/sessions")
def list_sessions(gid: str, db: Session = Depends(get_db),
                  _user: dict = Depends(require_role())):
    _get_group(db, gid)
    rows = (db.query(AgentGroupSession)
            .filter(AgentGroupSession.group_id == gid)
            .order_by(AgentGroupSession.created_at.desc()).all())
    return {"items": [{"id": s.id, "title": s.title, "status": s.status,
                       "leaderSessionId": s.leader_session_id,
                       "runtimeTeamId": s.runtime_team_id,
                       "closedAt": s.closed_at.isoformat() if s.closed_at else None,
                       "createdAt": s.created_at.isoformat() if s.created_at else None}
                      for s in rows]}


@router.get("/{gid}/sessions/{gsid}")
def get_session_detail(gid: str, gsid: str, db: Session = Depends(get_db),
                       _user: dict = Depends(require_role())):
    """群会话详情+成员 session 映射（聚合流与 UI roster 用，Spec §4.1）。"""
    s = _get_session(db, gsid)
    if s.group_id != gid:
        raise HTTPException(404, "group session not in group")
    g = _get_group(db, gid)
    rows = _session_members(db, gsid)
    return {
        "id": s.id, "title": s.title, "status": s.status,
        "leaderSessionId": s.leader_session_id, "runtimeTeamId": s.runtime_team_id,
        "leaderAgentId": g.leader_agent_id,
        "members": [{"agentId": r.agent_id, "sessionId": r.session_id,
                     "role": "leader" if r.agent_id == g.leader_agent_id else "member"}
                    for r in rows],
        "closedAt": s.closed_at.isoformat() if s.closed_at else None,
        "createdAt": s.created_at.isoformat() if s.created_at else None,
    }


# ---------------------------------------------------------------------------
# P2：群会话闭环（Spec §4.1/§4.2/§4.3）
# ---------------------------------------------------------------------------


def _get_session(db: Session, gsid: str) -> AgentGroupSession:
    s = db.get(AgentGroupSession, gsid)
    if not s:
        raise HTTPException(404, "group session not found")
    return s


def _session_members(db: Session, gsid: str) -> list[AgentGroupSessionMember]:
    return (db.query(AgentGroupSessionMember)
            .filter(AgentGroupSessionMember.group_session_id == gsid).all())


def open_group_session(db: Session, gid: str, uid: str, *,
                       reuse_active: bool = False) -> AgentGroupSession:
    """开聊=装配（不变量 3/5；D2：active 存在 409，reuse_active=True 时返回
    既有 active 会话供 automation 派发复用）。"""
    from .. import agentscope_client as rt
    from ..agentflow_executor import _node_runtime_binding

    g = _get_group(db, gid)
    if g.archived:
        raise HTTPException(409, detail={"code": "GROUP_ARCHIVED",
                                         "message": "Group 已归档，先恢复再开聊"})
    active = _active_session(db, gid)
    if active:
        if reuse_active:
            return active
        raise HTTPException(409, detail={"code": "ACTIVE_SESSION_EXISTS",
                                         "message": "已有 active 群会话，续聊或先关聊"})
    members = (db.query(AgentGroupMember)
               .filter(AgentGroupMember.group_id == gid).all())
    bindings: dict[str, dict] = {}
    for m in members:
        try:
            runtime_id, extra = _node_runtime_binding(db, uid, m.agent_id)
        except ValueError as exc:
            raise HTTPException(422, detail={
                "code": "AGENT_NOT_PUBLISHED",
                "message": f"成员 {m.agent_id} 缺 prod active release：{exc}"}) from exc
        bindings[m.agent_id] = {
            "runtime_agent_id": runtime_id,
            "chat_model_config": extra["chat_model_config"],
            "knowledge_ids": extra["knowledge_ids"],
        }
    seq = (db.query(AgentGroupSession)
           .filter(AgentGroupSession.group_id == gid).count()) + 1
    gs = AgentGroupSession(group_id=gid, title=f"任务 {seq}",
                           binding_snapshot=bindings)
    db.add(gs)
    db.flush()
    token = uuid.uuid4().hex
    # g063：绑定中且已发布的 SOP 内容随装配注入全员系统上下文
    from ..models import AgentGroupSop
    sop_content = ""
    if g.sop_id:
        sop = db.get(AgentGroupSop, g.sop_id)
        if sop and sop.status == "published":
            sop_content = sop.content_md or ""
    body = {
        "team_name": g.name,
        "team_description": g.description or "",
        "leader": bindings[g.leader_agent_id],
        "workers": [bindings[m.agent_id] for m in members
                    if m.agent_id != g.leader_agent_id],
        "internal_token": token,
        "sop_content": sop_content,
    }
    try:
        out = rt.group_session(uid, body)
    except rt.RuntimeError_ as exc:
        db.rollback()
        raise HTTPException(502, detail={"code": "RUNTIME_ASSEMBLY_FAILED",
                                         "message": str(exc)[:300]}) from exc
    gs.leader_session_id = out["leader_session_id"]
    gs.runtime_team_id = out["runtime_team_id"]
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    idx_rows = [AgentSessionIndex(
        session_id=out["leader_session_id"], user_id=uid,
        agent_id=g.leader_agent_id,
        runtime_agent_id=bindings[g.leader_agent_id]["runtime_agent_id"],
        trigger_kind="group", group_session_id=gs.id,
        session_token_hash=token_hash)]
    db.add(AgentGroupSessionMember(
        group_session_id=gs.id, agent_id=g.leader_agent_id,
        session_id=out["leader_session_id"]))
    for ms in out["member_sessions"]:
        platform_agent = next(m.agent_id for m in members
                              if bindings[m.agent_id]["runtime_agent_id"]
                              == ms["runtime_agent_id"])
        db.add(AgentGroupSessionMember(
            group_session_id=gs.id, agent_id=platform_agent,
            session_id=ms["session_id"]))
        idx_rows.append(AgentSessionIndex(
            session_id=ms["session_id"], user_id=uid, agent_id=platform_agent,
            runtime_agent_id=ms["runtime_agent_id"],
            trigger_kind="group", group_session_id=gs.id,
            session_token_hash=token_hash))
    for row in idx_rows:
        db.add(row)
    db.commit()
    # g063：群技能挂载进每个成员 session 的 workspace（失败不阻断开聊）
    from ..models import SkillResource
    skill_rows = (db.query(AgentGroupSkill)
                  .filter(AgentGroupSkill.group_id == gid).all())
    if skill_rows:
        sess_pairs = [(out["leader_session_id"],
                       bindings[g.leader_agent_id]["runtime_agent_id"])]
        sess_pairs += [(ms["session_id"], ms["runtime_agent_id"])
                       for ms in out["member_sessions"]]
        idx_by_sess = {i.session_id: i for i in db.query(AgentSessionIndex)
                       .filter(AgentSessionIndex.group_session_id == gs.id).all()}
        for sr in skill_rows:
            skill = db.get(SkillResource, sr.skill_id)
            if not skill:
                continue
            for sess_id, rt_agent in sess_pairs:
                idx = idx_by_sess.get(sess_id)
                try:
                    rt.upload_workspace_skill(
                        (idx.user_id if idx else uid) or uid, rt_agent, sess_id,
                        root=skill.name,
                        parts=[("SKILL.md",
                                (skill.content or "").encode("utf-8"))])
                except Exception:  # noqa: BLE001 —— 单会话挂载失败不阻断开聊
                    continue
    db.refresh(gs)
    return gs


@router.post("/{gid}/sessions")
def open_session(gid: str, db: Session = Depends(get_db),
                 user: dict = Depends(require_operator)):
    gs = open_group_session(db, gid, user.get("username", "dev"))
    return {"id": gs.id, "title": gs.title, "status": gs.status,
            "leaderSessionId": gs.leader_session_id,
            "runtimeTeamId": gs.runtime_team_id}


@router.post("/{gid}/sessions/{gsid}/turns")
def group_turn(gid: str, gsid: str, body: TurnBody,
               db: Session = Depends(get_db),
               user: dict = Depends(require_operator)):
    from .. import agentscope_client as rt

    s = _get_session(db, gsid)
    if s.group_id != gid:
        raise HTTPException(404, "group session not in group")
    if s.status != "active":
        raise HTTPException(409, detail={"code": "SESSION_CLOSED",
                                         "message": "群会话已关闭，只读"})
    # g064 不变量 10：回合预算闸门
    if s.turn_count >= s.max_team_turns:
        raise HTTPException(409, detail={
            "code": "BUDGET_EXCEEDED",
            "message": f"群会话已达回合预算 {s.max_team_turns}，"
                       "请关聊新建任务或提升 max_team_turns"})
    s.turn_count += 1
    uid = user.get("username", "dev")
    idx = (db.query(AgentSessionIndex)
           .filter_by(session_id=s.leader_session_id).first())
    rt.chat_trigger(idx.user_id or uid, idx.runtime_agent_id,
                    s.leader_session_id, body.text)
    return {"status": "started", "session_id": s.leader_session_id}


@router.get("/{gid}/sessions/{gsid}/stream")
def group_stream(gid: str, gsid: str, request: Request,
                 db: Session = Depends(get_db),
                 user: dict = Depends(require_role())):
    """聚合 SSE（Spec §4.3）：leader+workers 共成员数路合流，source 标签+单调 id。"""
    import queue
    import threading

    import httpx
    from fastapi.responses import StreamingResponse

    from .. import agentscope_client as rt

    s = _get_session(db, gsid)
    if s.group_id != gid:
        raise HTTPException(404, "group session not in group")
    rows = _session_members(db, gsid)
    agents = {a.id: a.name for a in db.query(Agent).filter(
        Agent.id.in_([r.agent_id for r in rows])).all()}
    idx_map = {i.session_id: i for i in db.query(AgentSessionIndex).filter(
        AgentSessionIndex.group_session_id == gsid).all()}
    sources = []
    for r in rows:
        idx = idx_map.get(r.session_id)
        if not idx or not idx.runtime_agent_id:
            continue
        sources.append({
            "agent_id": r.agent_id,
            "name": agents.get(r.agent_id, r.agent_id),
            "role": "leader" if r.agent_id == _get_group(db, gid).leader_agent_id
            else "member",
            "session_id": r.session_id,
            "runtime_agent_id": idx.runtime_agent_id,
            "runtime_uid": idx.user_id or "dev",
        })

    q: queue.Queue = queue.Queue()

    def pump(src: dict) -> None:
        url = rt.stream_url(src["session_id"], src["runtime_agent_id"])
        try:
            with httpx.Client(timeout=httpx.Timeout(None, read=None)) as client:
                with client.stream(
                        "GET", url,
                        headers={"X-User-ID": src["runtime_uid"]}) as upstream:
                    for line in upstream.iter_lines():
                        if not line.startswith("data: "):
                            continue
                        q.put((src, line[len("data: "):]))
        except Exception:  # noqa: BLE001 —— 单路断开不拖垮聚合流
            q.put((src, None))

    threads = [threading.Thread(target=pump, args=(src,), daemon=True)
               for src in sources]
    for t in threads:
        t.start()

    def gen():
        seq = 0
        alive = len(threads)
        while alive:
            try:
                src, data = q.get(timeout=30)
            except queue.Empty:
                yield ": keepalive\n\n"
                continue
            if data is None:
                alive -= 1
                continue
            seq += 1
            payload = json.dumps({"id": seq, "source": {
                "agentId": src["agent_id"], "name": src["name"],
                "role": src["role"], "sessionId": src["session_id"]},
                "payload": data})
            yield f"id: {seq}\ndata: {payload}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")


class ConfirmBody(BaseModel):
    agent_id: str
    confirmed: bool = True


@router.post("/{gid}/sessions/{gsid}/confirm")
def group_confirm(gid: str, gsid: str, body: ConfirmBody,
                  db: Session = Depends(get_db),
                  user: dict = Depends(require_role())):
    """成员 HITL 审批：按 agent_id 定位成员 session（Spec §4.1）。"""
    from .. import agentscope_client as rt

    s = _get_session(db, gsid)
    row = (db.query(AgentGroupSessionMember)
           .filter(AgentGroupSessionMember.group_session_id == gsid,
                   AgentGroupSessionMember.agent_id == body.agent_id).first())
    if not row:
        raise HTTPException(404, "member session not found")
    idx = (db.query(AgentSessionIndex)
           .filter_by(session_id=row.session_id).first())
    uid = user.get("username", "dev")
    runtime_uid = idx.user_id if idx else uid
    runtime_id = idx.runtime_agent_id if idx else None
    msgs = rt.session_messages(runtime_uid, runtime_id,
                               row.session_id).get("messages", [])
    reply_id, pending = None, []
    for m in reversed(msgs):
        if m.get("role") != "assistant":
            continue
        content = m.get("content") or []
        done = {str(b.get("id") or b.get("tool_call_id") or "")
                for b in content if isinstance(b, dict)
                and b.get("type") == "tool_result"}
        pending = [b for b in content if isinstance(b, dict)
                   and b.get("type") == "tool_call"
                   and str(b.get("id") or "") not in done]
        if pending:
            reply_id = str(m.get("id") or "")
            break
    if not pending or not reply_id:
        raise HTTPException(409, detail={"code": "NO_PENDING_PERMISSION",
                                         "message": "该成员会话没有等待确认的工具调用"})
    return rt.chat_confirm(runtime_uid, runtime_id, row.session_id,
                           reply_id, pending, body.confirmed)


class InterruptBody(BaseModel):
    scope: str = "all"  # leader|all


@router.post("/{gid}/sessions/{gsid}/interrupt")
def group_interrupt(gid: str, gsid: str, body: InterruptBody | None = None,
                    db: Session = Depends(get_db),
                    user: dict = Depends(require_operator)):
    from .. import agentscope_client as rt

    s = _get_session(db, gsid)
    scope = (body or InterruptBody()).scope
    rows = _session_members(db, gsid)
    leader_agent = _get_group(db, gid).leader_agent_id
    targets = [r for r in rows if (scope == "all" or r.agent_id == leader_agent)]
    out = []
    for r in targets:
        idx = (db.query(AgentSessionIndex)
               .filter_by(session_id=r.session_id).first())
        if not idx or not idx.runtime_agent_id:
            continue
        out.append(rt.interrupt_session(idx.user_id or "dev",
                                        idx.runtime_agent_id, r.session_id))
    return {"interrupted": len(out)}


@router.delete("/{gid}/sessions/{gsid}")
def close_session(gid: str, gsid: str, db: Session = Depends(get_db),
                  _user: dict = Depends(require_operator)):
    """关聊：标 closed 不解散 runtime（不变量 6/11，transcript 保真可重放）。"""
    s = _get_session(db, gsid)
    if s.status == "closed":
        raise HTTPException(409, detail={"code": "SESSION_CLOSED",
                                         "message": "群会话已关闭"})
    s.status = "closed"
    s.closed_at = datetime.now(timezone.utc)
    db.commit()
    return {"id": s.id, "status": "closed"}


# ---------------------------------------------------------------------------
# g063：群技能挂载 + 成员协作 SOP（D8 提前落地；Spec §3.1）
# ---------------------------------------------------------------------------


class GroupSkillBody(BaseModel):
    skill_id: str


@router.get("/{gid}/skills")
def list_group_skills(gid: str, db: Session = Depends(get_db),
                      _user: dict = Depends(require_role())):
    from ..models import SkillResource
    _get_group(db, gid)
    rows = (db.query(AgentGroupSkill)
            .filter(AgentGroupSkill.group_id == gid).all())
    out = []
    for r in rows:
        s = db.get(SkillResource, r.skill_id)
        out.append({"id": r.id, "skillId": r.skill_id,
                    "name": s.name if s else r.skill_id,
                    "description": (s.description if s else "") or ""})
    return {"items": out}


@router.post("/{gid}/skills")
def mount_group_skill(gid: str, body: GroupSkillBody,
                      db: Session = Depends(get_db),
                      _user: dict = Depends(require_operator)):
    from ..models import SkillResource
    g = _get_group(db, gid)
    if g.archived:
        raise HTTPException(409, detail={"code": "GROUP_ARCHIVED",
                                         "message": "Group 已归档"})
    if not db.get(SkillResource, body.skill_id):
        raise HTTPException(404, "skill not found")
    exists = (db.query(AgentGroupSkill)
              .filter(AgentGroupSkill.group_id == gid,
                      AgentGroupSkill.skill_id == body.skill_id).first())
    if exists:
        raise HTTPException(409, detail={"code": "SKILL_ALREADY_MOUNTED",
                                         "message": "技能已挂载"})
    row = AgentGroupSkill(group_id=gid, skill_id=body.skill_id)
    db.add(row)
    db.commit()
    # 已存在的 active 会话立即补挂（新会话在装配时挂）
    _push_skills_to_active(db, gid, [body.skill_id])
    return {"id": row.id}


@router.delete("/{gid}/skills/{skill_id}")
def unmount_group_skill(gid: str, skill_id: str, db: Session = Depends(get_db),
                        _user: dict = Depends(require_operator)):
    row = (db.query(AgentGroupSkill)
           .filter(AgentGroupSkill.group_id == gid,
                   AgentGroupSkill.skill_id == skill_id).first())
    if not row:
        raise HTTPException(404, "mount not found")
    db.delete(row)
    db.commit()
    return {"deleted": True}


def _push_skills_to_active(db: Session, gid: str, skill_ids: list[str]) -> None:
    """active 群会话补挂技能（运行时会话 workspace 上传；失败不阻断挂载登记）。"""
    from .. import agentscope_client as rt
    from ..models import SkillResource
    active = _active_session(db, gid)
    if not active or not skill_ids:
        return
    rows = _session_members(db, active.id)
    idx_map = {i.session_id: i for i in db.query(AgentSessionIndex).filter(
        AgentSessionIndex.group_session_id == active.id).all()}
    for sid in skill_ids:
        skill = db.get(SkillResource, sid)
        if not skill:
            continue
        for r in rows:
            idx = idx_map.get(r.session_id)
            if not idx or not idx.runtime_agent_id:
                continue
            try:
                rt.upload_workspace_skill(
                    idx.user_id or "dev", idx.runtime_agent_id, r.session_id,
                    root=skill.name,
                    parts=[("SKILL.md", (skill.content or "").encode("utf-8"))])
            except Exception:  # noqa: BLE001 —— 运行时会话可能已关闭；登记仍生效
                continue


class SopBody(BaseModel):
    name: str
    content: str = ""


@router.get("/{gid}/sops")
def list_group_sops(gid: str, db: Session = Depends(get_db),
                    _user: dict = Depends(require_role())):
    from ..models import AgentGroupSop
    g = _get_group(db, gid)
    rows = (db.query(AgentGroupSop)
            .filter(AgentGroupSop.group_id == gid)
            .order_by(AgentGroupSop.created_at.desc()).all())
    return {"boundSopId": g.sop_id, "items": [
        {"id": r.id, "name": r.name, "revision": r.revision, "status": r.status,
         "content": r.content_md,
         "publishedAt": r.published_at.isoformat() if r.published_at else None}
        for r in rows]}


@router.post("/{gid}/sops")
def create_group_sop(gid: str, body: SopBody, db: Session = Depends(get_db),
                     _user: dict = Depends(require_operator)):
    from ..models import AgentGroupSop
    g = _get_group(db, gid)
    name = (body.name or "").strip()
    if not name or len(name) > 64:
        raise HTTPException(422, detail={"code": "SOP_NAME_INVALID",
                                         "message": "SOP 名称须为 1-64 字"})
    row = AgentGroupSop(group_id=g.id, name=name, content_md=body.content)
    db.add(row)
    db.commit()
    return {"id": row.id, "status": row.status, "revision": row.revision}


@router.patch("/{gid}/sops/{sop_id}")
def patch_group_sop(gid: str, sop_id: str, body: SopBody,
                    db: Session = Depends(get_db),
                    _user: dict = Depends(require_operator)):
    from ..models import AgentGroupSop
    row = db.get(AgentGroupSop, sop_id)
    if not row or row.group_id != gid:
        raise HTTPException(404, "sop not found")
    if row.status == "published":
        # 不可变发布语义：published 只读，修改请新建 draft（Spec §3.1）
        raise HTTPException(409, detail={"code": "SOP_IMMUTABLE",
                                         "message": "已发布 SOP 只读；请新建草稿修订"})
    row.name = (body.name or row.name).strip() or row.name
    row.content_md = body.content
    row.revision += 1
    db.commit()
    return {"id": row.id, "revision": row.revision}


@router.post("/{gid}/sops/{sop_id}/publish")
def publish_group_sop(gid: str, sop_id: str, db: Session = Depends(get_db),
                      _user: dict = Depends(require_operator)):
    from ..models import AgentGroupSop
    row = db.get(AgentGroupSop, sop_id)
    if not row or row.group_id != gid:
        raise HTTPException(404, "sop not found")
    if row.status == "published":
        raise HTTPException(409, detail={"code": "SOP_ALREADY_PUBLISHED",
                                         "message": "SOP 已发布"})
    row.status = "published"
    row.published_at = datetime.now(timezone.utc)
    db.commit()
    return {"id": row.id, "status": row.status}


class SopBindBody(BaseModel):
    sop_id: str | None = None


@router.post("/{gid}/sop-bind")
def bind_group_sop(gid: str, body: SopBindBody, db: Session = Depends(get_db),
                   _user: dict = Depends(require_operator)):
    """群绑定指针原子替换；仅可绑 published（或解绑 null）。"""
    from ..models import AgentGroupSop
    g = _get_group(db, gid)
    if body.sop_id:
        row = db.get(AgentGroupSop, body.sop_id)
        if not row or row.group_id != gid:
            raise HTTPException(404, "sop not found")
        if row.status != "published":
            raise HTTPException(409, detail={"code": "SOP_NOT_PUBLISHED",
                                             "message": "仅可绑定已发布 SOP"})
    g.sop_id = body.sop_id
    g.revision += 1
    db.commit()
    return {"boundSopId": g.sop_id}
