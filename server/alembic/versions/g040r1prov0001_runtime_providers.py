"""R1（SDD 10 §5.3–5.8）：Runtime Provider 注册表与运行时绑定列。

- agent_runtime_provider 新表（与 model_provider 禁止合表；Secret 仅经 connection 引用）；
- release 增加 runtime_provider_id / runtime_profile / runtime_binding_snapshot；
- run 增加 runtime_provider_id / runtime_provider_run_id / runtime_request_hash / runtime_snapshot；
- call_record.run_id：先可空 + 经 node_run 回填 + 孤儿显式报告（不静默丢弃）。
  存在孤儿时**暂不加 NOT NULL**——处置孤儿等于处置历史数据，须用户决定，
  禁止删除历史（SDD 10 架构不可违反项）；无孤儿时直接收紧 NOT NULL。

Revision ID: g040r1prov0001
Revises: g039p2fix00001
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'g040r1prov0001'
down_revision: Union[str, Sequence[str], None] = 'g039p2fix00001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'agent_runtime_provider',
        sa.Column('id', sa.String(32), primary_key=True),
        sa.Column('name', sa.String(64), nullable=False),
        sa.Column('kind', sa.String(32), nullable=False),  # agentscope|deepseek-harness|external
        sa.Column('base_url', sa.String(256), nullable=False, server_default=''),
        sa.Column('connection_id', sa.String(32), sa.ForeignKey('connection.id'), nullable=True),
        sa.Column('status', sa.String(16), nullable=False, server_default='draft'),
        sa.Column('contract_version', sa.String(16), nullable=False, server_default='1.0'),
        sa.Column('capabilities', postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column('config', postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column('health_status', sa.String(16), nullable=True),
        sa.Column('last_health_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    )

    op.add_column('release', sa.Column('runtime_provider_id', sa.String(32), nullable=True))
    op.add_column('release', sa.Column('runtime_profile', sa.String(64), nullable=True))
    op.add_column('release', sa.Column('runtime_binding_snapshot', postgresql.JSONB, nullable=True))
    op.create_foreign_key('fk_release_runtime_provider', 'release',
                          'agent_runtime_provider', ['runtime_provider_id'], ['id'])

    op.add_column('run', sa.Column('runtime_provider_id', sa.String(32), nullable=True))
    op.add_column('run', sa.Column('runtime_provider_run_id', sa.String(128), nullable=True))
    op.add_column('run', sa.Column('runtime_request_hash', sa.String(64), nullable=True))
    op.add_column('run', sa.Column('runtime_snapshot', postgresql.JSONB, nullable=False,
                                  server_default=sa.text("'{}'::jsonb")))
    op.create_foreign_key('fk_run_runtime_provider', 'run',
                          'agent_runtime_provider', ['runtime_provider_id'], ['id'])
    op.create_index('ix_run_runtime_provider_id', 'run', ['runtime_provider_id'])
    op.create_index('ix_run_runtime_provider_run_id', 'run', ['runtime_provider_run_id'])

    # call_record.run_id：先可空（安全迁移第 1 步）
    op.add_column('call_record', sa.Column('run_id', sa.String(32), nullable=True))
    op.create_foreign_key('fk_call_record_run', 'call_record', 'run', ['run_id'], ['id'])
    op.create_index('ix_call_record_run_id', 'call_record', ['run_id'])
    # 第 2 步：历史 CallRecord 经 NodeRun 回填 Run
    op.execute("UPDATE call_record SET run_id = node_run.run_id "
               "FROM node_run WHERE call_record.node_run_id = node_run.id "
               "AND call_record.run_id IS NULL")
    # 第 3 步：校验孤儿并显式报告；第 4 步：无孤儿才加 NOT NULL
    bind = op.get_bind()
    orphans = bind.execute(sa.text(
        "SELECT id FROM call_record WHERE run_id IS NULL ORDER BY id LIMIT 51")).scalars().all()
    if orphans:
        sample = ", ".join(orphans[:10])
        more = "…" if len(orphans) > 10 else ""
        print(f"[g040r1prov0001] call_record.run_id 孤儿 {len(orphans)} 条无法经 node_run 回填"
              f"（样本：{sample}{more}）：保持可空并显式报告；处置须用户决定，不静默删除")
    else:
        op.alter_column('call_record', 'run_id', existing_type=sa.String(32), nullable=False)


def downgrade() -> None:
    # 先放开可能已加的 NOT NULL，再反向删除
    op.alter_column('call_record', 'run_id', existing_type=sa.String(32), nullable=True)
    op.drop_index('ix_call_record_run_id', table_name='call_record')
    op.drop_constraint('fk_call_record_run', 'call_record', type_='foreignkey')
    op.drop_column('call_record', 'run_id')

    op.drop_index('ix_run_runtime_provider_run_id', table_name='run')
    op.drop_index('ix_run_runtime_provider_id', table_name='run')
    op.drop_constraint('fk_run_runtime_provider', 'run', type_='foreignkey')
    op.drop_column('run', 'runtime_snapshot')
    op.drop_column('run', 'runtime_request_hash')
    op.drop_column('run', 'runtime_provider_run_id')
    op.drop_column('run', 'runtime_provider_id')

    op.drop_constraint('fk_release_runtime_provider', 'release', type_='foreignkey')
    op.drop_column('release', 'runtime_binding_snapshot')
    op.drop_column('release', 'runtime_profile')
    op.drop_column('release', 'runtime_provider_id')

    op.drop_table('agent_runtime_provider')
