"""Run → RuntimeExecuteRequest 组装（SDD 10 §7.2 / R1-3 / R2）。

Module Agent（definition.module 存在）：AgentSpec/工具/主数据/输出 Schema 全部来自
冻结版本（同一 AgentVersion 对任意 Provider 生成完全相同的请求体 → request hash 一致）；
无版本的草稿预览经 Module 现算 Spec 并标记 definitionSource=draft。
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from quality_runtime_contract import (
    AgentExecutionSpec,
    ExecutionContext,
    MasterDataRef,
    ModelSpec,
    RuntimeExecuteRequest,
    ToolRef,
)

from ..models import Agent, AgentVersion, ResultRuleVersion, Run

DEFAULT_RUNTIME_TIMEOUT_SECONDS = 300


def build_rule_snapshot(db: Session, rule_version_id: str | None) -> dict:
    """ResultRuleVersion → immutable Agent context, without mutable RuleSet reads."""
    rv = db.get(ResultRuleVersion, rule_version_id or "")
    if rv is None:
        raise ValueError("RULE_VERSION_REQUIRED：运行未绑定有效的冻结规则版本")
    rules = dict(rv.rules or {})
    return {
        "schema_version": str(rules.get("schemaVersion") or rules.get("schema_version") or "1.0"),
        "ruleSetId": str(rules.get("ruleSetId") or rv.rule_set_id),
        "ruleSetVersion": rv.version_no,
        "status": "published",
        "readOnlyAtRuntime": True,
        "evaluationRules": list(rules.get("evaluationRules") or []),
        "scoreRules": list(rules.get("scoreRules") or []),
        "issueRules": list(rules.get("issueRules") or []),
    }


def _runtime_input(value: dict) -> dict:
    """Remove platform-only replay metadata from the provider-visible input."""
    return {key: child for key, child in (value or {}).items()
            if not str(key).startswith("__")}


def build_runtime_request(db: Session, run: Run, *, timeout_seconds: int | None = None) -> RuntimeExecuteRequest:
    version = db.get(AgentVersion, run.agent_version_id) if run.agent_version_id else None
    definition = (version.definition or {}) if version else {}
    artifact = (version.artifact_hash if version else None) or "draft"
    agent = db.get(Agent, run.agent_id) if run.agent_id else None
    timeout = timeout_seconds or int((run.runtime_snapshot or {}).get("timeoutSeconds")
                                     or DEFAULT_RUNTIME_TIMEOUT_SECONDS)

    if definition.get("module"):
        from ..agent_modules import registry as module_registry
        mod = module_registry.get(definition["module"]["key"], definition["module"]["version"])
        ctx = mod.request_context(definition)
        model = ctx["model"] or {}
        spec = AgentExecutionSpec(
            id=run.agent_id or f"run:{run.id}",
            version=str(version.version_no),
            instructions=ctx["instructions"],
            model=ModelSpec(provider=str(model.get("provider") or "openai-compatible"),
                            model=str(model.get("model") or "unset"),
                            parameters=dict(model.get("parameters") or {})),
            tools=[ToolRef(name=t["name"], version=t["version"]) for t in ctx["tools"]],
            master_data=[MasterDataRef(name=m["name"], version=m["version"])
                         for m in ctx["master_data"]],
            output_schema=ctx["output_schema"],
        )
        metadata = {"agentVersionId": run.agent_version_id, "workflowId": run.workflow_id,
                    "taskRunId": run.task_run_id, "definitionSource": "version",
                    **ctx["metadata"]}
        if mod.manifest.get("injectRuleSnapshot"):
            metadata["rule_snapshot"] = build_rule_snapshot(db, run.rule_version_id)
    elif agent is not None and getattr(agent, "module_key", None):
        # 草稿预览：无冻结版本，经 Module 现算 Spec（写型业务工具禁用属 R3 策略执行）
        from ..agent_modules import registry as module_registry
        mod = module_registry.get(agent.module_key, agent.module_version)
        spec_dict = mod.build_agent_spec(agent.config)
        model = spec_dict.get("model") or {}
        spec = AgentExecutionSpec(
            id=agent.id, version="draft", instructions=spec_dict.get("instructions") or "",
            model=ModelSpec(provider=str(model.get("provider") or "openai-compatible"),
                            model=str(model.get("model") or "unset"),
                            parameters=dict(model.get("parameters") or {})),
            tools=[ToolRef(name=t["name"], version=t["version"]) for t in spec_dict.get("tools", [])],
            master_data=[MasterDataRef(name=m["name"], version=m["version"])
                         for m in spec_dict.get("master_data", [])],
            output_schema=mod.output_schema,
        )
        metadata = {"agentVersionId": None, "workflowId": run.workflow_id,
                    "taskRunId": run.task_run_id, "definitionSource": "draft",
                    "workflowMode": mod.workflow_mode}
        metadata.update(mod.runtime_context)
        if mod.manifest.get("injectRuleSnapshot"):
            metadata["rule_snapshot"] = build_rule_snapshot(db, run.rule_version_id)
    else:
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
        metadata = {"agentVersionId": run.agent_version_id, "workflowId": run.workflow_id,
                    "taskRunId": run.task_run_id}

    request = RuntimeExecuteRequest(
        run_id=run.id,
        idempotency_key=f"runtime:{run.id}:{run.attempt}:{str(artifact)[:16]}",
        agent=spec,
        input=_runtime_input(run.input or {}),
        context=ExecutionContext(task_instance_id=run.task_run_id, trace_id=run.id,
                                 metadata=metadata),
        timeout_seconds=timeout,
    )
    return request
