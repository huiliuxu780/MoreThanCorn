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

export interface AnalysisTaskDTO {
  id: string
  name: string
  description: string
  workflowId: string
  workflowVersionPolicy: WorkflowVersionPolicy | string
  dataAssetId: string
  dataDefinitionId: string | null
  status: TaskStatus | string
  taskVersion: TaskVersionDTO | null
  executionTarget?: ExecutionTargetDTO | null
}

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
