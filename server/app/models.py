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
    # F3（Spec §9.2.2）：真租约（locked_at 只是认领时间，租约到期才可回收）
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    owner_run_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    cancel_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
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
    # P0-07 语义适配：AgentScope 换底后该列曾被就地重解释为 Session 反链但
    # 名字仍是 provider——新增专名列终止"各处自行重新解释"。新代码一律读写
    # agentscope_session_id；runtime_provider_run_id 仅供旧 Provider 时代历史
    # 行只读（g052 迁移已把换底后的 Session 值搬入新列）。
    agentscope_session_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
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


# ---------- Agent 能力一等实体（09-07 重构 g047） ----------


class SkillResource(Base):
    """Skill 市场条目（registry kind=skill）：content 为 SKILL.md 全文。"""
    __tablename__ = "skill"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(64))
    description: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(32), default="")
    content: Mapped[str] = mapped_column(Text, default="")
    source: Mapped[str] = mapped_column(String(16), default="market")  # market|upload
    status: Mapped[str] = mapped_column(String(16), default="ready")
    extra: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class AgentSkill(Base):
    """Agent 已安装 Skill（per-agent 挂载，唯一约束防重复安装）。"""
    __tablename__ = "agent_skill"
    __table_args__ = (UniqueConstraint("agent_id", "skill_id", name="uq_agent_skill"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    agent_id: Mapped[str] = mapped_column(ForeignKey("agent.id"), index=True)
    skill_id: Mapped[str] = mapped_column(ForeignKey("skill.id"), index=True)
    installed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AgentMemory(Base):
    """Agent 全局记忆文档（单行/Agent；保存即版本快照）。"""
    __tablename__ = "agent_memory"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    agent_id: Mapped[str] = mapped_column(ForeignKey("agent.id"), unique=True, index=True)
    content: Mapped[str] = mapped_column(Text, default="")
    version: Mapped[int] = mapped_column(Integer, default=1)
    updated_by: Mapped[str] = mapped_column(String(64), default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class AgentMemoryRevision(Base):
    """记忆版本快照（版本管理 dialog 数据源）。"""
    __tablename__ = "agent_memory_revision"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    memory_id: Mapped[str] = mapped_column(ForeignKey("agent_memory.id"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    content: Mapped[str] = mapped_column(Text, default="")
    note: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AgentChatSession(Base):
    """对话工作区会话（左栏历史列表）。"""
    __tablename__ = "agent_chat_session"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    agent_id: Mapped[str] = mapped_column(ForeignKey("agent.id"), index=True)
    title: Mapped[str] = mapped_column(String(120), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class AgentChatMessage(Base):
    """对话消息；assistant 行随 chat-turn run 流式落库（streaming→done/failed）。"""
    __tablename__ = "agent_chat_message"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    session_id: Mapped[str] = mapped_column(ForeignKey("agent_chat_session.id"), index=True)
    role: Mapped[str] = mapped_column(String(16))  # user|assistant
    content: Mapped[str] = mapped_column(Text, default="")
    attachments: Mapped[list] = mapped_column(JSONB, default=list)
    model_id: Mapped[str] = mapped_column(String(64), default="")
    run_id: Mapped[str | None] = mapped_column(ForeignKey("run.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="done")  # streaming|done|failed
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AgentRuntimeProvider(Base):
    """Runtime Provider 注册表（SDD 10 §5.3）：与 ModelProvider 禁止合表。

    Secret 只能经 connection_id 引用现有 Connection/Secret 管理；
    config 仅存非敏感配置，禁止保存 API Key。"""
    __tablename__ = "agent_runtime_provider"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(64))
    kind: Mapped[str] = mapped_column(String(32))  # agentscope|external（历史行可能含已退役的 deepseek-harness，只读追溯）
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
    # D5：目录元数据（schema/partitioned/comment/列数等发现器产出）
    config: Mapped[dict] = mapped_column(JSONB, default=dict)
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
    trigger: Mapped[str] = mapped_column(String(16), default="manual")  # manual|schedule|backfill|api|event
    schedule_fire_key: Mapped[str | None] = mapped_column(String(128), unique=True, nullable=True)
    # F5（Spec §10.1）：event 触发批次的可追踪引用（SourceEvent→Delivery→TaskRun 全链路）
    source_event_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    event_delivery_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
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
    # F3（Spec §9/§9.2.1）：增量计数与取消/超时/Recovery 血缘
    processed_count: Mapped[int] = mapped_column(Integer, default=0)
    total_state: Mapped[str] = mapped_column(String(16), default="estimating")
    # estimating|exact（AC-030/031）
    cancel_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deadline_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    outcome_code: Mapped[str | None] = mapped_column(String(48), nullable=True)
    # F3（AC-038）：NO_ELIGIBLE_ITEMS 等业务终态说明（非系统失败）
    retry_of_task_run_id: Mapped[str | None] = mapped_column(
        ForeignKey("task_run.id", ondelete="RESTRICT"), nullable=True, index=True)
    run_scope: Mapped[str] = mapped_column(String(16), default="all")  # all|failed_items|backfill
    retry_round: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class TaskRunErrorAgg(Base):
    """F3：批次错误聚合（summary topErrors 数据源，Spec §9.2.1）。"""
    __tablename__ = "task_run_error_agg"
    __table_args__ = (
        UniqueConstraint("task_run_id", "category", "code",
                         name="uq_tr_err_agg_run_cat_code"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    task_run_id: Mapped[str] = mapped_column(String(32), index=True)
    category: Mapped[str] = mapped_column(String(32))
    code: Mapped[str] = mapped_column(String(64))
    count: Mapped[int] = mapped_column(Integer, default=0)
    sample_refs: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    first_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


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


# ---------------------------------------------------------------------------
# AgentScope 换底（2026-09-09 任务书 §四/§五 + docs/v2-design/13）
# 平台只保留控制面与索引；Session/消息/状态/调度真相在 AgentScope 运行时。
# ---------------------------------------------------------------------------


class AgentSessionIndex(Base):
    """AgentScope Session 的平台索引与业务关联（不复制 Session 内容）。"""
    __tablename__ = "agent_session_index"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    session_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    agent_id: Mapped[str] = mapped_column(String(32), index=True)
    release_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    trigger_kind: Mapped[str] = mapped_column(String(16), default="manual")
    # manual|chat|schedule|api|event|workflow|agentflow|agent_tool|group
    # （group=Group 群聊会话，Spec group-capability §4.4；词表注释级、无 DB ck）
    automation_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    trigger_log_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    workflow_run_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    agentflow_run_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    agentflow_node_run_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    conversation_key: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(128), nullable=True)
    runtime_agent_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # P0-08: 每 Session 内部 Tool 回调令牌（sha256 hex）。运行时持原文，
    # 平台只存哈希——共享 MTC_INTERNAL_TOKEN 仅是传输门，会话令牌才绑定
    # user/agent/session/release/工具清单。
    session_token_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # g062（Group Spec §3.1/§4.4）：群会话反链，仅 trigger_kind='group' 行非空
    group_session_id: Mapped[str | None] = mapped_column(
        String(32), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AutomationDefinition(Base):
    """自动任务定义：何时/何事件/何输入触发哪个目标（不含执行器）。"""
    __tablename__ = "automation_definition"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(64))
    description: Mapped[str] = mapped_column(Text, default="")
    target_kind: Mapped[str] = mapped_column(String(16))  # agent|workflow|agentflow
    agent_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    workflow_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    workflow_version_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    agentflow_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    agentflow_release_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    group_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    session_policy: Mapped[str] = mapped_column(String(16), default="fresh")
    # fresh|stateful|conversation
    prompt_template: Mapped[str] = mapped_column(Text, default="")
    input_mapping: Mapped[dict] = mapped_column(JSONB, default=dict)
    max_runs: Mapped[int | None] = mapped_column(Integer, nullable=True)
    deadline: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    runtime_schedule_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # P0-03: the Agent Release the runtime Schedule is pinned to (model+params
    # come from this release's frozen snapshot; republish → rebuild on next sync)
    runtime_release_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    last_auto_fire_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    auto_run_count: Mapped[int] = mapped_column(Integer, default=0)
    last_auto_status: Mapped[str | None] = mapped_column(String(16), nullable=True)
    created_by: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class AutomationTrigger(Base):
    """自动任务的触发方式（最多五个）：定时/API/事件/轮询。"""
    __tablename__ = "automation_trigger"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    automation_id: Mapped[str] = mapped_column(String(32), index=True)
    kind: Mapped[str] = mapped_column(String(16))  # schedule|api|event|polling
    config: Mapped[dict] = mapped_column(JSONB, default=dict)
    # schedule: {cron, timezone}; event/polling: {data_source_id, filter, mapping}
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AutomationApiKey(Base):
    """API 触发凭据（哈希存储；非 QoderWake atk_ 形态）。"""
    __tablename__ = "automation_api_key"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    automation_id: Mapped[str] = mapped_column(String(32), index=True)
    key_hash: Mapped[str] = mapped_column(String(128), unique=True)
    label: Mapped[str] = mapped_column(String(64), default="")
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AutomationTriggerLog(Base):
    """AutomationInvocation 持久化（F2，Spec §7）：一次触发的权威业务事实。

    表名沿用 automation_trigger_log（无损迁移留待后续）；DTO 只暴露 target 联合形状。
    状态机：received→(deduped|rejected|accepted→queued→running→completed|failed|cancelled)。
    """
    __tablename__ = "automation_trigger_log"
    __table_args__ = (
        Index("uq_triggerlog_idem", "automation_id", "idempotency_key",
              unique=True, postgresql_where=text("idempotency_key IS NOT NULL")),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    automation_id: Mapped[str] = mapped_column(String(32), index=True)
    trigger_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    source: Mapped[str] = mapped_column(String(16))  # manual|schedule|api|event|test（polling 归一 event）
    idempotency_key: Mapped[str | None] = mapped_column(String(128), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="received", index=True)
    # received|accepted|queued|running|completed|failed|cancelled|deduped|rejected
    session_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    workflow_run_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    agentflow_run_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    payload_sha: Mapped[str | None] = mapped_column(String(64), nullable=True)
    conversation_key: Mapped[str | None] = mapped_column(String(128), nullable=True)
    budget_snapshot: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    usage_summary: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    target_kind: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # agent_session|agentflow_run|workflow_run
    target_ref: Mapped[str | None] = mapped_column(String(64), nullable=True)
    attempt: Mapped[int] = mapped_column(Integer, default=1)
    retry_of_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    queued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(48), nullable=True)
    error_detail: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    cancel_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    input: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class EventDelivery(Base):
    """Per-route delivery record for an inbound event: independent retry/dead-letter.

    One DataSourceEvent fans out to N EventDelivery records (one per matched
    EventRoute / legacy AutomationTrigger).  Each delivery carries its own
    attempts counter, retry schedule, and terminal status — so one failed
    target doesn't poison the whole event.

    F5（Spec §10.2.1）：trigger_id/automation_id/trigger_log_id 为兼容列，
    route 投递可空（目的地走 destination_kind/destination_id）。
    """
    __tablename__ = "event_delivery"
    __table_args__ = (
        # NULL 不参与唯一冲突（PG 语义）：route 投递无 trigger_id，去重走 dedupe_scope
        UniqueConstraint("event_id", "trigger_id", name="uq_event_trigger"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    event_id: Mapped[str] = mapped_column(String(32), index=True)
    trigger_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    automation_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    source: Mapped[str] = mapped_column(String(16), default="event")
    status: Mapped[str] = mapped_column(String(16), default="pending")
    # pending | running | completed | failed | dead
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3)
    next_retry_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    dead_reason: Mapped[str] = mapped_column(Text, default="")
    error: Mapped[str] = mapped_column(Text, default="")
    trigger_log_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # F5（Spec §10.2.1）：唯一目的地字段组。pending/running 阶段两个结果引用可空；
    # completed 后满足 XOR：automation→invocation_id，analysis_task→task_run_id。
    route_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    route_revision: Mapped[int | None] = mapped_column(Integer, nullable=True)
    destination_kind: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # automation|analysis_task；旧行经 trigger_id/automation_id 兼容读取
    destination_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    invocation_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    task_run_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    completion_policy: Mapped[str] = mapped_column(String(16), default="accepted")
    # accepted=派发受理即完成；terminal=目标执行终态才完成（Spec §10.2）
    mapped_input: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # 创建时冻结的 mapping 产物：retry 不随 route 编辑漂移（Spec §10.0 版本规则）
    dedupe_scope: Mapped[str | None] = mapped_column(String(160), nullable=True, index=True)
    # route 级去重：f"{route_id}:{dedupe.keyPath 提取值}"，窗口见 route.dedupe
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class EventRoute(Base):
    """EventRoute（F5，Spec §10.0）：某类来源事件满足条件后送往哪里的唯一逻辑契约。

    destination XOR：automation | analysis_task（一 route 一目的地，不双发）。
    revision 随 PUT 递增；delivery 创建时冻结 route_id+route_revision+mapped_input；
    DELETE = 归档语义（enabled=false + archived=true），历史 delivery 仍可追踪。
    兼容期：automation_trigger(kind=event|polling) 仍是 destination=automation 的
    AS-IS 存储，统一 DTO 视图由 /api/v2/event-routes 投影（origin 字段区分）。
    """
    __tablename__ = "event_route"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    source_id: Mapped[str] = mapped_column(String(32), index=True)  # DataSource.id（无FK，源可先删）
    event_type: Mapped[str] = mapped_column(String(64), default="")  # 空=匹配该源全部事件
    destination_kind: Mapped[str] = mapped_column(String(16))  # automation|analysis_task
    destination_id: Mapped[str] = mapped_column(String(32), index=True)
    filter: Mapped[dict] = mapped_column(JSONB, default=dict)
    # {version:1, expression:{field,op,value}}；expression 为空 = 不过滤
    mapping: Mapped[dict] = mapped_column(JSONB, default=dict)  # {version:1, fields:{k: path}}
    dedupe: Mapped[dict] = mapped_column(JSONB, default=dict)  # {keyPath, windowSeconds}
    completion_policy: Mapped[str] = mapped_column(String(16), default="accepted")
    # accepted|terminal（Spec §10.2）
    retry_policy: Mapped[dict] = mapped_column(JSONB, default=dict)
    # {maxAttempts, backoff, maxDelaySeconds}；空 = 平台默认 3 次指数退避
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    created_by: Mapped[str] = mapped_column(String(64), default="dev")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class AgentFlowDefinition(Base):
    """AgentFlow 产品定义（运行归 AgentScope Pipeline/Agent 原语）。"""
    __tablename__ = "agentflow_definition"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(64))
    description: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class AgentFlowVersion(Base):
    """AgentFlow 不可变版本：节点/边/输入契约/汇总 schema。"""
    __tablename__ = "agentflow_version"
    __table_args__ = (UniqueConstraint("definition_id", "version_no", name="uq_agentflow_version_no"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    definition_id: Mapped[str] = mapped_column(String(32), index=True)
    version_no: Mapped[int] = mapped_column(Integer)
    definition: Mapped[dict] = mapped_column(JSONB, default=dict)
    content_digest: Mapped[str] = mapped_column(String(64), default="")
    created_by: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AgentFlowRelease(Base):
    """AgentFlow 发布：允许新执行的版本指针。"""
    __tablename__ = "agentflow_release"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    version_id: Mapped[str] = mapped_column(String(32), index=True)
    # P0-05/P0-06: denormalized definition pointer — enables the DB-level
    # "one active release per (definition, environment)" unique index
    definition_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    environment: Mapped[str] = mapped_column(String(16), default="prod")
    status: Mapped[str] = mapped_column(String(16), default="active")  # active|stopped
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AgentFlowRun(Base):
    """AgentFlow 一次执行（节点 Session 归 AgentScope）。"""
    __tablename__ = "agentflow_run"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    release_id: Mapped[str] = mapped_column(String(32), index=True)
    trigger_kind: Mapped[str] = mapped_column(String(16), default="manual")
    status: Mapped[str] = mapped_column(String(16), default="queued")
    # queued|running|succeeded|failed|cancelled
    input: Mapped[dict] = mapped_column(JSONB, default=dict)
    output: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    error: Mapped[str] = mapped_column(Text, default="")
    automation_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    parent_session_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # P0-08: flow-run 级内部 Tool 回调令牌哈希（节点 Session 由运行时创建，
    # 平台无法逐 Session 发令牌；令牌绑定整个 run，运行时为每个节点 Session 登记）
    run_token_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AgentFlowNodeRun(Base):
    """AgentFlow 节点一次尝试：绑定 AgentScope Session 与输入版本（重跑决策依据）。"""
    __tablename__ = "agentflow_node_run"
    __table_args__ = (UniqueConstraint("run_id", "node_id", "attempt", name="uq_agentflow_node_attempt"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    run_id: Mapped[str] = mapped_column(String(32), index=True)
    node_id: Mapped[str] = mapped_column(String(64))
    attempt: Mapped[int] = mapped_column(Integer, default=1)
    agent_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    session_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(16), default="running")
    input: Mapped[dict] = mapped_column(JSONB, default=dict)
    input_version: Mapped[int] = mapped_column(Integer, default=1)
    output: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    error: Mapped[str] = mapped_column(Text, default="")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class DataSource(Base):
    """外部数据源：连接/订阅/游标/健康（与自动任务定义解耦）。"""
    __tablename__ = "data_source"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(64))
    kind: Mapped[str] = mapped_column(String(16))  # webhook|polling|test_event
    config: Mapped[dict] = mapped_column(JSONB, default=dict)
    auth_token_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # g067（15 号稿 P0 W1–W3）：可选 HMAC 签名密钥（kms 信封加密）；配置后才验签
    signing_secret_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="active")  # active|paused|error
    # 09-14 D3 拍板：删除=归档语义（事件/路由流水可追溯；被引用时 409 列清单）
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    # 09-14 类型体系：非 webhook 类型凭据加密存储（飞书 app_id/app_secret、
    # MaxCompute AccessKey、API 拉取 bearer/apikey/basic）；config 只放非敏感参数。
    # D5：凭据正主是 Connection——connection_id 设置后本列仅兼容保留（迁移期双写）
    secret_ref: Mapped[str | None] = mapped_column(String(512), nullable=True)
    # D5（09-14 拍板连接统一）：凭据/端点引用 Connection；表/日志库引用 DataAsset
    connection_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    asset_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    cursor: Mapped[dict] = mapped_column(JSONB, default=dict)
    last_poll_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # 09-15 g061（16 号稿 B1）：拉取健康三列——概览带失败原因/自动拉取诊断；
    # tick 双路写（成功清零/失败留证），修「失败消息随 502 丢弃」缺口
    last_poll_error: Mapped[str] = mapped_column(Text, default="")
    last_poll_ok: Mapped[bool] = mapped_column(Boolean, default=True)
    last_poll_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class DataSourceEvent(Base):
    """入站事件：去重/过滤/映射/派发/死信全状态。"""
    __tablename__ = "data_source_event"
    __table_args__ = (UniqueConstraint("source_id", "dedupe_key", name="uq_source_dedupe"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    source_id: Mapped[str] = mapped_column(String(32), index=True)
    dedupe_key: Mapped[str] = mapped_column(String(128))
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    status: Mapped[str] = mapped_column(String(16), default="received")
    # received|filtered|dispatched|partial_failed|failed|dead
    automation_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    dispatch_ref: Mapped[str | None] = mapped_column(String(64), nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str] = mapped_column(Text, default="")
    # F5（AC-023/024）：逐 route 流水证据 [{routeId, revision, result, deliveryId?}]，
    # result ∈ delivered|filtered|deduped|failed|dead|route_disabled，filtered/deduped
    # 不产生 delivery 行，证据只存在这里
    route_outcomes: Mapped[list] = mapped_column(JSONB, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


# ---------------------------------------------------------------------------
# Group（多 Agent 群聊协作组）—— docs/product-domain/group-capability-spec.md
# v1.1 APPROVED（g062group0001）。定义真源在平台；运行时 team 花名册在
# AgentScope 官方 teams 表（TeamRecord.members 仅 worker，leader 经
# TeamRecord.session_id/leader_agent_id 标识）。
# ---------------------------------------------------------------------------


class AgentGroup(Base):
    """群定义：恰一位 Leader + 成员（含 Leader 共 1..5，不变量 1/2）。"""
    __tablename__ = "agent_group"
    __table_args__ = (
        CheckConstraint("char_length(name) <= 20", name="ck_agent_group_name_len"),
        CheckConstraint("char_length(name) > 0", name="ck_agent_group_name_nonempty"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(20))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    leader_agent_id: Mapped[str] = mapped_column(String(32), index=True)
    avatar: Mapped[str | None] = mapped_column(Text, nullable=True)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    # g063：成员协作 SOP 绑定指针（原子替换；仅可绑 published，Spec §3.1）
    sop_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class AgentGroupMember(Base):
    """群成员行：role ∈ leader|member；uq(group,agent)；config=每成员覆盖。"""
    __tablename__ = "agent_group_member"
    __table_args__ = (
        CheckConstraint("role in ('leader', 'member')", name="ck_agent_group_member_role"),
        UniqueConstraint("group_id", "agent_id", name="uq_group_member"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    group_id: Mapped[str] = mapped_column(String(32), index=True)
    agent_id: Mapped[str] = mapped_column(String(32), index=True)
    role: Mapped[str] = mapped_column(String(8))
    # {chat_model_config?, knowledge_ids?}（D3：响应模型+知识挂载，无工作目录假字段）
    config: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class AgentGroupSession(Base):
    """群会话（UI 文案「任务」）=一个 AgentScope team 实例；closed 只读不解散。"""
    __tablename__ = "agent_group_session"
    __table_args__ = (
        CheckConstraint(
            "status in ('active', 'closed', 'failed')",
            name="ck_agent_group_session_status"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    group_id: Mapped[str] = mapped_column(String(32), index=True)
    title: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(8), default="active")
    leader_session_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    runtime_team_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # 开聊时冻结：{agent_id:{runtime_agent_id, frozen_model_id/params, knowledge_ids}}
    binding_snapshot: Mapped[dict] = mapped_column(JSONB, default=dict)
    # g064：回合预算（不变量 10；team turn=用户发言回合）
    turn_count: Mapped[int] = mapped_column(Integer, default=0)
    max_team_turns: Mapped[int] = mapped_column(Integer, default=60)
    closed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AgentGroupSessionMember(Base):
    """群会话成员 session 映射（聚合 SSE 与投影用）。"""
    __tablename__ = "agent_group_session_member"
    __table_args__ = (
        UniqueConstraint("group_session_id", "agent_id", name="uq_group_session_member"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    group_session_id: Mapped[str] = mapped_column(String(32), index=True)
    agent_id: Mapped[str] = mapped_column(String(32))
    session_id: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AgentGroupSkill(Base):
    """群技能挂载（g063）：装配时逐成员 session 上传 SKILL.md 进 workspace。"""
    __tablename__ = "agent_group_skill"
    __table_args__ = (UniqueConstraint("group_id", "skill_id", name="uq_group_skill"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    group_id: Mapped[str] = mapped_column(String(32), index=True)
    skill_id: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AgentGroupSop(Base):
    """成员协作 SOP（g063）：版本化群协作规则；published 行只读（不可变发布）。"""
    __tablename__ = "agent_group_sop"
    __table_args__ = (
        CheckConstraint("status in ('draft', 'published')",
                        name="ck_agent_group_sop_status"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    group_id: Mapped[str] = mapped_column(String(32), index=True)
    name: Mapped[str] = mapped_column(String(64))
    content_md: Mapped[str] = mapped_column(Text, default="")
    revision: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(16), default="draft")
    published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow)
