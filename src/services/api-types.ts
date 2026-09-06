/** 09-SDD P0-B4：业务 API 显式 DTO 类型（禁止无边界 Record<string, any>）。
 * 与 server/app/routers 返回结构一一对应；契约测试见 src/services/__tests__。 */

/* ---------- Task 领域（09 §9.1/§9.2/§9.4） ---------- */

export type TaskStatus = "draft" | "active" | "paused" | "archived"
export type WorkflowVersionPolicy = "pinned" | "latest_published"

export interface TaskScopeCondition {
  field: string
  op: string
  value: unknown
}

export interface TaskScopeDTO {
  op?: "and" | "or"
  conditions?: TaskScopeCondition[]
  mode?: string
  expr?: string
}

export interface TaskSamplingDTO {
  mode: "all" | "count" | "random" | "legacy"
  count?: number
  percent?: number
  expr?: string
}

export interface TaskWindowDTO {
  mode: "all" | "relative" | "fixed" | "legacy"
  value?: string
  timezone?: string
  start?: string
  end?: string
  expr?: string
}

/** R7-1/R8-UI：统一执行目标契约（agent|workflow）。 */
export interface ExecutionTargetDTO {
  type: "agent" | "workflow"
  agentId?: string | null
  workflowId?: string | null
  versionPolicy?: string | null
  pinnedAgentVersionId?: string | null
  pinnedWorkflowVersionId?: string | null
}

/** SDD 13 §8.1：OutputBinding 通用契约（target_table / platform_only）。 */
export interface OutputBindingDTO {
  mode: "platform_only" | "target_table"
  assetId?: string | null
  assetName?: string | null
  definitionVersionId?: string | null
  writeMode?: "append" | "upsert"
  keyFields?: string[]
  mapping?: Record<string, string>
  failurePolicy?: string
  validatedAt?: string | null
  schemaFingerprint?: string | null
}

export interface OutputSchemaRefDTO {
  ref: string
  sha256?: string | null
}

export interface TaskVersionDTO {
  id: string
  versionNo: number
  workflowId: string
  workflowVersionPolicy: WorkflowVersionPolicy
  pinnedWorkflowVersionId: string | null
  executionTarget?: ExecutionTargetDTO | null
  dataAssetId: string
  dataDefinitionVersionId: string | null
  resultRuleVersionId: string | null
  inputMapping: Record<string, string>
  scope: TaskScopeDTO
  sampling: TaskSamplingDTO
  dataWindow: TaskWindowDTO
  outputSchemaVersion: string
  outputSchemaVersionId: string | null
  outputSchema?: OutputSchemaRefDTO | null
  outputBinding?: OutputBindingDTO | null
  note: string
  createdBy: string
  createdAt: string
}

/** MTC-002A：自主任务状态（产品名自主任务；持久层仍为 AnalysisTask）。 */
export type AutomationDefinitionStatus = "draft" | "active" | "paused" | "archived"

export interface AutomationInputConfigDTO {
  dataAssetId: string
  dataDefinitionVersionId?: string | null
  scope?: Record<string, unknown>
  sampling?: Record<string, unknown>
  dataWindow?: Record<string, unknown>
  inputMapping?: Record<string, string>
}

export interface AutomationScheduleConfigDTO {
  id: string
  name?: string | null
  cron: string
  timezone: string
  enabled: boolean
  nextRunAt: string | null
}

export interface AutomationExecutionConfigDTO {
  executionTarget?: ExecutionTargetDTO | null
  outputMode?: string | null
  outputAssetId?: string | null
  outputWriteMode?: string | null
  outputFailurePolicy?: string | null
  outputKeyFields?: string[]
  outputMapping?: Record<string, string>
}

/**
 * MTC-002A-R：canonical DTO——只描述 /api/automations 的真实响应。
 * nullability 以后端 automation_dtos.automation_definition_dto 实际输出为准：
 * agent 型任务 workflowId=null；workflowVersionId 仅 pinned 策略有值；
 * 不含任何 legacy-only 字段（taskVersion/workflowVersionPolicy/dataAssetId/dataDefinitionId）。
 */
