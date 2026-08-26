"""form V1.5: key/status + form_version + form_record + fields 数据迁移

Revision ID: f0rmv3f0rm15
Revises: f0rm20260826
Create Date: 2026-08-26
"""
import uuid
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'f0rmv3f0rm15'
down_revision: Union[str, Sequence[str], None] = 'f0rm20260826'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _migrate_fields(old_fields) -> list:
    """旧 {name,type(data),control,required,default,description,options:str[]} →
    新 {id,key,type(UI),dataType,label,description,placeholder,default,options:[{label,value}],validation,layout,binding,condition}"""
    out = []
    for f in old_fields or []:
        opts = f.get("options") or []
        if opts and isinstance(opts[0], str):
            opts = [{"label": v, "value": v} for v in opts]
        out.append({
            "id": f.get("id") or uuid.uuid4().hex[:12],
            "key": f.get("key") or f.get("name") or "",
            "type": f.get("type") if f.get("control") is None else f.get("control"),
            "dataType": f.get("dataType") or (f.get("type") if f.get("control") else "string"),
            "label": f.get("label") or f.get("description") or f.get("name") or "",
            "description": f.get("description") or "",
            "placeholder": f.get("placeholder") or "",
            "default": f.get("default") or "",
            "options": opts,
            "validation": {"required": bool(f.get("required")), **(f.get("validation") or {})},
            "layout": f.get("layout") or {"span": 12},
            "binding": f.get("binding") or {"type": "manual"},
            "condition": f.get("condition") or {},
        })
    return out


def upgrade() -> None:
    op.add_column('form', sa.Column('key', sa.String(length=64), nullable=False, server_default=''))
    op.add_column('form', sa.Column('status', sa.String(length=16), nullable=False, server_default='draft'))
    op.create_table('form_version',
        sa.Column('id', sa.String(length=32), nullable=False),
        sa.Column('form_id', sa.String(length=32), nullable=False),
        sa.Column('version_no', sa.Integer(), nullable=False),
        sa.Column('fields', postgresql.JSONB(), nullable=False, server_default='[]'),
        sa.Column('note', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_form_version_form_id', 'form_version', ['form_id'])
    op.create_table('form_record',
        sa.Column('id', sa.String(length=32), nullable=False),
        sa.Column('form_id', sa.String(length=32), nullable=False),
        sa.Column('form_version', sa.Integer(), nullable=False),
        sa.Column('values', postgresql.JSONB(), nullable=False, server_default='{}'),
        sa.Column('created_by', sa.String(length=64), nullable=False),
        sa.Column('run_id', sa.String(length=32), nullable=True),
        sa.Column('task_id', sa.String(length=32), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_form_record_form_id', 'form_record', ['form_id'])

    # 数据迁移：key=name 回填 + fields 结构升级
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, name, fields FROM form")).fetchall()
    for r in rows:
        conn.execute(sa.text("UPDATE form SET key = :k WHERE id = :id AND key = ''"),
                     {"k": r.name, "id": r.id})
        conn.execute(sa.text("UPDATE form SET fields = CAST(:f AS jsonb) WHERE id = :id"),
                     {"f": __import__("json").dumps(_migrate_fields(r.fields)), "id": r.id})


def downgrade() -> None:
    op.drop_index('ix_form_record_form_id')
    op.drop_table('form_record')
    op.drop_index('ix_form_version_form_id')
    op.drop_table('form_version')
    op.drop_column('form', 'status')
    op.drop_column('form', 'key')
