"""g064: 群会话回合预算（Spec 不变量 10，P3 落地）。

team turn 定义=用户发言回合（成员唤醒由官方 TeamMemberLoopMiddleware nudge
与 ReActConfig.max_iters 约束）；超限 turns 端点 409 BUDGET_EXCEEDED。
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "g064groupbudget0001"
down_revision = "g063groupsop0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("agent_group_session", sa.Column(
        "turn_count", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("agent_group_session", sa.Column(
        "max_team_turns", sa.Integer(), nullable=False, server_default="60"))


def downgrade() -> None:
    op.drop_column("agent_group_session", "max_team_turns")
    op.drop_column("agent_group_session", "turn_count")
