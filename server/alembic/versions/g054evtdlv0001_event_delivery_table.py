"""g054: event_delivery 表正式入迁移链（P0-09 排查发现）。

B 轮（2026-09-09）该表用 ``EventDelivery.__table__.create(bind=engine)`` 在
wf_dev/wf_test 裸建，从未写过迁移——任何新建库（含本轮临时测试库）都缺表，
事件多派发/死信链路直接 UndefinedTable。本迁移按 models.EventDelivery 现行
定义补齐（已存在该表的库自动跳过，幂等）。

Revision ID: g054evtdlv0001
Revises: g053intauth0001
"""
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "g054evtdlv0001"
down_revision = "g053intauth0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    exists = bind.execute(sa.text(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema='public' AND table_name='event_delivery'"
    )).fetchone()
    if exists:
        return
    op.create_table(
        "event_delivery",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("event_id", sa.String(32), nullable=False),
        sa.Column("trigger_id", sa.String(32), nullable=False),
        sa.Column("automation_id", sa.String(32), nullable=False),
        sa.Column("source", sa.String(16), nullable=False, server_default="event"),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("max_attempts", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("next_retry_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("dead_reason", sa.Text(), nullable=False, server_default=""),
        sa.Column("error", sa.Text(), nullable=False, server_default=""),
        sa.Column("trigger_log_id", sa.String(32), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.UniqueConstraint("event_id", "trigger_id", name="uq_event_trigger"),
    )
    op.create_index("ix_event_delivery_event_id", "event_delivery", ["event_id"])
    op.create_index("ix_event_delivery_trigger_id", "event_delivery", ["trigger_id"])
    op.create_index("ix_event_delivery_automation_id", "event_delivery",
                    ["automation_id"])


def downgrade() -> None:
    op.drop_index("ix_event_delivery_automation_id", table_name="event_delivery")
    op.drop_index("ix_event_delivery_trigger_id", table_name="event_delivery")
    op.drop_index("ix_event_delivery_event_id", table_name="event_delivery")
    op.drop_table("event_delivery")
