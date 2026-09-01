/**
 * 全局状态语义 token（Implementation Spec §2.1）。
 * 颜色由主题变量管理，组件不硬编码 hex。
 */
export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger"

export interface ListParams {
  search?: string
  page?: number
  pageSize?: number
  sort?: string
  filters?: string
  tab?: string
}

export interface ListResponse<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

/** 业务语义主数据（Master §10.1）。 */
export interface BusinessContext {
  brand: string
  productCategory: string
  serviceType: string
  issueTopic: string
}

/** 组织人员快照（Master §10.3）。 */
export interface OrgSnapshot {
  agentId: string
  agentName: string
  teamId: string
  teamName: string
  departmentId: string
  departmentName: string
}

/** 对话证据：ASR 片段（Design Spec §11.4，不使用聊天气泡）。 */
export interface TranscriptSegment {
  id: string
  speaker: "consumer" | "agent" | "system"
  speakerLabel: string
  startSeconds: number
  text: string
  /** 引用该片段的评价项 id，用于证据高亮与双向定位。 */
  criterionRefs?: string[]
}

/** 评价项（Criterion）结果。 */
export interface CriterionResult {
  id: string
  section: string
  criterion: string
  result: "PASS" | "FAIL" | "N/A"
  severity?: "Critical" | "High" | "Medium" | "Low"
  reason?: string
  /** Conversation 证据片段 id。 */
  evidenceSegmentIds?: string[]
  /** 业务证据引用。 */
  businessEvidenceIds?: string[]
  confidence?: number
  /** 人工复核修正。 */
  human?: {
    result?: "PASS" | "FAIL" | "N/A"
    comment?: string
  }
}

export interface ReviewState {
  status: "NONE" | "PENDING" | "IN_REVIEW" | "COMPLETED" | "REOPENED"
  reviewer?: string
  reviewedAt?: string
}

/** Quality Result：面向业务消费、证据、复核与运营的质量记录（Master §12）。 */
export interface QualityResult {
  /** 后端主键（多条结果可共享 interactionId，行 key/跳转须用它） */
  id?: string
  interactionId: string
  interactionTime: string
  durationSeconds?: number
  org: OrgSnapshot
  businessContext: BusinessContext
  requestType: string
  requestSummary: string
  /** 派生结果（Derived Result）。 */
  score?: number
  risk?: "Critical" | "High" | "Medium" | "Low"
  critical: boolean
  issueCount: number
  issueSummary?: string
  review: ReviewState
  hasAudio: boolean
  /** 执行信息（与业务质量严格分离）。 */
  execution: {
    runId: string
    taskId: string
    status: "SUCCESS" | "ERROR" | "SKIPPED"
    agentVersion: string
  }
}

export interface QualityResultDetail extends QualityResult {
  transcript: TranscriptSegment[]
  sections: {
    section: string
    criteria: CriterionResult[]
  }[]
  businessFacts: BusinessFact[]
}

/** 业务事实（Design Spec §11.7，按业务对象组织，不是原始 JSON）。 */
export interface BusinessFact {
  id: string
  kind: "service-request" | "reminder" | "action" | "timeline" | "tool-fact"
  title: string
  fields: { label: string; value: string }[]
  usedByCriterionIds?: string[]
}

/** Evaluation Agent。 */
export interface EvaluationAgent {
  id: string
  name: string
  description: string
  currentVersion: string
  status: "Draft" | "Testing" | "Published" | "Deprecated"
  updatedAt: string
  updatedBy: string
}

export interface AgentVersionInfo {
  version: string
  status: "Draft" | "Published" | "Deprecated"
  publishedAt?: string
  publishedBy?: string
  versionNote?: string
  /** 09 P0-B4：工作流版本真实 ID（任务 pinned 策略绑定用） */
  versionId?: string
}

/** 通用 Node 家族（Master §8.3）：Node Type 通用化，Node Instance 业务化。 */
export type AgentNodeKind =
  | "input"
  | "llm"
  | "tool"
  | "transform"
  | "condition"
  | "router"
  | "human-interrupt"
  | "create-record"
  | "notification"
  | "end"

export interface AgentNodeDef {
  id: string
  kind: AgentNodeKind
  name: string
  description?: string
  position: { x: number; y: number }
  config: Record<string, unknown>
}

export interface AgentEdgeDef {
  id: string
  source: string
  target: string
  sourceHandle?: string
  label?: string
}

export interface AgentDetail extends EvaluationAgent {
  moduleKey?: string
  requiresRuleVersion?: boolean
  inputSchema: {
    key: string
    type: "String" | "Number" | "Boolean" | "DateTime" | "Object" | "Array"
    required: boolean
    description?: string
  }[]
  structuredOutputs: { name: string; description: string; schema: string }[]
  versions: AgentVersionInfo[]
  graph: { nodes: AgentNodeDef[]; edges: AgentEdgeDef[] }
  lastTestPassed: boolean
  changedSinceTest: boolean
}

/** Tool。 */
export interface Tool {
  id: string
  name: string
  description: string
  source: "API" | "Built-in"
  capability: "READ" | "WRITE" | "ACTION"
  governance: "Enabled" | "Disabled" | "Deprecated"
  currentVersion: string
  versionStatus: "Draft" | "Published"
  connectionId?: string
  connectionName?: string
  requiresApproval: boolean
  updatedAt: string
  lastTestPassed?: boolean
}

