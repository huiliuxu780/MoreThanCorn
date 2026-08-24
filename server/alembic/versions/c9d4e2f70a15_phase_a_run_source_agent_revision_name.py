"""phase A: run.definition_source + agent.config_revision + agent name len<=20（SDD 01 A-01/A-08/A-17）

Revision ID: c9d4e2f70a15
Revises: 7f42d060212d
Create Date: 2026-08-25 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c9d4e2f70a15'
down_revision: Union[str, Sequence[str], None] = '7f42d060212d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('run', sa.Column('definition_source', sa.String(length=8), nullable=True))
    op.add_column('agent', sa.Column('config_revision', sa.Integer(),
                                     server_default='1', nullable=False))
    # 调研 12 §3.1：存储层与前端/服务端共用同一名称上限（20）
    op.execute("ALTER TABLE agent DROP CONSTRAINT IF EXISTS ck_agent_name_len")
    op.create_check_constraint('ck_agent_name_len', 'agent', 'char_length(name) <= 20')


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('ck_agent_name_len', 'agent', type_='check')
    op.drop_column('agent', 'config_revision')
    op.drop_column('run', 'definition_source')
