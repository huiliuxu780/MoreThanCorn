"""Run → RuntimeExecuteRequest 组装（SDD 10 §7.2 / R1-3）。

R1 阶段为最小组装：Provider-neutral 字段全部来自平台已有事实
（Run 输入、AgentVersion 冻结快照、artifact_hash），不引入 Module 语义（R2 扩展）。
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from quality_runtime_contract import (
    AgentExecutionSpec,
    ExecutionContext,
    ModelSpec,
    RuntimeExecuteRequest,
)

from ..models import AgentVersion, Run

DEFAULT_RUNTIME_TIMEOUT_SECONDS = 300


def build_runtime_request(db: Session, run: Run, *, timeout_seconds: int | None = None) -> RuntimeExecuteRequest:
    version = db.get(AgentVersion, run.agent_version_id) if run.agent_version_id else None
    definition = (version.definition or {}) if version else {}
    model_ref = definition.get("modelRef") or {}
    spec = AgentExecutionSpec(
        id=run.agent_id or f"run:{run.id}",
        version=str(version.version_no) if version else "0",
        # R1：尚无 Module AgentSpec（R2 落地）；contract 要求非空，历史 Run 用占位
        instructions=str(definition.get("instructions") or definition.get("rolePrompt")
                         or "(platform-default)"),
        model=ModelSpec(provider=str(model_ref.get("provider") or "platform"),
                        model=str(model_ref.get("modelId") or "unset")),
        output_schema=definition.get("outputSchema") or {},
    )
    artifact = (version.artifact_hash if version else None) or "draft"
    request = RuntimeExecuteRequest(
        run_id=run.id,
        idempotency_key=f"runtime:{run.id}:{run.attempt}:{str(artifact)[:16]}",
        agent=spec,
        input=run.input or {},
        context=ExecutionContext(
            task_instance_id=run.task_run_id,
            trace_id=run.id,
            metadata={"agentVersionId": run.agent_version_id,
                      "workflowId": run.workflow_id,
                      "taskRunId": run.task_run_id},
        ),
        timeout_seconds=timeout_seconds
        or int((run.runtime_snapshot or {}).get("timeoutSeconds") or DEFAULT_RUNTIME_TIMEOUT_SECONDS),
    )
    return request
