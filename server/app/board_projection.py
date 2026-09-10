"""Task board read-only projection (task book §五-H).

The board is a query projection over real execution sources:
AgentScope Sessions (via the platform index), Workflow runs and
AgentFlow runs. No canonical WorkItem state machine lives here.

Lane vocabulary (QoderWake-verified): pending | running | done |
waiting | failed | cancelled; "ended" aggregates done+failed+cancelled.
"""
from __future__ import annotations

LANES = ("pending", "running", "done", "waiting", "failed", "cancelled")
ENDED = {"done", "failed", "cancelled"}

# 触发方式中文枚举（QoderWake /work-management「触发方式」筛选项同构，实测 7 值）：
# 全部 / 手动触发 / 定时触发 / 事件触发 / API 触发 / @Waker 触发 / 对话触发。
# 内部 kind → 面向用户的触发类型；workflow/agentflow/batch/agent 等执行载体不是
# 触发类型本身，按入口来源折叠（自动化载体归属其触发方式，其余归手动触发）。
SOURCE_LABELS = {
    "manual": "手动触发",
    "chat": "对话触发",
    "schedule": "定时触发",
    "api": "API 触发",
    "event": "事件触发",
    "webhook": "事件触发",
    "at_waker": "@Waker 触发",
    "im": "@Waker 触发",
    "workflow": "手动触发",
    "agentflow": "手动触发",
    "agent_tool": "对话触发",
    "batch": "手动触发",
    "test": "手动触发",
    "eval": "手动触发",
}


def map_session_lane(status: str | None, finished_reason: str | None, message_count: int) -> str:
    if status == "running":
        return "running"
    if status in ("waiting", "parked"):
        return "waiting"
    if finished_reason == "error":
        return "failed"
    if finished_reason in ("interrupted", "cancelled"):
        return "cancelled"
    if finished_reason in ("completed", "stop", "end"):
        return "done"
    if message_count == 0:
        return "pending"
    return "running"


def map_workflow_lane(run_status: str) -> str:
    return {
        "queued": "pending",
        "running": "running",
        "waiting_external": "waiting",
        "paused": "waiting",
        "succeeded": "done",
        "failed": "failed",
        "cancelled": "cancelled",
    }.get(run_status, "running" if run_status else "pending")


def map_agentflow_lane(run_status: str) -> str:
    return {
        "running": "running",
        "succeeded": "done",
        "failed": "failed",
        "cancelled": "cancelled",
    }.get(run_status, "pending")


def is_ended(lane: str) -> bool:
    return lane in ENDED
