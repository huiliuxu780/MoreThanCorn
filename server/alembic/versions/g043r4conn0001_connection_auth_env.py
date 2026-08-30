"""R4：Connection 鉴权升级——多环境域名 + 自定义鉴权脚本 + kind 归一化。

- connection.environments JSONB：[{code,label,endpoint?,secret_ref?}] 按环境覆盖
  endpoint/凭据（预置 dev/test/pre/prod 四槽，可自定义）；
- connection.default_env：执行侧未显式传环境时的回落；
- connection.auth_script：kind=script 的 JS 鉴权脚本（QuickJS 沙箱执行）；
- secret_ref 扩 Text：aksk/basic/脚本 KV 存 JSON payload 密文，128 长度不够；
- kind 存量脏值归一化（旧前端写入过 "API Key"/"Bearer Token"/"Basic Auth"/"None"）。

Revision ID: g043r4conn0001
Revises: g042r3target0001
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'g043r4conn0001'
down_revision: Union[str, Sequence[str], None] = 'g042r3target0001'
branch_labels = None
depends_on = None

KIND_FIX = {
    "None": "none",
    "API Key": "api_key",
    "Bearer Token": "bearer",
    "Basic Auth": "basic",
    "AkSk": "aksk",
    "Custom Script": "script",
}


def upgrade() -> None:
    op.add_column('connection', sa.Column('environments', postgresql.JSONB,
                                          nullable=False, server_default='[]'))
    op.add_column('connection', sa.Column('default_env', sa.String(16), nullable=True))
    op.add_column('connection', sa.Column('auth_script', sa.Text(), nullable=True))
    op.alter_column('connection', 'secret_ref', existing_type=sa.String(128),
                    type_=sa.Text(), existing_nullable=False)
    for old, new in KIND_FIX.items():
        op.execute(sa.text("UPDATE connection SET kind = :new WHERE kind = :old")
                   .bindparams(new=new, old=old))


def downgrade() -> None:
    for old, new in KIND_FIX.items():
        op.execute(sa.text("UPDATE connection SET kind = :old WHERE kind = :new")
                   .bindparams(new=new, old=old))
    op.alter_column('connection', 'secret_ref', existing_type=sa.Text(),
                    type_=sa.String(128), existing_nullable=False)
    op.drop_column('connection', 'auth_script')
    op.drop_column('connection', 'default_env')
    op.drop_column('connection', 'environments')
