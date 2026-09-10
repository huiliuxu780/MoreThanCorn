"""g053: 内部 Tool 回调令牌绑定列（P0-08）。

- agent_session_index.session_token_hash：每 Session 一次性回调令牌 sha256；
- agentflow_run.run_token_hash：flow-run 级令牌 sha256（节点 Session 由运行时
  创建，令牌绑定整个 run）。

共享 MTC_INTERNAL_TOKEN 仅作传输门；会话/运行令牌才是 user↔session↔release
↔tool 的绑定凭据。存量行令牌列为 NULL = 旧 Session 无法再做内部回调
（fail closed），新 Session 自动签发。

Revision ID: g053intauth0001
Revises: g052runsession0001
"""
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "g053intauth0001"
down_revision = "g052runsession0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "agent_session_index",
        sa.Column("session_token_hash", sa.String(64), nullable=True),
    )
    op.add_column(
        "agentflow_run",
        sa.Column("run_token_hash", sa.String(64), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("agentflow_run", "run_token_hash")
    op.drop_column("agent_session_index", "session_token_hash")
