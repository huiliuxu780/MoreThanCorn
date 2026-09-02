"""DataWriter 协议与错误分类（SDD 13 §7.2/§14.4）。

错误码必须区分：权限不足 / 表或字段变更 / 唯一冲突 / 可重试连接类错误。"""
from __future__ import annotations

from dataclasses import dataclass, field


class WriterError(Exception):
    def __init__(self, code: str, message: str, retryable: bool = False):
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


@dataclass
class TargetColumn:
    name: str
    pg_type: str
    nullable: bool = True
    has_default: bool = False


@dataclass
class TargetMetadata:
    schema_name: str
    table: str
    columns: dict = field(default_factory=dict)          # name -> TargetColumn
    unique_constraints: list = field(default_factory=list)  # [ (col, ...), ... ]


@dataclass
class TargetReference:
    asset_id: str
    schema_name: str
    table: str
    key: dict = field(default_factory=dict)


# SQLSTATE 分类（SDD 14.4：权限/字段变更/唯一冲突可区分；连接类可重试）
_PERMANENT_SQLSTATE = {
    "42501": ("TARGET_PERMISSION_DENIED", False),
    "42P01": ("TARGET_TABLE_MISSING", False),
    "42703": ("TARGET_COLUMN_MISSING", False),
    "23505": ("TARGET_UNIQUE_CONFLICT", False),
    "23502": ("TARGET_NOT_NULL_VIOLATION", False),
    "23503": ("TARGET_FK_VIOLATION", False),
    "22000": ("TARGET_DATA_ERROR", False),
    "42601": ("TARGET_SYNTAX_ERROR", False),
}
_RETRYABLE_PREFIXES = ("08", "40", "53", "57P")  # 连接/序列化/资源/停机类


def classify_sqlstate(sqlstate: str | None) -> tuple[str, bool]:
    if not sqlstate:
        return "TARGET_UNKNOWN_ERROR", True
    if sqlstate in _PERMANENT_SQLSTATE:
        return _PERMANENT_SQLSTATE[sqlstate]
    if sqlstate.startswith(_RETRYABLE_PREFIXES):
        return "TARGET_TRANSIENT_ERROR", True
    return "TARGET_UNKNOWN_ERROR", False
