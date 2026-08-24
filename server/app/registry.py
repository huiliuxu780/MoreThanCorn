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
    {
        "type_key": "agent", "family": "Agent", "label": "Agent", "icon": "bot", "accent": "#F97E2B",
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
        "executor_key": "agent-select",
        "schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "x-control": "expression-editor"},
                "primaryAgents": {"type": "array", "x-control": "agent-picker-multi"},
                "fallbackAgent": {"type": "string", "x-control": "agent-picker"},
            },
            "required": [],
        },
        "io": {"outputs": ["agentCode:string", "agentName:string", "agentDesc:string"]},
    },
    {
        "type_key": "agent-exec", "family": "Agent", "label": "Agent执行", "icon": "play", "accent": "#F97E2B",
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
        "executor_key": "decision-class",
        "schema": {"type": "object", "properties": {"branches": {"type": "array"}}},
        "io": {"outputs": ["selected:string"]},
    },
    {
        "type_key": "query-rewrite", "family": "数据", "label": "Query改写", "icon": "pen", "accent": "#7B61FF",
        "executor_key": "query-rewrite",
        "schema": {"type": "object", "properties": {"template": {"type": "string"}}},
        "io": {"outputs": ["queryList:string"]},
    },
    {
        "type_key": "code-write", "family": "代码", "label": "代码编写", "icon": "code", "accent": "#7B61FF",
        "executor_key": "code-write",
        "schema": {"type": "object", "properties": {"template": {"type": "string"}}},
        "io": {"outputs": ["output:string"]},
    },
    {
        "type_key": "knowledge-retrieval", "family": "外部", "label": "知识检索", "icon": "book-open", "accent": "#0E9F6E",
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
]

BY_TYPE: dict[str, dict] = {d["type_key"]: d for d in V1_NODE_DEFINITIONS}

TERMINAL_TYPES = {"end", "create-record"}


def node_definition_list() -> list[dict]:
    return V1_NODE_DEFINITIONS


def required_config_fields(node_type: str) -> list[str]:
    return BY_TYPE.get(node_type, {}).get("schema", {}).get("required", [])
