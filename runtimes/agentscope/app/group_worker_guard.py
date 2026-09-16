"""Group worker 退化兜底中继（09-16 用户质疑「退化无法处理」的纠正实现）。

官方 TeamMemberLoopMiddleware 在 worker 连续 max_nudges 次未真调 TeamSay 后
以 ReplyEndEvent(ERROR) 放弃本回合——报告文本随之丢失，Leader 只收到失败通知。
退化（模型不发 tool call）本身不可根除（随机行为），但**后果可兜住**：
本模块在放弃点之前把 worker 最后一条回复文本自动中继进 Leader inbox
（HintBlock 带 [auto-relay] 标记），退化降级为「带标记的非正式汇报」。

挂钩方式与 tool_policy 同款：替换 middleware 类引用（_chat 以 from-import
绑定，须同步替换其模块属性）。装配期由 group_runner 登记
worker_session_id → (leader_session_id, leader_agent_id, user_id)。
"""
from __future__ import annotations

from typing import AsyncGenerator, Callable

from agentscope.app._service import _chat as _chat_mod
from agentscope.app.middleware import _team_member_middleware as _tmw_mod
from agentscope.app.middleware._team_member_middleware import (
    TeamMemberLoopMiddleware,
)
from agentscope.event import ReplyEndEvent
from agentscope.message import HintBlock

# 装配期登记：worker session → leader 路由信息
_REGISTRY: dict[str, dict] = {}
_BUS = None


def set_bus(bus) -> None:
    global _BUS
    _BUS = bus


def register_worker(worker_session_id: str, *, leader_session_id: str,
                    leader_agent_id: str, user_id: str) -> None:
    _REGISTRY[worker_session_id] = {
        "leader_session_id": leader_session_id,
        "leader_agent_id": leader_agent_id,
        "user_id": user_id,
    }


def _last_assistant_text(agent) -> str:
    """本回合最后一条 assistant 文本；reply_id 失配时退化为全局最后一条。"""
    reply_id = getattr(agent.state, "reply_id", None)
    for strict in (True, False):
        for msg in reversed(agent.state.context):
            if msg.role != "assistant":
                continue
            if strict and reply_id and msg.id != reply_id:
                continue
            parts = []
            for block in msg.get_content_blocks():
                text = getattr(block, "text", None)
                if text:
                    parts.append(str(text))
            if parts:
                return "\n".join(parts)
        if not strict:
            break
    return ""


class RelayingTeamMemberLoopMiddleware(TeamMemberLoopMiddleware):
    """放弃点兜底：ERROR 释放前把 worker 最后文本中继给 Leader。"""

    async def on_reply(
        self,
        agent,
        input_kwargs: dict,
        next_handler: Callable[..., AsyncGenerator],
    ) -> AsyncGenerator:
        async for evt in super().on_reply(agent, input_kwargs, next_handler):
            if (
                isinstance(evt, ReplyEndEvent)
                and evt.error is not None
                and "giving up" in (evt.error.message or "")
            ):
                await self._relay(agent)
            yield evt

    async def _relay(self, agent) -> None:
        if _BUS is None:
            return
        info = _REGISTRY.get(str(getattr(agent.state, "session_id", "")))
        if not info:
            return
        text = _last_assistant_text(agent)
        if not text:
            return
        from agentscope.app._bus_ops import deliver_to_inbox

        await deliver_to_inbox(
            _BUS,
            user_id=info["user_id"],
            session_id=info["leader_session_id"],
            agent_id=info["leader_agent_id"],
            payload=HintBlock(
                hint=(
                    f"<team-message from=\"{agent.name}\" auto-relay=\"true\">"
                    f"[auto-relay] {agent.name} 本回合未通过 TeamSay 汇报"
                    f"（模型退化，系统兜底中继其最后文本，供参考非正式汇报）："
                    f"{text[:2000]}</team-message>"
                ),
                source='{"label": "System", "sublabel": "AutoRelay"}',
            ).model_dump(),
        )


def install() -> None:
    _tmw_mod.TeamMemberLoopMiddleware = RelayingTeamMemberLoopMiddleware
    _chat_mod.TeamMemberLoopMiddleware = RelayingTeamMemberLoopMiddleware
