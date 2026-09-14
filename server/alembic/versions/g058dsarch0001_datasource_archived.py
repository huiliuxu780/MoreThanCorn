"""g058: DataSource 归档列（09-14 D3 拍板：数据源治理页删除=归档语义）。

DELETE /api/v2/data-sources/{id} 不物理删（事件/路由流水需可追溯）；
被引用时 409 并列引用清单。列表默认隐藏 archived（includeArchived=yes 可见）。

Revision ID: g058dsarch0001
Revises: g057eventrt0001
"""
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "g058dsarch0001"
down_revision = "g057eventrt0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    cols = {row[0] for row in bind.execute(sa.text(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_schema='public' AND table_name='data_source'")).fetchall()}
    if "archived" not in cols:
        op.add_column("data_source", sa.Column(
            "archived", sa.Boolean, nullable=False, server_default=sa.text("false")))


def downgrade() -> None:
    op.drop_column("data_source", "archived")
