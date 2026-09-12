"""g056: 分析批跑可靠性（F3，Spec §9/§9.2.2/§19 F3）。

- task_run：processed_count/total_state（AC-030/031 增量计数）、
  cancel_requested_at/deadline_at（取消/超时）；
- job_queue：lease_expires_at/heartbeat_at/owner_run_id/cancel_requested_at
  （真租约，AC-036 崩溃恢复）；
- task_run_error_agg：错误聚合表（Spec §9.2.1，summary topErrors 数据源）。

Revision ID: g056batchrl0001
Revises: g055invoc0001
"""
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "g056batchrl0001"
down_revision = "g055invoc0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    tr_cols = {row[0] for row in bind.execute(sa.text(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_schema='public' AND table_name='task_run'")).fetchall()}
    tr_add = {
        "processed_count": sa.Column("processed_count", sa.Integer, nullable=False,
                                     server_default="0"),
        "total_state": sa.Column("total_state", sa.String(16), nullable=False,
                                 server_default="estimating"),
        "cancel_requested_at": sa.Column("cancel_requested_at",
                                         sa.DateTime(timezone=True), nullable=True),
        "deadline_at": sa.Column("deadline_at", sa.DateTime(timezone=True),
                                 nullable=True),
        "retry_of_task_run_id": sa.Column("retry_of_task_run_id", sa.String(32),
                                          nullable=True),
        "run_scope": sa.Column("run_scope", sa.String(16), nullable=False,
                               server_default="all"),
        "retry_round": sa.Column("retry_round", sa.Integer, nullable=False,
                                 server_default="0"),
        "outcome_code": sa.Column("outcome_code", sa.String(48), nullable=True),
    }
    for name, col in tr_add.items():
        if name not in tr_cols:
            op.add_column("task_run", col)

    jq_cols = {row[0] for row in bind.execute(sa.text(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_schema='public' AND table_name='job_queue'")).fetchall()}
    jq_add = {
        "lease_expires_at": sa.Column("lease_expires_at",
                                      sa.DateTime(timezone=True), nullable=True),
        "heartbeat_at": sa.Column("heartbeat_at", sa.DateTime(timezone=True),
                                  nullable=True),
        "owner_run_id": sa.Column("owner_run_id", sa.String(32), nullable=True),
        "cancel_requested_at": sa.Column("cancel_requested_at",
                                         sa.DateTime(timezone=True), nullable=True),
    }
    for name, col in jq_add.items():
        if name not in jq_cols:
            op.add_column("job_queue", col)

    exists = bind.execute(sa.text(
        "SELECT 1 FROM information_schema.tables WHERE table_schema='public' "
        "AND table_name='task_run_error_agg'")).fetchone()
    if not exists:
        op.create_table(
            "task_run_error_agg",
            sa.Column("id", sa.String(32), primary_key=True),
            sa.Column("task_run_id", sa.String(32), nullable=False),
            sa.Column("category", sa.String(32), nullable=False),
            sa.Column("code", sa.String(64), nullable=False),
            sa.Column("count", sa.Integer, nullable=False, server_default="0"),
            sa.Column("sample_refs", sa.JSON(), nullable=True),
            sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_tr_err_agg_run", "task_run_error_agg", ["task_run_id"])
        op.create_index("ix_task_run_retry_of_task_run_id", "task_run",
                        ["retry_of_task_run_id"])
        op.create_index("uq_tr_err_agg_run_cat_code", "task_run_error_agg",
                        ["task_run_id", "category", "code"], unique=True)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS task_run_error_agg")
    for name in ("cancel_requested_at", "owner_run_id", "heartbeat_at",
                 "lease_expires_at"):
        op.execute(f"ALTER TABLE job_queue DROP COLUMN IF EXISTS {name}")
    op.execute("DROP INDEX IF EXISTS ix_task_run_retry_of_task_run_id")
    for name in ("outcome_code", "retry_round", "run_scope", "retry_of_task_run_id",
                 "deadline_at", "cancel_requested_at", "total_state",
                 "processed_count"):
        op.execute(f"ALTER TABLE task_run DROP COLUMN IF EXISTS {name}")
