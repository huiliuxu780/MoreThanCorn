"""g065: automation 第四执行体 group（执行域 Spec 增补，D4 落地）。"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "g065automationgroup0001"
down_revision = "g064groupbudget0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("automation_definition", sa.Column(
        "group_id", sa.String(32), nullable=True))
    op.create_index("ix_automation_definition_group",
                    "automation_definition", ["group_id"])


def downgrade() -> None:
    op.drop_index("ix_automation_definition_group",
                  table_name="automation_definition")
    op.drop_column("automation_definition", "group_id")
