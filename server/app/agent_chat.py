"""已退役的自建对话执行（AgentScope 换底 2026-09-09，P0-07 清尾 2026-09-10）。

本模块只保留 410 退役契约：旧 HTTP 端点（agent_caps）调用 ``start_chat_turn``
得到 ``LegacyChatRetiredError`` → 410。对话一律走 /api/v2/agents/{id}/sessions
+ turns（AgentScope 原生 Session）。

P0-07 删除项（不得复活）：
- 自建 system prompt 拼装（_system_prompt）；
- 自建模型解析（resolve_model_key）与 agent_runtime._chat_completion 依赖；
- 自建消息/Run 写入的 start_chat_turn 实现体；
- worker 分派入口 execute_chat_turn（runner.py 对 chat-turn 作业已 fail-stale）。

历史实现可经 Git 历史恢复（2026-09-09 之前的 agent_chat.py）。
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from .models import Agent, AgentChatSession


class LegacyChatRetiredError(RuntimeError):
    """自建对话执行已退役（AgentScope 换底 2026-09-09）。"""


def start_chat_turn(db: Session, agent: Agent, session: AgentChatSession, text: str,
                    attachments: list[dict], model_id: str) -> dict:
    """已退役：自建对话 Session/消息为第二真相源。

    对话一律走 /api/v2/agents/{id}/sessions + turns（AgentScope 原生 Session）。
    """
    raise LegacyChatRetiredError(
        "自建对话执行已退役：请使用 /api/v2/agents/{agentId}/sessions 与 /turns"
    )
