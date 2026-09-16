"""g067: webhook 签名加固（15 号稿 P0 W1–W3）。

signing_secret_enc 可选（kms 信封加密明文密钥）：配置后才验签（HMAC-SHA256 + 时间戳 tolerance 300s +
compare_digest），未配置保持 token-only 兼容现有调用方。
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "g067webhooksign0001"
down_revision = "g066automationgroupck0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("data_source", sa.Column(
        "signing_secret_enc", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("data_source", "signing_secret_enc")
