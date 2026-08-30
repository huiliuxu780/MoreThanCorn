/** 真实后端客户端（P0）。VITE_WF_API=1 时启用。契约源：server/contracts。 */
import { parseListFilters } from "@/lib/list-filters"

export const WF_BASE = import.meta.env.VITE_WF_API_BASE ?? "http://127.0.0.1:8100"

export interface WfSummary {
  id: string
  name: string
  description?: string
  status: string
  currentVersion: number | null
  updatedAt: string
}

export interface WfListResponse {
  items: WfSummary[]
  total: number
  page: number
  pageSize: number
}

export interface WfInputBinding {
  name: string
  type: string
  source:
    | { kind: "fixed"; value: unknown }
    | { kind: "upstream"; nodeId: string; path: string }
    | { kind: "input" | "state" | "system"; path: string }
}

export interface WfNode {
  id: string
  type: string
  name: string
  config: Record<string, unknown>
  inputs: WfInputBinding[]
  execution?: { timeoutMs?: number; retries?: number; onError?: string }
  branches?: string[]
}

export interface WfEdge {
  id: string
  source: string
  sourceHandle?: string | null
  target: string
}

export interface WfDefinition {
  schemaVersion: "1.0"
  workflow: {
    id: string
    name: string
    status: string
    currentVersionId?: string | null
    draftRevision: number
  }
  graph: { nodes: WfNode[]; edges: WfEdge[] }
  io: { inputSchema: Record<string, unknown>; structuredOutputs: { key: string; schema: Record<string, unknown> }[] }
  triggers?: { manual?: boolean; api?: boolean; scheduleIds?: string[] }
  ui: { positions: Record<string, { x: number; y: number }>; viewport: Record<string, number> }
}

export interface WfDetail {
  id: string
  name: string
  status: string
  draftRevision: number
  definition: WfDefinition
  updatedAt: string
}

export interface ValidationIssue {
  nodeId: string
  kind: "graph" | "unconnected" | "unconfigured" | "dependency"
  message: string
}

export interface ValidationReport {
  ok: boolean
  issues: ValidationIssue[]
}

export interface NodeDefinition {
  type_key: string
  family: string
  label: string
  icon: string
  accent: string
  schema: Record<string, unknown>
  io: Record<string, unknown>
  executor_key: string
  editor_kinds?: ("FLOW" | "GROUP" | "WORKFLOW")[]  // SDD C-2：节点可出现的编排器
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const tok = typeof wfApiToken === "function" ? wfApiToken() : ""
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
  }
  if (init?.headers) Object.assign(headers, init.headers)
  const res = await fetch(`${WF_BASE}${path}`, { ...init, headers })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new ApiError(res.status, `${res.status}: ${JSON.stringify(body?.detail ?? body)}`)
  }
  return res.json() as Promise<T>
}

export const wfApi = {
  list: (params?: { search?: string; page?: number; pageSize?: number }) => {
    const q = new URLSearchParams()
    if (params?.search) q.set("search", params.search)
    if (params?.page) q.set("page", String(params.page))
    if (params?.pageSize) q.set("pageSize", String(params.pageSize))
    return req<WfListResponse>(`/api/workflows?${q}`)
  },
  create: (name: string, description = "") =>
    req<{ id: string; name: string; status: string }>("/api/workflows", {
      method: "POST",
      body: JSON.stringify({ name, description }),
    }),
  get: (id: string) => req<WfDetail>(`/api/workflows/${id}`),
  del: (id: string) => req<{ ok: boolean }>(`/api/workflows/${id}`, { method: "DELETE" }),
  updateMeta: (id: string, p: { name?: string; description?: string; icon?: string | null }) =>
    req<{ ok: boolean }>(`/api/workflows/${id}/meta`, { method: "PUT", body: JSON.stringify(p) }),
  saveDraft: (id: string, definition: WfDefinition, baseRevision: number) =>
    req<{ workflowCode: string; draftVersion: string; savedAt: string }>(
      `/api/workflows/${id}/draft`,
      { method: "PUT", body: JSON.stringify({ definition, baseRevision }) },
    ),
  validate: (id: string) => req<ValidationReport>(`/api/workflows/${id}/validation`),
  /** E-4.3：节点单测（用给定输入执行单节点执行器，不落 Run/事件） */
  nodeTest: (id: string, nodeId: string, input: Record<string, unknown>) =>
    req<{ ok: boolean; output?: unknown; error?: string; durationMs?: number }>(
      `/api/workflows/${id}/node-test`, { method: "POST", body: JSON.stringify({ nodeId, input }) }),
  publish: (id: string, note = "") =>
    req<{ versionId: string; versionNo: number }>(
      `/api/workflows/${id}/publish?note=${encodeURIComponent(note)}`,
      { method: "POST" },
    ),
  versions: (id: string) =>
    req<{ versionId: string; versionNo: number; note: string; publishedAt: string }[]>(
      `/api/workflows/${id}/versions`),
  nodeDefinitions: () => req<NodeDefinition[]>("/api/registry/node-definitions"),
  polish: (text: string) => req<{ text: string }>("/api/workflows/0/polish", {
    method: "POST", body: JSON.stringify({ text }),
  }),
  migrate: (wid: string) => req<{ migrated: boolean; draftRevision: number }>(`/api/workflows/${wid}/migrate`, { method: "POST" }),
  resume: (rid: string, payload: Record<string, unknown>) =>
    req<{ status: string; nodeId: string }>(`/api/runs/${rid}/resume`, { method: "POST", body: JSON.stringify(payload) }),
  models: () => req<{ items: { modelKey: string; capabilities: string[] }[] }>("/api/registry/models").then((r) => r.items ?? []),
}

export const wfEnabled = () => import.meta.env.VITE_WF_API === "1"

/* ---------- P1：Runs ---------- */
export interface RunSummary {
  runId: string
  status: string
  trigger: string
  startedAt: string | null
  durationMs: number | null
  error: { message: string } | null
}
export interface NodeRunInfo {
  nodeRunId: string
  nodeId: string
  nodeType: string
  status: string
  input: Record<string, unknown>
  output: Record<string, unknown> | null
  error: { message: string } | null
  durationMs: number | null
}
export interface RunDetail extends RunSummary {
  input: Record<string, unknown>
  output: Record<string, unknown> | null
  endedAt: string | null
  nodeRuns: NodeRunInfo[]
}

export const runApi = {
  start: (workflowId: string, input: Record<string, unknown>, trigger: "test" | "manual" = "test") =>
    req<{ runId: string; status: string }>("/api/runs", {
      method: "POST",
      body: JSON.stringify({ workflowId, trigger, input }),
    }),
  list: (workflowId: string) => req<RunSummary[]>(`/api/runs?workflowId=${workflowId}`),
  detail: (runId: string) => req<RunDetail>(`/api/runs/${runId}`),
  eventsUrl: (runId: string) => `${WF_BASE}/api/runs/${runId}/events`,
}

