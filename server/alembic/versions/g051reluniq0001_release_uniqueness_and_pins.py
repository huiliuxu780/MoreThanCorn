"""g051: active Release 数据库级唯一约束（P0-06）+ Schedule/AgentFlow Release 钉住字段。

1. automation_definition.runtime_release_id —— P0-03：Schedule 钉住的 Agent Release。
2. agentflow_release.definition_id —— P0-05/P0-06：反规范化 definition 指针，
   支撑 (definition, environment) 唯一索引与共享解析函数。
3. 同 (agent, environment) 至多一条 active 稳定 Release + 至多一条 active 灰度
   Release（部分唯一索引）；建索引前把历史多余 active 降级为 rolled_back/stopped
   （保留每组 created_at 最新一条）。
4. 回填 automation 钉住与 agentflow definition_id。

Revision ID: g051reluniq0001
Revises: g050sessionrt0001
"""
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "g051reluniq0001"
down_revision = "g050sessionrt0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "automation_definition",
        sa.Column("runtime_release_id", sa.String(32), nullable=True),
    )
    op.add_column(
        "agentflow_release",
        sa.Column("definition_id", sa.String(32), nullable=True),
    )
    op.create_index(
        "ix_agentflow_release_definition_id",
        "agentflow_release",
        ["definition_id"],
    )

    # backfill agentflow_release.definition_id from its version
    op.execute(
        """
        UPDATE agentflow_release r
        SET definition_id = v.definition_id
        FROM agentflow_version v
        WHERE r.version_id = v.id AND r.definition_id IS NULL
        """
    )
    # backfill automation schedule pins: best effort — the agent's current
    # active prod release (schedules created before this migration follow the
    # rebuild-on-drift rule at their next sync anyway)
    op.execute(
        """
        UPDATE automation_definition a
        SET runtime_release_id = (
            SELECT r.id FROM release r
            WHERE r.agent_id = a.agent_id AND r.status = 'active'
              AND r.environment = 'prod'
            ORDER BY r.created_at DESC LIMIT 1
        )
        WHERE a.runtime_schedule_id IS NOT NULL
          AND a.runtime_release_id IS NULL
          AND EXISTS (
            SELECT 1 FROM release r
            WHERE r.agent_id = a.agent_id AND r.status = 'active'
              AND r.environment = 'prod'
          )
        """
    )

    # demote historical duplicate actives (keep newest per group) so the
    # unique partial indexes can be created
    op.execute(
        """
        UPDATE release r
        SET status = 'rolled_back'
        WHERE r.status = 'active'
          AND EXISTS (
            SELECT 1 FROM release keep
            WHERE keep.agent_id = r.agent_id
              AND keep.environment = r.environment
              AND keep.status = 'active'
              AND (keep.canary_percent = 0) = (r.canary_percent = 0)
              AND (keep.created_at, keep.id) > (r.created_at, r.id)
          )
        """
    )
    op.execute(
        """
        UPDATE agentflow_release r
        SET status = 'stopped'
        WHERE r.status = 'active'
          AND r.definition_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM agentflow_release keep
            WHERE keep.definition_id = r.definition_id
              AND keep.environment = r.environment
              AND keep.status = 'active'
              AND (keep.created_at, keep.id) > (r.created_at, r.id)
          )
        """
    )

    op.execute(
        """
        CREATE UNIQUE INDEX uq_release_one_active_stable_per_env
        ON release (agent_id, environment)
        WHERE status = 'active' AND canary_percent = 0
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX uq_release_one_active_canary_per_env
        ON release (agent_id, environment)
        WHERE status = 'active' AND canary_percent > 0
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX uq_agentflow_release_one_active_per_env
        ON agentflow_release (definition_id, environment)
        WHERE status = 'active' AND definition_id IS NOT NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_agentflow_release_one_active_per_env")
    op.execute("DROP INDEX IF EXISTS uq_release_one_active_canary_per_env")
    op.execute("DROP INDEX IF EXISTS uq_release_one_active_stable_per_env")
    op.drop_index("ix_agentflow_release_definition_id", table_name="agentflow_release")
    op.drop_column("agentflow_release", "definition_id")
    op.drop_column("automation_definition", "runtime_release_id")
