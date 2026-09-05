"""MTC-002A：AutomationDefinition（自主任务）领域 DTO 映射层。

产品名收敛为「自主任务」，领域名 AutomationDefinition；持久层继续使用
AnalysisTask / analysis_task（本轮不改表名、不改外键、不做迁移）。

DTO 字段全部来自既有列；缺失语义保持 None / 可选，不编造：
- workflowVersionId：仅当版本策略为 pinned 时有值，latest_published 时为 None；
- inputConfig 的结构化子字段来自当前 TaskVersion（JSONB），无版本时为空容器；
- scheduleConfig 来自 schedule 表最近一条记录，无调度时为 None。
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from .models import AnalysisTask, AnalysisTaskVersion, Schedule


def _execution_target(v: AnalysisTaskVersion | None, task: AnalysisTask) -> dict:
    """与 routers/business._execution_target_dto 同语义（agent | workflow 统一执行目标）。"""
    if v is not None and v.execution_target_type == "agent":
        return {"type": "agent", "agentId": v.agent_id,
                "versionPolicy": v.agent_version_policy,
                "pinnedAgentVersionId": v.pinned_agent_version_id}
    if v is not None:
        return {"type": "workflow", "workflowId": v.workflow_id,
                "versionPolicy": v.workflow_version_policy,
                "pinnedWorkflowVersionId": v.pinned_workflow_version_id}
    return {"type": "workflow", "workflowId": task.workflow_id,
            "versionPolicy": task.version_policy, "pinnedWorkflowVersionId": None}


def automation_definition_dto(db: Session, task: AnalysisTask) -> dict:
    """自主任务定义读模型（/api/automations canonical 形状）。"""
    v = db.get(AnalysisTaskVersion, task.current_version_id) if task.current_version_id else None
    target = _execution_target(v, task)
    schedule = (db.query(Schedule).filter_by(task_id=task.id)
                .order_by(Schedule.created_at.desc()).first())
    return {
        "id": task.id,
        "name": task.name,
        "description": task.description,
        "status": task.status,
        "agentId": target.get("agentId") if target["type"] == "agent" else task.agent_id,
        "workflowId": target.get("workflowId") or task.workflow_id,
        "workflowVersionId": target.get("pinnedWorkflowVersionId"),
        "inputConfig": {
            "dataAssetId": v.data_asset_id if v is not None else task.data_asset_id,
            "dataDefinitionVersionId": (v.data_definition_version_id if v is not None
                                        else task.data_definition_id),
            "scope": (v.scope or {}) if v is not None else {},
            "sampling": (v.sampling or {}) if v is not None else {},
            "dataWindow": (v.data_window or {}) if v is not None else {},
            "inputMapping": (v.input_mapping or {}) if v is not None else {},
        },
        "scheduleConfig": ({
            "id": schedule.id,
            "name": schedule.name,
            "cron": schedule.cron_expr,
            "timezone": schedule.timezone,
            "enabled": schedule.enabled,
            "nextRunAt": schedule.next_run_at.isoformat() if schedule.next_run_at else None,
        } if schedule is not None else None),
        "executionConfig": {
            "executionTarget": target,
            "outputMode": v.output_mode if v is not None else "platform_only",
            "outputAssetId": v.output_asset_id if v is not None else None,
            "outputWriteMode": v.output_write_mode if v is not None else None,
            "outputFailurePolicy": v.output_failure_policy if v is not None else None,
            "outputKeyFields": (v.output_key_fields or []) if v is not None else [],
            "outputMapping": (v.output_mapping or {}) if v is not None else {},
        },
        "createdAt": task.created_at.isoformat() if task.created_at else None,
        "updatedAt": task.updated_at.isoformat() if task.updated_at else None,
        "createdBy": task.created_by,
        "version": v.version_no if v is not None else None,
    }


def automation_definition_version_dto(v: AnalysisTaskVersion) -> dict:
    """自主任务配置版本读模型（TaskVersion 不可变语义不变）。"""
    return {
        "id": v.id,
        "versionNo": v.version_no,
        "executionTarget": {
            "type": v.execution_target_type,
            "agentId": v.agent_id,
            "agentVersionPolicy": v.agent_version_policy,
            "pinnedAgentVersionId": v.pinned_agent_version_id,
            "workflowId": v.workflow_id,
            "workflowVersionPolicy": v.workflow_version_policy,
            "pinnedWorkflowVersionId": v.pinned_workflow_version_id,
        },
        "dataAssetId": v.data_asset_id,
        "dataDefinitionVersionId": v.data_definition_version_id,
        "resultRuleVersionId": v.result_rule_version_id,
        "rulePolicy": v.rule_policy,
        "resultRuleSetId": v.result_rule_set_id,
        "inputMapping": v.input_mapping or {},
        "scope": v.scope or {},
        "sampling": v.sampling or {},
        "dataWindow": v.data_window or {},
        "outputMode": v.output_mode,
        "outputAssetId": v.output_asset_id,
        "outputWriteMode": v.output_write_mode,
        "outputFailurePolicy": v.output_failure_policy,
        "note": v.note,
        "createdBy": v.created_by,
        "createdAt": v.created_at.isoformat() if v.created_at else None,
    }
