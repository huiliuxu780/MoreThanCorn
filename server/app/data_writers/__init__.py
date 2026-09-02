"""SDD 13 §7.2：目标表 Writer 边界。

task_runner / Runtime Provider adapter / Router 不得直接拼接目标数据库 SQL；
统一经 registry.get_writer → DataWriter.inspect_target / write_record。"""
from .base import TargetColumn, TargetMetadata, TargetReference, WriterError, classify_sqlstate
from .registry import get_writer

__all__ = ["TargetColumn", "TargetMetadata", "TargetReference", "WriterError",
           "classify_sqlstate", "get_writer"]
