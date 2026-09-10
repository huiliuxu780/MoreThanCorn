"""g052: Run.agentscope_session_id 专名列（P0-07 字段语义适配层）。

AgentScope 换底后 ``run.runtime_provider_run_id`` 被统一入口就地重解释为
Session 反链，但列名仍是 provider——本迁移建立专名列终止双重语义：

- 新列 ``run.agentscope_session_id``；
- 回填：``runtime_provider_id IS NULL`` 且旧列非空的行（换底后统一入口产物，
  从不写 provider id）——其旧列值即 AgentScope Session ID；
- 旧 Provider 时代的行（runtime_provider_id 非空）保持只读，不回填。

Revision ID: g052runsession0001
Revises: g051reluniq0001
"""
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "g052runsession0001"
down_revision = "g051reluniq0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "run",
        sa.Column("agentscope_session_id", sa.String(128), nullable=True),
    )
    op.create_index(
        "ix_run_agentscope_session_id", "run", ["agentscope_session_id"]
    )
    op.execute(
        """
        UPDATE run
        SET agentscope_session_id = runtime_provider_run_id
        WHERE runtime_provider_id IS NULL
          AND runtime_provider_run_id IS NOT NULL
          AND agentscope_session_id IS NULL
        """
    )


def downgrade() -> None:
    op.drop_index("ix_run_agentscope_session_id", table_name="run")
    op.drop_column("run", "agentscope_session_id")
