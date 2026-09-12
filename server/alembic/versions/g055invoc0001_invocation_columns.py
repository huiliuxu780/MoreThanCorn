"""g055: AutomationTriggerLog 升级为 AutomationInvocation 持久化（F2，Spec §7.2）。

补齐时间（queued/started/ended）、target（kind/ref）、attempt/retry_of、
结构化错误（error_code/error_detail）、conversation_key、budget/usage 预留列、
cancel_requested_at（CANCELLED 终态意图）与 normalized input（retry 依据）；
幂等原子化：partial unique index (automation_id, idempotency_key)。

Revision ID: g055invoc0001
Revises: g054evtdlv0001
"""
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "g055invoc0001"
down_revision = "g054evtdlv0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    existing = {row[0] for row in bind.execute(sa.text(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_schema='public' AND table_name='automation_trigger_log'"
    )).fetchall()}
    additions = {
        "conversation_key": sa.Column("conversation_key", sa.String(128), nullable=True),
        "budget_snapshot": sa.Column("budget_snapshot", sa.JSON(), nullable=True),
        "usage_summary": sa.Column("usage_summary", sa.JSON(), nullable=True),
        "target_kind": sa.Column("target_kind", sa.String(16), nullable=True),
        "target_ref": sa.Column("target_ref", sa.String(64), nullable=True),
        "attempt": sa.Column("attempt", sa.Integer, nullable=False, server_default="1"),
        "retry_of_id": sa.Column("retry_of_id", sa.String(32), nullable=True),
        "queued_at": sa.Column("queued_at", sa.DateTime(timezone=True), nullable=True),
        "started_at": sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        "ended_at": sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        "error_code": sa.Column("error_code", sa.String(48), nullable=True),
        "error_detail": sa.Column("error_detail", sa.JSON(), nullable=True),
        "cancel_requested_at": sa.Column("cancel_requested_at", sa.DateTime(timezone=True), nullable=True),
        "input": sa.Column("input", sa.JSON(), nullable=True),
    }
    for name, col in additions.items():
        if name not in existing:
            op.add_column("automation_trigger_log", col)

    index_exists = bind.execute(sa.text(
        "SELECT 1 FROM pg_indexes WHERE schemaname='public' "
        "AND indexname='uq_triggerlog_idem'"
    )).fetchone()
    if not index_exists:
        op.create_index(
            "uq_triggerlog_idem", "automation_trigger_log",
            ["automation_id", "idempotency_key"],
            unique=True,
            postgresql_where=sa.text("idempotency_key IS NOT NULL"),
        )


def downgrade() -> None:
    bind = op.get_bind()
    op.execute("DROP INDEX IF EXISTS uq_triggerlog_idem")
    for name in ("input", "cancel_requested_at", "error_detail", "error_code",
                 "ended_at", "started_at", "queued_at", "retry_of_id", "attempt",
                 "target_ref", "target_kind", "usage_summary", "budget_snapshot",
                 "conversation_key"):
        op.execute(f"ALTER TABLE automation_trigger_log DROP COLUMN IF EXISTS {name}")
