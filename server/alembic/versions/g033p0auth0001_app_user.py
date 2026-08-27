"""09-SDD P0-B3：app_user 身份表 + admin 种子（P0-10）。

种子口令：WF_ADMIN_PASSWORD（未设置时为 'admin'——仅限非生产；
生产启动门要求改密/接 SSO 前的临时措施，验收报告登记）。

Revision ID: g033p0auth0001
Revises: g032p0taskdom01
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'g033p0auth0001'
down_revision: Union[str, Sequence[str], None] = 'g032p0taskdom01'
branch_labels = None
depends_on = None


def _hash_password(password: str) -> str:
    import hashlib
    import os
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 120_000)
    return salt.hex() + "$" + dk.hex()


def upgrade() -> None:
    op.create_table(
        'app_user',
        sa.Column('id', sa.String(32), primary_key=True),
        sa.Column('username', sa.String(64), nullable=False, unique=True),
        sa.Column('display_name', sa.String(64), nullable=False, server_default=''),
        sa.Column('password_hash', sa.String(256), nullable=False),
        sa.Column('role', sa.String(16), nullable=False, server_default='viewer'),
        sa.Column('status', sa.String(16), nullable=False, server_default='active'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text('now()')),
    )
    import os
    import uuid
    conn = op.get_bind()
    exists = conn.execute(sa.text(
        "SELECT 1 FROM app_user WHERE username='admin'")).fetchone()
    if not exists:
        conn.execute(sa.text(
            "INSERT INTO app_user (id, username, display_name, password_hash, role, status, created_at) "
            "VALUES (:id, 'admin', '管理员', :ph, 'admin', 'active', now())"),
            {"id": uuid.uuid4().hex,
             "ph": _hash_password(os.environ.get("WF_ADMIN_PASSWORD", "admin"))})


def downgrade() -> None:
    op.drop_table('app_user')
