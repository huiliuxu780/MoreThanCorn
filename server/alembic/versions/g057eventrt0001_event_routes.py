"""g057: EventRoute 一等实体 + EventDelivery 唯一目的地字段组（F5，Spec §10/§12.6）。

- event_route：唯一事件路由契约表（destination XOR automation|analysis_task，
  revision 递增，DELETE=归档语义）；
- event_delivery：§10.2.1 字段组（route_id/route_revision/destination_kind/
  destination_id/invocation_id/task_run_id/completion_policy）+ mapped_input
  冻结 + dedupe_scope（route 级去重）；
- data_source_event：route_outcomes 流水证据（AC-023/024 区分
  filtered/deduped/dead）；
- task_run：source_event_id/event_delivery_id（event 触发批次全链路引用）。

兼容列 trigger_id/automation_id/trigger_log_id 保留至旧 API 零流量（Spec §10.2.1）。

Revision ID: g057eventrt0001
Revises: g056batchrl0001
"""
from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision = "g057eventrt0001"
down_revision = "g056batchrl0001"
branch_labels = None
depends_on = None


def _cols(table: str) -> set[str]:
    bind = op.get_bind()
    return {row[0] for row in bind.execute(sa.text(
        "SELECT column_name FROM information_schema.columns "
        f"WHERE table_schema='public' AND table_name='{table}'")).fetchall()}


def _add(table: str, mapping: dict[str, sa.Column]) -> None:
    have = _cols(table)
    for name, col in mapping.items():
        if name not in have:
            op.add_column(table, col)


def upgrade() -> None:
    bind = op.get_bind()
    tables = {row[0] for row in bind.execute(sa.text(
        "SELECT table_name FROM information_schema.tables "
        "WHERE table_schema='public'")).fetchall()}

    if "event_route" not in tables:
        op.create_table(
            "event_route",
            sa.Column("id", sa.String(32), primary_key=True),
            sa.Column("source_id", sa.String(32), nullable=False),
            sa.Column("event_type", sa.String(64), nullable=False,
                      server_default=""),
            sa.Column("destination_kind", sa.String(16), nullable=False),
            sa.Column("destination_id", sa.String(32), nullable=False),
            sa.Column("filter", JSONB, nullable=False, server_default="{}"),
            sa.Column("mapping", JSONB, nullable=False, server_default="{}"),
            sa.Column("dedupe", JSONB, nullable=False, server_default="{}"),
            sa.Column("completion_policy", sa.String(16), nullable=False,
                      server_default="accepted"),
            sa.Column("retry_policy", JSONB, nullable=False,
                      server_default="{}"),
            sa.Column("enabled", sa.Boolean, nullable=False,
                      server_default=sa.text("true")),
            sa.Column("archived", sa.Boolean, nullable=False,
                      server_default=sa.text("false")),
            sa.Column("revision", sa.Integer, nullable=False, server_default="1"),
            sa.Column("created_by", sa.String(64), nullable=False,
                      server_default="dev"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                      server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                      server_default=sa.func.now()),
        )
        op.create_index("ix_event_route_source_id", "event_route", ["source_id"])
        op.create_index("ix_event_route_destination_id", "event_route",
                        ["destination_id"])

    _add("event_delivery", {
        "route_id": sa.Column("route_id", sa.String(32), nullable=True),
        "route_revision": sa.Column("route_revision", sa.Integer, nullable=True),
        "destination_kind": sa.Column("destination_kind", sa.String(16),
                                      nullable=True),
        "destination_id": sa.Column("destination_id", sa.String(32),
                                    nullable=True),
        "invocation_id": sa.Column("invocation_id", sa.String(32), nullable=True),
        "task_run_id": sa.Column("task_run_id", sa.String(32), nullable=True),
        "completion_policy": sa.Column("completion_policy", sa.String(16),
                                       nullable=False, server_default="accepted"),
        "mapped_input": sa.Column("mapped_input", JSONB, nullable=True),
        "dedupe_scope": sa.Column("dedupe_scope", sa.String(160), nullable=True),
    })
    ed_cols = _cols("event_delivery")
    bind = op.get_bind()
    idx = {row[0] for row in bind.execute(sa.text(
        "SELECT indexname FROM pg_indexes WHERE tablename='event_delivery'")).fetchall()}
    for name, col in (("ix_event_delivery_route_id", "route_id"),
                      ("ix_event_delivery_invocation_id", "invocation_id"),
                      ("ix_event_delivery_task_run_id", "task_run_id"),
                      ("ix_event_delivery_dedupe_scope", "dedupe_scope")):
        if col in ed_cols and name not in idx:
            op.create_index(name, "event_delivery", [col])

    _add("data_source_event", {
        "route_outcomes": sa.Column("route_outcomes", JSONB, nullable=False,
                                    server_default="[]"),
    })

    _add("task_run", {
        "source_event_id": sa.Column("source_event_id", sa.String(32),
                                     nullable=True),
        "event_delivery_id": sa.Column("event_delivery_id", sa.String(32),
                                       nullable=True),
    })
    tr_idx = {row[0] for row in bind.execute(sa.text(
        "SELECT indexname FROM pg_indexes WHERE tablename='task_run'")).fetchall()}
    for name, col in (("ix_task_run_source_event_id", "source_event_id"),
                      ("ix_task_run_event_delivery_id", "event_delivery_id")):
        if name not in tr_idx:
            op.create_index(name, "task_run", [col])

    # F5：兼容列改可空——route 投递无 trigger_id/automation_id（目的地走
    # destination_kind/destination_id；uq_event_trigger 中 NULL 不参与冲突）
    if "event_delivery" in tables:
        op.alter_column("event_delivery", "trigger_id", nullable=True,
                        existing_type=sa.String(32))
        op.alter_column("event_delivery", "automation_id", nullable=True,
                        existing_type=sa.String(32))


def downgrade() -> None:
    op.alter_column("event_delivery", "trigger_id", nullable=False,
                    existing_type=sa.String(32))
    op.alter_column("event_delivery", "automation_id", nullable=False,
                    existing_type=sa.String(32))
    op.drop_table("event_route")
    for col in ("dedupe_scope", "mapped_input", "completion_policy",
                "task_run_id", "invocation_id", "destination_id",
                "destination_kind", "route_revision", "route_id"):
        op.drop_column("event_delivery", col)
    op.drop_column("data_source_event", "route_outcomes")
    op.drop_column("task_run", "event_delivery_id")
    op.drop_column("task_run", "source_event_id")
