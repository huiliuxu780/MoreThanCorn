"""g062: Group（多 Agent 群聊协作组）P1 四表 + 会话索引反链列。

Spec: docs/product-domain/group-capability-spec.md §3.1（v1.1 APPROVED）。
Group 定义真源在平台 PG；运行时 team 花名册在 AgentScope 官方 teams 表。
本迁移只建 P1 四表；agent_group_skill(g063/P2)、agent_group_sop(g064/P3) 随切片后建。
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "g062group0001"
down_revision = "g061pollhealth0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "agent_group",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("name", sa.String(20), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("leader_agent_id", sa.String(32), nullable=False),
        sa.Column("avatar", sa.Text(), nullable=True),
        sa.Column("archived", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("char_length(name) <= 20", name="ck_agent_group_name_len"),
        sa.CheckConstraint("char_length(name) > 0", name="ck_agent_group_name_nonempty"),
    )
    op.create_index("ix_agent_group_leader", "agent_group", ["leader_agent_id"])
    op.create_table(
        "agent_group_member",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("group_id", sa.String(32), nullable=False),
        sa.Column("agent_id", sa.String(32), nullable=False),
        sa.Column("role", sa.String(8), nullable=False),
        sa.Column("config", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("role in ('leader', 'member')", name="ck_agent_group_member_role"),
        sa.UniqueConstraint("group_id", "agent_id", name="uq_group_member"),
    )
    op.create_index("ix_agent_group_member_group", "agent_group_member", ["group_id"])
    op.create_index("ix_agent_group_member_agent", "agent_group_member", ["agent_id"])
    op.create_table(
        "agent_group_session",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("group_id", sa.String(32), nullable=False),
        sa.Column("title", sa.Text(), nullable=True),
        sa.Column("status", sa.String(8), nullable=False, server_default="active"),
        sa.Column("leader_session_id", sa.String(64), nullable=True),
        sa.Column("runtime_team_id", sa.String(64), nullable=True),
        sa.Column("binding_snapshot", sa.JSON(), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status in ('active', 'closed', 'failed')",
            name="ck_agent_group_session_status"),
    )
    op.create_index("ix_agent_group_session_group", "agent_group_session", ["group_id"])
    op.create_table(
        "agent_group_session_member",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("group_session_id", sa.String(32), nullable=False),
        sa.Column("agent_id", sa.String(32), nullable=False),
        sa.Column("session_id", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("group_session_id", "agent_id", name="uq_group_session_member"),
    )
    op.create_index(
        "ix_agent_group_session_member_gs",
        "agent_group_session_member", ["group_session_id"])
    # 会话索引反链（Spec §3.1/§4.4）：trigger_kind='group' 行非空
    op.add_column("agent_session_index", sa.Column(
        "group_session_id", sa.String(32), nullable=True))
    op.create_index(
        "ix_agent_session_index_group_session",
        "agent_session_index", ["group_session_id"])


def downgrade() -> None:
    op.drop_index("ix_agent_session_index_group_session", table_name="agent_session_index")
    op.drop_column("agent_session_index", "group_session_id")
    op.drop_index("ix_agent_group_session_member_gs",
                  table_name="agent_group_session_member")
    op.drop_table("agent_group_session_member")
    op.drop_index("ix_agent_group_session_group", table_name="agent_group_session")
    op.drop_table("agent_group_session")
    op.drop_index("ix_agent_group_member_agent", table_name="agent_group_member")
    op.drop_index("ix_agent_group_member_group", table_name="agent_group_member")
    op.drop_table("agent_group_member")
    op.drop_index("ix_agent_group_leader", table_name="agent_group")
    op.drop_table("agent_group")
