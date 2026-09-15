"""g061: data_source 拉取健康三列（16 号稿 B1 / 概览带失败原因与自动拉取诊断）。

现状缺口：poll 失败仅 status="error"，失败消息随 HTTP 502 丢弃，UI 无从展示
「为什么失败」。三列由 tick 双路写（成功清零 / 失败留证）。
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "g061pollhealth0001"
down_revision = "g060d5unify0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("data_source", sa.Column(
        "last_poll_error", sa.Text(), server_default="", nullable=False))
    op.add_column("data_source", sa.Column(
        "last_poll_ok", sa.Boolean(), server_default=sa.text("true"), nullable=False))
    op.add_column("data_source", sa.Column(
        "last_poll_count", sa.Integer(), server_default="0", nullable=False))


def downgrade() -> None:
    op.drop_column("data_source", "last_poll_count")
    op.drop_column("data_source", "last_poll_ok")
    op.drop_column("data_source", "last_poll_error")
