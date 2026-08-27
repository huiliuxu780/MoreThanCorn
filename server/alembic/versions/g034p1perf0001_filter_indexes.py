"""09-SDD P1-B1 / P1-10：列表筛选/追踪常用维度索引（避免全表扫描）。

quality_result 已有 interaction_ref/task_run_id/task_id/rule_version_id/run_id 索引（g032），
此处补 interaction_time 与 score（时间范围/排序/打分筛选高频维度）。

Revision ID: g034p1perf0001
Revises: g033p0auth0001
"""
from typing import Sequence, Union

from alembic import op

revision: str = 'g034p1perf0001'
down_revision: Union[str, Sequence[str], None] = 'g033p0auth0001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index('ix_quality_result_interaction_time', 'quality_result', ['interaction_time'])
    op.create_index('ix_quality_result_score', 'quality_result', ['score'])
    # run 侧交互引用/批次追踪索引（g032 已建 task_run_id/interaction_ref，此处补复合覆盖）
    op.create_index('ix_run_taskrun_ref', 'run', ['task_run_id', 'interaction_ref'])


def downgrade() -> None:
    op.drop_index('ix_run_taskrun_ref', table_name='run')
    op.drop_index('ix_quality_result_score', table_name='quality_result')
    op.drop_index('ix_quality_result_interaction_time', table_name='quality_result')
