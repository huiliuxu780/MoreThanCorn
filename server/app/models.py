"""SQLAlchemy models — 对应 11-data-model.md（Kernel + 执行基础设施）。"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def new_id() -> str:
    return uuid.uuid4().hex


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Workflow(Base):
    __tablename__ = "workflow"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(64))
    description: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(16), default="draft")  # draft|testing|published|deprecated
    current_version_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    draft_definition: Mapped[dict] = mapped_column(JSONB, default=dict)
    draft_revision: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class WorkflowVersion(Base):
    __tablename__ = "workflow_version"
    __table_args__ = (UniqueConstraint("workflow_id", "version_no", name="uq_version_no"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    workflow_id: Mapped[str] = mapped_column(ForeignKey("workflow.id"), index=True)
    version_no: Mapped[int] = mapped_column(Integer)
    definition: Mapped[dict] = mapped_column(JSONB)  # 不可变快照
    tool_version_refs: Mapped[dict] = mapped_column(JSONB, default=list)
    model_refs: Mapped[dict] = mapped_column(JSONB, default=list)
    mcp_refs: Mapped[dict] = mapped_column(JSONB, default=list)
    knowledge_refs: Mapped[dict] = mapped_column(JSONB, default=list)
    input_schema: Mapped[dict] = mapped_column(JSONB, default=dict)
    structured_output_schemas: Mapped[dict] = mapped_column(JSONB, default=list)
    note: Mapped[str] = mapped_column(Text, default="")
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    published_by: Mapped[str] = mapped_column(String(64), default="")


class NodeDefinition(Base):
    __tablename__ = "node_definition"

    type_key: Mapped[str] = mapped_column(String(32), primary_key=True)
    family: Mapped[str] = mapped_column(String(32))
    label: Mapped[str] = mapped_column(String(32))
    icon: Mapped[str] = mapped_column(String(32), default="")
    accent: Mapped[str] = mapped_column(String(16), default="")
    schema_: Mapped[dict] = mapped_column("schema", JSONB, default=dict)
    io: Mapped[dict] = mapped_column(JSONB, default=dict)
    executor_key: Mapped[str] = mapped_column(String(32))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    version: Mapped[int] = mapped_column(Integer, default=1)


class Connection(Base):
    __tablename__ = "connection"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(64))
    kind: Mapped[str] = mapped_column(String(16))  # api_key|basic|bearer
    protocol: Mapped[str] = mapped_column(String(16), default="http-api")  # http-api|mysql|postgresql|oss|mcp-http|llm
    endpoint: Mapped[dict] = mapped_column(JSONB, default=dict)  # {base_url}|{host,port}|{bucket,region}
    provider_hint: Mapped[str] = mapped_column(String(64), default="")
    secret_ref: Mapped[str] = mapped_column(String(128))  # Secret Store 引用，不存明文
    status: Mapped[str] = mapped_column(String(16), default="active")
    last_test_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Tool(Base):
    __tablename__ = "tool"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(64))
    description: Mapped[str] = mapped_column(Text, default="")
    kind: Mapped[str] = mapped_column(String(16))  # http|builtin
    status: Mapped[str] = mapped_column(String(16), default="ready")
    connection_id: Mapped[str | None] = mapped_column(ForeignKey("connection.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ToolVersion(Base):
    __tablename__ = "tool_version"
    __table_args__ = (UniqueConstraint("tool_id", "version_no", name="uq_tool_version"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    tool_id: Mapped[str] = mapped_column(ForeignKey("tool.id"), index=True)
    version_no: Mapped[int] = mapped_column(Integer)
    input_schema: Mapped[dict] = mapped_column(JSONB, default=dict)
    output_schema: Mapped[dict] = mapped_column(JSONB, default=dict)
    spec: Mapped[dict] = mapped_column(JSONB, default=dict)  # request 配方/transform/builtin key
    status: Mapped[str] = mapped_column(String(16), default="ready")


class ModelProvider(Base):
    __tablename__ = "model_provider"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(64))
    base_url: Mapped[str] = mapped_column(String(256), default="")
    auth_connection_id: Mapped[str | None] = mapped_column(ForeignKey("connection.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="active")


class Model(Base):
    __tablename__ = "model"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    provider_id: Mapped[str] = mapped_column(ForeignKey("model_provider.id"), index=True)
    model_key: Mapped[str] = mapped_column(String(64))
    display_name: Mapped[str] = mapped_column(String(64))
    capabilities: Mapped[dict] = mapped_column(JSONB, default=list)  # ["text","thinking"]
    default_params: Mapped[dict] = mapped_column(JSONB, default=dict)
    version: Mapped[int] = mapped_column(Integer, default=1)  # 轻量 Model Version：配置修订号
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)


class Schedule(Base):
    __tablename__ = "schedule"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(64))
    task_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    workflow_id: Mapped[str | None] = mapped_column(ForeignKey("workflow.id"), nullable=True)
    cron_expr: Mapped[str] = mapped_column(String(64))
    timezone: Mapped[str] = mapped_column(String(48), default="Asia/Shanghai")
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    window_params: Mapped[dict] = mapped_column(JSONB, default=dict)
    pinned_version_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    next_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_ran_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    failed_count: Mapped[int] = mapped_column(Integer, default=0)
    valid_from: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    valid_to: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class JobQueue(Base):
    __tablename__ = "job_queue"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    type: Mapped[str] = mapped_column(String(32))
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    run_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3)
    idempotency_key: Mapped[str | None] = mapped_column(String(128), unique=True, nullable=True)
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    locked_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Run(Base):
    __tablename__ = "run"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    workflow_version_id: Mapped[str | None] = mapped_column(ForeignKey("workflow_version.id", ondelete="SET NULL"), nullable=True, index=True)
    workflow_id: Mapped[str | None] = mapped_column(ForeignKey("workflow.id", ondelete="SET NULL"), nullable=True, index=True)
    agent_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)  # Agent 运行层（05 设计）
    trigger: Mapped[str] = mapped_column(String(16), default="manual")  # manual|api|schedule|test|agent|eval
    idempotency_key: Mapped[str | None] = mapped_column(String(128), unique=True, nullable=True)
    origin_run_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="queued", index=True)
    definition_source: Mapped[str | None] = mapped_column(String(8), nullable=True)  # draft|version（SDD A-01）
    input: Mapped[dict] = mapped_column(JSONB, default=dict)
    output: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    error: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    token_usage: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class NodeRun(Base):
    __tablename__ = "node_run"
    __table_args__ = (UniqueConstraint("run_id", "node_id", "attempt", name="uq_node_run"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    run_id: Mapped[str] = mapped_column(ForeignKey("run.id", ondelete="CASCADE"), index=True)
    node_id: Mapped[str] = mapped_column(String(64))
    node_type: Mapped[str] = mapped_column(String(32))
    attempt: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    input: Mapped[dict] = mapped_column(JSONB, default=dict)
    output: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    error: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    token_usage: Mapped[dict] = mapped_column(JSONB, default=dict)


class RunEvent(Base):
    __tablename__ = "run_event"
    __table_args__ = (UniqueConstraint("run_id", "sequence", name="uq_run_seq"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    run_id: Mapped[str] = mapped_column(ForeignKey("run.id", ondelete="CASCADE"), index=True)
    sequence: Mapped[int] = mapped_column(BigInteger)
    type: Mapped[str] = mapped_column(String(40))
    node_run_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    node_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class CallRecord(Base):
    __tablename__ = "call_record"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    node_run_id: Mapped[str | None] = mapped_column(ForeignKey("node_run.id"), nullable=True, index=True)
    kind: Mapped[str] = mapped_column(String(16))  # tool|model|mcp|knowledge
    target_type: Mapped[str] = mapped_column(String(16), default="")  # tool|model|mcp|knowledge|datasource|asset
    target_id: Mapped[str] = mapped_column(String(64), default="")
    request: Mapped[dict] = mapped_column(JSONB, default=dict)  # 脱敏后
    response: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    status: Mapped[str] = mapped_column(String(16))
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    token_usage: Mapped[dict] = mapped_column(JSONB, default=dict)
    error: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Agent(Base):
    """Agent 层对象（三型）：自主规划/对话编排/编排Agent专家组。"""
    __tablename__ = "agent"
    __table_args__ = (
        # SDD A-17（调研 12 §3.1）：名称上限与前端/服务端校验共用同一常量 20
        CheckConstraint("char_length(name) <= 20", name="ck_agent_name_len"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(64))
    type: Mapped[str] = mapped_column(String(16))  # autonomous|dialogue|expert-group
    description: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(16), default="draft")
    workflow_id: Mapped[str | None] = mapped_column(ForeignKey("workflow.id"), nullable=True)
    avatar: Mapped[str | None] = mapped_column(String(128), nullable=True)
    config: Mapped[dict] = mapped_column(JSONB, default=dict)
    config_revision: Mapped[int] = mapped_column(Integer, default=1)  # SDD A-08 乐观锁
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class ResourceLock(Base):
    """编辑锁（真实操作人展示）。"""
    __tablename__ = "resource_lock"

    resource_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    ws_id: Mapped[str] = mapped_column(String(16))
    user_name: Mapped[str] = mapped_column(String(64), default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class QualityResult(Base):
    """质检业务层：AI 结构化结果（Master §6 业务对象）。"""
    __tablename__ = "quality_result"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    run_id: Mapped[str | None] = mapped_column(ForeignKey("run.id", ondelete="SET NULL"), nullable=True, index=True)
    workflow_version_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    interaction_ref: Mapped[str] = mapped_column(String(128), default="")
    interaction_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    structured_output: Mapped[dict] = mapped_column(JSONB, default=dict)
    score: Mapped[float | None] = mapped_column(nullable=True)
    risk: Mapped[str | None] = mapped_column(String(16), nullable=True)
    critical: Mapped[bool] = mapped_column(default=False)
    issue_count: Mapped[int] = mapped_column(default=0)
    issue_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    review_status: Mapped[str] = mapped_column(String(16), default="AI")  # AI|REVIEWED|EFFECTIVE
    transcript: Mapped[dict] = mapped_column(JSONB, default=list)  # [{start,end,speaker,text}]
    rules_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    review_history: Mapped[dict] = mapped_column(JSONB, default=list)  # [{at,action,reviewer,note}]
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Evidence(Base):
    """证据：支撑质检结论的片段/调用事实。"""
    __tablename__ = "evidence"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    result_id: Mapped[str] = mapped_column(ForeignKey("quality_result.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(32), default="transcript_span")  # transcript_span|tool_call|field
    locator: Mapped[dict] = mapped_column(JSONB, default=dict)
    text: Mapped[str] = mapped_column(Text, default="")
    source_ref: Mapped[str] = mapped_column(String(128), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class EvalSample(Base):
    """效果评测样本：固定输入+可选期望输出。"""
    __tablename__ = "eval_sample"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    workflow_id: Mapped[str] = mapped_column(ForeignKey("workflow.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(64))
    input: Mapped[dict] = mapped_column(JSONB, default=dict)
    expected: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    data_asset_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ResultRuleSet(Base):
    """结果规则：版本化；对 structured_output 求值派生 score/risk/issueCount。"""
    __tablename__ = "result_rule_set"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(64))
    description: Mapped[str] = mapped_column(Text, default="")
    agent_id: Mapped[str] = mapped_column(String(64), default="")
    version: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(16), default="draft")  # draft|published
    rules: Mapped[dict] = mapped_column(JSONB, default=dict)  # {scoreRules:[], issueRules:[]}
    evaluation_priority: Mapped[str] = mapped_column(String(32), default="Most Recent Completed")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class DataAsset(Base):
    """数据资产：按行批量质检的输入数据集。"""
    __tablename__ = "data_asset"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(64))
    description: Mapped[str] = mapped_column(Text, default="")
    source: Mapped[str] = mapped_column(String(64), default="manual")
    datasource_id: Mapped[str | None] = mapped_column(ForeignKey("datasource.id"), nullable=True)
    location: Mapped[str] = mapped_column(String(128), default="")  # 表/路径；空=内联 rows
    record_meaning: Mapped[str] = mapped_column(String(128), default="一通客服对话")
    record_id_field: Mapped[str] = mapped_column(String(64), default="interactionId")
    time_field: Mapped[str] = mapped_column(String(64), default="interactionTime")
    lifecycle: Mapped[str] = mapped_column(String(16), default="Ready")
    health: Mapped[str] = mapped_column(String(16), default="Healthy")
    revision: Mapped[int] = mapped_column(Integer, default=1)
    rows: Mapped[dict] = mapped_column(JSONB, default=list)  # list of row dicts
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class AnalysisTask(Base):
    """分析任务：workflow × 数据资产 × schedule。"""
    __tablename__ = "analysis_task"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(64))
    description: Mapped[str] = mapped_column(Text, default="")
    workflow_id: Mapped[str] = mapped_column(String(64))
    version_policy: Mapped[str] = mapped_column(String(16), default="Latest Published")
    data_asset_id: Mapped[str] = mapped_column(String(64))
    data_definition_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    scope: Mapped[str] = mapped_column(String(128), default="all")
    sampling: Mapped[str] = mapped_column(String(64), default="all")
    data_window: Mapped[str] = mapped_column(String(64), default="last_7d")
    status: Mapped[str] = mapped_column(String(16), default="Active")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Datasource(Base):
    """数据源：连接层引用 Connection，语义层描述库/桶/路径。"""
    __tablename__ = "datasource"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(64))
    description: Mapped[str] = mapped_column(Text, default="")
    type: Mapped[str] = mapped_column(String(16))  # mysql|postgresql|oss|http
    connection_id: Mapped[str | None] = mapped_column(ForeignKey("connection.id"), nullable=True)
    location: Mapped[str] = mapped_column(String(128), default="")  # db 名 / bucket / base path
    config: Mapped[dict] = mapped_column(JSONB, default=dict)
    status: Mapped[str] = mapped_column(String(16), default="enabled")  # enabled|disabled
    health: Mapped[str] = mapped_column(String(16), default="healthy")  # healthy|degraded|error
    last_check_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class McpServer(Base):
    """MCP Server：stdio/http 接入，注册后握手发现工具列表。"""
    __tablename__ = "mcp_server"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(64))
    description: Mapped[str] = mapped_column(Text, default="")
    transport: Mapped[str] = mapped_column(String(8))  # stdio|http
    command: Mapped[str] = mapped_column(String(256), default="")  # stdio 启动命令
    connection_id: Mapped[str | None] = mapped_column(ForeignKey("connection.id"), nullable=True)  # http 模式
    env: Mapped[dict] = mapped_column(JSONB, default=dict)  # {KEY: {"secret_ref": ...}}
    status: Mapped[str] = mapped_column(String(16), default="enabled")
    health: Mapped[str] = mapped_column(String(16), default="healthy")
    discovered_tools: Mapped[dict] = mapped_column(JSONB, default=list)
    last_test_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class KnowledgeSource(Base):
    """知识库：向量库/文档库，供 knowledge-retrieval 节点与检索工具消费。"""
    __tablename__ = "knowledge_source"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(64))
    description: Mapped[str] = mapped_column(Text, default="")
    kind: Mapped[str] = mapped_column(String(16))  # vector|document
    embedding_model_id: Mapped[str | None] = mapped_column(ForeignKey("model.id"), nullable=True)
    source_config: Mapped[dict] = mapped_column(JSONB, default=dict)
    status: Mapped[str] = mapped_column(String(16), default="enabled")
    health: Mapped[str] = mapped_column(String(16), default="healthy")
    slice_count: Mapped[int] = mapped_column(Integer, default=0)
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class DataDefinition(Base):
    """数据定义：挂在 Data Asset 下的字段语义层（schema + eligibility + revision）。"""
    __tablename__ = "data_definition"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(64))
    data_asset_id: Mapped[str] = mapped_column(ForeignKey("data_asset.id"), index=True)
    field_schema: Mapped[dict] = mapped_column(JSONB, default=list)
    eligibility: Mapped[dict] = mapped_column(JSONB, default=list)
    lifecycle: Mapped[str] = mapped_column(String(16), default="Draft")  # Draft|Ready|Deprecated
    revision: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class ResourceChangeLog(Base):
    """资源变更记录：无版本类型资源的审计（创建/配置变更/凭证轮换/停用启用/测试失败）。"""
    __tablename__ = "resource_change_log"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    resource_type: Mapped[str] = mapped_column(String(16), index=True)
    resource_id: Mapped[str] = mapped_column(String(32), index=True)
    action: Mapped[str] = mapped_column(String(32))
    actor: Mapped[str] = mapped_column(String(64), default="")
    detail: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
