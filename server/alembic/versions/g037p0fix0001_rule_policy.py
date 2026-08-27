"""09-SDD P0 修复轮：规则跟随策略 + TaskRun 解析规则版本。

审计反例：result_rule_version_id 允许 NULL 且无解析策略，P0-08 追踪字段可为空。
修复：TaskVersion 显式 rule_policy（pinned|follow_latest）；TaskRun 启动时解析为
确定版本并冻结（resolved_rule_version_id），Run/Result 的 rule_version_id 恒非空。

Revision ID: g037p0fix0001
Revises: g036p1alert0001
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'g037p0fix0001'
down_revision: Union[str, Sequence[str], None] = 'g036p1alert0001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('analysis_task_version',
                  sa.Column('rule_policy', sa.String(16), nullable=False, server_default='pinned'))
    # 存量：绑定版本的=pinned，未绑定的回填为 follow_latest（保持可运行语义）
    op.execute("UPDATE analysis_task_version SET rule_policy = 'follow_latest' "
               "WHERE result_rule_version_id IS NULL")
    op.add_column('task_run',
                  sa.Column('resolved_rule_version_id', sa.String(32), nullable=True))


def downgrade() -> None:
    op.drop_column('task_run', 'resolved_rule_version_id')
    op.drop_column('analysis_task_version', 'rule_policy')
