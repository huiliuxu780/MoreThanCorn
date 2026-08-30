"""SDD-12 P0：Secret 轮换账本 + 统一 CheckRun + Connection 生命周期扩列。

- connection_secret_revision：rotate 新增/退役旧；普通 config 更新不产生行（B-02）。
- check_run：connection|resource 的真实检查记录；启用门禁与健康度派生事实源（P0-04）。
- connection.lifecycle：draft|active|disabled|archived；存量回填 active（行为不变），
  新建默认 draft（C-01）。status 保留为兼容读，与 lifecycle 同步。
- connection.archived_at/archived_by/revision：软删除与乐观锁基座。

仅新增与回填，不删除任何存量表/列（§16.1）。

Revision ID: g045sdd12p0001
Revises: g044p2perm0001
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'g045sdd12p0001'
down_revision: Union[str, Sequence[str], None] = 'g044p2perm0001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'connection_secret_revision',
        sa.Column('id', sa.String(32), primary_key=True),
        sa.Column('connection_id', sa.String(32), sa.ForeignKey('connection.id'), nullable=False),
        sa.Column('env_code', sa.String(16), nullable=False, server_default=''),
        sa.Column('version_no', sa.Integer(), nullable=False),
        sa.Column('encrypted_payload', sa.Text(), nullable=False),
        sa.Column('payload_fingerprint', sa.String(64), nullable=False, server_default=''),
        sa.Column('status', sa.String(16), nullable=False, server_default='active'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text('now()')),
        sa.Column('created_by', sa.String(64), nullable=False, server_default=''),
        sa.Column('retired_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('retired_by', sa.String(64), nullable=True),
        sa.UniqueConstraint('connection_id', 'env_code', 'version_no',
                            name='uq_conn_secret_revision'),
    )
    op.create_index('ix_connection_secret_revision_connection_id',
                    'connection_secret_revision', ['connection_id'])

    op.create_table(
        'check_run',
        sa.Column('id', sa.String(32), primary_key=True),
        sa.Column('scope', sa.String(16), nullable=False),
        sa.Column('target_id', sa.String(32), nullable=False),
        sa.Column('env_code', sa.String(16), nullable=False, server_default=''),
        sa.Column('purpose', sa.String(16), nullable=False),
        sa.Column('status', sa.String(16), nullable=False),
        sa.Column('latency_ms', sa.Integer(), nullable=True),
        sa.Column('error', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('diagnostics', postgresql.JSONB(astext_type=sa.Text()), nullable=False,
                  server_default='{}'),
        sa.Column('config_fingerprint', sa.String(64), nullable=False, server_default=''),
        sa.Column('trace_id', sa.String(64), nullable=False, server_default=''),
        sa.Column('actor', sa.String(64), nullable=False, server_default=''),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text('now()')),
    )
    op.create_index('ix_check_run_target_id', 'check_run', ['target_id'])

    op.add_column('connection', sa.Column('lifecycle', sa.String(16), nullable=False,
                                          server_default='active'))
    op.alter_column('connection', 'lifecycle', server_default=None)  # 仅回填存量，新建走 ORM 默认 draft
    op.add_column('connection', sa.Column('archived_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('connection', sa.Column('archived_by', sa.String(64), nullable=True))
    op.add_column('connection', sa.Column('revision', sa.Integer(), nullable=False,
                                          server_default='1'))


def downgrade() -> None:
    # §16.1：downgrade 不删除已产生的新数据之外的东西；此处按常规回滚结构。
    op.drop_column('connection', 'revision')
    op.drop_column('connection', 'archived_by')
    op.drop_column('connection', 'archived_at')
    op.drop_column('connection', 'lifecycle')
    op.drop_index('ix_check_run_target_id', table_name='check_run')
    op.drop_table('check_run')
    op.drop_index('ix_connection_secret_revision_connection_id',
                  table_name='connection_secret_revision')
    op.drop_table('connection_secret_revision')
