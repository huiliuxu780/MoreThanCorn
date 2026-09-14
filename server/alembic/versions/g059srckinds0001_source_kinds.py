"""g059: 数据源类型体系扩展（09-14 用户拍板：maxcompute / api 拉取 / webhook / 飞书多维表格）。

- kind 重命名：polling → api_pull（语义=平台主动拉取 HTTP API）；存量行迁移；
- 新增 secret_ref 列：非 webhook 类型的凭据（飞书 app_id/app_secret、MaxCompute
  AccessKey、API 拉取 bearer/apikey）加密存储，config 只放非敏感参数；
- webhook 的接收 token 仍走 auth_token_hash（语义不变）。

Revision ID: g059srckinds0001
Revises: g058dsarch0001
"""
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "g059srckinds0001"
down_revision = "g058dsarch0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    cols = {row[0] for row in bind.execute(sa.text(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_schema='public' AND table_name='data_source'")).fetchall()}
    if "secret_ref" not in cols:
        op.add_column("data_source", sa.Column(
            "secret_ref", sa.String(512), nullable=True))
    bind.execute(sa.text(
        "UPDATE data_source SET kind='api_pull' WHERE kind='polling'"))


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(sa.text(
        "UPDATE data_source SET kind='polling' WHERE kind='api_pull'"))
    op.drop_column("data_source", "secret_ref")
