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

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const tok = typeof wfApiToken === "function" ? wfApiToken() : ""
  const res = await fetch(`${WF_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
    ...init,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(`${res.status}: ${JSON.stringify(body?.detail ?? body)}`)
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
  saveDraft: (id: string, definition: WfDefinition, baseRevision: number) =>
    req<{ workflowCode: string; draftVersion: string; savedAt: string }>(
      `/api/workflows/${id}/draft`,
      { method: "PUT", body: JSON.stringify({ definition, baseRevision }) },
    ),
  validate: (id: string) => req<ValidationReport>(`/api/workflows/${id}/validation`),
  publish: (id: string, note = "") =>
    req<{ versionId: string; versionNo: number }>(
      `/api/workflows/${id}/publish?note=${encodeURIComponent(note)}`,
      { method: "POST" },
    ),
  versions: (id: string) =>
    req<{ versionId: string; versionNo: number; note: string; publishedAt: string }[]>(
      `/api/workflows/${id}/versions`),
  nodeDefinitions: () => req<NodeDefinition[]>("/api/registry/node-definitions"),
  models: () => req<{ modelKey: string; capabilities: string[] }[]>("/api/registry/models"),
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
}
const EX_STATUS: Record<string, ExecutionStatus> = { success: "SUCCESS", failed: "ERROR", skipped: "SKIPPED", running: "SKIPPED", pending: "SKIPPED" }

export async function realRunDetail(runId: string): Promise<{ run: Run; executions: { items: InteractionExecution[]; total: number; page: number; pageSize: number } }> {
  const d = await req<Record<string, any>>(`/api/runs/${runId}`)
  const run: Run = {
    id: d.runId, taskId: "-", taskName: "Workflow Run",
    status: RUN_STATUS[d.status] ?? "PENDING",
    startedAt: d.startedAt ?? new Date().toISOString(),
    finishedAt: d.endedAt ?? undefined,
    duration: d.durationMs != null ? `${d.durationMs}ms` : undefined,
    dataWindow: { start: "-", end: "-", label: "-" },
    snapshot: {
      agentName: "workflow",
      // SDD A-01 验收：可见本次执行的是草稿还是哪个版本
      agentVersion: d.definitionSource === "version" ? `版本 v${d.versionNo ?? "?"}` : d.definitionSource === "draft" ? "草稿" : "-",
      dataAssetName: "-", dataAssetRevision: 0,
      scope: "-", sampling: "-", runtime: "fastapi-kernel", toolVersions: [], inputMapping: [],
    },
    summary: {
      input: (d.nodeRuns ?? []).length,
      success: (d.nodeRuns ?? []).filter((n: any) => n.status === "success").length,
      skipped: (d.nodeRuns ?? []).filter((n: any) => n.status === "skipped").length,
      error: (d.nodeRuns ?? []).filter((n: any) => n.status === "failed").length,
    },
  }
  const executions: InteractionExecution[] = (d.nodeRuns ?? []).map((n: any) => ({
    id: n.nodeRunId, runId, interactionId: n.nodeId, agentName: n.nodeType, teamName: "-",
    businessContext: BC_Q, status: EX_STATUS[n.status] ?? "SKIPPED",
    duration: n.durationMs != null ? `${n.durationMs}ms` : undefined,
    errorType: n.error?.message, attempts: [{ no: n.attempt ?? 1, status: EX_STATUS[n.status] ?? "SKIPPED", error: n.error?.message }],
  }))
  return { run, executions: { items: executions, total: executions.length, page: 1, pageSize: 50 } }
}

export interface Paged<T> { items: T[]; total: number; page: number; pageSize: number }
export const pagedApi = {
  agents: (p: { page?: number; pageSize?: number; search?: string }) =>
    req<Paged<Record<string, any>>>(`/api/agents?page=${p.page ?? 1}&pageSize=${p.pageSize ?? 20}&search=${encodeURIComponent(p.search ?? "")}`),
  tools: (p: { page?: number; pageSize?: number; search?: string }) =>
    req<Paged<Record<string, any>>>(`/api/tools?page=${p.page ?? 1}&pageSize=${p.pageSize ?? 20}&search=${encodeURIComponent(p.search ?? "")}`),
  connections: (p: { page?: number; pageSize?: number; search?: string }) =>
    req<Paged<Record<string, any>>>(`/api/connections?page=${p.page ?? 1}&pageSize=${p.pageSize ?? 20}&search=${encodeURIComponent(p.search ?? "")}`),
  models: (p: { page?: number; pageSize?: number }) =>
    req<Paged<Record<string, any>>>(`/api/registry/models?page=${p.page ?? 1}&pageSize=${p.pageSize ?? 20}`),
  providers: (p: { page?: number; pageSize?: number }) =>
    req<Paged<Record<string, any>>>(`/api/model-providers?page=${p.page ?? 1}&pageSize=${p.pageSize ?? 20}`),
}

export const wfApiToken = () =>
  (typeof localStorage !== "undefined" && localStorage.getItem("wf_api_token")) ||
  (import.meta as any).env?.VITE_WF_API_TOKEN || ""

/* ---------- Phase A（SDD A-16/D-3）：Agent 层统一客户端，页面禁止裸 fetch ---------- */
export interface AgentInfo {
  id: string; name: string; type: string; typeLabel: string; status: string;
  workflowId: string | null; config: Record<string, any>; configRevision: number;
  description: string; avatar?: string | null
}

export interface AgentVersionInfo {
  versionId: string; versionNo: number; note: string; artifactHash: string; createdAt: string
}
export interface AgentRunEvent { type: string; payload: Record<string, any>; at: string }
export interface AgentRunDetail {
  runId: string; status: string; trigger: string; input: Record<string, unknown>;
  output?: { content?: string } | null; error?: { message?: string } | null;
  durationMs?: number | null; events: AgentRunEvent[]
}
export const agentApi = {
  list: (p?: { page?: number; pageSize?: number; search?: string }) => {
    const q = new URLSearchParams()
    q.set("page", String(p?.page ?? 1)); q.set("pageSize", String(p?.pageSize ?? 100))
    if (p?.search) q.set("search", p.search)
    return req<{ items: { id: string; name: string; type: string; status: string }[]; total: number }>(`/api/agents?${q}`)
  },
  get: (id: string) => req<AgentInfo>(`/api/agents/${id}`),
  del: (id: string) => req<{ ok: boolean }>(`/api/agents/${id}`, { method: "DELETE" }),
  create: (body: { name: string; type: string; description?: string; config?: Record<string, unknown> }) =>
    req<{ id: string; workflowId: string | null; configRevision: number }>("/api/agents", {
      method: "POST", body: JSON.stringify(body) }),
  /** SDD A-08：携带 expectedRevision，冲突时抛出 409（REVISION_CONFLICT） */
  update: (id: string, body: Record<string, unknown>, expectedRevision?: number) =>
    req<{ id: string; config: Record<string, any>; configRevision: number }>(`/api/agents/${id}`, {
      method: "PUT", body: JSON.stringify({ ...body, ...(expectedRevision != null ? { expectedRevision } : {}) }) }),
  run: (id: string, input: Record<string, unknown>, trigger = "test") =>
    req<{ runId: string }>(`/api/agents/${id}/run`, {
      method: "POST", body: JSON.stringify({ input, trigger }) }),
  runDetail: (id: string, runId: string) => req<AgentRunDetail>(`/api/agents/${id}/runs/${runId}`),
  runs: (id: string) =>
    req<{ items: { runId: string; status: string; trigger: string; startedAt: string | null; durationMs: number | null; error?: { message?: string } | null }[] }>(`/api/agents/${id}/runs`),
  mountsHealth: (id: string) =>
    req<{ items: { kind: string; name: string; valid: boolean }[] }>(`/api/agents/${id}/mounts-health`),
  /** SDD A-03：顶层运行异步入队，轮询直到终态 */
  async runOnce(id: string, input: Record<string, unknown>, timeoutMs = 90000): Promise<AgentRunDetail> {
    const { runId } = await agentApi.run(id, input)
    const deadline = Date.now() + timeoutMs
    for (; ;) {
      const d = await agentApi.runDetail(id, runId)
      if (["succeeded", "failed", "cancelled"].includes(d.status)) return d
      if (Date.now() > deadline) throw new Error(`运行超时（${Math.round(timeoutMs / 1000)}s 未到终态）`)
      await new Promise((r) => setTimeout(r, 500))
    }
  },
  /* ---------- SDD Phase B：Agent 版本与部署 ---------- */
  versions: (id: string) =>
    req<AgentVersionInfo[]>(`/api/agents/${id}/versions`),
  createVersion: (id: string, note = "") =>
    req<{ versionId: string; versionNo: number; artifactHash: string } | { detail: { code: string; issues?: { code: string; message: string }[]; message?: string } }>(
      `/api/agents/${id}/versions`, { method: "POST", body: JSON.stringify({ note }) }),
  versionDetail: (id: string, versionId: string) =>
    req<Record<string, any>>(`/api/agents/${id}/versions/${versionId}`),
  release: (id: string, versionId: string, environment: "sandbox" | "prod") =>
    req<{ releaseId: string; environment: string; versionNo: number; status: string }>(
      `/api/agents/${id}/releases`, { method: "POST", body: JSON.stringify({ versionId, environment }) }),
  releases: (id: string) =>
    req<{ releaseId: string; environment: string; status: string; versionNo: number | null; createdAt: string }[]>(
      `/api/agents/${id}/releases`),
  eventsUrl: (runId: string) => `${WF_BASE}/api/runs/${runId}/events`,
  /* ---------- SDD D-1：观测 / 评测 / 生成 ---------- */
  metrics: (id: string) =>
    req<{ total: number; succeeded: number; failed: number; successRate: number; avgDurationMs: number; maxDurationMs: number }>(
      `/api/agents/${id}/metrics`),
  versionsWithMembers: (id: string) =>
    req<(AgentVersionInfo & { frozenMembers: { ref: string; version: string | null }[] })[]>(`/api/agents/${id}/versions`),
  evalSamples: (id: string) =>
    req<{ items: { id: string; name: string; input: Record<string, unknown>; expected?: unknown }[] }>(`/api/agents/${id}/eval-samples`),
  addEvalSample: (id: string, name: string, input: Record<string, unknown>, expected?: { text?: string } | null) =>
    req<{ id: string }>(`/api/agents/${id}/eval-samples`, { method: "POST", body: JSON.stringify({ name, input, ...(expected ? { expected } : {}) }) }),
  delEvalSample: (sampleId: string) => req<{ ok: boolean }>(`/api/eval-samples/${sampleId}`, { method: "DELETE" }),
  evalRun: (id: string, judge: "none" | "rule" | "model" = "none") =>
    req<{ total: number; succeeded: number; results: { sampleId: string; name: string; runId?: string; status: string; durationMs?: number | null; output?: string; judge?: { kind: string; score: number; passed?: boolean; note?: string } | null; error?: string | null }[] }>(
      `/api/agents/${id}/eval-run`, { method: "POST", body: JSON.stringify({ judge }) }),
  humanScore: (id: string, sampleId: string, score: number, note = "") =>
    req<{ id: string; judge: unknown }>(`/api/agents/${id}/eval-samples/${sampleId}/human-score`,
      { method: "POST", body: JSON.stringify({ score, note }) }),
  /* ---------- SDD D-3：进化（失败归因→候选补丁→审批应用） ---------- */
  evolutionCandidates: (id: string) =>
    req<{ id: string; attribution: string; basePrompt: string; proposedPrompt: string; status: string }>(
      `/api/agents/${id}/evolution/candidates`, { method: "POST", body: "{}" }),
  evolutionList: (id: string) =>
    req<{ id: string; attribution: string; reason: string; status: string; createdAt: string }[]>(`/api/agents/${id}/evolution`),
  evolutionApply: (id: string, patchId: string) =>
    req<{ id: string; status: string; configRevision: number }>(`/api/agents/${id}/evolution/${patchId}/apply`, { method: "POST", body: "{}" }),
  evolutionReject: (id: string, patchId: string) =>
    req<{ id: string; status: string }>(`/api/agents/${id}/evolution/${patchId}/reject`, { method: "POST", body: "{}" }),
  generatePrompt: (name: string, hint: string) =>
    req<{ prompt: string }>("/api/agents/generate-prompt", { method: "POST", body: JSON.stringify({ name, hint }) }),
}

/** SSE 事件流消费（SDD B-08）：fetch + ReadableStream 解析，终态事件后返回。 */
export async function streamRunEvents(runId: string, onEvent: (ev: { type: string; payload: Record<string, any> }) => void,
                                      timeoutMs = 120000): Promise<void> {
  const TERMINAL = ["workflow_completed", "workflow_failed", "agent_completed", "agent_failed"]
  const resp = await fetch(`${WF_BASE}/api/runs/${runId}/events`)
  if (!resp.ok || !resp.body) throw new Error(`事件流连接失败：${resp.status}`)
  const reader = resp.body.getReader()
  const dec = new TextDecoder()
  let buf = ""
  const t0 = Date.now()
  for (; ;) {
    if (Date.now() - t0 > timeoutMs) throw new Error("事件流超时")
    const { done, value } = await reader.read()
    if (done) return
    buf += dec.decode(value, { stream: true })
    let sep: number
    while ((sep = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, sep)
      buf = buf.slice(sep + 2)
      const dataLine = block.split("\n").find((l) => l.startsWith("data:"))
      if (!dataLine) continue
      let ev: { type: string; payload: Record<string, any> }
      try { ev = JSON.parse(dataLine.slice(5).trim()) } catch { continue }
      onEvent(ev)
      if (TERMINAL.includes(ev.type)) return
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
  summary: (workflowId: string) => req<Record<string, any>>(`/api/workflows/${workflowId}/eval-summary`),
  versionMetrics: (workflowId: string) =>
    req<{ versions: { versionNo: number; runs: number; successRate: number }[]; failedCases: { runId: string; error: string }[] }>(
      `/api/workflows/${workflowId}/version-metrics`),
}
export const lockApi = {
  acquire: (resourceId: string, wsId: string, user: string) =>
    req<{ user?: string }>("/api/locks", { method: "POST", body: JSON.stringify({ resourceId, wsId, user }) }),
  release: (resourceId: string, wsId: string) =>
    req<{ ok: boolean }>(`/api/locks/${resourceId}?wsId=${wsId}`, { method: "DELETE" }),
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
  const r = await req<Paged<Record<string, any>>>(`/api/quality-results?${q.toString()}`)
  return {
    items: r.items.map((q) => ({
      id: q.id, interactionId: q.interactionId || q.id, interactionTime: q.interactionTime,
      org: { ...ORG, agentName: q.agentName ?? "-", teamName: "-", departmentName: "-" },
      businessContext: { ...BC_Q, serviceType: q.serviceType ?? "-" },
      requestType: "-", requestSummary: q.requestSummary ?? q.issueSummary ?? "-",
      score: q.score ?? undefined, risk: q.risk ?? undefined, critical: !!q.critical,
      issueCount: q.issueCount ?? 0, issueSummary: q.issueSummary ?? undefined,
      review: { status: REVIEW_MAP[q.review] ?? "PENDING" }, hasAudio: false,
      execution: { runId: q.execution?.runId ?? "-", taskId: "-", status: q.execution?.status ?? "SUCCESS", agentVersion: "-" },
    })),
    total: r.total, page: r.page, pageSize: params.pageSize ?? 20,
  }
}

export async function realQualityResultDetail(id: string): Promise<Record<string, any>> {
  const q = await req<Record<string, any>>(`/api/quality-results/${id}`)
  // 真实数据映射为页面结构（复核审计修复：此前 transcript/sections 未定义导致空白页）
  const so = (q.structuredOutput ?? {}) as Record<string, unknown>
  const soEntries = Object.entries(so).filter(([k]) => !["transcript", "evidence"].includes(k))
  const sections = soEntries.length > 0 ? [{
    section: "结构化质检输出",
    criteria: soEntries.map(([k, v]) => ({
      id: k, criterion: k, result: typeof v === "object" ? JSON.stringify(v) : String(v ?? "—"),
    })),
  }] : []
  const evidence = (q.evidence ?? []) as { id: string; kind: string; text: string }[]
  return {
    ...q,
    transcript: [],           // 真实运行不保存对话原文（诚实空态）
    sections,
    businessFacts: evidence.map((e) => ({ id: e.id, label: e.kind, fields: [{ label: e.kind, value: e.text }] })),
    reviewHistory: [],
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
  related: Record<string, any>[]
}

/** Tab 计数真数据（此前恒来自 mock）。 */
export async function realQualityResultCounts(): Promise<{ all: number; pending: number; reviewed: number }> {
  const r = await req<{ counts?: { all: number; ai: number; reviewed: number } }>("/api/quality-results?pageSize=1")
  const c = r.counts ?? { all: 0, ai: 0, reviewed: 0 }
  return { all: c.all, pending: c.ai, reviewed: c.reviewed }
}

/** 质量总览真数据：KPI 由真实质检结果计算；无数据的板块返回空（页面显示空态，不造假数）。 */
export async function realQualityOverview(): Promise<OverviewData> {
  const r = await req<{ items: Record<string, any>[]; counts?: { all: number; ai: number; reviewed: number } }>(
    "/api/quality-results?pageSize=200")
  const items = r.items ?? []
  const scored = items.filter((x) => typeof x.score === "number")
  const avg = scored.length ? scored.reduce((a, x) => a + x.score, 0) / scored.length : 0
  const issue = items.filter((x) => (x.issueCount ?? 0) > 0).length
  const critical = items.filter((x) => x.critical).length
  const c = r.counts ?? { all: items.length, ai: 0, reviewed: 0 }
  return {
    kpis: [
      { label: "质检交互总数", value: String(c.all), delta: "真实数据", deltaTone: "neutral" },
      { label: "平均质量得分", value: scored.length ? avg.toFixed(1) : "—", delta: scored.length ? `${scored.length} 条有分` : "暂无评分", deltaTone: "neutral" },
      { label: "问题交互率", value: c.all ? `${Math.round((issue / c.all) * 100)}%` : "—", delta: `${issue} 条有问题`, deltaTone: issue > 0 ? "warning" : "neutral" },
      { label: "Critical", value: String(critical), delta: critical > 0 ? "需关注" : "无", deltaTone: critical > 0 ? "danger" : "success" },
      { label: "已复核", value: String(c.reviewed), delta: `${c.ai} 条待复核`, deltaTone: "neutral" },
    ],
    trend: [],       // 历史趋势需要按日聚合，待后端提供（真实空态）
    attention: [],
    topIssues: [],
    sceneQuality: [],
  }
}

/** 坐席分析真数据：Agent 维度由真实 agents+runs 汇总；细分板块真实空态。 */
export async function realAgentAnalysis(): Promise<AgentAnalysisData> {
  const [agents, results, runs] = await Promise.all([
    req<{ items: Record<string, any>[] }>("/api/agents?pageSize=100"),
    req<{ items: Record<string, any>[] }>("/api/quality-results?pageSize=200"),
    req<{ runId: string; status: string }[]>("/api/runs"),
  ])
  const items = results.items ?? []
  const scored = items.filter((x) => typeof x.score === "number")
  const avg = scored.length ? scored.reduce((a, x) => a + x.score, 0) / scored.length : 0
  const runCount = Array.isArray(runs) ? runs.length : 0
  const succ = Array.isArray(runs) ? runs.filter((x) => x.status === "succeeded").length : 0
  return {
    scopeSummary: [
      { label: "Agent 总数", value: String((agents.items ?? []).length) },
      { label: "运行总数", value: String(runCount) },
      { label: "运行成功率", value: runCount ? `${Math.round((succ / runCount) * 100)}%` : "—" },
      { label: "质检结果", value: String(items.length) },
      { label: "平均得分", value: scored.length ? avg.toFixed(1) : "—" },
    ],
    trend: [],
    teams: [],
    agents: (agents.items ?? []).map((a) => ({
      agent: String(a.name ?? a.id), team: String(a.typeLabel ?? "-"),
      valid: runCount, avgScore: scored.length ? Number(avg.toFixed(1)) : 0,
      issueRate: 0, critical: 0, topProblem: "—", topScene: "—",
    })),
    attentionAgents: [],
    problems: [],
    scenes: [],
    related: [],
  }
}

/* ---------- 业务深化适配器 ---------- */
import type { AnalysisTask, DataAsset, ResultRuleSet } from "@/domain/types"

export const bizApi = {
  rules: () => req<Paged<Record<string, any>>>("/api/result-rules").then((r) => r.items as ResultRuleSet[]),
  rule: (id: string) => req<Record<string, any>>(`/api/result-rules/${id}`),
  createRule: (body: { name: string; description?: string; rules?: Record<string, unknown> }) =>
    req<{ id: string }>("/api/result-rules", { method: "POST", body: JSON.stringify(body) }),
  updateRule: (id: string, body: Record<string, unknown>) =>
    req<Record<string, any>>(`/api/result-rules/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  publishRule: (id: string) => req<{ version: number; recalculated: number }>(`/api/result-rules/${id}/publish`, { method: "POST" }),
  review: (id: string, body: Record<string, unknown>) =>
    req<Record<string, any>>(`/api/quality-results/${id}/review`, { method: "POST", body: JSON.stringify(body) }),
  qualityDetail: (id: string) => req<Record<string, any>>(`/api/quality-results/${id}`),
  assets: () => req<Paged<Record<string, any>>>("/api/data-assets").then((r) => r.items as DataAsset[]),
  createAsset: (body: { name: string; rows?: unknown[] }) =>
    req<{ id: string }>("/api/data-assets", { method: "POST", body: JSON.stringify(body) }),
  asset: (id: string) => req<Record<string, any>>(`/api/data-assets/${id}`),
  appendRows: (id: string, rows: unknown[]) =>
    req<Record<string, any>>(`/api/data-assets/${id}/rows`, { method: "POST", body: JSON.stringify({ rows }) }),
  tasks: () => req<Paged<Record<string, any>>>("/api/tasks").then((r) => r.items as AnalysisTask[]),
  task: (id: string) => req<Record<string, any>>(`/api/tasks/${id}`),
  createTask: (body: Record<string, unknown>) => req<{ id: string; name: string }>("/api/tasks", { method: "POST", body: JSON.stringify(body) }),
  updateTask: (id: string, body: Record<string, unknown>) =>
    req<{ id: string; name: string; status: string }>(`/api/tasks/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  setTaskStatus: (id: string, status: "Active" | "Paused") =>
    req<{ id: string; status: string }>(`/api/tasks/${id}/status`, { method: "POST", body: JSON.stringify({ status }) }),
  addEvidence: (resultId: string, body: { kind?: string; text: string; sourceRef?: string }) =>
    req<{ id: string; kind: string }>(`/api/quality-results/${resultId}/evidence`, { method: "POST", body: JSON.stringify(body) }),
  batchRun: (id: string, limit?: number, window?: { start?: string; end?: string }) =>
    req<{ runIds: string[] }>(`/api/tasks/${id}/batch-run`, { method: "POST", body: JSON.stringify({ limit, window }) }),
  taskSchedule: (id: string, cron: string, timezone = "Asia/Shanghai") =>
    req<{ id: string; nextRunAt: string }>(`/api/tasks/${id}/schedule`, { method: "POST", body: JSON.stringify({ cron, timezone }) }),
}

export async function realQualityDetail(id: string): Promise<Record<string, any>> {
  const q = await req<Record<string, any>>(`/api/quality-results/${id}`)
  const hist = q.reviewHistory ?? q.review_history ?? []
  const last = hist[hist.length - 1]
  return {
    interactionId: q.interactionId || q.id,
    interactionTime: q.interactionTime ?? new Date().toISOString(),
    org: ORG, businessContext: BC_Q, requestType: "-", requestSummary: q.issueSummary ?? "-",
    score: q.score ?? undefined, risk: q.risk ?? undefined, critical: !!q.critical,
    issueCount: q.issueCount ?? 0, issueSummary: q.issueSummary ?? undefined,
    review: { status: REVIEW_MAP[q.review] ?? "PENDING", reviewer: last?.reviewer },
    hasAudio: false,
    execution: { runId: q.runId ?? "-", taskId: "-", status: "SUCCESS", agentVersion: "-" },
    transcript: (q.transcript ?? []).map((t: any, i: number) => ({
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
  }
}
