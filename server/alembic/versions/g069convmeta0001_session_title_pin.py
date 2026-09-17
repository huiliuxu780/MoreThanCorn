"""g069: 对话任务标题与置顶（09-16 用户指认 a/f）。

agent_session_index.title = LLM 短总结（首轮触发后台生成，失败回落截断）；
agent_session_index.pinned_at / agent_group_session.pinned_at = 置顶排序键
（列表 pinned 优先、其内 pinned_at desc、再 created_at desc）。
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "g069convmeta0001"
down_revision = "g068signrotate0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("agent_session_index", sa.Column("title", sa.Text(), nullable=True))
    op.add_column("agent_session_index", sa.Column(
        "pinned_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("agent_group_session", sa.Column(
        "pinned_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("agent_group_session", "pinned_at")
    op.drop_column("agent_session_index", "pinned_at")
    op.drop_column("agent_session_index", "title")
