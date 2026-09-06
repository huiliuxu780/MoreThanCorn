"""09-07 Agent 能力重构：Skill/记忆/对话一等实体。

- skill：Skill 市场条目（registry kind=skill），content 为 SKILL.md 全文；
- agent_skill：per-agent 安装关系，UNIQUE(agent_id, skill_id)；
- agent_memory / agent_memory_revision：全局记忆文档 + 版本快照；
- agent_chat_session / agent_chat_message：对话工作区会话与消息；
- run.created_at 补索引（run-stats 按日聚合）。

仅新增，不删除任何存量表/列（expand-only 约定）。

Revision ID: g047agentcap0001
Revises: g046sdd13pr10001
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'g047agentcap0001'
down_revision: Union[str, Sequence[str], None] = 'g046sdd13pr10001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "ix_run_created_at" not in {i["name"] for i in insp.get_indexes("run")}:
        op.create_index("ix_run_created_at", "run", ["created_at"])

    op.create_table(
        "skill",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("name", sa.String(64), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("category", sa.String(32), nullable=False, server_default=""),
        sa.Column("content", sa.Text(), nullable=False, server_default=""),
        sa.Column("source", sa.String(16), nullable=False, server_default="market"),
        sa.Column("status", sa.String(16), nullable=False, server_default="ready"),
        sa.Column("extra", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "agent_skill",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("agent_id", sa.String(32), sa.ForeignKey("agent.id"), nullable=False),
        sa.Column("skill_id", sa.String(32), sa.ForeignKey("skill.id"), nullable=False),
        sa.Column("installed_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("agent_id", "skill_id", name="uq_agent_skill"),
    )
    op.create_index("ix_agent_skill_agent_id", "agent_skill", ["agent_id"])
    op.create_index("ix_agent_skill_skill_id", "agent_skill", ["skill_id"])
    op.create_table(
        "agent_memory",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("agent_id", sa.String(32), sa.ForeignKey("agent.id"), nullable=False),
        sa.Column("content", sa.Text(), nullable=False, server_default=""),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("updated_by", sa.String(64), nullable=False, server_default=""),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("uq_agent_memory_agent", "agent_memory", ["agent_id"], unique=True)
    op.create_table(
        "agent_memory_revision",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("memory_id", sa.String(32), sa.ForeignKey("agent_memory.id"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False, server_default=""),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_by", sa.String(64), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_agent_memory_revision_memory_id", "agent_memory_revision", ["memory_id"])
    op.create_table(
        "agent_chat_session",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("agent_id", sa.String(32), sa.ForeignKey("agent.id"), nullable=False),
        sa.Column("title", sa.String(120), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_agent_chat_session_agent_id", "agent_chat_session", ["agent_id"])
    op.create_table(
        "agent_chat_message",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("session_id", sa.String(32), sa.ForeignKey("agent_chat_session.id"), nullable=False),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("content", sa.Text(), nullable=False, server_default=""),
        sa.Column("attachments", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="[]"),
        sa.Column("model_id", sa.String(64), nullable=False, server_default=""),
        sa.Column("run_id", sa.String(32), sa.ForeignKey("run.id"), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="done"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_agent_chat_message_session_id", "agent_chat_message", ["session_id"])


def downgrade() -> None:
    op.drop_index("ix_agent_chat_message_session_id", table_name="agent_chat_message")
    op.drop_table("agent_chat_message")
    op.drop_index("ix_agent_chat_session_agent_id", table_name="agent_chat_session")
    op.drop_table("agent_chat_session")
    op.drop_index("ix_agent_memory_revision_memory_id", table_name="agent_memory_revision")
    op.drop_table("agent_memory_revision")
    op.drop_index("uq_agent_memory_agent", table_name="agent_memory")
    op.drop_table("agent_memory")
    op.drop_index("ix_agent_skill_skill_id", table_name="agent_skill")
    op.drop_index("ix_agent_skill_agent_id", table_name="agent_skill")
    op.drop_table("agent_skill")
    op.drop_table("skill")
    op.drop_index("ix_run_created_at", table_name="run")
