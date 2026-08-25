"""phase E-2: agent.archived（归档）+ release.canary_percent（灰度）

Revision ID: e031phasee2001
Revises: d030phased4001
Create Date: 2026-08-25 21:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e031phasee2001'
down_revision: Union[str, Sequence[str], None] = 'd030phased4001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('agent', sa.Column('archived', sa.Boolean(), server_default=sa.text('false'), nullable=False))
    op.add_column('release', sa.Column('canary_percent', sa.Integer(), server_default=sa.text('0'), nullable=False))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('release', 'canary_percent')
    op.drop_column('agent', 'archived')
