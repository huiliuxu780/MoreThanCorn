"""phase D-1b: eval_sample.workflow_id 放开非空（样本可只挂 Agent，SDD 04 §0）

Revision ID: d029phased1002
Revises: d028phased1001
Create Date: 2026-08-26 09:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd029phased1002'
down_revision: Union[str, Sequence[str], None] = 'd028phased1001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.alter_column('eval_sample', 'workflow_id', existing_type=sa.String(length=32), nullable=True)


def downgrade() -> None:
    """Downgrade schema."""
    op.alter_column('eval_sample', 'workflow_id', existing_type=sa.String(length=32), nullable=False)
