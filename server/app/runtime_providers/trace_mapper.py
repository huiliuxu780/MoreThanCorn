"""Provider TraceEvent → 平台 RunEvent（SDD 10 §12.1，R1 最小映射）。

R1 只落受控摘要（sequence/type/name/error），不落 input/output 正文——
全量 Trace/CallRecord 脱敏落库属于 R3 结果事务。以 runtime_snapshot.lastTraceSequence
去重，重复轮询不产生重复事件。
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from quality_runtime_contract import TraceEvent

from ..runner import emit


def append_provider_events(db: Session, run, trace: list[TraceEvent], snapshot: dict) -> int:
    last = int((snapshot or {}).get("lastTraceSequence", -1) or -1)
    added = 0
    for event in sorted(trace, key=lambda e: e.sequence):
        if event.sequence <= last:
            continue
        payload: dict = {"providerSequence": event.sequence, "type": event.type}
        if event.name:
            payload["name"] = event.name
        if event.error is not None:
            payload["error"] = {"code": str(event.error.code), "message": event.error.message}
        # R8-UI：阶段语义透传（Provider metadata.workflow_stage），RunDetail 阶段表按此聚合
        if isinstance(event.metadata, dict) and event.metadata.get("workflow_stage"):
            payload["workflowStage"] = str(event.metadata["workflow_stage"])
        emit(db, run.id, "runtime_trace", payload=payload)
        snapshot["lastTraceSequence"] = event.sequence
        added += 1
    return added
