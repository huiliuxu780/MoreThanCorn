"""g049: AgentScope 换底控制面与索引表（任务书 §四/§五，docs/v2-design/13）。

平台只保留控制面与索引；Session/消息/AgentState/Schedule 真相在
AgentScope 运行时（wf_agentscope 库，官方 AsyncSQLAlchemyStorage）。

Revision ID: g049agentscope0001
Revises: g048skillseed0001
"""
from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "g049agentscope0001"
down_revision = "g048skillseed0001"
branch_labels = None
depends_on = None

JSONB = postgresql.JSONB


def upgrade() -> None:
    op.create_table(
        "agent_session_index",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("session_id", sa.String(64), nullable=False),
        sa.Column("user_id", sa.String(64), nullable=False),
        sa.Column("agent_id", sa.String(32), nullable=False),
        sa.Column("release_id", sa.String(32), nullable=True),
        sa.Column("trigger_kind", sa.String(16), nullable=False, server_default="manual"),
        sa.Column("automation_id", sa.String(32), nullable=True),
        sa.Column("trigger_log_id", sa.String(32), nullable=True),
        sa.Column("workflow_run_id", sa.String(32), nullable=True),
        sa.Column("agentflow_run_id", sa.String(32), nullable=True),
        sa.Column("agentflow_node_run_id", sa.String(32), nullable=True),
        sa.Column("conversation_key", sa.String(128), nullable=True),
        sa.Column("idempotency_key", sa.String(128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("session_id", name="uq_session_index_session"),
    )
    op.create_index("ix_session_index_user", "agent_session_index", ["user_id"])
    op.create_index("ix_session_index_agent", "agent_session_index", ["agent_id"])
    op.create_index("ix_session_index_automation", "agent_session_index", ["automation_id"])
    op.create_index("ix_session_index_wf_run", "agent_session_index", ["workflow_run_id"])
    op.create_index("ix_session_index_flow_run", "agent_session_index", ["agentflow_run_id"])
    op.create_index("ix_session_index_conv", "agent_session_index", ["conversation_key"])

    op.create_table(
        "automation_definition",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("name", sa.String(64), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("target_kind", sa.String(16), nullable=False),
        sa.Column("agent_id", sa.String(32), nullable=True),
        sa.Column("workflow_id", sa.String(64), nullable=True),
        sa.Column("workflow_version_id", sa.String(32), nullable=True),
        sa.Column("agentflow_id", sa.String(32), nullable=True),
        sa.Column("agentflow_release_id", sa.String(32), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("session_policy", sa.String(16), nullable=False, server_default="fresh"),
        sa.Column("prompt_template", sa.Text(), nullable=False, server_default=""),
        sa.Column("input_mapping", JSONB(), nullable=False, server_default="{}"),
        sa.Column("max_runs", sa.Integer(), nullable=True),
        sa.Column("deadline", sa.DateTime(timezone=True), nullable=True),
        sa.Column("runtime_schedule_id", sa.String(64), nullable=True),
        sa.Column("last_auto_fire_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("auto_run_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_auto_status", sa.String(16), nullable=True),
        sa.Column("created_by", sa.String(64), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "(target_kind='agent' AND agent_id IS NOT NULL) OR "
            "(target_kind='workflow' AND workflow_id IS NOT NULL) OR "
            "(target_kind='agentflow' AND agentflow_id IS NOT NULL)",
            name="ck_automation_target",
        ),
    )
    op.create_index("ix_automation_agent", "automation_definition", ["agent_id"])

    op.create_table(
        "automation_trigger",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("automation_id", sa.String(32), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("config", JSONB(), nullable=False, server_default="{}"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_automation_trigger_auto", "automation_trigger", ["automation_id"])

    op.create_table(
        "automation_api_key",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("automation_id", sa.String(32), nullable=False),
        sa.Column("key_hash", sa.String(128), nullable=False),
        sa.Column("label", sa.String(64), nullable=False, server_default=""),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("key_hash", name="uq_automation_api_key_hash"),
    )
    op.create_index("ix_automation_key_auto", "automation_api_key", ["automation_id"])

    op.create_table(
        "automation_trigger_log",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("automation_id", sa.String(32), nullable=False),
        sa.Column("trigger_id", sa.String(32), nullable=True),
        sa.Column("source", sa.String(16), nullable=False),
        sa.Column("idempotency_key", sa.String(128), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="received"),
        sa.Column("session_id", sa.String(64), nullable=True),
        sa.Column("workflow_run_id", sa.String(32), nullable=True),
        sa.Column("agentflow_run_id", sa.String(32), nullable=True),
        sa.Column("payload_sha", sa.String(64), nullable=True),
        sa.Column("error", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_trigger_log_auto", "automation_trigger_log", ["automation_id"])
    op.create_index("ix_trigger_log_session", "automation_trigger_log", ["session_id"])

    op.create_table(
        "agentflow_definition",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("name", sa.String(64), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_by", sa.String(64), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        "agentflow_version",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("definition_id", sa.String(32), nullable=False),
        sa.Column("version_no", sa.Integer(), nullable=False),
        sa.Column("definition", JSONB(), nullable=False, server_default="{}"),
        sa.Column("content_digest", sa.String(64), nullable=False, server_default=""),
        sa.Column("created_by", sa.String(64), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("definition_id", "version_no", name="uq_agentflow_version_no"),
    )
    op.create_index("ix_agentflow_version_def", "agentflow_version", ["definition_id"])

    op.create_table(
        "agentflow_release",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("version_id", sa.String(32), nullable=False),
        sa.Column("environment", sa.String(16), nullable=False, server_default="prod"),
        sa.Column("status", sa.String(16), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_agentflow_release_ver", "agentflow_release", ["version_id"])

    op.create_table(
        "agentflow_run",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("release_id", sa.String(32), nullable=False),
        sa.Column("trigger_kind", sa.String(16), nullable=False, server_default="manual"),
        sa.Column("status", sa.String(16), nullable=False, server_default="running"),
        sa.Column("input", JSONB(), nullable=False, server_default="{}"),
        sa.Column("output", JSONB(), nullable=True),
        sa.Column("error", sa.Text(), nullable=False, server_default=""),
        sa.Column("automation_id", sa.String(32), nullable=True),
        sa.Column("parent_session_id", sa.String(64), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_agentflow_run_release", "agentflow_run", ["release_id"])
    op.create_index("ix_agentflow_run_auto", "agentflow_run", ["automation_id"])

    op.create_table(
        "agentflow_node_run",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("run_id", sa.String(32), nullable=False),
        sa.Column("node_id", sa.String(64), nullable=False),
        sa.Column("attempt", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("agent_id", sa.String(32), nullable=True),
        sa.Column("session_id", sa.String(64), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="running"),
        sa.Column("input", JSONB(), nullable=False, server_default="{}"),
        sa.Column("input_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("output", JSONB(), nullable=True),
        sa.Column("error", sa.Text(), nullable=False, server_default=""),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("run_id", "node_id", "attempt", name="uq_agentflow_node_attempt"),
    )
    op.create_index("ix_agentflow_node_run_run", "agentflow_node_run", ["run_id"])
    op.create_index("ix_agentflow_node_session", "agentflow_node_run", ["session_id"])

    op.create_table(
        "data_source",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("name", sa.String(64), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("config", JSONB(), nullable=False, server_default="{}"),
        sa.Column("auth_token_hash", sa.String(128), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="active"),
        sa.Column("cursor", JSONB(), nullable=False, server_default="{}"),
        sa.Column("last_poll_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        "data_source_event",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("source_id", sa.String(32), nullable=False),
        sa.Column("dedupe_key", sa.String(128), nullable=False),
        sa.Column("payload", JSONB(), nullable=False, server_default="{}"),
        sa.Column("status", sa.String(16), nullable=False, server_default="received"),
        sa.Column("automation_id", sa.String(32), nullable=True),
        sa.Column("dispatch_ref", sa.String(64), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("source_id", "dedupe_key", name="uq_source_dedupe"),
    )
    op.create_index("ix_source_event_source", "data_source_event", ["source_id"])
    op.create_index("ix_source_event_auto", "data_source_event", ["automation_id"])


def downgrade() -> None:
    for table in (
        "data_source_event",
        "data_source",
        "agentflow_node_run",
        "agentflow_run",
        "agentflow_release",
        "agentflow_version",
        "agentflow_definition",
        "automation_trigger_log",
        "automation_api_key",
        "automation_trigger",
        "automation_definition",
        "agent_session_index",
    ):
        op.drop_table(table)
