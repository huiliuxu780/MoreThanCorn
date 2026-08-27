"""DataReader 协议与公共类型（09-SDD §6.2 目标接口）。"""
from dataclasses import dataclass, field


class ReaderError(Exception):
    """数据读取失败（源不可用/无权限/表不存在等）。任务链必须失败关闭。"""


@dataclass
class DataPage:
    rows: list
    next_cursor: str | None = None
    total_hint: int | None = None


def safe_ident(name: str) -> str:
    """SQL 标识符白名单校验（防注入）并返回双引号标识符。

    09 闭环验收修复（P1-1）：真实 PostgreSQL 对未加引号的标识符会折叠为小写，
    导致 camelCase 字段（如 interactionId）永远匹配不到。白名单先校验裸名
    （不含引号/反斜杠，注入不可达），再统一加双引号保留大小写。"""
    import re
    if not name or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name):
        raise ReaderError(f"非法 SQL 标识符：{name!r}")
    return f'"{name}"'
