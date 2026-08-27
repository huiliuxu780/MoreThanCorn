"""09-SDD P1-B2 / P1-02：复核领取/分配字段（待复核队列 §11.4）。

Revision ID: g035p1review0001
Revises: g034p1perf0001
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'g035p1review0001'
down_revision: Union[str, Sequence[str], None] = 'g034p1perf0001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('quality_result', sa.Column('review_claimed_by', sa.String(64), nullable=True))
    op.add_column('quality_result', sa.Column('review_claimed_at', sa.DateTime(timezone=True), nullable=True))
    op.create_index('ix_quality_result_claimed_by', 'quality_result', ['review_claimed_by'])


def downgrade() -> None:
    op.drop_index('ix_quality_result_claimed_by', table_name='quality_result')
    op.drop_column('quality_result', 'review_claimed_at')
    op.drop_column('quality_result', 'review_claimed_by')
