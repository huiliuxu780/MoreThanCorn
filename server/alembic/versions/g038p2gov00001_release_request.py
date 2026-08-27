"""09-SDD P2-08：发布治理——统一发布申请（ReleaseRequest）状态机。

对 Workflow/Rules/Task/Definition 的不可变版本提供审批、Canary、发布、
回滚与变更审计。资源仍保留各自不可变版本表；本表是覆盖其上的治理层，
记录"把哪个版本提为当前生效"的申请与流转（pending→approved/rejected→
released→rolled_back），Canary 以 canary/canary_scope/canary_promoted 表达。

Revision ID: g038p2gov00001
Revises: g037p0fix0001
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'g038p2gov00001'
down_revision: Union[str, Sequence[str], None] = 'g037p0fix0001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'release_request',
        sa.Column('id', sa.String(32), primary_key=True),
        sa.Column('resource_type', sa.String(16), nullable=False),
        sa.Column('resource_id', sa.String(32), nullable=False),
        sa.Column('from_version_no', sa.Integer(), nullable=True),
        sa.Column('to_version_no', sa.Integer(), nullable=False),
        sa.Column('state', sa.String(16), nullable=False, server_default='pending'),
        sa.Column('canary', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('canary_scope', postgresql.JSONB(astext_type=sa.Text()), nullable=False,
                  server_default=sa.text("'{}'::jsonb")),
        sa.Column('canary_promoted', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('requested_by', sa.String(64), nullable=False, server_default=''),
        sa.Column('approved_by', sa.String(64), nullable=True),
        sa.Column('approved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('rejected_reason', sa.Text(), nullable=False, server_default=''),
        sa.Column('released_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('rolled_back_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('note', sa.Text(), nullable=False, server_default=''),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text('now()')),
    )
    op.create_index('ix_release_request_resource', 'release_request',
                    ['resource_type', 'resource_id'])
    op.create_index('ix_release_request_state', 'release_request', ['state'])


def downgrade() -> None:
    op.drop_index('ix_release_request_state', table_name='release_request')
    op.drop_index('ix_release_request_resource', table_name='release_request')
    op.drop_table('release_request')
