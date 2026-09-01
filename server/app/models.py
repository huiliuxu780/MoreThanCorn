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
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
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
    icon: Mapped[str | None] = mapped_column(String(128), nullable=True)  # 08-26 基础信息编辑
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
    kind: Mapped[str] = mapped_column(String(16))  # none|api_key|bearer|basic|aksk|script
    protocol: Mapped[str] = mapped_column(String(16), default="http-api")  # http-api|mysql|postgresql|oss|mcp-http|llm
    endpoint: Mapped[dict] = mapped_column(JSONB, default=dict)  # {base_url}|{host,port}|{bucket,region}（默认环境）
    environments: Mapped[list] = mapped_column(JSONB, default=list)  # [{code,label,endpoint?,secret_ref?}] 按环境覆盖
    default_env: Mapped[str | None] = mapped_column(String(16), nullable=True)
    auth_script: Mapped[str | None] = mapped_column(Text, nullable=True)  # kind=script 的 JS 鉴权脚本
    provider_hint: Mapped[str] = mapped_column(String(64), default="")
    secret_ref: Mapped[str] = mapped_column(String(128))  # Secret Store 引用，不存明文（裸串或 JSON payload 密文）
    status: Mapped[str] = mapped_column(String(16), default="active")  # 兼容读：与 lifecycle 同步；健康度走 check_run 派生
    # SDD-12 P0（AR-07 生命周期与健康分离）：存量行由迁移回填 active；新建默认 draft（C-01）。
    lifecycle: Mapped[str] = mapped_column(String(16), default="draft")  # draft|active|disabled|archived
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    archived_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    revision: Mapped[int] = mapped_column(Integer, default=1)  # 乐观锁（P1 PATCH If-Match 基座）
    last_test_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ConnectionSecretRevision(Base):
    """SDD-12 §5.3（P0 止血形态）：Secret 轮换账本。

    一行=一次写入。legacy `connection.secret_ref` / `environments[].secret_ref`
    仍是运行时读取位置（P1 规范化表落地前），本账本提供版本、退役与审计语义：
    rotate 新增一行并退役旧行；普通 config 更新不产生行（B-02）。
    env_code 空串=连接级根 Secret。encrypted_payload 不得出现在任何 API 响应。
    """
    __tablename__ = "connection_secret_revision"
    __table_args__ = (UniqueConstraint("connection_id", "env_code", "version_no",
                                       name="uq_conn_secret_revision"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    connection_id: Mapped[str] = mapped_column(ForeignKey("connection.id"), index=True)
    env_code: Mapped[str] = mapped_column(String(16), default="")
    version_no: Mapped[int] = mapped_column(Integer)
    encrypted_payload: Mapped[str] = mapped_column(Text)
    payload_fingerprint: Mapped[str] = mapped_column(String(64), default="")  # 不可逆指纹，仅判变化
    status: Mapped[str] = mapped_column(String(16), default="active")  # active|retired|compromised
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    created_by: Mapped[str] = mapped_column(String(64), default="")
    retired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    retired_by: Mapped[str | None] = mapped_column(String(64), nullable=True)


class CheckRun(Base):
    """SDD-12 §11.3（P0 统一形态）：Connection/Resource 的真实检查记录。

    启用门禁与健康度从这里派生：最近一次检查的 config_fingerprint 与当前配置
    指纹不一致 → stale（C-03）；无记录 → untested（H-02 不得显示 healthy）。
    diagnostics 只允许脱敏字段（状态码等），禁止明文凭据/完整报文（§11.3）。
    """
    __tablename__ = "check_run"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    scope: Mapped[str] = mapped_column(String(16))  # connection|resource
    target_id: Mapped[str] = mapped_column(String(32), index=True)
    env_code: Mapped[str] = mapped_column(String(16), default="")
    purpose: Mapped[str] = mapped_column(String(16))  # connectivity|auth|discover|inference|query|execute
    status: Mapped[str] = mapped_column(String(16))  # succeeded|failed|partial
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    diagnostics: Mapped[dict] = mapped_column(JSONB, default=dict)
    config_fingerprint: Mapped[str] = mapped_column(String(64), default="")
    trace_id: Mapped[str] = mapped_column(String(64), default="")
    actor: Mapped[str] = mapped_column(String(64), default="")
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
    __table_args__ = (
        # 09-SDD INV-02/§9.8：同一批次内一条 Interaction 一个 attempt 唯一
        UniqueConstraint("task_run_id", "interaction_ref", "attempt", name="uq_run_taskrun_interaction_attempt"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    workflow_version_id: Mapped[str | None] = mapped_column(ForeignKey("workflow_version.id", ondelete="SET NULL"), nullable=True, index=True)
    workflow_id: Mapped[str | None] = mapped_column(ForeignKey("workflow.id", ondelete="SET NULL"), nullable=True, index=True)
    agent_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)  # Agent 运行层（05 设计）
    trigger: Mapped[str] = mapped_column(String(16), default="manual")  # manual|api|schedule|test|agent|eval|batch
    idempotency_key: Mapped[str | None] = mapped_column(String(128), unique=True, nullable=True)
    origin_run_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="queued", index=True)
    definition_source: Mapped[str | None] = mapped_column(String(8), nullable=True)  # draft|version（SDD A-01）
    agent_version_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)  # SDD B-03
    # 09-SDD §9.5：Task 主链追踪（INV-05）
    task_run_id: Mapped[str | None] = mapped_column(ForeignKey("task_run.id", ondelete="SET NULL"), nullable=True, index=True)
    task_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    task_version_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    interaction_ref: Mapped[str] = mapped_column(String(128), default="", index=True)
    attempt: Mapped[int] = mapped_column(Integer, default=1)
    definition_version_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    rule_version_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    data_snapshot_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    input: Mapped[dict] = mapped_column(JSONB, default=dict)
    output: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    error: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    token_usage: Mapped[dict] = mapped_column(JSONB, default=dict)
    # SDD 10 §5.7：Runtime 执行事实（R1）。runtime_snapshot 保存实际执行事实，
    # 不只保存期望配置；平台 run.id 即发送给 Provider 的 run_id。
    runtime_provider_id: Mapped[str | None] = mapped_column(
        ForeignKey("agent_runtime_provider.id"), nullable=True, index=True)
    runtime_provider_run_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    runtime_request_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    runtime_snapshot: Mapped[dict] = mapped_column(JSONB, default=dict)
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
    # SDD C-1：双通道与 Trace 骨架
    channel: Mapped[str] = mapped_column(String(8), default="CONTROL")  # CONTROL|CONTENT
    trace_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    span_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    parent_span_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tokens: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class MemoryRecord(Base):
    """持久化记忆值（SDD C-4）：scope=agent:{agentId}|wf:{workflowId}，键空间内唯一。"""
    __tablename__ = "memory_record"
    __table_args__ = (UniqueConstraint("scope", "key", name="uq_memory_scope_key"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    scope: Mapped[str] = mapped_column(String(64), index=True)
    key: Mapped[str] = mapped_column(String(128))
    value: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class CallRecord(Base):
    __tablename__ = "call_record"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    node_run_id: Mapped[str | None] = mapped_column(ForeignKey("node_run.id"), nullable=True, index=True)
    # SDD 10 §5.8（R1）：直接领域 Agent 调用只挂 run_id（node_run_id=null）。
    # 先可空 + 迁移经 node_run 回填；孤儿处置后再收紧 NOT NULL（见 g040r1prov0001）。
    run_id: Mapped[str | None] = mapped_column(ForeignKey("run.id"), nullable=True, index=True)
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
    type: Mapped[str] = mapped_column(String(16))  # 历史：autonomous|dialogue|expert-group；新体系内部值 "module"（SDD 10 §5.1，仅历史读取保留）
    # SDD 10 §5.1（R2）：领域 Module 标识；expand/contract 先可空兼容封存历史行，新 Agent 必填（应用层）
    module_key: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    module_version: Mapped[str | None] = mapped_column(String(32), nullable=True)
    description: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(16), default="draft")
    workflow_id: Mapped[str | None] = mapped_column(ForeignKey("workflow.id"), nullable=True)
    avatar: Mapped[str | None] = mapped_column(String(128), nullable=True)
    config: Mapped[dict] = mapped_column(JSONB, default=dict)
    config_revision: Mapped[int] = mapped_column(Integer, default=1)  # SDD A-08 乐观锁
    sandbox_version_id: Mapped[str | None] = mapped_column(String(32), nullable=True)  # SDD B
    prod_version_id: Mapped[str | None] = mapped_column(String(32), nullable=True)  # SDD B
    archived: Mapped[bool] = mapped_column(Boolean, default=False)  # SDD E-2.1 归档
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class AgentVersion(Base):
    """Agent 不可变版本快照（SDD 02 §2.2）。"""
    __tablename__ = "agent_version"
    __table_args__ = (UniqueConstraint("agent_id", "version_no", name="uq_agent_version_no"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    agent_id: Mapped[str] = mapped_column(ForeignKey("agent.id"), index=True)
    version_no: Mapped[int] = mapped_column(Integer)
    schema_version: Mapped[int] = mapped_column(Integer, default=1)
    definition: Mapped[dict] = mapped_column(JSONB)
    common_config: Mapped[dict] = mapped_column(JSONB, default=dict)
    dependency_snapshot: Mapped[dict] = mapped_column(JSONB, default=dict)
    artifact_hash: Mapped[str] = mapped_column(String(64))
    note: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Release(Base):
    """Agent 版本到环境的部署记录（SDD 02 §2.3）；回滚=重新部署旧版本。"""
    __tablename__ = "release"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    agent_id: Mapped[str] = mapped_column(ForeignKey("agent.id"), index=True)
    agent_version_id: Mapped[str] = mapped_column(ForeignKey("agent_version.id"))
    environment: Mapped[str] = mapped_column(String(8))  # sandbox|prod
    status: Mapped[str] = mapped_column(String(16), default="active")  # active|rolled_back|offline
    canary_percent: Mapped[int] = mapped_column(Integer, default=0)  # SDD E-2.3 灰度百分比 0-100
    # SDD 10 §5.4：Release Runtime Binding（R1）
    runtime_provider_id: Mapped[str | None] = mapped_column(
        ForeignKey("agent_runtime_provider.id"), nullable=True)
    runtime_profile: Mapped[str | None] = mapped_column(String(64), nullable=True)
    runtime_binding_snapshot: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_by: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AgentRuntimeProvider(Base):
    """Runtime Provider 注册表（SDD 10 §5.3）：与 ModelProvider 禁止合表。

    Secret 只能经 connection_id 引用现有 Connection/Secret 管理；
    config 仅存非敏感配置，禁止保存 API Key。"""
    __tablename__ = "agent_runtime_provider"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(64))
    kind: Mapped[str] = mapped_column(String(32))  # agentscope|deepseek-harness|external
    base_url: Mapped[str] = mapped_column(String(256), default="")
    connection_id: Mapped[str | None] = mapped_column(ForeignKey("connection.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="draft")  # draft|enabled|disabled
    contract_version: Mapped[str] = mapped_column(String(16), default="1.0")
    capabilities: Mapped[dict] = mapped_column(JSONB, default=dict)
    config: Mapped[dict] = mapped_column(JSONB, default=dict)  # 非敏感配置
    health_status: Mapped[str | None] = mapped_column(String(16), nullable=True)  # ok|degraded|unavailable|error
    last_health_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class ResourceLock(Base):
    """编辑锁（租约语义，SDD D-4：expires_at 过期可接管）。"""
    __tablename__ = "resource_lock"

    resource_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    ws_id: Mapped[str] = mapped_column(String(16))
    user_name: Mapped[str] = mapped_column(String(64), default="")
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class Form(Base):
    """07-SDD（08-26 决策+V1.5）：集中表单实体=业务 Schema（输入契约+结果结构）。

    V1.5：key 稳定标识（创建后不可改）+ status 生命周期 + 字段模型 {id,key,type(UI),dataType,label,...}。"""
    __tablename__ = "form"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    key: Mapped[str] = mapped_column(String(64), default="")
    name: Mapped[str] = mapped_column(String(64))
    description: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(16), default="draft")  # draft|published|disabled
    fields: Mapped[list] = mapped_column(JSONB, default=list)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class FormVersion(Base):
    """07-SDD V1.5：Form 不可变版本（发布生成；Workflow Run 冻结 formId+version）。"""
    __tablename__ = "form_version"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    form_id: Mapped[str] = mapped_column(String(32), index=True)
    version_no: Mapped[int] = mapped_column(Integer)
    fields: Mapped[list] = mapped_column(JSONB, default=list)
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class FormRecord(Base):
    """07-SDD V1.5：Form 记录层（values+formVersion+runId 追溯；动态字段不进列）。"""
    __tablename__ = "form_record"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    form_id: Mapped[str] = mapped_column(String(32), index=True)
    form_version: Mapped[int] = mapped_column(Integer, default=0)
    values: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_by: Mapped[str] = mapped_column(String(64), default="")
    run_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    task_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class QualityResult(Base):
    """质检业务层：AI 结构化结果（09-SDD §9.6）。

    INV-03：一个 Run 至多一条 is_latest 结果；谱系行以 is_latest=false 保留。
    INV-08：ai_result 冻结 AI 原始值；人工修订走 ReviewRevision。
    score/risk 等顶层列为"生效值"（AI 派生或最近人工修订）。"""
    __tablename__ = "quality_result"
    __table_args__ = (
        # 部分唯一：一个 Run 至多一条"生效"结果；is_latest=false 谱系行不受限
        Index("uq_quality_result_run_latest", "run_id", unique=True,
              postgresql_where=text("is_latest")),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    run_id: Mapped[str | None] = mapped_column(ForeignKey("run.id", ondelete="SET NULL"), nullable=True, index=True)
    workflow_version_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # SDD 10 §5.9（R3）：Agent 主链结果的版本谱系
    agent_version_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    interaction_ref: Mapped[str] = mapped_column(String(128), default="", index=True)
    interaction_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    structured_output: Mapped[dict] = mapped_column(JSONB, default=dict)
    score: Mapped[float | None] = mapped_column(nullable=True)
    risk: Mapped[str | None] = mapped_column(String(16), nullable=True)
    critical: Mapped[bool] = mapped_column(default=False)
    issue_count: Mapped[int] = mapped_column(default=0)
    issue_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    review_status: Mapped[str] = mapped_column(String(16), default="AI")  # AI|IN_REVIEW|REVIEWED|EFFECTIVE|REOPENED
    transcript: Mapped[dict] = mapped_column(JSONB, default=list)  # [{start,end,speaker,text}]
    rules_version: Mapped[int | None] = mapped_column(Integer, nullable=True)  # legacy（B1 起由 rule_version_id 取代）
    review_history: Mapped[dict] = mapped_column(JSONB, default=list)  # [{at,action,reviewer,note}]
    # 09 P1-02：复核领取/分配（待复核队列 §11.4）
    review_claimed_by: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    review_claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # 09-SDD §9.6：追踪与版本链
    task_run_id: Mapped[str | None] = mapped_column(ForeignKey("task_run.id", ondelete="SET NULL"), nullable=True, index=True)
    task_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    task_version_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    rule_version_id: Mapped[str | None] = mapped_column(ForeignKey("result_rule_version.id", ondelete="SET NULL"), nullable=True, index=True)
    output_schema_version_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    ai_result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)  # AI 原始：结构化输出+派生值（不可变）
    derived_result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)  # 冻结规则版本派生的 score/risk/issues
    effective_review_revision_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    is_latest: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
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
    """效果评测样本：固定输入+可选期望输出；可挂工作流或 Agent（SDD D-1）。"""
    __tablename__ = "eval_sample"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    workflow_id: Mapped[str | None] = mapped_column(ForeignKey("workflow.id", ondelete="CASCADE"), nullable=True, index=True)
    agent_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)  # SDD D-1
    name: Mapped[str] = mapped_column(String(64))
    input: Mapped[dict] = mapped_column(JSONB, default=dict)
    expected: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    data_asset_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    judge_result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)  # SDD D-3：最近一次 Judge 结果
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class EvolutionPatch(Base):
    """进化候选补丁（SDD D-3）：失败归因 → 候选 Prompt → 审批后应用到草稿。"""
    __tablename__ = "evolution_patch"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    agent_id: Mapped[str] = mapped_column(ForeignKey("agent.id"), index=True)
    attribution: Mapped[str] = mapped_column(String(32), default="")  # tool_failed|timeout|hallucination|other
    reason: Mapped[str] = mapped_column(Text, default="")
    base_prompt: Mapped[str] = mapped_column(Text, default="")
    proposed_prompt: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(16), default="pending")  # pending|applied|rejected
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AuditLog(Base):
    """审计日志（SDD D-4）：发布/回滚/删除/解锁等高危操作留痕。"""
    __tablename__ = "audit_log"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    actor: Mapped[str] = mapped_column(String(64), default="")
    action: Mapped[str] = mapped_column(String(64))
    target_type: Mapped[str] = mapped_column(String(32), default="")
    target_id: Mapped[str] = mapped_column(String(64), default="")
    detail: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ReleaseRequest(Base):
    """发布治理（09-SDD P2-08）：统一的版本发布申请状态机。

    覆盖 workflow|rule|definition|task 四类资源，治理"把哪个不可变版本提为
    当前生效"。state 流转：pending → approved|rejected → released → rolled_back。
    Canary 以 canary + canary_scope + canary_promoted 表达（先灰度后全量）。
    """
    __tablename__ = "release_request"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    resource_type: Mapped[str] = mapped_column(String(16))  # workflow|rule|definition|task
    resource_id: Mapped[str] = mapped_column(String(32), index=True)
    from_version_no: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 申请时的生效版本
    to_version_no: Mapped[int] = mapped_column(Integer)
    state: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    canary: Mapped[bool] = mapped_column(Boolean, default=False)
    canary_scope: Mapped[dict] = mapped_column(JSONB, default=dict)
    canary_promoted: Mapped[bool] = mapped_column(Boolean, default=False)
    requested_by: Mapped[str] = mapped_column(String(64), default="")
    approved_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejected_reason: Mapped[str] = mapped_column(Text, default="")
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rolled_back_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    note: Mapped[str] = mapped_column(Text, default="")
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
    """分析任务（09-SDD §9.1）：可变身份对象；配置全部下沉到 AnalysisTaskVersion。

    SDD 10 §5.5（R3）：统一执行目标 workflow|agent（Check 约束互斥）。"""
    __tablename__ = "analysis_task"
    __table_args__ = (
        CheckConstraint("(execution_target_type = 'workflow' AND workflow_id IS NOT NULL "
                        "AND agent_id IS NULL) OR (execution_target_type = 'agent' "
                        "AND agent_id IS NOT NULL AND workflow_id IS NULL)",
                        name="ck_task_target_type"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(64))
    description: Mapped[str] = mapped_column(Text, default="")
    execution_target_type: Mapped[str] = mapped_column(String(16), default="workflow")
    agent_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    workflow_id: Mapped[str | None] = mapped_column(String(64), nullable=True)  # 冗余自 current TaskVersion，便于列表
    version_policy: Mapped[str] = mapped_column(String(16), default="Latest Published")  # legacy 扁平列（B1 起只读）
    data_asset_id: Mapped[str] = mapped_column(String(64))
    data_definition_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    scope: Mapped[str] = mapped_column(String(128), default="all")
    sampling: Mapped[str] = mapped_column(String(64), default="all")
    data_window: Mapped[str] = mapped_column(String(64), default="last_7d")
    status: Mapped[str] = mapped_column(String(16), default="active")  # draft|active|paused|archived（09 §11.1）
    current_version_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_by: Mapped[str] = mapped_column(String(64), default="")
    updated_by: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class AnalysisTaskVersion(Base):
    """分析任务不可变配置版本（09-SDD §9.2；INV-01 TaskRun 只绑定一个 TaskVersion）。

    SDD 10 §5.5（R3）：Agent 目标（agent_id + 版本策略 pinned|latest_sandbox_release|
    latest_prod_release）；与 Workflow 目标经 Check 约束互斥。"""
    __tablename__ = "analysis_task_version"
    __table_args__ = (
        UniqueConstraint("task_id", "version_no", name="uq_task_version_no"),
        CheckConstraint("(execution_target_type = 'workflow' AND workflow_id IS NOT NULL "
                        "AND agent_id IS NULL) OR (execution_target_type = 'agent' "
                        "AND agent_id IS NOT NULL AND workflow_id IS NULL)",
                        name="ck_task_version_target_type"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    task_id: Mapped[str] = mapped_column(ForeignKey("analysis_task.id", ondelete="CASCADE"), index=True)
    version_no: Mapped[int] = mapped_column(Integer)
    execution_target_type: Mapped[str] = mapped_column(String(16), default="workflow")
    agent_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    agent_version_policy: Mapped[str | None] = mapped_column(String(32), nullable=True)
    pinned_agent_version_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    workflow_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    workflow_version_policy: Mapped[str] = mapped_column(String(16), default="latest_published")  # pinned|latest_published
    pinned_workflow_version_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    data_asset_id: Mapped[str] = mapped_column(String(64))
    data_definition_version_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    result_rule_version_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # 09 P0 修复轮：规则绑定策略（pinned=绑定 result_rule_version_id；
    # follow_latest=批次启动时解析最新发布版本并冻结）
    rule_policy: Mapped[str] = mapped_column(String(16), default="pinned")
    # 09 闭环验收修复：follow_latest 的 RuleSet 作用域（避免全库取最新串用他集）
    result_rule_set_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    input_mapping: Mapped[dict] = mapped_column(JSONB, default=dict)
    scope: Mapped[dict] = mapped_column(JSONB, default=dict)      # {op,and/or,conditions[]}
    sampling: Mapped[dict] = mapped_column(JSONB, default=dict)   # {mode: all|count|random, count, percent, seed}
    data_window: Mapped[dict] = mapped_column(JSONB, default=dict)  # {mode: all|relative|fixed, value, timezone, start, end}
    output_schema_version_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # SDD 13 §4.2：输出配置（OutputBinding）。output_contract_snapshot 冻结执行目标
    # Output Schema 本体/ref/version/sha256/来源；legacy 质检引用只留 output_schema_version_id。
    output_contract_snapshot: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    output_mode: Mapped[str] = mapped_column(String(16), default="platform_only")  # platform_only|target_table
    output_asset_id: Mapped[str | None] = mapped_column(String(32), nullable=True)  # target_table 时必填
    output_definition_version_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    output_write_mode: Mapped[str] = mapped_column(String(16), default="upsert")  # append|upsert
    output_key_fields: Mapped[list] = mapped_column(JSONB, default=list)  # 至少覆盖目标表唯一键
    output_mapping: Mapped[dict] = mapped_column(JSONB, default=dict)  # 目标列 -> 受限表达式
    output_failure_policy: Mapped[str] = mapped_column(String(32), default="separate_delivery_status")
    note: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class DataDefinitionVersion(Base):
    """数据定义不可变版本（09-SDD §9.3/§9.5 追踪依赖）。"""
    __tablename__ = "data_definition_version"
    __table_args__ = (UniqueConstraint("definition_id", "version_no", name="uq_definition_version_no"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    definition_id: Mapped[str] = mapped_column(ForeignKey("data_definition.id", ondelete="CASCADE"), index=True)
    version_no: Mapped[int] = mapped_column(Integer)
    field_schema: Mapped[dict] = mapped_column(JSONB, default=list)
    eligibility: Mapped[dict] = mapped_column(JSONB, default=list)
    note: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ResultRuleVersion(Base):
    """结果规则不可变版本（09-SDD §6.6/P0-07；发布=快照冻结，不再全库重算）。"""
    __tablename__ = "result_rule_version"
    __table_args__ = (UniqueConstraint("rule_set_id", "version_no", name="uq_rule_version_no"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    rule_set_id: Mapped[str] = mapped_column(ForeignKey("result_rule_set.id", ondelete="CASCADE"), index=True)
    version_no: Mapped[int] = mapped_column(Integer)
    rules: Mapped[dict] = mapped_column(JSONB, default=dict)
    evaluation_priority: Mapped[str] = mapped_column(String(32), default="Most Recent Completed")
    note: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class QualityOutputSchema(Base):
    """质检输出 Schema 版本（09-SDD §6.5/D09-3；key+version_no 不可变）。"""
    __tablename__ = "quality_output_schema"
    __table_args__ = (UniqueConstraint("key", "version_no", name="uq_output_schema_version"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    key: Mapped[str] = mapped_column(String(64), index=True)  # quality_evaluation
    version_no: Mapped[int] = mapped_column(Integer)
    schema_: Mapped[dict] = mapped_column("schema", JSONB, default=dict)
    status: Mapped[str] = mapped_column(String(16), default="published")
    created_by: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class DataSnapshot(Base):
    """一次 TaskRun 实际读取的数据快照（09-SDD §9.3）。"""
    __tablename__ = "data_snapshot"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    asset_id: Mapped[str] = mapped_column(String(32), index=True)
    asset_revision: Mapped[int] = mapped_column(Integer, default=0)
    definition_version_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    locator: Mapped[dict] = mapped_column(JSONB, default=dict)      # 源/查询的脱敏快照
    resolved_window: Mapped[dict] = mapped_column(JSONB, default=dict)
    resolved_scope: Mapped[dict] = mapped_column(JSONB, default=dict)
    resolved_sampling: Mapped[dict] = mapped_column(JSONB, default=dict)
    checkpoint: Mapped[str | None] = mapped_column(String(256), nullable=True)
    expected_count: Mapped[int] = mapped_column(Integer, default=0)
    read_count: Mapped[int] = mapped_column(Integer, default=0)
    checksum: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class TaskRun(Base):
    """任务批次运行（09-SDD §9.4；INV-01/INV-11）。"""
    __tablename__ = "task_run"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    task_id: Mapped[str] = mapped_column(ForeignKey("analysis_task.id", ondelete="CASCADE"), index=True)
    task_version_id: Mapped[str] = mapped_column(ForeignKey("analysis_task_version.id"), index=True)
    data_snapshot_id: Mapped[str | None] = mapped_column(ForeignKey("data_snapshot.id", ondelete="SET NULL"), nullable=True)
    # 09 P0 修复轮：批次启动时解析并冻结的规则版本（Run/Result 的 rule_version_id 来源）
    resolved_rule_version_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # SDD 10 §5.6（R3）：批次启动一次解析并冻结（分页/重启/重试不得漂移到新版本）
    resolved_workflow_version_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    resolved_agent_version_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    resolved_release_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    runtime_binding_snapshot: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    trigger: Mapped[str] = mapped_column(String(16), default="manual")  # manual|schedule|backfill|api
    schedule_fire_key: Mapped[str | None] = mapped_column(String(128), unique=True, nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(128), unique=True, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="queued", index=True)  # queued|running|partial|succeeded|failed|cancelled
    total: Mapped[int] = mapped_column(Integer, default=0)
    succeeded_count: Mapped[int] = mapped_column(Integer, default=0)
    failed_count: Mapped[int] = mapped_column(Integer, default=0)
    skipped_count: Mapped[int] = mapped_column(Integer, default=0)
    cancelled_count: Mapped[int] = mapped_column(Integer, default=0)
    # SDD 13 §4.3：投递快照与聚合。delivery_status 单独表示目标表投递聚合，
    # 禁止以 status=succeeded 推导目标表已有全部结果。
    output_binding_snapshot: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    delivery_status: Mapped[str] = mapped_column(
        String(16), default="not_configured", index=True)  # not_configured|pending|running|succeeded|partial|failed
    delivery_pending_count: Mapped[int] = mapped_column(Integer, default=0)
    delivery_succeeded_count: Mapped[int] = mapped_column(Integer, default=0)
    delivery_failed_count: Mapped[int] = mapped_column(Integer, default=0)
    error_summary: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ResultDelivery(Base):
    """SDD 13 §4.4：Run 输出到目标表的投递 Outbox 行。

    平台 Outbox exactly-once creation（UNIQUE(run_id)/UNIQUE(idempotency_key)）；
    外部投递 at-least-once attempt，目标表效果靠唯一键+upsert 幂等。
    record_payload 为映射后冻结记录（数据级别继承 Run.output），重试不得改写。"""
    __tablename__ = "result_delivery"
    __table_args__ = (
        UniqueConstraint("run_id", name="uq_result_delivery_run"),
        UniqueConstraint("idempotency_key", name="uq_result_delivery_idem"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    run_id: Mapped[str] = mapped_column(ForeignKey("run.id", ondelete="CASCADE"), index=True)
    task_run_id: Mapped[str | None] = mapped_column(ForeignKey("task_run.id", ondelete="SET NULL"), nullable=True, index=True)
    task_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    task_version_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    interaction_ref: Mapped[str] = mapped_column(String(128), default="", index=True)
    output_asset_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    output_definition_version_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)  # pending|running|succeeded|retrying|failed|dead_letter
    write_mode: Mapped[str] = mapped_column(String(16), default="upsert")  # append|upsert
    idempotency_key: Mapped[str] = mapped_column(String(128), default="")  # result-delivery:{run_id}
    record_payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    payload_sha256: Mapped[str] = mapped_column(String(64), default="")
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=5)
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error: Mapped[dict | None] = mapped_column(JSONB, nullable=True)  # 结构化、脱敏错误
    target_reference: Mapped[dict | None] = mapped_column(JSONB, nullable=True)  # 成功后的表与键，不存 Secret
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ScheduleOccurrence(Base):
    """SDD 13 §4.6：当日调度事实（计划发生项持久化）。

    调度器滚动 48 小时预生成；UNIQUE(schedule_id, planned_at) 防重复计划；
    到点以 fire_key 幂等创建 TaskRun 并回填 task_run_id；超宽限未触发=missed；
    暂停后未触发=cancelled（不静默删除）。前端不得仅凭 cron 推算历史计划。"""
    __tablename__ = "schedule_occurrence"
    __table_args__ = (
        UniqueConstraint("fire_key", name="uq_occurrence_fire_key"),
        UniqueConstraint("schedule_id", "planned_at", name="uq_occurrence_schedule_planned"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    schedule_id: Mapped[str] = mapped_column(ForeignKey("schedule.id", ondelete="CASCADE"), index=True)
    task_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    planned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    timezone: Mapped[str] = mapped_column(String(48), default="Asia/Shanghai")
    fire_key: Mapped[str] = mapped_column(String(128), default="")  # 与 TaskRun.schedule_fire_key 对齐
    status: Mapped[str] = mapped_column(String(16), default="planned", index=True)  # planned|firing|started|missed|skipped|cancelled
    task_run_id: Mapped[str | None] = mapped_column(ForeignKey("task_run.id", ondelete="SET NULL"), nullable=True, unique=True)
    schedule_snapshot: Mapped[dict] = mapped_column(JSONB, default=dict)
    error: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class ReviewRevision(Base):
    """复核修订（09-SDD §9.7/INV-08：只追加，不覆盖 AI 原始结果）。"""
    __tablename__ = "review_revision"
    __table_args__ = (UniqueConstraint("quality_result_id", "revision_no", name="uq_review_revision"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    quality_result_id: Mapped[str] = mapped_column(ForeignKey("quality_result.id", ondelete="CASCADE"), index=True)
    revision_no: Mapped[int] = mapped_column(Integer)
    action: Mapped[str] = mapped_column(String(16))  # approve|revise|effective|reopen
    reason: Mapped[str] = mapped_column(Text, default="")
    reviewer_id: Mapped[str] = mapped_column(String(64), default="")
    before: Mapped[dict] = mapped_column(JSONB, default=dict)
    after: Mapped[dict] = mapped_column(JSONB, default=dict)
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


class AppUser(Base):
    """平台用户（09-SDD P0-10）：服务端身份与角色；actor 的唯一来源。"""
    __tablename__ = "app_user"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(64), default="")
    password_hash: Mapped[str] = mapped_column(String(256))
    role: Mapped[str] = mapped_column(String(16), default="viewer")  # admin|operator|viewer
    status: Mapped[str] = mapped_column(String(16), default="active")  # active|disabled
    # P2-02：组织/团队/数据范围（单租户内团队维度）；data_scope=all 直通，team 按同队成员过滤
    team: Mapped[str] = mapped_column(String(64), default="")
    data_scope: Mapped[str] = mapped_column(String(16), default="all")  # all|team
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AlertRule(Base):
    """09 P1-08：告警规则（阈值评估）。"""
    __tablename__ = "alert_rule"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(64))
    metric: Mapped[str] = mapped_column(String(32))  # queue_backlog|run_error_rate|schedule_overdue|dead_letter
    operator: Mapped[str] = mapped_column(String(4), default="gt")  # gt|gte|lt|lte
    threshold: Mapped[float] = mapped_column(Float, default=0)
    severity: Mapped[str] = mapped_column(String(16), default="warning")  # info|warning|critical
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    notify: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AlertEvent(Base):
    """09 P1-08：告警事件（触发留痕，可确认）。"""
    __tablename__ = "alert_event"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    rule_id: Mapped[str | None] = mapped_column(ForeignKey("alert_rule.id", ondelete="SET NULL"), nullable=True, index=True)
    metric: Mapped[str] = mapped_column(String(32))
    value: Mapped[float] = mapped_column(Float, default=0)
    threshold: Mapped[float] = mapped_column(Float, default=0)
    severity: Mapped[str] = mapped_column(String(16), default="warning")
    message: Mapped[str] = mapped_column(Text, default="")
    acknowledged: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


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
