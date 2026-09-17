"""Group 装配端点（平台确定性装配，Spec group-capability v1.1 §4.2 / D1）。

POST /mtc/group-session：leader session → worker sessions → upsert_team
（members 仅 worker、role=invited）→ set_session_team_id 全员 → leader 会话
注入群花名册 SystemMsg（TeamSay 寻址名=官方 directory 命名 name@agent_id[:8]）。
严格串行（不变量 5，script_runner.py:56-59 并发挂死先例）。
工具门禁不在这里：tool_policy.group_denied_tools 按 session.team_id 恒摘四建团
工具、manifest 缺失 fail-closed（不变量 4）。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from agentscope.app._service._access import ResourceAccessService
from agentscope.app.deps import (
    get_current_user_id,
    get_resource_access_service,
    get_storage,
    get_workspace_manager,
)
from agentscope.app.storage import StorageBase
from agentscope.app.storage._model._team import TeamData, TeamMember, TeamRecord
from agentscope.message import SystemMsg

from .mtc_router import _new_session

group_router = APIRouter()


class MemberBinding(BaseModel):
    runtime_agent_id: str
    chat_model_config: dict = Field(default_factory=dict)
    knowledge_ids: list[str] = Field(default_factory=list)


class GroupSessionBody(BaseModel):
    team_name: str
    team_description: str = ""
    leader: MemberBinding
    workers: list[MemberBinding]
    internal_token: str | None = None
    # g063：已发布成员协作 SOP 全文（平台装配期注入全员系统上下文）
    sop_content: str = ""


def _roster_msg(team_name: str, workers: list[tuple[str, str]]) -> SystemMsg:
    """leader 会话首条系统消息：群花名册+TeamSay 寻址规则（name@agent_id[:8]）。"""
    lines = [f"你正在群聊「{team_name}」中担任 Leader。"]
    lines.append("群成员（TeamSay 的 to 参数必须使用下列寻址名，广播用 to=None）：")
    for name, addr in workers:
        lines.append(f"- {name} → to=\"{addr}\"")
    lines.append("规则：用 TeamSay 派活；成员会经 TeamSay 汇报；"
                 "收齐汇报后向用户总结。禁止轮询成员。")
    # 09-17（用户指认「群聊里面不能@ leader么」）：@ 语义进花名册——
    # 用户消息里的 @成员名 是点名指派，不是字面文本；leader 须据此自办或转达。
    lines.append("用户在消息中用「@成员名」点名（含 @ 你的名称）：见 @X 即用户把该诉求"
                 "指派给 X；X 是你自己则直接办理，X 是其他成员则用 TeamSay 转达给 X 的"
                 "寻址名；不得回复用户「@ 无效/无法 @」之类的话。")
    return SystemMsg(name="system", content="\n".join(lines))


@group_router.post("/mtc/group-session")
async def create_group_session(
    body: GroupSessionBody,
    user_id: str = Depends(get_current_user_id),
    storage: StorageBase = Depends(get_storage),
    workspace_manager=Depends(get_workspace_manager),
    access: ResourceAccessService = Depends(get_resource_access_service),
):
    from .internal_auth import register

    # ① leader session
    leader_rec = await _new_session(
        storage, workspace_manager, user_id, body.leader.runtime_agent_id,
        body.leader.chat_model_config, body.leader.knowledge_ids)
    if body.internal_token:
        register(leader_rec.id, body.internal_token)
    # ② worker sessions（串行）
    worker_recs = []
    for w in body.workers:
        rec = await _new_session(
            storage, workspace_manager, user_id, w.runtime_agent_id,
            w.chat_model_config, w.knowledge_ids)
        if body.internal_token:
            register(rec.id, body.internal_token)
        worker_recs.append(rec)
    # ③ team（members 仅 worker，官方形态）
    team = await storage.upsert_team(user_id, TeamRecord(
        user_id=user_id,
        session_id=leader_rec.id,
        leader_agent_id=body.leader.runtime_agent_id,
        data=TeamData(
            name=body.team_name,
            description=body.team_description,
            members=[
                TeamMember(owner_id=user_id, agent_id=w.runtime_agent_id,
                           session_id=rec.id, role="invited")
                for w, rec in zip(body.workers, worker_recs)
            ],
        ),
    ))
    # ④ 全员绑 team_id
    await storage.set_session_team_id(user_id, leader_rec.id, team.id)
    for rec in worker_recs:
        await storage.set_session_team_id(user_id, rec.id, team.id)
        # 退化兜底中继登记（group_worker_guard）：worker session → leader 路由
        from .group_worker_guard import register_worker

        register_worker(rec.id, leader_session_id=leader_rec.id,
                        leader_agent_id=body.leader.runtime_agent_id,
                        user_id=user_id)
    # leader 花名册注入（寻址名=官方 directory 命名 name@agent_id[:8]）
    roster: list[tuple[str, str]] = []
    for w in body.workers:
        ag = await storage.get_agent(user_id, w.runtime_agent_id)
        name = ag.data.name if ag else w.runtime_agent_id
        roster.append((name, f"{name}@{w.runtime_agent_id[:8]}"))
    sess = await storage.get_session(user_id, body.leader.runtime_agent_id,
                                     leader_rec.id)
    state = sess.state
    state.context.append(_roster_msg(body.team_name, roster))
    if body.sop_content:
        state.context.append(SystemMsg(
            name="system",
            content="成员协作 SOP（群级协作规则，全员必须遵守）：\n"
                    + body.sop_content))
    await storage.update_session_state(
        user_id, body.leader.runtime_agent_id, leader_rec.id, state)
    # worker 会话注入：汇报规范（必须真调用 TeamSay，正文描述汇报会被
    # TeamMemberLoopMiddleware 判未汇报 nudge×3 → ERROR，活体实测 09-16）+ SOP
    leader_ag = await storage.get_agent(user_id, body.leader.runtime_agent_id)
    leader_name = leader_ag.data.name if leader_ag else "leader"
    leader_addr = f"{leader_name}@{body.leader.runtime_agent_id[:8]}"
    for w, rec in zip(body.workers, worker_recs):
        w_sess = await storage.get_session(
            user_id, w.runtime_agent_id, rec.id)
        w_state = w_sess.state
        w_state.context.append(SystemMsg(
            name="system",
            content="汇报规范：完成工作后必须调用 TeamSay 工具向 Leader 汇报"
                    f"（to=\"{leader_name}\" 或 to=\"{leader_addr}\" 均可）；"
                    "在正文里文字描述汇报无效，会被系统判定未汇报并终止本回合。"))
        if body.sop_content:
            w_state.context.append(SystemMsg(
                name="system",
                content="成员协作 SOP（群级协作规则，全员必须遵守）：\n"
                        + body.sop_content))
        await storage.update_session_state(
            user_id, w.runtime_agent_id, rec.id, w_state)
    # ⑤ 返回
    return {
        "runtime_team_id": team.id,
        "leader_session_id": leader_rec.id,
        "member_sessions": [
            {"runtime_agent_id": w.runtime_agent_id, "session_id": rec.id}
            for w, rec in zip(body.workers, worker_recs)
        ],
    }
