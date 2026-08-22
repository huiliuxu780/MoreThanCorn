"""Node Registry — V1 节点定义（08-registry-design.md / 13 §3）。

config_schema 驱动前端 Inspector 动态表单（06/14-b）。
"""
from __future__ import annotations

from .schemas import WorkflowDefinition

V1_NODE_DEFINITIONS: list[dict] = [
    {
        "type_key": "input", "family": "边界", "label": "开始", "icon": "play", "accent": "#3D6BFF",
        "executor_key": "passthrough",
        "schema": {"type": "object", "properties": {}},
        "io": {"outputs": ["userQuery:string", "chatHistory:string", "userId:string",
                           "conversationId:string", "chatId:string", "reference:string"]},
    },
    {
        "type_key": "llm", "family": "智能", "label": "大模型", "icon": "bot", "accent": "#F97E2B",
        "executor_key": "llm",
        "schema": {
            "type": "object",
            "properties": {
                "modelRef": {"type": "object", "properties": {
                    "providerId": {"type": "string"}, "modelId": {"type": "string"},
                    "params": {"type": "object"}}},
                "prompt": {"type": "string", "x-control": "prompt-editor"},
                "executionMode": {"type": "string", "enum": ["single", "batch"]},
                "outputFormat": {"type": "string", "enum": ["Markdown", "JSON"]},
                "outputExamples": {"type": "string"},
            },
            "required": ["modelRef", "prompt"],
        },
        "io": {"outputs": ["output:string", "thought:string", "answer:string"]},
    },
    {
        "type_key": "tool", "family": "外部", "label": "插件工具", "icon": "wrench", "accent": "#0062FF",
        "executor_key": "tool",
        "schema": {
            "type": "object",
            "properties": {"toolVersionId": {"type": "string", "x-control": "tool-picker"}},
            "required": ["toolVersionId"],
        },
        "io": {"outputs": "from-tool-version"},
    },
    {
        "type_key": "condition", "family": "逻辑", "label": "条件判断", "icon": "branch", "accent": "#FF4C00",
        "executor_key": "condition",
        "schema": {
            "type": "object",
            "properties": {"branches": {"type": "array", "items": {
                "type": "object", "properties": {
                    "handle": {"type": "string"},
                    "variable": {"type": "object", "x-control": "variable-picker"},
                    "operator": {"type": "string", "enum": ["eq", "neq", "contains", "gt", "lt"]},
                    "value": {"type": "string"}}}}},
        },
        "io": {},
    },
    {
        "type_key": "transform", "family": "数据", "label": "变量处理", "icon": "braces", "accent": "#7B61FF",
        "executor_key": "transform",
        "schema": {
            "type": "object",
            "properties": {"expression": {"type": "string", "x-control": "expression-editor"},
                           "template": {"type": "string"}},
        },
        "io": {"outputs": "declared"},
    },
    {
        "type_key": "end", "family": "边界", "label": "结束", "icon": "flag", "accent": "#64748B",
        "executor_key": "collect",
        "schema": {"type": "object", "properties": {}},
        "io": {},
    },
    {
        "type_key": "create-record", "family": "副作用", "label": "创建质检记录", "icon": "file-plus", "accent": "#188F00",
        "executor_key": "sink_quality_record",
        "schema": {"type": "object", "properties": {"outputKey": {"type": "string"}}},
        "io": {},
    },
    {
        "type_key": "workflow-exec", "family": "外部", "label": "工作流执行", "icon": "route", "accent": "#F97E2B",
        "executor_key": "workflow_exec",
        "schema": {"type": "object", "properties": {"workflowCode": {"type": "string", "x-control": "workflow-picker"}},
                   "required": ["workflowCode"]},
        "io": {},
    },
    {
        "type_key": "notification", "family": "副作用", "label": "通知", "icon": "bell", "accent": "#AA00FF",
        "executor_key": "notify_log",
        "schema": {"type": "object", "properties": {"message": {"type": "string"}}},
        "io": {},
    },
]

BY_TYPE: dict[str, dict] = {d["type_key"]: d for d in V1_NODE_DEFINITIONS}

TERMINAL_TYPES = {"end", "create-record"}


def node_definition_list() -> list[dict]:
    return V1_NODE_DEFINITIONS


def required_config_fields(node_type: str) -> list[str]:
    return BY_TYPE.get(node_type, {}).get("schema", {}).get("required", [])
