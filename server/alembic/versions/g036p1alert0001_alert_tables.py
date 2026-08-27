"""09-SDD P1-B4 / P1-08：告警规则与告警事件表。

Revision ID: g036p1alert0001
Revises: g035p1review0001
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'g036p1alert0001'
down_revision: Union[str, Sequence[str], None] = 'g035p1review0001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'alert_rule',
        sa.Column('id', sa.String(32), primary_key=True),
        sa.Column('name', sa.String(64), nullable=False),
        sa.Column('metric', sa.String(32), nullable=False),
        sa.Column('operator', sa.String(4), nullable=False, server_default='gt'),
        sa.Column('threshold', sa.Float(), nullable=False, server_default='0'),
        sa.Column('severity', sa.String(16), nullable=False, server_default='warning'),
        sa.Column('enabled', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('notify', postgresql.JSONB(), nullable=False, server_default='{}'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
    )
    op.create_table(
        'alert_event',
        sa.Column('id', sa.String(32), primary_key=True),
        sa.Column('rule_id', sa.String(32), sa.ForeignKey('alert_rule.id', ondelete='SET NULL'), nullable=True),
        sa.Column('metric', sa.String(32), nullable=False),
        sa.Column('value', sa.Float(), nullable=False, server_default='0'),
        sa.Column('threshold', sa.Float(), nullable=False, server_default='0'),
        sa.Column('severity', sa.String(16), nullable=False, server_default='warning'),
        sa.Column('message', sa.Text(), nullable=False, server_default=''),
        sa.Column('acknowledged', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
    )
    op.create_index('ix_alert_event_rule_id', 'alert_event', ['rule_id'])


def downgrade() -> None:
    op.drop_index('ix_alert_event_rule_id', table_name='alert_event')
    op.drop_table('alert_event')
    op.drop_table('alert_rule')
