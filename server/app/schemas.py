"""Pydantic DSL — 与 contracts/workflow-definition.schema.json 单一事实源对齐（07-workflow-dsl.md）。"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

NodeType = Literal[
    "input", "llm", "tool", "condition", "transform", "end", "create-record", "notification",
    "workflow-exec", "knowledge-retrieval", "mcp-call",
    "agent", "agent-select", "agent-exec", "decision-class", "query-rewrite", "code-write"
]
ValueType = Literal["string", "number", "boolean", "object", "array", "datetime"]


class FixedSource(BaseModel):
    kind: Literal["fixed"]
    value: Any = None


class UpstreamSource(BaseModel):
    kind: Literal["upstream"]
    nodeId: str
    path: str  # outputs.xxx


class ScopeSource(BaseModel):
    kind: Literal["input", "state", "system"]
    path: str


InputSource = FixedSource | UpstreamSource | ScopeSource


class InputBinding(BaseModel):
    name: str
    type: ValueType = "string"
    source: InputSource


class ExecutionPolicy(BaseModel):
    timeoutMs: int = Field(default=60000, ge=100, le=600000)
    retries: int = Field(default=0, ge=0, le=3)
    onError: Literal["fail", "skip"] = "fail"


class WorkflowNode(BaseModel):
    id: str
    type: NodeType
    name: str
    config: dict[str, Any] = Field(default_factory=dict)
    inputs: list[InputBinding] = Field(default_factory=list)
    execution: ExecutionPolicy = Field(default_factory=ExecutionPolicy)
    branches: list[str] = Field(default_factory=list)


class WorkflowEdge(BaseModel):
    id: str
    source: str
    sourceHandle: str | None = None
    target: str


class Graph(BaseModel):
    nodes: list[WorkflowNode]
    edges: list[WorkflowEdge]


class StructuredOutput(BaseModel):
    key: str
    schema_: dict[str, Any] = Field(default_factory=dict, alias="schema")

    model_config = {"populate_by_name": True}


class IO(BaseModel):
    inputSchema: dict[str, Any] = Field(default_factory=dict)
    structuredOutputs: list[StructuredOutput] = Field(default_factory=list)


class Triggers(BaseModel):
    manual: bool = True
    api: bool = True
    scheduleIds: list[str] = Field(default_factory=list)


class UIState(BaseModel):
    positions: dict[str, dict[str, float]] = Field(default_factory=dict)
    viewport: dict[str, float] = Field(default_factory=dict)


class WorkflowMeta(BaseModel):
    id: str
    name: str
    status: Literal["draft", "testing", "published", "deprecated"] = "draft"
    currentVersionId: str | None = None
    draftRevision: int = 1


class WorkflowDefinition(BaseModel):
    schemaVersion: Literal["1.0"] = "1.0"
    workflow: WorkflowMeta
    graph: Graph
    io: IO = Field(default_factory=IO)
    triggers: Triggers = Field(default_factory=Triggers)
    ui: UIState = Field(default_factory=UIState)
    meta: dict[str, Any] = Field(default_factory=dict)


class ValidationIssue(BaseModel):
    nodeId: str
    kind: Literal["graph", "unconnected", "unconfigured", "dependency"]
    message: str


class ValidationReport(BaseModel):
    ok: bool
    issues: list[ValidationIssue]


class WorkflowSummary(BaseModel):
    id: str
    name: str
    status: str
    currentVersion: int | None = None
    updatedAt: str


class SaveDraftRequest(BaseModel):
    definition: WorkflowDefinition
    baseRevision: int


class SaveDraftResponse(BaseModel):
    workflowCode: str
    draftVersion: str
    savedAt: str


class CreateWorkflowRequest(BaseModel):
    name: str
    description: str = ""
