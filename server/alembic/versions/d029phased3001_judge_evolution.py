"""phase D-3: eval_sample.judge_result + evolution_patch（评测 Judge + 进化候选补丁）

Revision ID: d029phased3001
Revises: d029phased1001
Create Date: 2026-08-26 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


# revision identifiers, used by Alembic.
revision: str = 'd029phased3001'
down_revision: Union[str, Sequence[str], None] = 'd029phased1002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('eval_sample', sa.Column('judge_result', JSONB(), nullable=True))
    op.create_table(
        'evolution_patch',
        sa.Column('id', sa.String(length=32), primary_key=True),
        sa.Column('agent_id', sa.String(length=32), sa.ForeignKey('agent.id'), nullable=False, index=True),
        sa.Column('attribution', sa.String(length=32), server_default='', nullable=False),
        sa.Column('reason', sa.Text(), server_default='', nullable=False),
        sa.Column('base_prompt', sa.Text(), server_default='', nullable=False),
        sa.Column('proposed_prompt', sa.Text(), server_default='', nullable=False),
        sa.Column('status', sa.String(length=16), server_default='pending', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('evolution_patch')
    op.drop_column('eval_sample', 'judge_result')
