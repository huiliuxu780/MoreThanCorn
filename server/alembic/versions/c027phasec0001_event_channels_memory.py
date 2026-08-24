"""phase C: run_event 通道/trace 列 + memory_record 持久化（SDD 03 §C-1/C-4）

Revision ID: c027phasec0001
Revises: b026phaseb0001
Create Date: 2026-08-26 01:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


# revision identifiers, used by Alembic.
revision: str = 'c027phasec0001'
down_revision: Union[str, Sequence[str], None] = 'b026phaseb0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('run_event', sa.Column('channel', sa.String(length=8), server_default='CONTROL', nullable=False))
    op.add_column('run_event', sa.Column('trace_id', sa.String(length=64), nullable=True))
    op.add_column('run_event', sa.Column('span_id', sa.String(length=64), nullable=True))
    op.add_column('run_event', sa.Column('parent_span_id', sa.String(length=64), nullable=True))
    op.add_column('run_event', sa.Column('duration_ms', sa.Integer(), nullable=True))
    op.add_column('run_event', sa.Column('tokens', JSONB(), nullable=True))
    op.create_table(
        'memory_record',
        sa.Column('id', sa.String(length=32), primary_key=True),
        sa.Column('scope', sa.String(length=64), nullable=False, index=True),  # agent:{id} | wf:{id}
        sa.Column('key', sa.String(length=128), nullable=False),
        sa.Column('value', sa.Text(), server_default='', nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.UniqueConstraint('scope', 'key', name='uq_memory_scope_key'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('memory_record')
    op.drop_column('run_event', 'tokens')
    op.drop_column('run_event', 'duration_ms')
    op.drop_column('run_event', 'parent_span_id')
    op.drop_column('run_event', 'span_id')
    op.drop_column('run_event', 'trace_id')
    op.drop_column('run_event', 'channel')