/* ---------- P2：Schedules / retry / export / admin ---------- */
export interface ScheduleInfo {
  id: string; name: string; workflowId: string; cron: string; timezone: string;
  enabled: boolean; nextRunAt: string | null; lastRanAt: string | null; failedCount: number
}
export const scheduleApi = {
  list: (workflowId: string) => req<ScheduleInfo[]>(`/api/schedules?workflowId=${workflowId}`),
  create: (workflowId: string, cron: string, timezone = "Asia/Shanghai", enabled = false) =>
    req<{ id: string; nextRunAt: string; enabled: boolean }>("/api/schedules", {
      method: "POST", body: JSON.stringify({ workflowId, cron, timezone, enabled }) }),
  enable: (id: string) => req<{ id: string; enabled: boolean }>(`/api/schedules/${id}/enable`, { method: "POST" }),
  disable: (id: string) => req<{ id: string; enabled: boolean }>(`/api/schedules/${id}/disable`, { method: "POST" }),
  remove: (id: string) => req<{ ok: boolean }>(`/api/schedules/${id}`, { method: "DELETE" }),
  runs: (id: string) => req<{ runId: string; status: string; startedAt: string | null }[]>(`/api/schedules/${id}/runs`),
}
export const runRetry = (runId: string) =>
  req<{ runId: string; originRunId: string }>(`/api/runs/${runId}/retry`, { method: "POST" })
export const runCancel = (runId: string) =>
  req<{ runId: string; status: string }>(`/api/runs/${runId}/cancel`, { method: "POST" })
export const runEventsList = (runId: string) =>
  req<{ items: { sequence: number; type: string; nodeId?: string; at: string; payload: Record<string, unknown> }[] }>(`/api/runs/${runId}/events-list`)
export const runExportUrl = (runId: string) => `${WF_BASE}/api/runs/${runId}/export`
/* E-1.2：服务层补齐，页面零裸 fetch */
export const auditList = (limit = 200) =>
  req<{ items: Record<string, unknown>[] }>(`/api/audit?limit=${limit}`)
export const registrySystemVariables = () =>
  req<{ items: { name: string; label: string }[] }>("/api/registry/system-variables")
export const listDataAssets = () =>
  req<{ items: { id: string; name: string; revision?: number }[] }>("/api/data-assets")

/* ---------- P1：Run Detail 真 API 适配（冻结页 run-detail 复用） ---------- */
import type { ExecutionStatus, InteractionExecution, Run, RunStatus } from "@/domain/types"

const RUN_STATUS: Record<string, RunStatus> = {
  succeeded: "SUCCESS", running: "RUNNING", queued: "PENDING",
  failed: "FAILED", cancelled: "CANCELLED", timed_out: "FAILED",
  paused: "PAUSED",  // 07-SDD §4.17
}
const EX_STATUS: Record<string, ExecutionStatus> = { success: "SUCCESS", failed: "ERROR", skipped: "SKIPPED", running: "SKIPPED", pending: "SKIPPED" }

interface RunDetailRaw {
  runId: string
  status: string
  trigger?: string
  startedAt: string | null
  endedAt: string | null
  durationMs: number | null
  originRunId?: string | null
  retryChildren?: { runId: string; status: string; createdAt: string }[]
  definitionSource?: "draft" | "version" | null
  versionNo?: number | null
  agentId?: string | null
  workflowVersionId?: string | null
  taskRunId?: string | null
  taskId?: string | null
  taskVersionId?: string | null
  interactionRef?: string
  nodeRuns?: {
    nodeRunId: string; nodeId: string; nodeType: string; status: string
    durationMs: number | null; attempt?: number; error?: { message?: string } | null
  }[]
  /* R8-UI：Agent Run 增强块（SDD 10 §15.4 / 11 §7-③） */
  runtime?: {
    providerId?: string | null; provider?: string | null; runtimeVersion?: string | null
    adapterVersion?: string | null; contractVersion?: string | null
    moduleImplementationVersion?: string | null; module?: { key: string; version: string } | null
  } | null
  stages?: { sequence: number; stage: string; name?: string | null; events?: number; durationMs?: number | null }[]
  calls?: {
    kind: string; targetType?: string | null; targetId?: string | null; status?: string | null
    latencyMs?: number | null; tokenUsage?: Record<string, unknown> | null; request?: Record<string, unknown> | null
  }[]
  usage?: Record<string, unknown>
  evidence?: { kind?: string; locator?: string | Record<string, unknown>; text?: string; sourceRef?: string }[]
  quality?: {
    id: string; score: number | null; risk: string | null; critical?: boolean
    issueSummary?: string | null; review?: string | null; structuredOutput?: Record<string, unknown>
  } | null
}

/** R8-UI：Agent Run 增强块透传（RunDetail 三卡/阶段表/CallRecord/派生质检卡）。 */
export interface AgentRunExtras {
  runtime: NonNullable<RunDetailRaw["runtime"]> | null
  stages: NonNullable<RunDetailRaw["stages"]>
  calls: NonNullable<RunDetailRaw["calls"]>
  usage: Record<string, unknown>
  evidence: NonNullable<RunDetailRaw["evidence"]>
  quality: NonNullable<RunDetailRaw["quality"]> | null
}

export async function realRunDetail(runId: string): Promise<{ run: Run; executions: { items: InteractionExecution[]; total: number; page: number; pageSize: number }; agent: AgentRunExtras | null }> {
  const d = await req<RunDetailRaw>(`/api/runs/${runId}`)
  const nodeRuns = d.nodeRuns ?? []
  // 09 P0-08：任务主链 Run 用真实 TaskRun/DataSnapshot 填充，不再占位
  let windowLabel = "-"
  let scopeLabel = "-"
  let samplingLabel = "-"
  let assetLabel = "-"
  let assetRevision = 0
  if (d.taskRunId) {
    const snap = await req<{
      taskId: string
      dataSnapshot: null | { assetId: string; assetRevision: number; resolvedWindow: { mode?: string; value?: string; start?: string; end?: string }; resolvedScope: { conditions?: unknown[] }; resolvedSampling: { mode?: string; count?: number; percent?: number } }
    }>(`/api/task-runs/${d.taskRunId}/snapshot`).catch(() => null)
    if (snap?.dataSnapshot) {
      const ds = snap.dataSnapshot
      const w = ds.resolvedWindow ?? {}
      windowLabel = w.mode === "relative" ? `相对窗口 ${w.value ?? ""}`
        : w.mode === "fixed" ? `${w.start ?? ""} → ${w.end ?? ""}`
        : w.mode === "all" ? "全量" : "-"
      scopeLabel = (ds.resolvedScope?.conditions ?? []).length ? `${ds.resolvedScope?.conditions?.length} 个条件` : "全部"
      const sp = ds.resolvedSampling ?? {}
      samplingLabel = sp.mode === "count" ? `固定 ${sp.count ?? 0} 条`
        : sp.mode === "random" ? `随机 ${sp.percent ?? 0}%`
        : sp.mode === "all" ? "全量" : "-"
      assetLabel = ds.assetId.slice(0, 8)
      assetRevision = ds.assetRevision
    }
  }
  const run: Run = {
    id: d.runId, taskId: d.taskId ?? "-", taskName: "Workflow Run",
    status: RUN_STATUS[d.status] ?? "PENDING",
    startedAt: d.startedAt ?? new Date().toISOString(),
    finishedAt: d.endedAt ?? undefined,
    duration: d.durationMs != null ? `${d.durationMs}ms` : undefined,
    originRunId: d.originRunId ?? undefined,          // E-3.2 重试谱系
    retryChildren: d.retryChildren ?? [],
    agentId: d.agentId ?? undefined,                  // R-Archive：旧 Agent 运行隐藏重试
    dataWindow: { start: "-", end: "-", label: windowLabel },
    snapshot: {
      agentName: "workflow",
      // SDD A-01 验收：可见本次执行的是草稿还是哪个版本
      agentVersion: d.definitionSource === "version" ? `版本 v${d.versionNo ?? "?"}` : d.definitionSource === "draft" ? "草稿" : "-",
      dataAssetName: assetLabel, dataAssetRevision: assetRevision,
      scope: scopeLabel, sampling: samplingLabel, runtime: "fastapi-kernel", toolVersions: [], inputMapping: [],
    },
    summary: {
      input: nodeRuns.length,
      success: nodeRuns.filter((n) => n.status === "success").length,
      skipped: nodeRuns.filter((n) => n.status === "skipped").length,
      error: nodeRuns.filter((n) => n.status === "failed").length,
    },
  }
  const executions: InteractionExecution[] = nodeRuns.map((n) => ({
    id: n.nodeRunId, runId, interactionId: n.nodeId, agentName: n.nodeType, teamName: "-",
    businessContext: BC_Q, status: EX_STATUS[n.status] ?? "SKIPPED",
    duration: n.durationMs != null ? `${n.durationMs}ms` : undefined,
    errorType: n.error?.message, attempts: [{ no: n.attempt ?? 1, status: EX_STATUS[n.status] ?? "SKIPPED", error: n.error?.message }],
  }))
  const agent: AgentRunExtras | null = d.runtime || (d.stages ?? []).length || (d.calls ?? []).length || d.quality
    ? {
      runtime: d.runtime ?? null,
      stages: d.stages ?? [],
      calls: d.calls ?? [],
      usage: d.usage ?? {},
      evidence: d.evidence ?? [],
      quality: d.quality ?? null,
    }
    : null
  return { run, executions: { items: executions, total: executions.length, page: 1, pageSize: 50 }, agent }
}

