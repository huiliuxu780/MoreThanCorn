"""P1X — Group 装配契约（无 LLM；Spec group-capability v1.1 §4.2/§4.3/不变量 4）。

证据（全部直连 probe 库/Redis，不经 app 进程、不耗模型额度）：
- 装配序：leader session → worker sessions → upsert_team（members 仅 worker、
  role=invited）→ set_session_team_id 全员；_LeaderContext 前置条件成立
  （team.session_id == leader session id 且 leader session.team_id 非空）
- TeamSay 路由：leader TeamSay(to=worker 名) 在 worker session inbox 落地
  HintBlock payload（bus queue drain 实证）
- 重启恢复：全新 storage 实例读回 team 花名册与全员 team_id（进程重启可续，不变量 9）
- fail-closed：tool_policy.group_denied_tools——群会话+无 manifest=deny 全 subagent
  族（含 TeamSay）；群会话+有 manifest=仅四建团工具；非群会话=[]（不变量 4）
LLM 真回合（leader 派活→worker 汇报→汇总）留 P2 live E2E（--live 门禁）。
"""
from __future__ import annotations

import asyncio
import uuid

from agentscope.agent import ContextConfig, ReActConfig
from agentscope.app._tool._team_say import TeamSay
from agentscope.app.message_bus import MessageBusKeys, RedisMessageBus
from agentscope.app.storage import AsyncSQLAlchemyStorage
from agentscope.app.storage._model._agent import AgentData, AgentRecord
from agentscope.app.storage._model._session import SessionConfig
from agentscope.app.storage._model._team import TeamData, TeamMember, TeamRecord
from agentscope.app.workspace_manager import LocalWorkspaceManager

from app import tool_policy
from probes import common as C

USER = C.USER


async def _assemble(storage):
    """Spec §4.2 ①-④ 的平台装配序（串行）。返回 ids 字典。"""
    tag = uuid.uuid4().hex[:8]
    leader_name, worker_name = f"p1x-leader-{tag}", f"p1x-worker-{tag}"
    leader_rec = await storage.upsert_agent(
        USER, AgentRecord(user_id=USER,
                          data=AgentData(name=leader_name,
                                         system_prompt="leader",
                                         context_config=ContextConfig(),
                                         react_config=ReActConfig())))
    worker_rec = await storage.upsert_agent(
        USER, AgentRecord(user_id=USER,
                          data=AgentData(name=worker_name,
                                         system_prompt="worker",
                                         context_config=ContextConfig(),
                                         react_config=ReActConfig())))
    cfg = SessionConfig(workspace_id=f"p1x-ws-{tag}")
    leader_sid = (await storage.upsert_session(
        USER, leader_rec, config=cfg)).id                  # ①
    worker_sid = (await storage.upsert_session(
        USER, worker_rec, config=cfg)).id                  # ②
    team = await storage.upsert_team(USER, TeamRecord(   # ③
        user_id=USER,
        session_id=leader_sid,
        leader_agent_id=leader_rec,
        data=TeamData(
            name=f"p1x-team-{tag}",
            description="probe",
            members=[TeamMember(owner_id=USER, agent_id=worker_rec,
                                session_id=worker_sid, role="invited")],
        ),
    ))
    await storage.set_session_team_id(USER, leader_sid, team.id)   # ④
    await storage.set_session_team_id(USER, worker_sid, team.id)
    return {"tag": tag, "leader": leader_rec, "worker": worker_rec,
            "leader_sid": leader_sid, "worker_sid": worker_sid,
            "team_id": team.id,
            "worker_name": f"p1x-worker-{tag}"}


async def main() -> None:
    # storage/bus 表与连接在 __aenter__ 建立（create_tables 默认 True）
    async with AsyncSQLAlchemyStorage(C.PROBE_DB_URL) as storage, \
            RedisMessageBus(db=C.REDIS_DB) as bus:
        await _run(storage, bus)


async def _run(storage, bus) -> None:
    wm = LocalWorkspaceManager(C.WS_ROOT)
    ids = await _assemble(storage)

    # —— 装配序断言：_LeaderContext 前置条件
    team = await storage.get_team(USER, ids["team_id"])
    leader_sess = await storage.get_session(USER, ids["leader"], ids["leader_sid"])
    worker_sess = await storage.get_session(USER, ids["worker"], ids["worker_sid"])
    assert team is not None and team.session_id == ids["leader_sid"]
    assert leader_sess.team_id == ids["team_id"]
    assert worker_sess.team_id == ids["team_id"]
    assert [m.role for m in team.data.members] == ["invited"]
    assert team.data.members[0].session_id == ids["worker_sid"]
    C.evidence("p1x_team", "assembly_order", {
        "leader_context_precond": True,
        "members_roles": ["invited"],
        "team_session_is_leader": True})

    # —— TeamSay 路由：leader → worker inbox
    say = TeamSay(storage, bus, wm, USER, ids["leader_sid"], ids["leader"],
                  role="leader")
    # 官方 directory 命名：invited 成员 = name@agent_id[:8]（Spec §4.2 寻址规则）
    chunk = await say(content="请把质检结论汇报给我",
                      to=f"{ids['worker_name']}@{ids['worker'][:8]}")
    drained = await bus.queue_drain(MessageBusKeys.inbox(ids["worker_sid"]))
    assert drained, "worker inbox 应收到 TeamSay payload"
    payload = drained[0] if isinstance(drained, list) else drained
    raw = str(payload)
    assert "team-message" in raw or "HintBlock" in raw or "汇报" in raw
    C.evidence("p1x_team", "teamsay_routing", {
        "delivered_to_worker_inbox": True,
        "payload_keys": sorted(payload.keys()) if isinstance(payload, dict) else None})

    # —— 重启恢复：全新 storage 实例读回
    async with AsyncSQLAlchemyStorage(C.PROBE_DB_URL) as storage2:
        team2 = await storage2.get_team(USER, ids["team_id"])
        sess2 = await storage2.get_session(USER, ids["leader"], ids["leader_sid"])
        assert team2 is not None and len(team2.data.members) == 1
        assert sess2.team_id == ids["team_id"]
    C.evidence("p1x_team", "restart_recovery", {
        "team_roster_survives": True, "leader_team_id_survives": True})

    # —— fail-closed / 建团工具摘除（不变量 4，纯决策函数）
    deny_no_manifest = tool_policy.group_denied_tools(True, {})
    deny_with_manifest = tool_policy.group_denied_tools(True, {"tool_policy": {}})
    deny_non_group = tool_policy.group_denied_tools(False, {})
    assert deny_no_manifest == ["AgentCreate", "AgentInvite", "TeamCreate",
                                "TeamDelete", "TeamSay"]
    assert deny_with_manifest == ["AgentCreate", "AgentInvite", "TeamCreate",
                                  "TeamDelete"]
    assert deny_non_group == []
    C.evidence("p1x_team", "fail_closed", {
        "group_no_manifest": deny_no_manifest,
        "group_with_manifest": deny_with_manifest,
        "non_group": deny_non_group})

    print("P1X OK")


if __name__ == "__main__":
    asyncio.run(main())
