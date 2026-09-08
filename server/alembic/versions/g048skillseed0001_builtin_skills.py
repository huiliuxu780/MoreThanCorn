"""docs/v2-design/10 §5.1：仓内现存 SKILL.md 一次性种子为 builtin Skill。

- 读取 repo 内两份 SKILL.md（business module bundle / POC consumer-analysis）；
- 文件缺失或同名已存在则跳过（幂等）；DB 为唯一源，文件归档不删。

仅新增行，不改表结构（expand-only 约定）。

Revision ID: g048skillseed0001
Revises: g047agentcap0001
"""
from datetime import datetime, timezone
from pathlib import Path
from typing import Sequence, Union
from uuid import uuid4

import sqlalchemy as sa
from alembic import op

revision: str = 'g048skillseed0001'
down_revision: Union[str, Sequence[str], None] = 'g047agentcap0001'
branch_labels = None
depends_on = None

_ROOT = Path(__file__).resolve().parents[3]

SEEDS = [
    {
        "name": "native-business-analysis",
        "desc": "对业务数据进行只读分析：明确指标口径、查询数据源、确定性计算、交叉核验并带引用输出结论。",
        "path": _ROOT / "server/app/agent_modules/business_analysis/skills/native-business-analysis/SKILL.md",
    },
    {
        "name": "consumer-analysis",
        "desc": "消费者需求分析：从通话记录抽取需求实体并归类到产品组。",
        "path": _ROOT / "poc/agent_runtime_providers/independent_agents/skills/consumer-analysis/SKILL.md",
    },
]


def upgrade() -> None:
    bind = op.get_bind()
    skill = sa.table(
        "skill",
        sa.column("id", sa.String),
        sa.column("name", sa.String),
        sa.column("description", sa.Text),
        sa.column("category", sa.String),
        sa.column("content", sa.Text),
        sa.column("source", sa.String),
        sa.column("status", sa.String),
        sa.column("extra", sa.JSON),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )
    existing = {r[0] for r in bind.execute(sa.select(skill.c.name)).all()}
    for s in SEEDS:
        if s["name"] in existing or not s["path"].exists():
            continue
        now = datetime.now(timezone.utc)
        bind.execute(sa.insert(skill).values(
            id=uuid4().hex, name=s["name"], description=s["desc"], category="",
            content=s["path"].read_text(encoding="utf-8"), source="builtin",
            status="ready", extra={}, created_at=now, updated_at=now))


def downgrade() -> None:
    bind = op.get_bind()
    skill = sa.table("skill", sa.column("name", sa.String), sa.column("source", sa.String))
    bind.execute(sa.delete(skill).where(
        skill.c.name.in_([s["name"] for s in SEEDS]), skill.c.source == "builtin"))
