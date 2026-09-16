"""g066: ck_automation_target 词表扩 group（第四执行体，D4）。"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "g066automationgroupck0001"
down_revision = "g065automationgroup0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("ck_automation_target", "automation_definition",
                       type_="check")
    op.create_check_constraint(
        "ck_automation_target", "automation_definition",
        "(target_kind='agent' AND agent_id IS NOT NULL) OR "
        "(target_kind='workflow' AND workflow_id IS NOT NULL) OR "
        "(target_kind='agentflow' AND agentflow_id IS NOT NULL) OR "
        "(target_kind='group' AND group_id IS NOT NULL)")


def downgrade() -> None:
    op.drop_constraint("ck_automation_target", "automation_definition",
                       type_="check")
    op.create_check_constraint(
        "ck_automation_target", "automation_definition",
        sa.text("(target_kind='agent' AND agent_id IS NOT NULL) OR "
                "(target_kind='workflow' AND workflow_id IS NOT NULL) OR "
                "(target_kind='agentflow' AND agentflow_id IS NOT NULL)"))
