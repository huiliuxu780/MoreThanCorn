"""g060: D5 连接统一——凭据归 Connection、目录发现→数据资产、接入引用（09-14 用户拍板）。

- data_source：新增 connection_id / asset_id 引用列（凭据与表目录改由
  Connection/DataAsset 承载；config.endpoint/secret_ref 保留为兼容列双写过渡）；
- data_asset：新增 config JSONB（目录元数据：schema/partitioned/comment/列数）。

存量源迁移由 scripts/migrate_d5_corn_source.py 一次性执行（幂等），
不在迁移里碰凭据（安全门：迁移不读写 secret 明文）。

Revision ID: g060d5unify0001
Revises: g059srckinds0001
"""
from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "g060d5unify0001"
down_revision = "g059srckinds0001"
branch_labels = None
depends_on = None


def _cols(table: str) -> set:
    bind = op.get_bind()
    return {row[0] for row in bind.execute(sa.text(
        "SELECT column_name FROM information_schema.columns "
        f"WHERE table_schema='public' AND table_name='{table}'")).fetchall()}


def upgrade() -> None:
    ds = _cols("data_source")
    if "connection_id" not in ds:
        op.add_column("data_source", sa.Column(
            "connection_id", sa.String(32), nullable=True))
        op.create_index("ix_data_source_connection_id", "data_source",
                        ["connection_id"])
    if "asset_id" not in ds:
        op.add_column("data_source", sa.Column(
            "asset_id", sa.String(32), nullable=True))
        op.create_index("ix_data_source_asset_id", "data_source", ["asset_id"])
    da = _cols("data_asset")
    if "config" not in da:
        op.add_column("data_asset", sa.Column(
            "config", postgresql.JSONB, nullable=False, server_default="{}"))


def downgrade() -> None:
    op.drop_column("data_asset", "config")
    op.drop_index("ix_data_source_asset_id", "data_source")
    op.drop_column("data_source", "asset_id")
    op.drop_index("ix_data_source_connection_id", "data_source")
    op.drop_column("data_source", "connection_id")