export interface Paged<T> { items: T[]; total: number; page: number; pageSize: number }

export interface AgentListItem {
  id: string; name: string; type: string; typeLabel?: string; status: string
  archived?: boolean; avatar?: string | null; workflowId?: string | null; updatedAt?: string
}
export interface ToolListItem {
  id: string; name: string; kind: string; status: string; connectionId?: string | null
  description?: string; updatedAt?: string; versions?: { version: number; status: string }[]
}
export interface ConnectionListItem {
  id: string; name: string; kind: string; protocol: string
  endpoint: Record<string, unknown>; status: string; secretConfigured: boolean
  providerHint?: string; updatedAt?: string
  environments?: { code: string; label?: string; endpoint?: Record<string, unknown>; secretConfigured?: boolean }[]
  defaultEnv?: string | null; authScript?: string
}
export interface ModelListItem {
  id?: string; modelKey: string; displayName?: string; providerId?: string
  providerName?: string; capabilities?: string[]; enabled?: boolean; version?: number
}
export interface ProviderListItem {
  id: string; name: string; baseUrl?: string; status?: string; modelCount?: number
}

export const pagedApi = {
  agents: (p: { page?: number; pageSize?: number; search?: string; archived?: "" | "true" | "all" }) =>
    req<Paged<AgentListItem>>(`/api/agents?page=${p.page ?? 1}&pageSize=${p.pageSize ?? 20}&search=${encodeURIComponent(p.search ?? "")}${p.archived ? `&archived=${p.archived}` : ""}`),
  tools: (p: { page?: number; pageSize?: number; search?: string }) =>
    req<Paged<ToolListItem>>(`/api/tools?page=${p.page ?? 1}&pageSize=${p.pageSize ?? 20}&search=${encodeURIComponent(p.search ?? "")}`),
  connections: (p: { page?: number; pageSize?: number; search?: string }) =>
    req<Paged<ConnectionListItem>>(`/api/connections?page=${p.page ?? 1}&pageSize=${p.pageSize ?? 20}&search=${encodeURIComponent(p.search ?? "")}`),
  reveal: (cid: string) => req<{ secret: string | Record<string, string>; envSecrets?: Record<string, string | Record<string, string>> }>(`/api/connections/${cid}/reveal`),
  models: (p: { page?: number; pageSize?: number }) =>
    req<Paged<ModelListItem>>(`/api/registry/models?page=${p.page ?? 1}&pageSize=${p.pageSize ?? 20}`),
  providers: (p: { page?: number; pageSize?: number }) =>
    req<Paged<ProviderListItem>>(`/api/model-providers?page=${p.page ?? 1}&pageSize=${p.pageSize ?? 20}`),
}

export const wfApiToken = (): string =>
  (typeof localStorage !== "undefined" && localStorage.getItem("wf_api_token")) ||
  (import.meta.env.VITE_WF_API_TOKEN as string | undefined) || ""

export const setWfApiToken = (token: string) => {
  if (typeof localStorage !== "undefined") localStorage.setItem("wf_api_token", token)
}

