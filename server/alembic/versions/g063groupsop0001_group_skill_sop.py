"""g063: Group 群技能挂载 + 成员协作 SOP（Spec §3.1 g063/g064 合并切片，D8 提前落地）。

- agent_group_skill：群级技能挂载（复用 skill 市场实体；装配时逐成员 session 上传 workspace）
- agent_group_sop：版本化群协作规则；published 行只读（不可变发布语义）
- agent_group.sop_id：群绑定指针（原子替换；仅可绑 published）
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "g063groupsop0001"
down_revision = "g062group0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "agent_group_skill",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("group_id", sa.String(32), nullable=False),
        sa.Column("skill_id", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("group_id", "skill_id", name="uq_group_skill"),
    )
    op.create_index("ix_agent_group_skill_group", "agent_group_skill", ["group_id"])
    op.create_table(
        "agent_group_sop",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("group_id", sa.String(32), nullable=False),
        sa.Column("name", sa.String(64), nullable=False),
        sa.Column("content_md", sa.Text(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("status", sa.String(16), nullable=False, server_default="draft"),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("status in ('draft', 'published')",
                           name="ck_agent_group_sop_status"),
    )
    op.create_index("ix_agent_group_sop_group", "agent_group_sop", ["group_id"])
    op.add_column("agent_group", sa.Column(
        "sop_id", sa.String(32), nullable=True))


def downgrade() -> None:
    op.drop_column("agent_group", "sop_id")
    op.drop_index("ix_agent_group_sop_group", table_name="agent_group_sop")
    op.drop_table("agent_group_sop")
    op.drop_index("ix_agent_group_skill_group", table_name="agent_group_skill")
    op.drop_table("agent_group_skill")
