"""datasource kind → DataWriter（SDD 13 §18：首期只支持 PostgreSQL table sink）。"""
from __future__ import annotations

from .base import WriterError
from .postgres import PostgresWriter


def get_writer(db, datasource):
    if datasource is None:
        raise WriterError("UNSUPPORTED_SINK", "目标 DataAsset 未绑定 DataSource", retryable=False)
    if (datasource.type or "") != "postgresql":
        raise WriterError("UNSUPPORTED_SINK",
                          f"首期仅支持 PostgreSQL table sink（当前 {datasource.type}）",
                          retryable=False)
    return PostgresWriter(db, datasource)
