"""QualityEvaluation 输出 Schema（09-SDD §6.5 / D09-3 / P0-06）。

非法结构化输出不得落正式结果（INV-06）。校验在本地完成；
Schema 本体版本化存于 quality_output_schema 表。"""
from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import QualityOutputSchema

QUALITY_EVALUATION_KEY = "quality_evaluation"


def latest_quality_schema(db: Session | None = None) -> QualityOutputSchema | None:
    """取 quality_evaluation 最新已发布版本（无 db 时用独立会话，便于测试）。"""
    from .db import SessionLocal
    own = db is None
    db = db or SessionLocal()
    try:
        return db.execute(
            select(QualityOutputSchema)
            .where(QualityOutputSchema.key == QUALITY_EVALUATION_KEY,
                   QualityOutputSchema.status == "published")
            .order_by(QualityOutputSchema.version_no.desc())
        ).scalars().first()
    finally:
        if own:
            db.close()


def validate_evaluation(data, schema: dict | None = None) -> tuple[bool, list[str]]:
    """本地校验模型输出。返回 (ok, errors)；schema 缺省取最新已发布版本。"""
    import jsonschema
    if schema is None:
        row = latest_quality_schema()
        if row is None:
            return False, ["quality_evaluation schema 未配置"]
        schema = row.schema_
    v = jsonschema.Draft7Validator(schema)
    errors = sorted(v.iter_errors(data), key=lambda e: list(e.path))
    if not errors:
        return True, []
    msgs = []
    for e in errors[:5]:
        path = ".".join(str(p) for p in e.path) or "(root)"
        msgs.append(f"{path}: {e.message}")
    return False, msgs
