"""Node Registry — V1 节点定义（08-registry-design.md / 13 §3）。

config_schema 驱动前端 Inspector 动态表单（06/14-b）。
"""
from __future__ import annotations

from .schemas import WorkflowDefinition

V1_NODE_DEFINITIONS: list[dict] = [
    {
        "type_key": "input", "family": "边界", "label": "开始", "icon": "play", "accent": "#3D6BFF",
        "editor_kinds": ["FLOW", "GROUP", "WORKFLOW"],
        "executor_key": "passthrough",
        "schema": {"type": "object", "properties": {}},
        "io": {"outputs": ["userQuery:string", "chatHistory:string", "userId:string",
                           "conversationId:string", "chatId:string", "reference:string"]},
    },
    {
        "type_key": "llm", "family": "智能", "label": "大模型", "icon": "bot", "accent": "#F97E2B",
        "editor_kinds": ["FLOW", "WORKFLOW"],
        "executor_key": "llm",
        "schema": {
            "type": "object",
            "properties": {
                "modelRef": {"type": "object", "properties": {
                    "providerId": {"type": "string"}, "modelId": {"type": "string"},
                    "params": {"type": "object"}}},
                "prompt": {"type": "string", "x-control": "prompt-editor"},
                "outputFormat": {"type": "string", "enum": ["Markdown", "JSON"]},
            },
            "required": ["modelRef", "prompt"],
        },
        "io": {"outputs": ["output:string", "thought:string", "answer:string"]},
    },
    {
        "type_key": "tool", "family": "外部", "label": "插件工具", "icon": "wrench", "accent": "#0062FF",
        "editor_kinds": ["FLOW", "WORKFLOW"],
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
        "editor_kinds": ["FLOW", "GROUP", "WORKFLOW"],
        "executor_key": "condition",
        "schema": {
            "type": "object",
            "properties": {"branches": {"type": "array", "items": {
                "type": "object", "properties": {
                    "handle": {"type": "string"},
                    "variable": {"type": "object", "x-control": "variable-picker"},
                    "operator": {"type": "string",
                                 "enum": ["eq", "neq", "contains", "not_contains",
                                          "empty", "not_empty", "gt", "lt"]},
                    "value": {"type": "string"}}}}},
        },
        "io": {},
    },
    {
        "type_key": "transform", "family": "数据", "label": "变量处理", "icon": "braces", "accent": "#7B61FF",
        "editor_kinds": ["FLOW", "WORKFLOW"],
        "executor_key": "transform",
        "schema": {
            "type": "object",
            "properties": {"template": {"type": "string", "x-control": "prompt-editor"}},
        },
        "io": {"outputs": "declared"},
    },
    {
        "type_key": "end", "family": "边界", "label": "结束", "icon": "flag", "accent": "#64748B",
        "editor_kinds": ["FLOW", "GROUP", "WORKFLOW"],
        "executor_key": "collect",
        "schema": {"type": "object", "properties": {}},
        "io": {},
    },
    {
        "type_key": "create-record", "family": "副作用", "label": "创建质检记录", "icon": "file-plus", "accent": "#188F00",
        "editor_kinds": ["WORKFLOW"],
        "executor_key": "sink_quality_record",
        "schema": {"type": "object", "properties": {"outputKey": {"type": "string"}}},
        "io": {},
    },
    {
        "type_key": "workflow-exec", "family": "外部", "label": "工作流执行", "icon": "route", "accent": "#F97E2B",
        "editor_kinds": ["FLOW", "WORKFLOW"],
        "executor_key": "workflow_exec",
        "schema": {"type": "object", "properties": {"workflowCode": {"type": "string", "x-control": "workflow-picker"}},
                   "required": ["workflowCode"]},
        "io": {},
    },
    {
        "type_key": "notification", "family": "副作用", "label": "通知", "icon": "bell", "accent": "#AA00FF",
        "editor_kinds": ["WORKFLOW"],
        "executor_key": "notify_log",
        "schema": {"type": "object", "properties": {"message": {"type": "string"}}},
        "io": {},
    },
    {
        "type_key": "agent", "family": "Agent", "label": "Agent", "icon": "bot", "accent": "#F97E2B",
        "editor_kinds": ["FLOW", "GROUP"],
        "executor_key": "agent",
        "schema": {
            "type": "object",
            "properties": {"agentCode": {"type": "string", "x-control": "agent-picker"}},
            "required": ["agentCode"],
        },
        "io": {"outputs": ["content:string"]},
    },
    {
        "type_key": "agent-select", "family": "Agent", "label": "Agent选择", "icon": "route", "accent": "#F97E2B",
        "editor_kinds": ["GROUP"],
        "executor_key": "agent-select",
        "schema": {
            "type": "object",
            "properties": {
                "primaryAgents": {"type": "array", "x-control": "agent-picker-multi"},
                "fallbackAgent": {"type": "string", "x-control": "agent-picker"},
            },
            "required": [],
        },
        "io": {"outputs": ["agentCode:string", "agentName:string", "agentDesc:string"]},
    },
    {
        "type_key": "agent-exec", "family": "Agent", "label": "Agent执行", "icon": "play", "accent": "#F97E2B",
        "editor_kinds": ["GROUP"],
        "executor_key": "agent-exec",
        "schema": {
            "type": "object",
            "properties": {"agentCode": {"type": "string", "x-control": "agent-picker"}},
            "required": [],
        },
        "io": {"outputs": ["content:string"]},
    },
    {
        "type_key": "decision-class", "family": "逻辑", "label": "决策分类", "icon": "branch", "accent": "#FF4C00",
        "editor_kinds": ["FLOW", "GROUP"],
        "executor_key": "decision-class",
        "schema": {"type": "object", "properties": {"branches": {"type": "array", "items": {
            "type": "object", "properties": {
                "title": {"type": "string"}, "description": {"type": "string"}}}}}},
        "io": {"outputs": ["classificationTitle:string", "classificationId:string"]},
    },
    {
        "type_key": "query-rewrite", "family": "数据", "label": "Query改写", "icon": "pen", "accent": "#7B61FF",
        "editor_kinds": ["FLOW", "GROUP"],
        "executor_key": "query-rewrite",
        "schema": {"type": "object", "properties": {
            "strategy": {"type": "string", "enum": ["default", "custom"]},
            "template": {"type": "string", "x-control": "prompt-editor"}}},
        "io": {"outputs": ["queryList:array"]},
    },
    {
        "type_key": "code-write", "family": "代码", "label": "代码编写", "icon": "code", "accent": "#7B61FF",
        "editor_kinds": ["FLOW", "GROUP"],
        "executor_key": "code-write",
        "schema": {"type": "object", "properties": {"code": {"type": "string", "x-control": "code-editor"}}},
        "io": {"outputs": "declared"},
    },
    {
        "type_key": "knowledge-retrieval", "family": "外部", "label": "知识检索", "icon": "book-open", "accent": "#0E9F6E",
        "editor_kinds": ["FLOW", "WORKFLOW"],
        "executor_key": "knowledge_retrieval",
        "schema": {
            "type": "object",
            "properties": {
                "knowledgeSourceId": {"type": "string", "x-control": "knowledge-picker"},
                "query": {"type": "string", "x-control": "expression-editor"},
                "topK": {"type": "number", "default": 5},
            },
            "required": ["knowledgeSourceId", "query"],
        },
        "io": {"outputs": ["slices:string", "sources:string"]},
    },
    {
        "type_key": "mcp-call", "family": "外部", "label": "MCP 工具", "icon": "server", "accent": "#0891B2",
        "editor_kinds": ["FLOW", "WORKFLOW"],
        "executor_key": "mcp_call",
        "schema": {
            "type": "object",
            "properties": {
                "mcpServerId": {"type": "string", "x-control": "mcp-picker"},
                "toolName": {"type": "string", "x-control": "mcp-tool-picker"},
                "args": {"type": "object"},
            },
            "required": ["mcpServerId", "toolName"],
        },
        "io": {"outputs": ["result:string"]},
    },
    # ---------- Phase C（SDD 03 §C-4） ----------
    {
        "type_key": "reply", "family": "信息回复", "label": "对话回复", "icon": "message-square", "accent": "#188F00",
        "editor_kinds": ["FLOW"],
        "executor_key": "reply",
        "schema": {
            "type": "object",
            "properties": {"content": {"type": "string", "x-control": "prompt-editor"}},
            "required": ["content"],
        },
        "io": {"outputs": []},
    },
    {
        "type_key": "memory-variable", "family": "记忆变量", "label": "记忆变量", "icon": "brain", "accent": "#7B61FF",
        "editor_kinds": ["FLOW"],
        "executor_key": "memory_variable",
        "schema": {
            "type": "object",
            "properties": {
                "mode": {"type": "string", "enum": ["read", "write"]},
                "keys": {"type": "array", "items": {"type": "string"}},
            },
        },
        "io": {"outputs": "declared"},
    },
    {
        "type_key": "workflow-select", "family": "外部", "label": "工作流选择", "icon": "route", "accent": "#F97E2B",
        "editor_kinds": ["FLOW"],
        "executor_key": "workflow_select",
        "schema": {
            "type": "object",
            "properties": {"candidates": {"type": "array", "items": {"type": "string"}, "x-control": "workflow-picker-multi"}},
            "required": ["candidates"],
        },
        "io": {"outputs": ["workflowCode:string", "workflowName:string", "workflowDesc:string"]},
    },
    {
        "type_key": "workflow-fixed", "family": "外部", "label": "工作流", "icon": "route", "accent": "#F97E2B",
        "editor_kinds": ["FLOW"],
        "executor_key": "workflow_fixed",
        "schema": {
            "type": "object",
            "properties": {"workflowId": {"type": "string", "x-control": "workflow-picker"}},
            "required": ["workflowId"],
        },
        "io": {"outputs": "declared"},
    },
]

BY_TYPE: dict[str, dict] = {d["type_key"]: d for d in V1_NODE_DEFINITIONS}

TERMINAL_TYPES = {"end", "create-record"}


def node_definition_list() -> list[dict]:
    return V1_NODE_DEFINITIONS


def required_config_fields(node_type: str) -> list[str]:
    return BY_TYPE.get(node_type, {}).get("schema", {}).get("required", [])
