"""g070: 规则 Skill 化（09-17 拍板）：skill 版本列 + run/session 资产记账列。

- skill.version：同名 Skill 再上传递增，人读版本号；复现凭据仍以 content_digest 为准。
- run.asset_refs / agent_session_index.asset_refs：开工/开会话时冻结
  {rules_skill: {skill_id, name, version, content_digest}}——「这单按哪版规则跑」可查。
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "g070ruleskill0001"
down_revision = "g069convmeta0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("skill", sa.Column(
        "version", sa.Integer(), nullable=False, server_default="1"))
    op.add_column("run", sa.Column("asset_refs", postgresql.JSONB(), nullable=True))
    op.add_column("agent_session_index", sa.Column("asset_refs", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("agent_session_index", "asset_refs")
    op.drop_column("run", "asset_refs")
    op.drop_column("skill", "version")
