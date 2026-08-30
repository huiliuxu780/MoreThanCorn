"""P2-02：用户团队与数据范围（单租户内团队维度权限）。

- app_user.team：团队标识（空=无团队归属）；
- app_user.data_scope：all=全量（默认，存量行为不变）| team=仅同队成员创建的数据。
服务端强制（apply_data_scope/assert_task_readable），admin 直通。

Revision ID: g044p2perm0001
Revises: g043r4conn0001
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'g044p2perm0001'
down_revision: Union[str, Sequence[str], None] = 'g043r4conn0001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('app_user', sa.Column('team', sa.String(64), nullable=False, server_default=''))
    op.add_column('app_user', sa.Column('data_scope', sa.String(16), nullable=False, server_default='all'))


def downgrade() -> None:
    op.drop_column('app_user', 'data_scope')
    op.drop_column('app_user', 'team')
