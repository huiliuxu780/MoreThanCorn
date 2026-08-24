"""phase D-1: eval_sample 支持 agent 维度（SDD 04 §0）

Revision ID: d028phased1001
Revises: c027phasec0001
Create Date: 2026-08-26 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd028phased1001'
down_revision: Union[str, Sequence[str], None] = 'c027phasec0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('eval_sample', sa.Column('agent_id', sa.String(length=32), nullable=True))
    op.create_index(op.f('ix_eval_sample_agent_id'), 'eval_sample', ['agent_id'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_eval_sample_agent_id'), table_name='eval_sample')
    op.drop_column('eval_sample', 'agent_id')
