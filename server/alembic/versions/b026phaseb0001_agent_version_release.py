"""phase B: agent_version/release 表 + agent 环境版本指针 + run.agent_version_id（SDD 02 §2）

规格原写 016–017 两张，合并为一张迁移（偏离已登记于 02 变更记录）。

Revision ID: b026phaseb0001
Revises: c9d4e2f70a15
Create Date: 2026-08-25 23:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


# revision identifiers, used by Alembic.
revision: str = 'b026phaseb0001'
down_revision: Union[str, Sequence[str], None] = 'c9d4e2f70a15'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'agent_version',
        sa.Column('id', sa.String(length=32), primary_key=True),
        sa.Column('agent_id', sa.String(length=32), sa.ForeignKey('agent.id'), nullable=False, index=True),
        sa.Column('version_no', sa.Integer(), nullable=False),
        sa.Column('schema_version', sa.Integer(), server_default='1', nullable=False),
        sa.Column('definition', JSONB(), nullable=False),
        sa.Column('common_config', JSONB(), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column('dependency_snapshot', JSONB(), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column('artifact_hash', sa.String(length=64), nullable=False),
        sa.Column('note', sa.Text(), server_default='', nullable=False),
        sa.Column('created_by', sa.String(length=64), server_default='', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.UniqueConstraint('agent_id', 'version_no', name='uq_agent_version_no'),
    )
    op.create_table(
        'release',
        sa.Column('id', sa.String(length=32), primary_key=True),
        sa.Column('agent_id', sa.String(length=32), sa.ForeignKey('agent.id'), nullable=False, index=True),
        sa.Column('agent_version_id', sa.String(length=32), sa.ForeignKey('agent_version.id'), nullable=False),
        sa.Column('environment', sa.String(length=8), nullable=False),
        sa.Column('status', sa.String(length=16), server_default='active', nullable=False),
        sa.Column('created_by', sa.String(length=64), server_default='', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    )
    op.add_column('agent', sa.Column('sandbox_version_id', sa.String(length=32), nullable=True))
    op.add_column('agent', sa.Column('prod_version_id', sa.String(length=32), nullable=True))
    op.add_column('run', sa.Column('agent_version_id', sa.String(length=32), nullable=True))
    op.create_index(op.f('ix_run_agent_version_id'), 'run', ['agent_version_id'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_run_agent_version_id'), table_name='run')
    op.drop_column('run', 'agent_version_id')
    op.drop_column('agent', 'prod_version_id')
    op.drop_column('agent', 'sandbox_version_id')
    op.drop_table('release')
    op.drop_table('agent_version')
