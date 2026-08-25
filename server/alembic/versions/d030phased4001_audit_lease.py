"""phase D-4: audit_log（审计日志）+ resource_lock 租约字段

Revision ID: d030phased4001
Revises: d029phased3001
Create Date: 2026-08-26 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


# revision identifiers, used by Alembic.
revision: str = 'd030phased4001'
down_revision: Union[str, Sequence[str], None] = 'd029phased3001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'audit_log',
        sa.Column('id', sa.String(length=32), primary_key=True),
        sa.Column('actor', sa.String(length=64), server_default='', nullable=False),
        sa.Column('action', sa.String(length=64), nullable=False),
        sa.Column('target_type', sa.String(length=32), server_default='', nullable=False),
        sa.Column('target_id', sa.String(length=64), server_default='', nullable=False),
        sa.Column('detail', JSONB(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    )
    op.add_column('resource_lock', sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('resource_lock', 'expires_at')
    op.drop_table('audit_log')
