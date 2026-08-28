"""R2（SDD 10 §5.1）：Agent 领域 Module 标识（expand/contract 第 1 步）。

agent.module_key / module_version 先可空——兼容全部已封存历史行（旧三类 Agent 不迁移，
不回填）；新 Module Agent 由应用层强制必填。删除旧类型 UI/分派已在 R-Archive 完成。

Revision ID: g041r2module0001
Revises: g040r1prov0001
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'g041r2module0001'
down_revision: Union[str, Sequence[str], None] = 'g040r1prov0001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('agent', sa.Column('module_key', sa.String(64), nullable=True))
    op.add_column('agent', sa.Column('module_version', sa.String(32), nullable=True))
    op.create_index('ix_agent_module_key', 'agent', ['module_key'])


def downgrade() -> None:
    op.drop_index('ix_agent_module_key', table_name='agent')
    op.drop_column('agent', 'module_version')
    op.drop_column('agent', 'module_key')
