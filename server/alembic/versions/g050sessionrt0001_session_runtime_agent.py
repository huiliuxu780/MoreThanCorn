"""g050: agent_session_index 增 runtime_agent_id（Session 与运行时 AgentRecord 的创建期绑定）。

修复：重新发布后最新 Release 的 runtime agent 变化，导致旧 Session 的
stream/messages/status 解析到错误 AgentRecord（404/断流）。

Revision ID: g050sessionrt0001
Revises: g049agentscope0001
"""
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "g050sessionrt0001"
down_revision = "g049agentscope0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "agent_session_index",
        sa.Column("runtime_agent_id", sa.String(64), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("agent_session_index", "runtime_agent_id")