export interface ToolVersionInfo {
  version: string
  status: "Draft" | "Published"
  publishedAt?: string
  versionNote?: string
}

export interface ToolContractField {
  name: string
  type: "String" | "Number" | "Boolean" | "DateTime" | "Object" | "Array"
  required: boolean
  location: "Path" | "Query" | "Header" | "Body"
  requestKey: string
}

export interface ToolDetail extends Tool {
  http: {
    method: "GET" | "POST" | "PUT" | "DELETE"
    path: string
    headers: { key: string; value: string }[]
    queryParams: { key: string; value: string }[]
    body?: string
  }
  inputContract: ToolContractField[]
  outputContract: { name: string; type: string; description?: string }[]
  versions: ToolVersionInfo[]
  permission: string
}

/** Data Asset。 */
export interface DataAsset {
  id: string
  name: string
  description: string
  source: string
  recordMeaning: string
  recordIdField: string
  timeField: string
  timeFieldLabel: string
  lifecycle: "Draft" | "Ready" | "Deprecated"
  health: "Healthy" | "Degraded" | "Error"
  currentRevision: number
  updatedAt: string
  schema: DataAssetField[]
  eligibility: string[]
}

export interface DataAssetField {
  key: string
  displayName: string
  type: "String" | "Number" | "Boolean" | "DateTime" | "Object" | "Array"
  description?: string
  required: boolean
}

export interface DataAssetRevisionInfo {
  revision: number
  status: "Ready" | "Draft" | "Deprecated"
  updatedAt: string
  note?: string
}

/** Analysis Task。 */
export interface AnalysisTask {
  id: string
  name: string
  description?: string
  agentId: string
  agentName: string
  agentVersionPolicy: "Latest Published" | "Fixed"
  fixedAgentVersion?: string
  dataAssetId: string
  dataAssetName: string
  scope: string
  sampling: string
  schedule: string
  dataWindow: string
  status: "Active" | "Inactive"
  lastRun?: {
    runId: string
    status: RunStatus
    finishedAt?: string
  }
  nextRunAt?: string
  updatedAt: string
}

export type RunStatus =
  | "PENDING"
  | "RUNNING"
  | "SUCCESS"
  | "PARTIAL_SUCCESS"
  | "FAILED"
  | "CANCELLED"
  | "BLOCKED"
  | "PAUSED"

/** Run：Task 的一次真实执行，冻结当次实际依赖（Master §14）。 */
export interface Run {
  id: string
  taskId: string
  taskName: string
  status: RunStatus
  startedAt: string
  finishedAt?: string
  duration?: string
  /** E-3.2 重试谱系：上游来源与下游派生 */
  originRunId?: string
  retryChildren?: { runId: string; status: string; createdAt: string }[]
  /** R-Archive：旧 Agent Run 标识（运行详情据此隐藏重试入口） */
  agentId?: string
  dataWindow: { start: string; end: string; label: string }
  snapshot: {
    agentName: string
    agentVersion: string
    dataAssetName: string
    dataAssetRevision: number
    resultRulesVersion?: string
    scope: string
    sampling: string
    runtime: string
    toolVersions: { toolName: string; version: string }[]
    inputMapping: { agentInput: string; assetField: string }[]
  }
  summary: {
    input: number
    success: number
    skipped: number
    error: number
  }
  errors?: { type: string; count: number }[]
  blockedReason?: string
}

export type ExecutionStatus = "SUCCESS" | "ERROR" | "SKIPPED"

export interface InteractionExecution {
  id: string
  runId: string
  interactionId: string
  agentName: string
  teamName: string
  businessContext: BusinessContext
  status: ExecutionStatus
  /** 业务质量结果（与执行状态分离）。 */
  risk?: "Critical" | "High" | "Medium" | "Low"
  score?: number
  duration?: string
  errorType?: string
  attempts: { no: number; status: ExecutionStatus; error?: string }[]
}

/** Result Rules：独立质量业务配置资产（Master §28.13）。 */
export interface ResultRuleSet {
  id: string
  name: string
  description: string
  agentId: string
  agentName: string
  currentVersion: string
  versionStatus: "Draft" | "Published"
  evaluationPriority: "Most Recent Completed" | "Initial Completed"
  updatedAt: string
}

export interface ResultRuleSetDetail extends ResultRuleSet {
  scoreRules: {
    id: string
    criterion: string
    resultType: string
    scoringRule: string
    weight: number
  }[]
  overall: { rule: string; passLine: number }
  criticalRules: { id: string; condition: string; effect: string }[]
  riskMapping: { id: string; condition: string; risk: string }[]
  levels: { id: string; range: string; level: string }[]
  derivedLabels: { id: string; condition: string; label: string }[]
  versions: RuleSetVersionInfo[]
}

export interface RuleSetVersionInfo {
  version: string
  status: "Draft" | "Published"
  publishedAt?: string
  publishedBy?: string
  versionNote?: string
}

/** Connection：endpoint + auth（Master §28.7）。 */
export interface Connection {
  id: string
  name: string
  endpoint: string
  authType: "None" | "API Key" | "Bearer Token" | "Basic Auth"
  secretConfigured: boolean
  requiredHeaders?: string[]
  status: "Connected" | "Failed" | "Not Tested" | "Testing"
  updatedAt: string
}
