"""09 闭环验收修复：follow_latest 增加 RuleSet 作用域 + Data Asset record_id_field 可写。

- analysis_task_version.result_rule_set_id：follow_latest 解析时限定该规则集，
  避免全库取最新版本导致串用其他规则集（P1-3）。
- data_asset.record_id_field 已存在（默认 interactionId），本迁移不改动该列；
  仅补齐任务版本作用域列。recordIdField 的可写性在 API/前端层修复（P1-1）。

Revision ID: g039p2fix00001
Revises: g038p2gov00001
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'g039p2fix00001'
down_revision: Union[str, Sequence[str], None] = 'g038p2gov00001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('analysis_task_version',
                  sa.Column('result_rule_set_id', sa.String(32), nullable=True))
    op.create_index('ix_task_version_rule_set', 'analysis_task_version',
                    ['result_rule_set_id'])


def downgrade() -> None:
    op.drop_index('ix_task_version_rule_set', table_name='analysis_task_version')
    op.drop_column('analysis_task_version', 'result_rule_set_id')
