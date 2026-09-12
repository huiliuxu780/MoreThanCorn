"""F1：旧 API 路由流量统计（Spec §12.1「观察期内记录旧 API 调用量」）。

进程内计数器（重启清零）；持久化聚合留给可观测性切片，不为统计引入写放大。
读写均走 GIL 原子 dict 操作，无需锁。
"""
from __future__ import annotations

from collections import defaultdict
from typing import Dict

# path 前缀 → 调用次数
_COUNTS: Dict[str, int] = defaultdict(int)

# F1 登记：分析任务域旧路由（canonical 见 routers/automations.py）
LEGACY_PREFIXES = ("/api/automations", "/api/tasks")

# 新 canonical 前缀（不计入 legacy 统计）
CANONICAL_PREFIXES = ("/api/analysis-tasks",)


def inc(path: str) -> None:
    """命中 legacy 前缀的请求 +1（最长路径前缀优先，便于区分 /api/automations 与 /api/tasks）。"""
    matched = ""
    for prefix in LEGACY_PREFIXES:
        if path.startswith(prefix) and not any(
                path.startswith(c) for c in CANONICAL_PREFIXES):
            if len(prefix) > len(matched):
                matched = prefix
    if matched:
        _COUNTS[matched] += 1


def snapshot() -> Dict[str, int]:
    """只读快照（admin 查询用）。"""
    return dict(sorted(_COUNTS.items(), key=lambda kv: -kv[1]))