export interface AutomationDefinitionDTO {
  id: string
  name: string
  description: string
  status: AutomationDefinitionStatus | string
  agentId: string | null
  workflowId: string | null
  workflowVersionId: string | null
  inputConfig: AutomationInputConfigDTO
  scheduleConfig: AutomationScheduleConfigDTO | null
  executionConfig: AutomationExecutionConfigDTO
  createdAt: string | null
  updatedAt: string | null
  createdBy: string | null
  version: number | null
}

/**
 * MTC-002A-R：legacy DTO——描述 /api/tasks 真实响应（列表投影 + 详情快照的并集）。
 * 列表独有：executionTarget/executionTargetType/agentName/moduleKey/currentVersionNo/lastTaskRun/schedule；
 * 详情独有：taskVersion。optional/nullable 以实际响应为准。
 */
export interface LegacyAnalysisTaskDTO {
  id: string
  name: string
  description: string
  workflowId: string | null
  workflowVersionPolicy: WorkflowVersionPolicy | string
  dataAssetId: string
  dataDefinitionId: string | null
  scope: Record<string, unknown> | string
  sampling: Record<string, unknown> | string
  dataWindow: Record<string, unknown> | string
  status: TaskStatus | string
  executionTarget?: ExecutionTargetDTO | null
  executionTargetType?: string
  agentName?: string | null
  moduleKey?: string | null
  currentVersionNo?: number | null
  lastTaskRun?: { id: string; status: string; createdAt: string } | null
  schedule?: Record<string, unknown> | string
  taskVersion?: TaskVersionDTO | null
  /** MTC-004：调度摘要与最近活动（后端 list_tasks 附加；缺失为 null） */
  scheduleSummary?: { cron: string; timezone: string; enabled: boolean; nextRunAt: string | null } | null
  lastActivityAt?: string | null
  createdAt?: string | null
  updatedAt?: string | null
}

/** @deprecated Use AutomationDefinitionDTO for /api/automations；/api/tasks 用 LegacyAnalysisTaskDTO */
export type AnalysisTaskDTO = LegacyAnalysisTaskDTO

export interface TaskRunDTO {
  id: string
  taskId: string
  taskVersionId: string
  dataSnapshotId: string | null
  trigger: string
  scheduleFireKey: string | null
  idempotencyKey: string | null
  status: "queued" | "running" | "partial" | "succeeded" | "failed" | "cancelled"
  total: number
  succeeded: number
  failed: number
  skipped: number
  cancelled: number
  /** R7-5：冻结快照（AgentVersion/Release/Provider） */
  resolvedAgentVersionId?: string | null
  resolvedReleaseId?: string | null
  runtimeBinding?: { providerId?: string; providerKind?: string } | null
  /** SDD 13 §8.3：execution 与 delivery 两块 */
  execution?: { status: string; total: number; succeeded: number; failed: number; skipped: number; cancelled: number }
  delivery?: { status: string; pending: number; succeeded: number; failed: number; targetAssetId?: string | null }
  errorSummary: { errors: { interactionRef?: string; row?: number; error: string }[] } | null
  startedAt: string | null
  endedAt: string | null
  createdAt: string
}

export interface TaskRunRunDTO {
  id: string
  status: string
  interactionRef: string
  attempt: number
  workflowVersionId: string | null
  taskRunId: string | null
  taskId: string | null
  error: { message: string } | null
  startedAt: string | null
  endedAt: string | null
  durationMs: number | null
}

export interface TaskRunResultDTO {
  id: string
  runId: string | null
  interactionRef: string
  taskId: string | null
  taskRunId: string | null
  workflowVersionId: string | null
  ruleVersionId: string | null
  outputSchemaVersionId: string | null
  score: number | null
  risk: string | null
  review: string
  isLatest: boolean
}

/* ---------- Result Rules（09 §6.6） ---------- */

export interface ResultRuleSetDTO {
  id: string
  name: string
  description?: string
  agentId?: string
  currentVersion: string
  versionStatus: string
  evaluationPriority: string
  updatedAt: string
}

