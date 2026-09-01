"""SDD 13 PR1：Task 输出解耦与投递链的 Domain Model。

- analysis_task_version：OutputBinding 显式列（output_contract_snapshot/output_mode/
  output_asset_id/output_definition_version_id/output_write_mode/output_key_fields/
  output_mapping/output_failure_policy）；存量回填 output_mode=platform_only。
- task_run：output_binding_snapshot + delivery_status/三个投递计数；
  存量回填 delivery_status=not_configured。
- result_delivery：Run→目标表投递 Outbox；UNIQUE(run_id) 与 UNIQUE(idempotency_key)。
- schedule_occurrence：当日调度事实；UNIQUE(fire_key) 与 UNIQUE(schedule_id, planned_at)。

仅新增与回填，不删除任何存量表/列（SDD 13 §12：migration 不得删除旧列）。

Revision ID: g046sdd13pr10001
Revises: g045sdd12p0001
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'g046sdd13pr10001'
down_revision: Union[str, Sequence[str], None] = 'g045sdd12p0001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ---------- analysis_task_version：OutputBinding ----------
    op.add_column('analysis_task_version', sa.Column(
        'output_contract_snapshot', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column('analysis_task_version', sa.Column(
        'output_mode', sa.String(16), nullable=False, server_default='platform_only'))
    op.add_column('analysis_task_version', sa.Column(
        'output_asset_id', sa.String(32), nullable=True))
    op.add_column('analysis_task_version', sa.Column(
        'output_definition_version_id', sa.String(32), nullable=True))
    op.add_column('analysis_task_version', sa.Column(
        'output_write_mode', sa.String(16), nullable=False, server_default='upsert'))
    op.add_column('analysis_task_version', sa.Column(
        'output_key_fields', postgresql.JSONB(astext_type=sa.Text()), nullable=False,
        server_default=sa.text("'[]'::jsonb")))
    op.add_column('analysis_task_version', sa.Column(
        'output_mapping', postgresql.JSONB(astext_type=sa.Text()), nullable=False,
        server_default=sa.text("'{}'::jsonb")))
    op.add_column('analysis_task_version', sa.Column(
        'output_failure_policy', sa.String(32), nullable=False,
        server_default='separate_delivery_status'))
    op.execute("UPDATE analysis_task_version SET output_mode='platform_only' "
               "WHERE output_mode IS NULL OR output_mode = ''")

    # ---------- task_run：投递快照与聚合 ----------
    op.add_column('task_run', sa.Column(
        'output_binding_snapshot', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column('task_run', sa.Column(
        'delivery_status', sa.String(16), nullable=False, server_default='not_configured'))
    op.add_column('task_run', sa.Column('delivery_pending_count', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('task_run', sa.Column('delivery_succeeded_count', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('task_run', sa.Column('delivery_failed_count', sa.Integer(), nullable=False, server_default='0'))
    op.create_index('ix_task_run_delivery_status', 'task_run', ['delivery_status'])
    op.execute("UPDATE task_run SET delivery_status='not_configured' "
               "WHERE delivery_status IS NULL OR delivery_status = ''")

    # ---------- result_delivery ----------
    op.create_table(
        'result_delivery',
        sa.Column('id', sa.String(32), primary_key=True),
        sa.Column('run_id', sa.String(32), sa.ForeignKey('run.id', ondelete='CASCADE'), nullable=False),
        sa.Column('task_run_id', sa.String(32), sa.ForeignKey('task_run.id', ondelete='SET NULL'), nullable=True),
        sa.Column('task_id', sa.String(32), nullable=True),
        sa.Column('task_version_id', sa.String(32), nullable=True),
        sa.Column('interaction_ref', sa.String(128), nullable=False, server_default=''),
        sa.Column('output_asset_id', sa.String(32), nullable=True),
        sa.Column('output_definition_version_id', sa.String(32), nullable=True),
        sa.Column('status', sa.String(16), nullable=False, server_default='pending'),
        sa.Column('write_mode', sa.String(16), nullable=False, server_default='upsert'),
        sa.Column('idempotency_key', sa.String(128), nullable=False, server_default=''),
        sa.Column('record_payload', postgresql.JSONB(astext_type=sa.Text()), nullable=False,
                  server_default=sa.text("'{}'::jsonb")),
        sa.Column('payload_sha256', sa.String(64), nullable=False, server_default=''),
        sa.Column('attempts', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('max_attempts', sa.Integer(), nullable=False, server_default='5'),
        sa.Column('next_attempt_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('error', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('target_reference', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text('now()')),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint('run_id', name='uq_result_delivery_run'),
        sa.UniqueConstraint('idempotency_key', name='uq_result_delivery_idem'),
    )
    op.create_index('ix_result_delivery_run_id', 'result_delivery', ['run_id'])
    op.create_index('ix_result_delivery_task_run_id', 'result_delivery', ['task_run_id'])
    op.create_index('ix_result_delivery_task_id', 'result_delivery', ['task_id'])
    op.create_index('ix_result_delivery_interaction_ref', 'result_delivery', ['interaction_ref'])
    op.create_index('ix_result_delivery_status', 'result_delivery', ['status'])

    # ---------- schedule_occurrence ----------
    op.create_table(
        'schedule_occurrence',
        sa.Column('id', sa.String(32), primary_key=True),
        sa.Column('schedule_id', sa.String(32), sa.ForeignKey('schedule.id', ondelete='CASCADE'), nullable=False),
        sa.Column('task_id', sa.String(32), nullable=True),
        sa.Column('planned_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('timezone', sa.String(48), nullable=False, server_default='Asia/Shanghai'),
        sa.Column('fire_key', sa.String(128), nullable=False, server_default=''),
        sa.Column('status', sa.String(16), nullable=False, server_default='planned'),
        sa.Column('task_run_id', sa.String(32), sa.ForeignKey('task_run.id', ondelete='SET NULL'), nullable=True),
        sa.Column('schedule_snapshot', postgresql.JSONB(astext_type=sa.Text()), nullable=False,
                  server_default=sa.text("'{}'::jsonb")),
        sa.Column('error', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text('now()')),
        sa.UniqueConstraint('fire_key', name='uq_occurrence_fire_key'),
        sa.UniqueConstraint('schedule_id', 'planned_at', name='uq_occurrence_schedule_planned'),
        sa.UniqueConstraint('task_run_id', name='uq_occurrence_task_run'),
    )
    op.create_index('ix_schedule_occurrence_schedule_id', 'schedule_occurrence', ['schedule_id'])
    op.create_index('ix_schedule_occurrence_task_id', 'schedule_occurrence', ['task_id'])
    op.create_index('ix_schedule_occurrence_planned_at', 'schedule_occurrence', ['planned_at'])
    op.create_index('ix_schedule_occurrence_status', 'schedule_occurrence', ['status'])


def downgrade() -> None:
    op.drop_table('schedule_occurrence')
    op.drop_table('result_delivery')
    op.drop_index('ix_task_run_delivery_status', 'task_run')
    op.drop_column('task_run', 'delivery_failed_count')
    op.drop_column('task_run', 'delivery_succeeded_count')
    op.drop_column('task_run', 'delivery_pending_count')
    op.drop_column('task_run', 'delivery_status')
    op.drop_column('task_run', 'output_binding_snapshot')
    op.drop_column('analysis_task_version', 'output_failure_policy')
    op.drop_column('analysis_task_version', 'output_mapping')
    op.drop_column('analysis_task_version', 'output_key_fields')
    op.drop_column('analysis_task_version', 'output_write_mode')
    op.drop_column('analysis_task_version', 'output_definition_version_id')
    op.drop_column('analysis_task_version', 'output_asset_id')
    op.drop_column('analysis_task_version', 'output_mode')
    op.drop_column('analysis_task_version', 'output_contract_snapshot')
