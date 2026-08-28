"""R3（SDD 10 §5.5/§5.6/§5.9）：AnalysisTask 统一执行目标 + TaskRun 冻结快照。

- analysis_task(_version).execution_target_type = workflow|agent；agent_id 可空；
  workflow_id 改可空；Check 约束：二选一互斥（可升级可降级，命名约束便于回退）；
- task_run 增加 resolved_workflow_version_id / resolved_agent_version_id /
  resolved_release_id / runtime_binding_snapshot（批次启动一次解析，重试/分页不漂移）；
- quality_result.agent_version_id（可空）：Agent 主链结果的版本谱系。

Revision ID: g042r3target0001
Revises: g041r2module0001
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'g042r3target0001'
down_revision: Union[str, Sequence[str], None] = 'g041r2module0001'
branch_labels = None
depends_on = None

CHECKS = (
    ('ck_task_target_type', 'analysis_task',
     "(execution_target_type = 'workflow' AND workflow_id IS NOT NULL AND agent_id IS NULL) OR "
     "(execution_target_type = 'agent' AND agent_id IS NOT NULL AND workflow_id IS NULL)"),
    ('ck_task_version_target_type', 'analysis_task_version',
     "(execution_target_type = 'workflow' AND workflow_id IS NOT NULL AND agent_id IS NULL) OR "
     "(execution_target_type = 'agent' AND agent_id IS NOT NULL AND workflow_id IS NULL)"),
)


def upgrade() -> None:
    op.add_column('analysis_task', sa.Column('execution_target_type', sa.String(16),
                                             nullable=False, server_default='workflow'))
    op.add_column('analysis_task', sa.Column('agent_id', sa.String(32), nullable=True))
    op.alter_column('analysis_task', 'workflow_id', existing_type=sa.String(64), nullable=True)
    op.add_column('analysis_task_version', sa.Column('execution_target_type', sa.String(16),
                                                     nullable=False, server_default='workflow'))
    op.add_column('analysis_task_version', sa.Column('agent_id', sa.String(32), nullable=True))
    op.add_column('analysis_task_version', sa.Column('agent_version_policy', sa.String(32),
                                                     nullable=True))
    op.add_column('analysis_task_version', sa.Column('pinned_agent_version_id', sa.String(32),
                                                     nullable=True))
    op.alter_column('analysis_task_version', 'workflow_id', existing_type=sa.String(64),
                    nullable=True)
    for name, table, cond in CHECKS:
        op.create_check_constraint(name, table, cond)

    op.add_column('task_run', sa.Column('resolved_workflow_version_id', sa.String(32), nullable=True))
    op.add_column('task_run', sa.Column('resolved_agent_version_id', sa.String(32), nullable=True))
    op.add_column('task_run', sa.Column('resolved_release_id', sa.String(32), nullable=True))
    op.add_column('task_run', sa.Column('runtime_binding_snapshot', postgresql.JSONB, nullable=True))

    op.add_column('quality_result', sa.Column('agent_version_id', sa.String(32), nullable=True))
    op.create_index('ix_quality_result_agent_version_id', 'quality_result', ['agent_version_id'])


def downgrade() -> None:
    op.drop_index('ix_quality_result_agent_version_id', table_name='quality_result')
    op.drop_column('quality_result', 'agent_version_id')

    op.drop_column('task_run', 'runtime_binding_snapshot')
    op.drop_column('task_run', 'resolved_release_id')
    op.drop_column('task_run', 'resolved_agent_version_id')
    op.drop_column('task_run', 'resolved_workflow_version_id')

    for name, table, _cond in reversed(CHECKS):
        op.drop_constraint(name, table, type_='check')
    op.alter_column('analysis_task_version', 'workflow_id', existing_type=sa.String(64),
                    nullable=False)
    op.drop_column('analysis_task_version', 'pinned_agent_version_id')
    op.drop_column('analysis_task_version', 'agent_version_policy')
    op.drop_column('analysis_task_version', 'agent_id')
    op.drop_column('analysis_task_version', 'execution_target_type')
    op.alter_column('analysis_task', 'workflow_id', existing_type=sa.String(64), nullable=False)
    op.drop_column('analysis_task', 'agent_id')
    op.drop_column('analysis_task', 'execution_target_type')