/* ---------- 身份（09 P0-10） ---------- */
export const authApi = {
  login: (username: string, password: string) =>
    req<{ token: string; user: { id: string; username: string; role: string; displayName: string } }>(
      "/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  me: () => req<{ id?: string; username: string; role: string; displayName?: string }>("/api/auth/me"),
}

/* ---------- Phase A（SDD A-16/D-3）：Agent 层统一客户端，页面禁止裸 fetch ---------- */
export interface AgentInfo {
  id: string; name: string; type: string; typeLabel: string; status: string;
  workflowId: string | null; config: Record<string, unknown>; configRevision: number;
  description: string; avatar?: string | null;
  moduleKey?: string | null; moduleVersion?: string | null
}

export interface AgentVersionInfo {
  versionId: string; versionNo: number; note: string; artifactHash: string; createdAt: string
}
export interface AgentRunEvent { type: string; payload: Record<string, unknown>; at: string }
export interface AgentRunDetail {
  runId: string; status: string; trigger: string; input: Record<string, unknown>;
  output?: { content?: string } | null; error?: { message?: string } | null;
  durationMs?: number | null; events: AgentRunEvent[];
  runtime?: Record<string, unknown> | null; stages?: unknown[]; calls?: unknown[];
  usage?: Record<string, unknown>; evidence?: unknown[]
}
/** R-Archive（SDD 10）：旧三类 Agent 只读封存——agentApi 仅保留只读查询；
 *  创建/编辑/复制/发布/部署/运行/评测/进化等写函数已随 UI 入口一并移除
 *  （后端对应端点返回 410 LEGACY_AGENT_ARCHIVED）。 */
export const agentApi = {
  list: (p?: { page?: number; pageSize?: number; search?: string; archived?: "" | "true" | "all" }) => {
    const q = new URLSearchParams()
    q.set("page", String(p?.page ?? 1)); q.set("pageSize", String(p?.pageSize ?? 100))
    if (p?.search) q.set("search", p.search)
    if (p?.archived) q.set("archived", p.archived)  // E-2.1：默认隐藏已归档
    return req<{ items: { id: string; name: string; type: string; status: string; archived?: boolean }[]; total: number }>(`/api/agents?${q}`)
  },
  get: (id: string) => req<AgentInfo>(`/api/agents/${id}`),
  // R4：Module Agent 创建与目录
  modules: () => req<{ items: { key: string; version: string; displayName: string; description: string; riskClass: string; providers: string[]; logicalTools: string[]; criteria: string[]; resultProjection?: string; producesQualityResult?: boolean; inputSchema?: { required?: string[]; properties?: Record<string, { type?: string }> }; outputSchema?: Record<string, unknown> }[] }>(`/api/agents/modules`),
  create: (body: { name: string; moduleKey: string; moduleVersion?: string; description?: string; modelRef?: Record<string, unknown> }) =>
    req<{ id: string; name: string; type: string; moduleKey: string; moduleVersion: string; configRevision: number }>(`/api/agents`, {
      method: "POST", body: JSON.stringify(body) }),
  // R4：Module Agent 版本与 Release（Provider 绑定）
  createVersion: (id: string, note = "") =>
    req<{ versionId: string; versionNo: number; artifactHash: string } | { detail: { code: string; issues?: { code: string; message: string }[]; message?: string } }>(
      `/api/agents/${id}/versions`, { method: "POST", body: JSON.stringify({ note }) }),
  release: (id: string, versionId: string, environment: "sandbox" | "prod", canaryPercent = 0, runtimeProviderId?: string, runtimeProfile?: string) =>
    req<{ releaseId: string; environment: string; versionNo: number; status: string; canaryPercent: number }>(
      `/api/agents/${id}/releases`, { method: "POST", body: JSON.stringify({ versionId, environment, canaryPercent, runtimeProviderId, runtimeProfile }) }),
  providers: () => req<{ items: { id: string; name: string; kind: string; status: string; healthStatus: string | null }[] }>(`/api/runtime-providers`),
  // R4：Module 实例身份可编辑 + 预览运行（旧三类仍被后端 410 封存）
  update: (id: string, body: Record<string, unknown>, expectedRevision?: number) =>
    req<{ id: string; config: Record<string, unknown>; configRevision: number }>(`/api/agents/${id}`, {
      method: "PUT", body: JSON.stringify({ ...body, ...(expectedRevision != null ? { expectedRevision } : {}) }) }),
  run: (id: string, input: Record<string, unknown>, trigger = "test", extra?: Record<string, unknown>) =>
    req<{ runId: string }>(`/api/agents/${id}/run`, {
      method: "POST", body: JSON.stringify({ input, trigger, ...(extra ?? {}) }) }),
  runDetail: (id: string, runId: string) => req<AgentRunDetail>(`/api/agents/${id}/runs/${runId}`),
  runs: (id: string) =>
    req<{ items: { runId: string; status: string; trigger: string; startedAt: string | null; durationMs: number | null; error?: { message?: string } | null }[] }>(`/api/agents/${id}/runs`),
  mountsHealth: (id: string) =>
    req<{ items: { kind: string; name: string; valid: boolean }[] }>(`/api/agents/${id}/mounts-health`),
  /* ---------- SDD Phase B：Agent 版本与部署（只读） ---------- */
  versions: (id: string) =>
    req<AgentVersionInfo[]>(`/api/agents/${id}/versions`),
  versionDetail: (id: string, versionId: string) =>
    req<Record<string, unknown>>(`/api/agents/${id}/versions/${versionId}`),
  /* E-2.2：草稿 definition 预览（版本对比用） */
  draftDefinition: (id: string) =>
    req<{ definition: Record<string, unknown> }>(`/api/agents/${id}/definition-draft`),
  releases: (id: string) =>
    req<{ releaseId: string; environment: string; status: string; canaryPercent: number; versionNo: number | null; createdAt: string }[]>(
      `/api/agents/${id}/releases`),
  eventsUrl: (runId: string) => `${WF_BASE}/api/runs/${runId}/events`,
  /* ---------- SDD D-1：观测 / 评测（只读） ---------- */
  metrics: (id: string) =>
    req<{ total: number; succeeded: number; failed: number; successRate: number; avgDurationMs: number; maxDurationMs: number;
          totalTokens?: number; firstToken?: { avgMs: number | null; p50Ms: number | null; samples: number } }>(
      `/api/agents/${id}/metrics`),
  versionsWithMembers: (id: string) =>
    req<(AgentVersionInfo & { frozenMembers: { ref: string; version: string | null }[] })[]>(`/api/agents/${id}/versions`),
  evalSamples: (id: string) =>
    req<{ items: { id: string; name: string; input: Record<string, unknown>; expected?: unknown }[] }>(`/api/agents/${id}/eval-samples`),
  /* R8-UI-4：Golden Set 主动评测（真跑指定 Provider，逐 criterion 对比+违禁检查） */
  goldenEval: (id: string, providerId: string, limit = 3) =>
    req<{
      providerId: string; providerKind: string; samples: number; passed: number; passRate: number
      results: {
        sampleId: string; runId: string | null; runStatus: string; passed: boolean
        forbiddenViolations?: string[]; durationMs?: number | null; error?: string
        detail: { criterion: string; expected: string; actual?: string }[]
      }[]
    }>(`/api/agents/${id}/golden-eval`, { method: "POST", body: JSON.stringify({ providerId, limit }) }),
  /* R8-UI-2：效果评测 Tab（Golden Set + 真实 Run 逐 criterion 聚合） */
  evalSummary: (id: string) =>
    req<{
      goldenSet: { samples: number; source: string }; runCount: number; evaluatedRuns: number
      criteria: {
        criterion: string; total: number; byStatus: Record<string, number>; avgConfidence: number | null
        byProvider: { provider: string; total: number; byStatus: Record<string, number> }[]
      }[]
    }>(`/api/agents/${id}/eval-summary`),
  /* ---------- SDD D-3：进化（只读历史） ---------- */
  evolutionList: (id: string) =>
    req<{ id: string; attribution: string; reason: string; status: string; createdAt: string }[]>(`/api/agents/${id}/evolution`),
}

/* ---------- R8-UI：Runtime Providers 管理（SDD 10 §15.1 / 11 §7-②） ----------
 * 凭据仅经 connectionId 引用 Connection；config 禁密钥（服务端 422 兜底）；
 * RBAC：写=operator，disable=admin（前端门控+服务端强制）。 */
export interface RuntimeProviderDTO {
  id: string; name: string; kind: string; baseUrl: string; status: string
  contractVersion: string; capabilities: Record<string, unknown>
  healthStatus: string | null; lastHealthAt: string | null; connectionId: string | null
  createdAt: string
  config?: Record<string, unknown>
  compatibleModules?: { key: string; version: string; implementation: unknown }[]
}
export const runtimeProviderApi = {
  list: () => req<{ items: RuntimeProviderDTO[]; total: number }>("/api/runtime-providers"),
  get: (id: string) => req<RuntimeProviderDTO>(`/api/runtime-providers/${id}`),
  create: (body: Record<string, unknown>) =>
    req<RuntimeProviderDTO>("/api/runtime-providers", { method: "POST", body: JSON.stringify(body) }),
  update: (id: string, body: Record<string, unknown>) =>
    req<RuntimeProviderDTO>(`/api/runtime-providers/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  probe: (id: string) =>
    req<{ ok?: boolean; healthStatus?: string; capabilities?: Record<string, unknown> }>(
      `/api/runtime-providers/${id}/probe`, { method: "POST" }),
  disable: (id: string) =>
    req<RuntimeProviderDTO>(`/api/runtime-providers/${id}/disable`, { method: "POST" }),
  enable: (id: string) =>
    req<RuntimeProviderDTO>(`/api/runtime-providers/${id}`, { method: "PUT", body: JSON.stringify({ status: "enabled" }) }),
}

/** SSE 事件流消费（SDD B-08 / 09 P0-13）：fetch + ReadableStream 解析。
 * - 携带 Authorization（鉴权开启后事件流不再被 401 截断）；
 * - 断线按 Last-Event-ID 重连（服务端支持 sequence 续传）；
 * - 401/403 为明确终态（不无限重试）。 */
export interface RunStreamEvent { type: string; payload: Record<string, unknown>; sequence?: number }

export async function streamRunEvents(runId: string, onEvent: (ev: RunStreamEvent) => void,
                                      timeoutMs = 120000): Promise<void> {
  const TERMINAL = ["workflow_completed", "workflow_failed", "agent_completed", "agent_failed"]
  const t0 = Date.now()
  let lastSeq = 0
  let reconnects = 0
  for (; ;) {
    if (Date.now() - t0 > timeoutMs) throw new Error("事件流超时")
    const tok = wfApiToken()
    const headers: Record<string, string> = { ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }
    if (lastSeq > 0) headers["Last-Event-ID"] = String(lastSeq)  // 断线续传（服务端按 sequence 补拉）
    const resp = await fetch(`${WF_BASE}/api/runs/${runId}/events`, { headers })
    if (resp.status === 401 || resp.status === 403) {
      throw new ApiError(resp.status, `事件流未授权（${resp.status}）：请登录或刷新凭证`)
    }
    if (!resp.ok || !resp.body) {
      if (++reconnects > 3) throw new Error(`事件流连接失败：${resp.status}`)
      await new Promise((r) => setTimeout(r, 500 * reconnects))
      continue
    }
    reconnects = 0
    const reader = resp.body.getReader()
    const dec = new TextDecoder()
    let buf = ""
    let streamAlive = true
    try {
      for (; ;) {
        if (Date.now() - t0 > timeoutMs) throw new Error("事件流超时")
        const { done, value } = await reader.read()
        if (done) { streamAlive = false; break }
        buf += dec.decode(value, { stream: true })
        let sep: number
        while ((sep = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, sep)
          buf = buf.slice(sep + 2)
          const lines = block.split("\n")
          const dataLine = lines.find((l) => l.startsWith("data:"))
          const idLine = lines.find((l) => l.startsWith("id:"))
          if (!dataLine) continue
          if (idLine) {
            const n = Number(idLine.slice(3).trim())
            if (Number.isFinite(n)) lastSeq = Math.max(lastSeq, n)
          }
          let ev: RunStreamEvent
          try { ev = JSON.parse(dataLine.slice(5).trim()) } catch { continue }
          onEvent(ev)
          if (TERMINAL.includes(ev.type)) return
        }
      }
    } catch (e) {
      // 网络中断 → 重连；业务错误（超时/未授权）直接抛出
      if (e instanceof ApiError || (e instanceof Error && e.message.includes("超时"))) throw e
      streamAlive = false
    }
    if (!streamAlive) {
      // 流结束但未见终态事件：重连补拉（Last-Event-ID 语义）
      if (++reconnects > 3) return
      await new Promise((r) => setTimeout(r, 500 * reconnects))
    }
  }
}

/* ---------- E-1.1：质量筛选词表真实来源（后端聚合） ---------- */
export const qualityVocab = () =>
  req<import("@/components/quality/global-filters").QualityVocab>("/api/quality/vocab")

/* ---------- 观测（SDD design-run-observability）：span 树组装端点 ---------- */
export const runTrace = (runId: string) =>
  req<import("@/components/run/trace-view").TraceData>(`/api/runs/${runId}/trace`)

/* ---------- Phase A（SDD A-16）：评测与编辑锁也走服务层 ---------- */
export const evalApi = {
  samples: (workflowId: string) =>
    req<{ items: { id: string; name: string; input: Record<string, unknown>; expected?: { text?: string } | null }[] }>(`/api/eval-samples?workflowId=${workflowId}`),
  addSample: (workflowId: string, name: string, input: Record<string, unknown>, expectedText?: string) =>
    req<{ id: string }>("/api/eval-samples", { method: "POST", body: JSON.stringify({ workflowId, name, input, ...(expectedText?.trim() ? { expected: { text: expectedText.trim() } } : {}) }) }),
  delSample: (id: string) => req<{ ok: boolean }>(`/api/eval-samples/${id}`, { method: "DELETE" }),
  humanScore: (id: string, score: number) =>
    req<{ id: string; judge: { kind: string; score: number } }>(`/api/eval-samples/${id}/human-score`, { method: "POST", body: JSON.stringify({ score }) }),
  run: (workflowId: string, judge: "none" | "rule" | "model" = "rule") =>
    req<{ total: number; succeeded: number; results: { sampleId: string; name: string; runId?: string; status: string; durationMs?: number | null; output?: string; error?: string | null; judge?: { kind: string; score: number } | null }[] }>(
      `/api/workflows/${workflowId}/eval-run`, { method: "POST", body: JSON.stringify({ judge }) }),
  summary: (workflowId: string) =>
    req<{ total?: number; succeeded?: number; failed?: number; successRate?: number }>(
      `/api/workflows/${workflowId}/eval-summary`),
  versionMetrics: (workflowId: string) =>
    req<{ versions: { versionNo: number; runs: number; successRate: number }[]; failedCases: { runId: string; error: string }[] }>(
      `/api/workflows/${workflowId}/version-metrics`),
}
export const lockApi = {
  acquire: (resourceId: string, wsId: string, user: string) =>
    req<{ lockedByOther?: boolean; user?: string; expiresAt?: string }>("/api/locks", { method: "POST", body: JSON.stringify({ resourceId, wsId, user }) }),
  release: (resourceId: string, wsId: string) =>
    req<{ ok: boolean }>(`/api/locks/${resourceId}?wsId=${wsId}`, { method: "DELETE" }),
  /** E-2.4：强制解锁（admin；后端审计留痕） */
  forceRelease: (resourceId: string) =>
    req<{ ok: boolean }>(`/api/locks/${resourceId}/force`, { method: "DELETE" }),
}

/* ---------- 质检业务层联调：quality_result/evidence ---------- */
import type { ListResponse, QualityResult } from "@/domain/types"

const REVIEW_MAP: Record<string, "NONE" | "PENDING" | "IN_REVIEW" | "COMPLETED" | "REOPENED"> = {
  AI: "PENDING", REVIEWED: "IN_REVIEW", EFFECTIVE: "COMPLETED",
}
const ORG = { agentId: "-", agentName: "-", teamId: "-", teamName: "-", departmentId: "-", departmentName: "-" }
const BC_Q = { brand: "-", productCategory: "-", serviceType: "-", issueTopic: "-" }

export async function realQualityResults(params: {
  page?: number; pageSize?: number; tab?: string; search?: string; sort?: string; filters?: string
}): Promise<ListResponse<QualityResult>> {
  // E-1.1：筛选参数真进后端（此前仅 page/pageSize，其余筛选全是摆设）
  const q = new URLSearchParams({ page: String(params.page ?? 1), pageSize: String(params.pageSize ?? 20) })
  if (params.tab && params.tab !== "all") q.set("tab", params.tab)
  if (params.search) q.set("search", params.search)
  if (params.sort && params.sort !== "time:desc") q.set("sort", params.sort)
  for (const [k, v] of Object.entries(parseListFilters(params.filters ?? ""))) {
    if (v && v !== "__all__") q.set(k, v)
  }
  const r = await req<Paged<QualityResultListRaw>>(`/api/quality-results?${q.toString()}`)
  return {
    items: r.items.map((q) => ({
      id: q.id, interactionId: q.interactionId || q.id, interactionTime: q.interactionTime ?? new Date().toISOString(),
      org: { ...ORG, agentName: q.agentName ?? "-", teamName: "-", departmentName: "-" },
      businessContext: { ...BC_Q, serviceType: q.serviceType ?? "-" },
      requestType: "-", requestSummary: q.requestSummary ?? q.issueSummary ?? "-",
      score: q.score ?? undefined, risk: (q.risk as QualityResult["risk"]) ?? undefined, critical: !!q.critical,
      issueCount: q.issueCount ?? 0, issueSummary: q.issueSummary ?? undefined,
      review: { status: REVIEW_MAP[q.review ?? ""] ?? "PENDING" }, hasAudio: false,
      execution: {
        runId: q.execution?.runId ?? q.runId ?? "-", taskId: "-",
        status: (q.execution?.status ?? "SUCCESS") as QualityResult["execution"]["status"], agentVersion: "-",
      },
    })),
    total: r.total, page: r.page, pageSize: params.pageSize ?? 20,
  }
}

/** 质检结果列表行原始 DTO（/api/quality-results items）。 */
export interface QualityResultListRaw {
  id: string
  runId?: string | null
  interactionId?: string
  interactionTime?: string
  agentName?: string
  serviceType?: string
  requestSummary?: string
  score?: number | null
  risk?: string | null
  critical?: boolean
  issueCount?: number
  issueSummary?: string | null
  review?: string
  execution?: { runId?: string; status?: string } | null
}

export async function realQualityResultDetail(id: string): Promise<Record<string, unknown>> {
  const q = await req<QualityResultDetailDTO>(`/api/quality-results/${id}`)
  // 真实数据映射为页面结构（复核审计修复：此前 transcript/sections 未定义导致空白页）
  const so = q.structuredOutput ?? {}
  const soEntries = Object.entries(so).filter(([k]) => !["transcript", "evidence"].includes(k))
  const sections = soEntries.length > 0 ? [{
    section: "结构化质检输出",
    criteria: soEntries.map(([k, v]) => ({
      id: k, criterion: k, result: typeof v === "object" ? JSON.stringify(v) : String(v ?? "—"),
    })),
  }] : []
  return {
    ...q,
    transcript: [],           // 真实运行不保存对话原文（诚实空态）
    sections,
    businessFacts: q.evidence.map((e) => ({ id: e.id, title: e.kind, label: e.kind, fields: [{ label: e.kind, value: e.text }] })),
    reviewHistory: q.reviewRevisions,
  }
}

/* ---------- R3：质检页真数据适配（取代 mock 双轨） ---------- */
/* D-5：类型已从旧 mock 层迁出（旧 mock 模块已删除）。 */
export interface OverviewData {
  kpis: { label: string; value: string; delta: string; deltaTone: "success" | "danger" | "warning" | "neutral" }[]
  trend: { date: string; avgScore: number; issueRate: number; critical: number }[]
  attention: { id: string; title: string; detail: string; link: { label: string; filters: Record<string, string> } }[]
  topIssues: { section: string; criterion: string; affected: number; rate: string; delta: string; risk: string; scene: string }[]
  sceneQuality: { name: string; avgScore: number; count: number }[]
}

export interface AgentAnalysisData {
  scopeSummary: { label: string; value: string }[]
  trend: { date: string; avgScore: number; issueRate: number; critical: number }[]
  teams: { team: string; department: string; valid: number; avgScore: number; issueRate: number; critical: number; topProblem: string; topScene: string; delta: string }[]
  agents: { agent: string; team: string; valid: number; avgScore: number; issueRate: number; critical: number; topProblem: string; topScene: string }[]
  attentionAgents: { agent: string; reason: string; criterion: string }[]
  problems: { criterion: string; rate: string; affected: number }[]
  scenes: { name: string; avgScore: number; count: number }[]
  /** 关联质检结果（后端聚合提供前为真实空数组） */
  related: {
    interactionId: string; interactionTime: string; requestSummary: string
    score?: number; risk?: string; durationSeconds?: number
    businessContext: { serviceType: string; productCategory: string; issueTopic: string }
  }[]
}

/** Tab 计数真数据（此前恒来自 mock）。 */
export async function realQualityResultCounts(): Promise<{ all: number; pending: number; reviewed: number }> {
  const k = await analyticsApi.kpi()
  return { all: k.total, pending: k.pending, reviewed: k.reviewed }
}

/** 09 P1-03：质量分析服务端聚合客户端（不再前端取 200 条自算）。 */
export interface AnalyticsDimRow {
  value: string; count: number; avgScore: number; issueRate: number; critical: number
}
function _qs(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") sp.set(k, String(v))
  }
  return sp.toString()
}
export const analyticsApi = {
  kpi: (params?: { search?: string; days?: number }) =>
    req<{ total: number; avgScore: number; issueRate: number; withIssues: number; critical: number; reviewed: number; pending: number }>(
      `/api/quality/analytics/kpi?${_qs(params ?? {})}`),
  trend: (params?: { search?: string; days?: number }) =>
    req<{ items: { date: string; count: number; avgScore: number; issueRate: number; critical: number }[] }>(
      `/api/quality/analytics/trend?${_qs({ days: 30, ...(params ?? {}) })}`),
  topIssues: (params?: { search?: string; days?: number; limit?: number }) =>
    req<{ items: { criterion: string; affected: number }[] }>(
      `/api/quality/analytics/top-issues?${_qs(params ?? {})}`),
  byDimension: (dim: string, params?: { search?: string; days?: number }) =>
    req<{ dim: string; items: AnalyticsDimRow[] }>(
      `/api/quality/analytics/by-dimension?${_qs({ dim, ...(params ?? {}) })}`),
  observability: {
    runStats: () => req<{ total: number; byStatus: Record<string, number>; avgDurationMs: number }>("/api/observability/run-stats"),
    queueStats: () => req<{ pending: number; processing: number; dead: number; done: number }>("/api/observability/queue-stats"),
    scheduleStats: () => req<{ enabled: number; overdue: number }>("/api/observability/schedule-stats"),
    costStats: () => req<{ totalPromptTokens: number; totalCompletionTokens: number; totalTokens: number }>("/api/observability/cost-stats"),
  },
}

/** 质量总览真数据（09 P1-03）：KPI/趋势/Top问题全部来自服务端聚合。 */
export async function realQualityOverview(): Promise<OverviewData> {
  const [kpi, trend, topIssues] = await Promise.all([
    analyticsApi.kpi(),
    analyticsApi.trend({ days: 30 }).catch(() => ({ items: [] as { date: string; count: number; avgScore: number; issueRate: number; critical: number }[] })),
    analyticsApi.topIssues({ limit: 10 }).catch(() => ({ items: [] as { criterion: string; affected: number }[] })),
  ])
  return {
    kpis: [
      { label: "质检交互总数", value: String(kpi.total), delta: "全量聚合", deltaTone: "neutral" },
      { label: "平均质量得分", value: kpi.total ? kpi.avgScore.toFixed(1) : "—", delta: kpi.total ? "服务端全量" : "暂无数据", deltaTone: "neutral" },
      { label: "问题交互率", value: kpi.total ? `${Math.round(kpi.issueRate * 100)}%` : "—", delta: `${kpi.withIssues} 条有问题`, deltaTone: kpi.withIssues > 0 ? "warning" : "neutral" },
      { label: "Critical", value: String(kpi.critical), delta: kpi.critical > 0 ? "需关注" : "无", deltaTone: kpi.critical > 0 ? "danger" : "success" },
      { label: "已复核", value: String(kpi.reviewed), delta: `${kpi.pending} 条待复核`, deltaTone: "neutral" },
    ],
    trend: trend.items.map((t) => ({ date: t.date, avgScore: t.avgScore, issueRate: t.issueRate, critical: t.critical })),
    attention: [],
    topIssues: topIssues.items.map((i) => ({
      section: "质检问题", criterion: i.criterion, affected: i.affected,
      rate: kpi.total ? `${Math.round((i.affected / kpi.total) * 100)}%` : "—",
      delta: "—", risk: "—", scene: "—",
    })),
    sceneQuality: [],
  }
}

/** 坐席分析真数据（09 P1-03）：Agent/团队维度来自服务端 by-dimension 聚合。 */
export async function realAgentAnalysis(): Promise<AgentAnalysisData> {
  const [agents, kpi, runStats, byTeam, byAgent, topIssues, trend] = await Promise.all([
    req<{ items: AgentListItem[] }>("/api/agents?pageSize=100"),
    analyticsApi.kpi(),
    analyticsApi.observability.runStats().catch(() => ({ total: 0, byStatus: {} as Record<string, number>, avgDurationMs: 0 })),
    analyticsApi.byDimension("team").catch(() => ({ dim: "team", items: [] as AnalyticsDimRow[] })),
    analyticsApi.byDimension("agent").catch(() => ({ dim: "agent", items: [] as AnalyticsDimRow[] })),
    analyticsApi.topIssues({ limit: 10 }).catch(() => ({ items: [] as { criterion: string; affected: number }[] })),
    analyticsApi.trend({ days: 30 }).catch(() => ({ items: [] as { date: string; count: number; avgScore: number; issueRate: number; critical: number }[] })),
  ])
  const succ = runStats.byStatus["succeeded"] ?? 0
  return {
    scopeSummary: [
      { label: "Agent 总数", value: String((agents.items ?? []).length) },
      { label: "运行总数", value: String(runStats.total) },
      { label: "运行成功率", value: runStats.total ? `${Math.round((succ / runStats.total) * 100)}%` : "—" },
      { label: "质检结果", value: String(kpi.total) },
      { label: "平均得分", value: kpi.total ? kpi.avgScore.toFixed(1) : "—" },
    ],
    trend: trend.items.map((t) => ({ date: t.date, avgScore: t.avgScore, issueRate: t.issueRate, critical: t.critical })),
    teams: byTeam.items.map((t) => ({
      team: t.value, department: "-", valid: t.count, avgScore: t.avgScore,
      issueRate: t.issueRate, critical: t.critical, topProblem: "—", topScene: "—", delta: "—",
    })),
    agents: byAgent.items.length ? byAgent.items.map((a) => ({
      agent: a.value, team: "-", valid: a.count, avgScore: a.avgScore,
      issueRate: a.issueRate, critical: a.critical, topProblem: "—", topScene: "—",
    })) : (agents.items ?? []).map((a) => ({
      agent: String(a.name ?? a.id), team: String(a.typeLabel ?? "-"),
      valid: 0, avgScore: 0, issueRate: 0, critical: 0, topProblem: "—", topScene: "—",
    })),
    attentionAgents: [],
    problems: topIssues.items.map((i) => ({ criterion: i.criterion, rate: kpi.total ? `${Math.round((i.affected / kpi.total) * 100)}%` : "—", affected: i.affected })),
    scenes: [],
    related: [],
  }
}

/* ---------- 业务深化适配器（09 P0-B4：显式 DTO，去 agentId 承载语义） ---------- */
import type {
  AnalysisTaskDTO, QualityResultDetailDTO, ResultRuleDetailDTO, ResultRuleSetDTO,
  ResultRuleVersionDTO, TaskRunDTO, TaskRunResultDTO, TaskRunRunDTO, TaskVersionDTO,
} from "@/services/api-types"
import type { DataAsset } from "@/domain/types"

export interface CreateTaskPayload {
  name: string
  description?: string
  workflowId?: string
  workflowVersionPolicy?: "pinned" | "latest_published"
  pinnedWorkflowVersionId?: string
  /** R7-1：统一执行目标（agent 默认 / workflow 兼容） */
  executionTarget?: { type: "agent" | "workflow"; agentId?: string; workflowId?: string; versionPolicy?: string; pinnedAgentVersionId?: string | null; pinnedWorkflowVersionId?: string | null }
  dataAssetId: string
  dataDefinitionVersionId?: string
  resultRuleVersionId?: string
  /** 09 P0：pinned=绑定 resultRuleVersionId；follow_latest=批次启动解析最新发布版本 */
  rulePolicy?: "pinned" | "follow_latest"
  /** 09 闭环修复：follow_latest 的 RuleSet 作用域 */
  resultRuleSetId?: string
  inputMapping?: Record<string, string>
  scope?: { op: "and" | "or"; conditions: { field: string; op: string; value: unknown }[] }
  sampling?: { mode: "all" | "count" | "random"; count?: number; percent?: number }
  dataWindow?: { mode: "all" | "relative" | "fixed"; value?: string; timezone?: string; start?: string; end?: string }
}

export interface StartTaskRunResponse {
  taskRunId: string
  status: string
  resolvedVersions: {
    taskVersionId: string | null
    workflowVersionId: string | null
    ruleVersionId: string | null
    outputSchemaVersionId: string | null
  }
  dataSnapshotId: string | null
}

export const bizApi = {
  rules: () => req<{ items: ResultRuleSetDTO[] }>("/api/result-rules").then((r) => r.items),
  rule: (id: string) => req<ResultRuleDetailDTO>(`/api/result-rules/${id}`),
  ruleVersions: (id: string) =>
    req<{ items: ResultRuleVersionDTO[] }>(`/api/result-rules/${id}/versions`).then((r) => r.items),
  createRule: (body: { name: string; description?: string; rules?: Record<string, unknown> }) =>
    req<{ id: string; version: number }>("/api/result-rules", { method: "POST", body: JSON.stringify(body) }),
  updateRule: (id: string, body: { name?: string; rules?: Record<string, unknown> }) =>
    req<{ id: string; version: number; status: string }>(`/api/result-rules/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  /** 09 P0-07：发布=冻结不可变版本；不再全库重算 */
  publishRule: (id: string) =>
    req<{ id: string; version: number; ruleVersionId: string }>(`/api/result-rules/${id}/publish`, { method: "POST" }),
  review: (id: string, body: { action: string; score?: number; risk?: string; note?: string; reviewer?: string }) =>
    req<{ id: string; review: string; history: unknown[]; revisionId: string; revisionNo: number }>(
      `/api/quality-results/${id}/review`, { method: "POST", body: JSON.stringify(body) }),
  qualityDetail: (id: string) => req<QualityResultDetailDTO>(`/api/quality-results/${id}`),
  assets: () => req<{ items: Pick<DataAsset, "id" | "name">[] & Record<string, unknown>[] }>("/api/data-assets").then((r) => r.items),
  createAsset: (body: { name: string; rows?: unknown[] }) =>
    req<{ id: string; name: string }>("/api/data-assets", { method: "POST", body: JSON.stringify(body) }),
  asset: (id: string) => req<{ id: string; name: string; rows: unknown[]; revision: number }>(`/api/data-assets/${id}`),
  appendRows: (id: string, rows: unknown[]) =>
    req<{ id: string; rows: number; revision: number }>(`/api/data-assets/${id}/rows`, { method: "POST", body: JSON.stringify({ rows }) }),
  /* ---------- 任务：09 §10.1 创建即返回已解析 TaskVersion ---------- */
  tasks: () => req<{ items: AnalysisTaskDTO[] }>("/api/tasks").then((r) => r.items),
  task: (id: string) => req<AnalysisTaskDTO>(`/api/tasks/${id}`),
  taskVersions: (id: string) => req<{ items: TaskVersionDTO[] }>(`/api/tasks/${id}/versions`).then((r) => r.items),
  createTask: (body: CreateTaskPayload) =>
    req<{ id: string; name: string; workflowId: string; status: string; taskVersion: TaskVersionDTO }>(
      "/api/tasks", { method: "POST", body: JSON.stringify(body) }),
  updateTask: (id: string, body: Partial<CreateTaskPayload> & { note?: string }) =>
    req<{ id: string; name: string; status: string; taskVersion: TaskVersionDTO }>(
      `/api/tasks/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  setTaskStatus: (id: string, status: "active" | "paused" | "draft" | "archived") =>
    req<{ id: string; status: string }>(`/api/tasks/${id}/status`, { method: "POST", body: JSON.stringify({ status }) }),
  addEvidence: (resultId: string, body: { kind?: string; text: string; sourceRef?: string }) =>
    req<{ id: string; kind: string }>(`/api/quality-results/${resultId}/evidence`, { method: "POST", body: JSON.stringify(body) }),
  /** 09 §10.2：启动批次（202 异步；Idempotency-Key 重复返回原 TaskRun） */
  startTaskRun: (id: string, idempotencyKey?: string) =>
    req<StartTaskRunResponse>(`/api/tasks/${id}/runs`, {
      method: "POST", body: "{}",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {},
    }),
  taskRuns: (id: string) => req<{ items: TaskRunDTO[] }>(`/api/tasks/${id}/runs`).then((r) => r.items),
  taskRun: (trid: string) => req<TaskRunDTO>(`/api/task-runs/${trid}`),
  taskRunSnapshot: (trid: string) =>
    req<{
      taskRunId: string; taskId: string
      dataSnapshot: null | {
        id: string; assetId: string; assetRevision: number; definitionVersionId: string | null
        locator: Record<string, unknown>; resolvedWindow: Record<string, unknown>
        resolvedScope: Record<string, unknown>; resolvedSampling: Record<string, unknown>
        checkpoint: string | null; expectedCount: number; readCount: number
        checksum: string; createdAt: string
      }
    }>(`/api/task-runs/${trid}/snapshot`),
  taskRunRuns: (trid: string) => req<{ items: TaskRunRunDTO[] }>(`/api/task-runs/${trid}/runs`).then((r) => r.items),
  taskRunResults: (trid: string) => req<{ items: TaskRunResultDTO[] }>(`/api/task-runs/${trid}/results`).then((r) => r.items),
  /** 09 P1-01：历史窗口回填（202 异步） */
  backfillTask: (id: string, window: { start?: string; end?: string }) =>
    req<{ taskRunId: string; status: string; window: { start?: string; end?: string }; dataSnapshotId: string | null }>(
      `/api/tasks/${id}/backfill`, { method: "POST", body: JSON.stringify({ window }) }),
  /** 09 P1-01：任务级调度列表 */
  taskSchedules: (id: string) =>
    req<{ items: { id: string; name: string; cron: string; timezone: string; enabled: boolean; nextRunAt: string | null; lastRanAt: string | null; failedCount: number }[] }>(
      `/api/tasks/${id}/schedules`).then((r) => r.items),
  /** 09 P1-06：失败交互行级重试（202） */
  retryFailed: (id: string, trid: string) =>
    req<{ retried: number; newRunIds: string[] }>(`/api/tasks/${id}/runs/${trid}/retry-failed`, { method: "POST", body: "{}" }),
  taskSchedule: (id: string, cron: string, timezone = "Asia/Shanghai") =>
    req<{ id: string; nextRunAt: string }>(`/api/tasks/${id}/schedule`, { method: "POST", body: JSON.stringify({ cron, timezone }) }),
}

export async function realQualityDetail(id: string): Promise<Record<string, unknown>> {
  const q = await req<QualityResultDetailDTO>(`/api/quality-results/${id}`)
  const hist = q.reviewRevisions ?? []
  const last = hist[hist.length - 1]
  const transcript = (q.structuredOutput?.transcript ?? []) as
    { speaker?: string; start?: number; end?: number; text?: string }[]
  return {
    ...q,
    interactionId: q.interactionId || q.id,
    interactionTime: q.interactionTime ?? new Date().toISOString(),
    org: ORG, businessContext: BC_Q, requestType: "-", requestSummary: q.issueSummary ?? "-",
    score: q.score ?? undefined, risk: q.risk ?? undefined, critical: !!q.critical,
    issueCount: q.issueCount ?? 0, issueSummary: q.issueSummary ?? undefined,
    review: { status: REVIEW_MAP[q.review] ?? "PENDING", reviewer: last?.reviewer },
    hasAudio: false,
    execution: { runId: q.runId ?? "-", taskId: q.taskId ?? "-", status: "SUCCESS", agentVersion: "-" },
    transcript: transcript.map((t, i) => ({
      id: `seg${i}`, speaker: t.speaker ?? "agent", speakerLabel: t.speaker ?? "agent",
      startSeconds: t.start ?? 0, text: t.text ?? "", criterionRefs: [],
    })),
    sections: [{
      section: "规则派生",
      criteria: [{
        id: "c1", section: "规则派生",
        criterion: q.issueSummary ?? "承诺兑现检查",
        result: (q.issueCount ?? 0) > 0 ? "FAIL" : "PASS",
        severity: q.risk ?? undefined,
        reason: q.issueSummary ?? undefined,
      }],
    }],
    reviewHistory: hist,
    // 09 闭环验收修复：详情页消费 businessFacts/evidence，缺失时给默认值防白屏
    evidence: q.evidence ?? [],
    businessFacts: (q.evidence ?? []).map((e) => ({
      id: e.id, title: e.kind, label: e.kind,
      fields: [{ label: e.kind, value: e.text }], usedByCriterionIds: [],
    })),
  }
}

/* ---------- 07-SDD（08-26）：集中表单（工作流输入契约） ---------- */
export interface FormField {
  id?: string; key: string; type: string; dataType: string; label: string
  description?: string; placeholder?: string; default?: string
  options?: { label: string; value: string; disabled?: boolean }[]
  readOnly?: boolean
  optionsSource?: { type: "custom" | "field"; field?: string }
  visibleRoles?: string[]
  validation?: { required?: boolean; minLength?: number; maxLength?: number; min?: number; max?: number; pattern?: string; minSelections?: number; maxSelections?: number; unique?: boolean }
  layout?: { span?: number }
  display?: { disabled?: boolean; readonly?: boolean }
  binding?: { type: string; path?: string; sourceId?: string; sourceField?: string; expression?: string }
  condition?: { visibleWhen?: { field: string; operator: string; value?: unknown } }
}
export interface FormDef {
  id: string; key?: string; name: string; description?: string; status?: string; fields: FormField[]
  revision?: number; usage?: number; fieldCount?: number; updatedAt?: string
}
export const formsApi = {
  list: () => req<{ items: FormDef[] }>("/api/forms"),
  get: (id: string) => req<FormDef>(`/api/forms/${id}`),
  create: (p: { name: string; key?: string; description?: string; fields: FormField[] }) =>
    req<{ id: string; name: string }>("/api/forms", { method: "POST", body: JSON.stringify(p) }),
  update: (id: string, p: { name?: string; description?: string; fields?: FormField[] }) =>
    req<{ id: string; revision: number }>(`/api/forms/${id}`, { method: "PUT", body: JSON.stringify(p) }),
  duplicate: (id: string) => req<{ id: string; name: string }>(`/api/forms/${id}/duplicate`, { method: "POST" }),
  remove: (id: string) => req<{ ok: boolean }>(`/api/forms/${id}`, { method: "DELETE" }),
  records: (id: string) =>
    req<{ recordId: string; formVersion: number; values: Record<string, unknown>; createdBy?: string; runId?: string; createdAt?: string }[]>(`/api/forms/${id}/records`),
  publish: (id: string, note = "") => req<{ versionNo: number }>(`/api/forms/${id}/publish`, { method: "POST", body: JSON.stringify({ note }) }),
  versions: (id: string) => req<{ versionId: string; versionNo: number; fieldCount: number; createdAt: string }[]>(`/api/forms/${id}/versions`),
  disable: (id: string) => req<{ ok: boolean }>(`/api/forms/${id}/disable`, { method: "POST" }),
  references: (id: string) => req<{ workflows: { id: string; name: string }[] }>(`/api/forms/${id}/references`),
}
