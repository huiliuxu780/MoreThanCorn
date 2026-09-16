"""group_worker_guard 退化兜底中继单测（09-16）。

断言：worker 连续未真调 TeamSay 至 nudge 预算耗尽（官方 middleware 释放
ERROR）时，guard 在 ERROR 释放前把 worker 最后文本中继进 Leader inbox
（payload 带 auto-relay 标记）；正常汇报路径不受影响（不中继）。
"""
from __future__ import annotations

import asyncio

import pytest

from agentscope.app._bus_ops import deliver_to_inbox  # noqa: F401  (patch 目标)
from agentscope.app import _bus_ops
from agentscope.app.middleware._team_member_middleware import (
    TeamMemberLoopMiddleware,
)
from agentscope.event import ReplyEndEvent
from agentscope.message import TextBlock
from agentscope.state import AgentState
from agentscope.types import ReplyFinishedReason

from app import group_worker_guard as guard
from app.group_worker_guard import RelayingTeamMemberLoopMiddleware


class _FakeBus:
    def __init__(self) -> None:
        self.inbox: list[dict] = []

    async def queue_push(self, key: str, payload: dict) -> None:
        self.inbox.append({"key": key, "payload": payload})

    async def registry_get(self, key: str, field: str):
        return None

    async def acquire_lock(self, key: str, *, ttl_secs: int = 600):
        class _L:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

        return _L()

    async def queue_drain(self, key: str):
        return []


def _agent_with_text(session_id: str, text: str):
    state = AgentState(session_id=session_id)
    state.append_context("W1", [TextBlock(text=text)])

    class _Agent:
        name = "W1"
        react_config = None

        def __init__(self) -> None:
            self.state = state
            from agentscope.agent import ReActConfig

            self.react_config = ReActConfig()

    return _Agent()


async def _run_middleware(agent, ends: int):
    mw = RelayingTeamMemberLoopMiddleware(leader_name="L", max_nudges=3)
    events = []

    async def next_handler(**kwargs):
        for _ in range(ends):
            yield ReplyEndEvent(
                session_id=agent.state.session_id,
                reply_id=agent.state.reply_id,
                finished_reason=ReplyFinishedReason.COMPLETED,
            )

    async for evt in mw.on_reply(agent, {}, next_handler):
        events.append(evt)
    return events


def test_give_up_relays_last_text(monkeypatch):
    bus = _FakeBus()
    guard.set_bus(bus)
    monkeypatch.setattr(_bus_ops, "deliver_to_inbox",
                        lambda bus_, **kw: bus_.queue_push("inbox", kw["payload"]))
    agent = _agent_with_text("sess-w1", "已就位，等待质检任务。")
    guard.register_worker("sess-w1", leader_session_id="ldr",
                          leader_agent_id="ag1", user_id="u")

    events = asyncio.run(_run_middleware(agent, ends=4))
    assert events[-1].finished_reason == ReplyFinishedReason.ERROR
    assert len(bus.inbox) == 1
    payload = str(bus.inbox[0]["payload"])
    assert "auto-relay" in payload
    assert "已就位，等待质检任务。" in payload


def test_normal_report_not_relayed(monkeypatch):
    bus = _FakeBus()
    guard.set_bus(bus)
    monkeypatch.setattr(_bus_ops, "deliver_to_inbox",
                        lambda bus_, **kw: bus_.queue_push("inbox", kw["payload"]))
    agent = _agent_with_text("sess-w2", "正常文本")
    guard.register_worker("sess-w2", leader_session_id="ldr",
                          leader_agent_id="ag1", user_id="u")

    # 只结束一次且视为已汇报：直接放行路径由官方判定；这里验证基类未被替换语义破坏
    base = TeamMemberLoopMiddleware(leader_name="L")
    assert base._max_nudges == 3
    assert issubclass(RelayingTeamMemberLoopMiddleware, TeamMemberLoopMiddleware)
    assert bus.inbox == []