export interface ResultRuleDetailDTO {
  id: string
  name: string
  description?: string
  version: number
  status: "draft" | "published"
  rules: { scoreRules?: unknown[]; issueRules?: unknown[] } & Record<string, unknown>
  versions: { id: string; versionNo: number; rules: Record<string, unknown>; createdAt: string }[]
}

export interface ResultRuleVersionDTO {
  id: string
  versionNo: number
  rules: Record<string, unknown>
  evaluationPriority: string
  createdBy: string
  createdAt: string
}

/* ---------- QualityResult（09 §9.6/§9.7） ---------- */

export interface ReviewRevisionDTO {
  id: string
  revisionNo: number
  action: string
  reason: string
  reviewer: string
  before: { status?: string; score?: number | null; risk?: string | null }
  after: { status?: string; score?: number | null; risk?: string | null }
  createdAt: string
}

export interface QualityResultDetailDTO {
  id: string
  runId: string | null
  interactionId: string
  interactionTime: string
  agentName: string
  structuredOutput: Record<string, unknown>
  score: number | null
  risk: string | null
  critical: boolean
  issueCount: number
  issueSummary: string | null
  review: string
  taskRunId: string | null
  taskId: string | null
  taskVersionId: string | null
  workflowVersionId: string | null
  ruleVersionId: string | null
  outputSchemaVersionId: string | null
  aiResult: Record<string, unknown> | null
  derivedResult: Record<string, unknown> | null
  reviewRevisions: ReviewRevisionDTO[]
  evidence: { id: string; kind: string; locator: Record<string, unknown>; text: string; sourceRef: string }[]
}

export interface QualityResultListDTO {
  id: string
  runId: string | null
  interactionId?: string
  interactionTime: string
  agentName?: string
  score: number | null
  risk: string | null
  critical: boolean
  issueCount: number
  issueSummary: string | null
  review: string
}

/* ---------- 身份（09 P0-10） ---------- */

export interface AuthUserDTO {
  id?: string
  username: string
  role: "admin" | "operator" | "viewer"
  displayName?: string
}

/* ---------- MTC-002B：WorkItemProjection 统一读模型 ---------- */

/** 用户可见主状态（固定五组；顺序即泳道顺序；API 返回稳定 enum，中文由前端映射）。 */
export type WorkItemStatus =
  | "needs_action"
  | "running"
  | "completed"
  | "queued"
  | "failed_cancelled"

export type WorkItemPhase =
  | "scheduled"
  | "queued"
  | "executing"
  | "result_processing"
  | "done"
  | "failed"
  | "cancelled"
  | "attention"

export interface WorkItemAttention {
  required: boolean
  code: string | null
  message: string | null
  severity: "warning" | "critical" | null
}

export interface WorkItemDTO {
  id: string
  kind: "task_run" | "schedule_occurrence"
  automationId: string
  taskRunId: string | null
  scheduleOccurrenceId: string | null
  title: string
  description: string | null
  status: WorkItemStatus
  phase: WorkItemPhase
  origin: string
  assignee: {
    type: "agent" | "workflow"
    id: string
    name: string
    avatarUrl?: string | null
  } | null
  progress: {
    total: number
    completed: number
    succeeded: number
    failed: number
    skipped: number
    cancelled: number
    percent: number | null
  }
  attention: WorkItemAttention
  scheduledAt: string | null
  createdAt: string | null
  updatedAt: string | null
  startedAt: string | null
  finishedAt: string | null
  durationMs: number | null
  /** 诊断数据：原始执行/投递/计划状态与冲突码；不作为看板状态展示 */
  diagnostics: {
    executionStatus: string | null
    deliveryStatus: string | null
    occurrenceStatus: string | null
    conflictCodes: string[]
  }
  links: { primary: string; automation: string; taskRun: string | null }
}

export interface WorkItemListResponse {
  items: WorkItemDTO[]
  total: number
  page: number
  pageSize: number
  businessDate: string
  timezone: string
  counts: Record<WorkItemStatus, number>
  /** MTC-002B-R2：服务端截断标记；前端据此显示“加载更多”，不自行猜测 */
  truncated: boolean
}
