"""09-SDD P0-B1：Task 领域模型——TaskVersion/DataSnapshot/TaskRun/RuleVersion/
ReviewRevision/OutputSchema + Run/QualityResult 追踪列 + 不变量约束。

非破坏回填（D09-6）：
- 存量 analysis_task → v1 TaskVersion（扁平列确定性转换）；
- 存量 result_rule_set / data_definition → 不可变版本快照；
- 存量 quality_result 补 ai_result；重复 run_id 的旧行标记 is_latest=false（不删除）。

Revision ID: g032p0taskdom01
Revises: fwficon260826
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'g032p0taskdom01'
down_revision: Union[str, Sequence[str], None] = 'fwficon260826'
branch_labels = None
depends_on = None

QUALITY_EVALUATION_SCHEMA = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "title": "QualityEvaluation",
    "type": "object",
    "required": ["score", "risk", "issues", "summary"],
    "properties": {
        "score": {"type": "number", "minimum": 0, "maximum": 100},
        "risk": {"type": "string", "enum": ["Low", "Medium", "High", "Critical"]},
        "critical": {"type": "boolean"},
        "issues": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["criterion", "severity"],
                "properties": {
                    "criterion": {"type": "string"},
                    "severity": {"type": "string", "enum": ["Low", "Medium", "High", "Critical"]},
                    "evidence": {"type": "string"},
                },
            },
        },
        "summary": {"type": "string"},
    },
    "additionalProperties": True,
}

_jsonb = postgresql.JSONB


def _new_id_sql() -> str:
    return "md5(random()::text || clock_timestamp()::text)"


def upgrade() -> None:
    # ---- 新实体 ----
    op.create_table(
        'quality_output_schema',
        sa.Column('id', sa.String(32), primary_key=True),
        sa.Column('key', sa.String(64), nullable=False, index=True),
        sa.Column('version_no', sa.Integer(), nullable=False),
        sa.Column('schema', _jsonb, nullable=False, server_default='{}'),
        sa.Column('status', sa.String(16), nullable=False, server_default='published'),
        sa.Column('created_by', sa.String(64), nullable=False, server_default=''),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text('now()')),
        sa.UniqueConstraint('key', 'version_no', name='uq_output_schema_version'),
    )
    op.create_table(
        'analysis_task_version',
        sa.Column('id', sa.String(32), primary_key=True),
        sa.Column('task_id', sa.String(32),
                  sa.ForeignKey('analysis_task.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('version_no', sa.Integer(), nullable=False),
        sa.Column('workflow_id', sa.String(64), nullable=False),
        sa.Column('workflow_version_policy', sa.String(16), nullable=False,
                  server_default='latest_published'),
        sa.Column('pinned_workflow_version_id', sa.String(32), nullable=True),
        sa.Column('data_asset_id', sa.String(64), nullable=False),
        sa.Column('data_definition_version_id', sa.String(32), nullable=True),
        sa.Column('result_rule_version_id', sa.String(32), nullable=True),
        sa.Column('input_mapping', _jsonb, nullable=False, server_default='{}'),
        sa.Column('scope', _jsonb, nullable=False, server_default='{}'),
        sa.Column('sampling', _jsonb, nullable=False, server_default='{}'),
        sa.Column('data_window', _jsonb, nullable=False, server_default='{}'),
        sa.Column('output_schema_version_id', sa.String(32), nullable=True),
        sa.Column('note', sa.Text(), nullable=False, server_default=''),
        sa.Column('created_by', sa.String(64), nullable=False, server_default=''),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text('now()')),
        sa.UniqueConstraint('task_id', 'version_no', name='uq_task_version_no'),
    )
    op.create_table(
        'data_definition_version',
        sa.Column('id', sa.String(32), primary_key=True),
        sa.Column('definition_id', sa.String(32),
                  sa.ForeignKey('data_definition.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('version_no', sa.Integer(), nullable=False),
        sa.Column('field_schema', _jsonb, nullable=False, server_default='[]'),
        sa.Column('eligibility', _jsonb, nullable=False, server_default='[]'),
        sa.Column('note', sa.Text(), nullable=False, server_default=''),
        sa.Column('created_by', sa.String(64), nullable=False, server_default=''),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text('now()')),
        sa.UniqueConstraint('definition_id', 'version_no', name='uq_definition_version_no'),
    )
    op.create_table(
        'result_rule_version',
        sa.Column('id', sa.String(32), primary_key=True),
        sa.Column('rule_set_id', sa.String(32),
                  sa.ForeignKey('result_rule_set.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('version_no', sa.Integer(), nullable=False),
        sa.Column('rules', _jsonb, nullable=False, server_default='{}'),
        sa.Column('evaluation_priority', sa.String(32), nullable=False,
                  server_default='Most Recent Completed'),
        sa.Column('note', sa.Text(), nullable=False, server_default=''),
        sa.Column('created_by', sa.String(64), nullable=False, server_default=''),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text('now()')),
        sa.UniqueConstraint('rule_set_id', 'version_no', name='uq_rule_version_no'),
    )
    op.create_table(
        'data_snapshot',
        sa.Column('id', sa.String(32), primary_key=True),
        sa.Column('asset_id', sa.String(32), nullable=False, index=True),
        sa.Column('asset_revision', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('definition_version_id', sa.String(32), nullable=True),
        sa.Column('locator', _jsonb, nullable=False, server_default='{}'),
        sa.Column('resolved_window', _jsonb, nullable=False, server_default='{}'),
        sa.Column('resolved_scope', _jsonb, nullable=False, server_default='{}'),
        sa.Column('resolved_sampling', _jsonb, nullable=False, server_default='{}'),
        sa.Column('checkpoint', sa.String(256), nullable=True),
        sa.Column('expected_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('read_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('checksum', sa.String(64), nullable=False, server_default=''),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text('now()')),
    )
    op.create_table(
        'task_run',
        sa.Column('id', sa.String(32), primary_key=True),
        sa.Column('task_id', sa.String(32),
                  sa.ForeignKey('analysis_task.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('task_version_id', sa.String(32),
                  sa.ForeignKey('analysis_task_version.id'), nullable=False, index=True),
        sa.Column('data_snapshot_id', sa.String(32),
                  sa.ForeignKey('data_snapshot.id', ondelete='SET NULL'), nullable=True),
        sa.Column('trigger', sa.String(16), nullable=False, server_default='manual'),
        sa.Column('schedule_fire_key', sa.String(128), nullable=True, unique=True),
        sa.Column('idempotency_key', sa.String(128), nullable=True, unique=True),
        sa.Column('status', sa.String(16), nullable=False, server_default='queued', index=True),
        sa.Column('total', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('succeeded_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('failed_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('skipped_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('cancelled_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('error_summary', _jsonb, nullable=True),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text('now()')),
    )
    op.create_table(
        'review_revision',
        sa.Column('id', sa.String(32), primary_key=True),
        sa.Column('quality_result_id', sa.String(32),
                  sa.ForeignKey('quality_result.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('revision_no', sa.Integer(), nullable=False),
        sa.Column('action', sa.String(16), nullable=False),
        sa.Column('reason', sa.Text(), nullable=False, server_default=''),
        sa.Column('reviewer_id', sa.String(64), nullable=False, server_default=''),
        sa.Column('before', _jsonb, nullable=False, server_default='{}'),
        sa.Column('after', _jsonb, nullable=False, server_default='{}'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text('now()')),
        sa.UniqueConstraint('quality_result_id', 'revision_no', name='uq_review_revision'),
    )

    # ---- 既有表加列 ----
    op.add_column('analysis_task', sa.Column('current_version_id', sa.String(32), nullable=True))
    op.add_column('analysis_task', sa.Column('created_by', sa.String(64), nullable=False, server_default=''))
    op.add_column('analysis_task', sa.Column('updated_by', sa.String(64), nullable=False, server_default=''))
    op.add_column('analysis_task', sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False,
                                             server_default=sa.text('now()')))

    op.add_column('run', sa.Column('task_run_id', sa.String(32), nullable=True))
    op.create_foreign_key('fk_run_task_run', 'run', 'task_run',
                          ['task_run_id'], ['id'], ondelete='SET NULL')
    op.create_index('ix_run_task_run_id', 'run', ['task_run_id'])
    op.add_column('run', sa.Column('task_id', sa.String(32), nullable=True))
    op.create_index('ix_run_task_id', 'run', ['task_id'])
    op.add_column('run', sa.Column('task_version_id', sa.String(32), nullable=True))
    op.add_column('run', sa.Column('interaction_ref', sa.String(128), nullable=False, server_default=''))
    op.create_index('ix_run_interaction_ref', 'run', ['interaction_ref'])
    op.add_column('run', sa.Column('attempt', sa.Integer(), nullable=False, server_default='1'))
    op.add_column('run', sa.Column('definition_version_id', sa.String(32), nullable=True))
    op.add_column('run', sa.Column('rule_version_id', sa.String(32), nullable=True))
    op.add_column('run', sa.Column('data_snapshot_id', sa.String(32), nullable=True))
    op.create_unique_constraint('uq_run_taskrun_interaction_attempt', 'run',
                                ['task_run_id', 'interaction_ref', 'attempt'])

    op.add_column('quality_result', sa.Column('task_run_id', sa.String(32), nullable=True))
    op.create_foreign_key('fk_quality_result_task_run', 'quality_result', 'task_run',
                          ['task_run_id'], ['id'], ondelete='SET NULL')
    op.create_index('ix_quality_result_task_run_id', 'quality_result', ['task_run_id'])
    op.add_column('quality_result', sa.Column('task_id', sa.String(32), nullable=True))
    op.create_index('ix_quality_result_task_id', 'quality_result', ['task_id'])
    op.add_column('quality_result', sa.Column('task_version_id', sa.String(32), nullable=True))
    op.add_column('quality_result', sa.Column('rule_version_id', sa.String(32), nullable=True))
    op.create_foreign_key('fk_quality_result_rule_version', 'quality_result', 'result_rule_version',
                          ['rule_version_id'], ['id'], ondelete='SET NULL')
    op.create_index('ix_quality_result_rule_version_id', 'quality_result', ['rule_version_id'])
    op.add_column('quality_result', sa.Column('output_schema_version_id', sa.String(32), nullable=True))
    op.add_column('quality_result', sa.Column('ai_result', _jsonb, nullable=True))
    op.add_column('quality_result', sa.Column('derived_result', _jsonb, nullable=True))
    op.add_column('quality_result', sa.Column('effective_review_revision_id', sa.String(32), nullable=True))
    op.add_column('quality_result', sa.Column('is_latest', sa.Boolean(), nullable=False, server_default='true'))
    op.create_index('ix_quality_result_is_latest', 'quality_result', ['is_latest'])
    op.create_index('ix_quality_result_interaction_ref', 'quality_result', ['interaction_ref'])

    conn = op.get_bind()
    nid = _new_id_sql()

    # ---- 种子：QualityEvaluation Schema v1（D09-3） ----
    import json
    conn.execute(sa.text(
        "INSERT INTO quality_output_schema (id, key, version_no, schema, status, created_by, created_at) "
        f"VALUES ({nid}, 'quality_evaluation', 1, :schema, 'published', 'system', now())"),
        {"schema": json.dumps(QUALITY_EVALUATION_SCHEMA)})

    # ---- 回填：规则/定义不可变快照 ----
    conn.execute(sa.text(f"""
        INSERT INTO result_rule_version (id, rule_set_id, version_no, rules, evaluation_priority, note, created_by, created_at)
        SELECT {nid}, r.id, r.version, r.rules, r.evaluation_priority, 'P0-B1 backfill', 'system', now()
        FROM result_rule_set r
    """))
    conn.execute(sa.text(f"""
        INSERT INTO data_definition_version (id, definition_id, version_no, field_schema, eligibility, note, created_by, created_at)
        SELECT {nid}, d.id, d.revision, d.field_schema, d.eligibility, 'P0-B1 backfill', 'system', now()
        FROM data_definition d
    """))

    # ---- 回填：存量 Task → v1 TaskVersion（确定性转换，不删除任何行） ----
    conn.execute(sa.text(f"""
        INSERT INTO analysis_task_version
          (id, task_id, version_no, workflow_id, workflow_version_policy, pinned_workflow_version_id,
           data_asset_id, data_definition_version_id, result_rule_version_id,
           input_mapping, scope, sampling, data_window, output_schema_version_id, note, created_by, created_at)
        SELECT {nid}, t.id, 1, t.workflow_id, 'latest_published', NULL,
               t.data_asset_id, NULL, NULL, '{{}}'::jsonb,
               CASE WHEN t.scope IN ('all','') THEN '{{"op":"and","conditions":[]}}'::jsonb
                    ELSE jsonb_build_object('mode','legacy','expr',t.scope) END,
               CASE WHEN t.sampling IN ('all','') THEN '{{"mode":"all"}}'::jsonb
                    WHEN t.sampling LIKE 'first_%'
                      THEN jsonb_build_object('mode','count','count',(split_part(t.sampling,'_',2))::int)
                    ELSE jsonb_build_object('mode','legacy','expr',t.sampling) END,
               CASE WHEN t.data_window IN ('last_24h','last_7d','last_30d')
                      THEN jsonb_build_object('mode','relative','value',t.data_window,'timezone','Asia/Shanghai')
                    WHEN t.data_window IN ('all','') THEN '{{"mode":"all"}}'::jsonb
                    ELSE jsonb_build_object('mode','legacy','expr',t.data_window) END,
               (SELECT id FROM quality_output_schema WHERE key='quality_evaluation' AND version_no=1 LIMIT 1),
               'P0-B1 backfill from flat columns', 'system', now()
        FROM analysis_task t
    """))
    conn.execute(sa.text("""
        UPDATE analysis_task t SET current_version_id = v.id
        FROM analysis_task_version v WHERE v.task_id = t.id AND v.version_no = 1
    """))
    conn.execute(sa.text("UPDATE analysis_task SET status = lower(status)"))

    # ---- 回填：quality_result 补 ai_result；重复 run_id 旧行 is_latest=false（D09-6 不删除） ----
    conn.execute(sa.text("""
        UPDATE quality_result SET ai_result = jsonb_strip_nulls(jsonb_build_object(
            'structuredOutput', structured_output, 'score', score, 'risk', risk,
            'critical', critical, 'issueCount', issue_count, 'issueSummary', issue_summary))
        WHERE ai_result IS NULL
    """))
    conn.execute(sa.text("""
        UPDATE quality_result SET is_latest = FALSE
        WHERE id IN (
            SELECT id FROM (
                SELECT id, ROW_NUMBER() OVER (
                    PARTITION BY run_id ORDER BY created_at DESC, id DESC) AS rn
                FROM quality_result WHERE run_id IS NOT NULL
            ) x WHERE x.rn > 1
        )
    """))

    # ---- INV-03：一个 Run 至多一条生效结果（部分唯一） ----
    op.execute("CREATE UNIQUE INDEX uq_quality_result_run_latest "
               "ON quality_result (run_id) WHERE is_latest")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_quality_result_run_latest")
    for ix in ('ix_quality_result_interaction_ref', 'ix_quality_result_is_latest',
               'ix_quality_result_rule_version_id', 'ix_quality_result_task_id',
               'ix_quality_result_task_run_id'):
        op.drop_index(ix, table_name='quality_result')
    op.drop_constraint('fk_quality_result_rule_version', 'quality_result', type_='foreignkey')
    op.drop_constraint('fk_quality_result_task_run', 'quality_result', type_='foreignkey')
    for c in ('task_run_id', 'task_id', 'task_version_id', 'rule_version_id',
              'output_schema_version_id', 'ai_result', 'derived_result',
              'effective_review_revision_id', 'is_latest'):
        op.drop_column('quality_result', c)

    op.drop_constraint('uq_run_taskrun_interaction_attempt', 'run', type_='unique')
    for ix in ('ix_run_interaction_ref', 'ix_run_task_id', 'ix_run_task_run_id'):
        op.drop_index(ix, table_name='run')
    op.drop_constraint('fk_run_task_run', 'run', type_='foreignkey')
    for c in ('task_run_id', 'task_id', 'task_version_id', 'interaction_ref', 'attempt',
              'definition_version_id', 'rule_version_id', 'data_snapshot_id'):
        op.drop_column('run', c)

    for c in ('current_version_id', 'created_by', 'updated_by', 'updated_at'):
        op.drop_column('analysis_task', c)

    for t in ('review_revision', 'task_run', 'data_snapshot', 'result_rule_version',
              'data_definition_version', 'analysis_task_version', 'quality_output_schema'):
        op.drop_table(t)
