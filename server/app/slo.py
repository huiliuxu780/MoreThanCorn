"""09-SDD P2-09 / §15.1：SLO 冻结与测量。

十项目标值为 DRAFT（草稿，待产品/运维按 §15.1 冻结；冻结前不得用"性能良好"作验收结论）。
测量侧只报可测项；不可测项返回 null 并附注，需运维层采样/演练补齐。"""
from __future__ import annotations

import time
from collections import deque
from datetime import datetime, timedelta, timezone

# DRAFT 草稿值（08-30 代码侧默认；用户冻结后以冻结值为准）
SLO_DRAFT_NOTE = ("DRAFT：草稿值，待产品/运维冻结（09 §15.1）。"
                  "未冻结前不得以'性能良好/满足生产'作为验收结论。")

SLO_TARGETS: dict[str, float] = {
    "interactionsDailyAvg": 10_000,      # 日均 Interaction 数
    "interactionsPeakHour": 2_000,       # 峰值 Interaction 数/小时
    "maxBatchSize": 100_000,             # 最大单批数据量
    "apiAvailability": 0.999,            # API 可用性目标
    "apiP95Ms": 300,                     # 非模型 API p95
    "apiP99Ms": 800,                     # 非模型 API p99
    "scheduleP95Sec": 30,                # 调度延迟 p95
    "scheduleP99Sec": 60,                # 调度延迟 p99
    "queueWaitP95Sec": 5,                # 队列等待时长 p95
    "taskRunDeadlineSec": 1800,          # TaskRun 完成时限
    "rpoSec": 3600,                      # RPO
    "rtoSec": 14_400,                    # RTO
    "retentionDays": 180,                # 数据保留期限
    "costBudgetUsdPerDay": 50.0,         # 模型成本预算/日
}

_LATENCIES: deque[float] = deque(maxlen=10_000)


def record_latency_ms(ms: float) -> None:
    _LATENCIES.append(ms)


def _pct(xs: list[float], p: float) -> float | None:
    if not xs:
        return None
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round((p / 100) * (len(xs) - 1))))]


def measure(db) -> dict:
    """可测项实时测量（近 24h 窗口）；不可测项 null+注。"""
    from .models import JobQueue, Run
    since = datetime.now(timezone.utc) - timedelta(hours=24)

    api_p95 = _pct(list(_LATENCIES), 95)
    api_p99 = _pct(list(_LATENCIES), 99)

    waits = [ (j.locked_at - j.created_at).total_seconds()
              for j in db.query(JobQueue).filter(JobQueue.created_at >= since,
                                                 JobQueue.locked_at.isnot(None)).all() ]
    queue_p95 = _pct(waits, 95)

    durs = [r.duration_ms / 1000.0 for r in db.query(Run)
            .filter(Run.started_at >= since, Run.duration_ms.isnot(None)).all()]
    run_p95 = _pct(durs, 95)

    runs_today = db.query(Run).filter(Run.started_at >= since).all()
    tokens = sum((r.token_usage or {}).get("total", 0) or 0 for r in runs_today)
    cost = round(tokens / 1000 * 0.0008, 4)  # 与 metrics/aggregate 同口径估算

    return {
        "window": "last_24h",
        "apiP95Ms": round(api_p95, 1) if api_p95 is not None else None,
        "apiP99Ms": round(api_p99, 1) if api_p99 is not None else None,
        "queueWaitP95Sec": round(queue_p95, 2) if queue_p95 is not None else None,
        "runDurationP95Sec": round(run_p95, 1) if run_p95 is not None else None,
        "totalTokens24h": tokens,
        "estimatedCostUsd24h": cost,
        "unmeasured": {
            "apiAvailability": "需运维层外部探针连续采样",
            "scheduleP95Sec": "需调度触发 delta 独立采样（scheduler 选主落地后补）",
            "interactionsDailyAvg": "需业务峰值模型与计数口径冻结",
            "rpoSec": "需备份演练实测（见 DR 脚本）",
            "rtoSec": "需恢复演练实测（见 DR 脚本）",
        },
    }


def latency_timer():
    """中间件用上下文计时器。"""
    t0 = time.perf_counter()

    def stop() -> None:
        record_latency_ms((time.perf_counter() - t0) * 1000)
    return stop
