"""workflow icon column (08-26 工作流基础信息编辑)

Revision ID: fwficon260826
Revises: f0rmv3f0rm15
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'fwficon260826'
down_revision: Union[str, Sequence[str], None] = 'f0rmv3f0rm15'
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.add_column('workflow', sa.Column('icon', sa.String(length=128), nullable=True))

def downgrade() -> None:
    op.drop_column('workflow', 'icon')
