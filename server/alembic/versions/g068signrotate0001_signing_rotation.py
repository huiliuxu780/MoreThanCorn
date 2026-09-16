"""g068: webhook 签名密钥轮换双活（15 号稿 W6，Stripe 式滚动期）。

prev_enc + rotated_at：轮换窗口内（默认 24h）新旧 secret 同时可验；
窗口外旧 secret 失效。窗口可经 src.config.signing_rotation_window_hours 覆盖。
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "g068signrotate0001"
down_revision = "g067webhooksign0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("data_source", sa.Column(
        "signing_secret_prev_enc", sa.Text(), nullable=True))
    op.add_column("data_source", sa.Column(
        "signing_secret_rotated_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("data_source", "signing_secret_rotated_at")
    op.drop_column("data_source", "signing_secret_prev_enc")
