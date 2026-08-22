/** 真实后端客户端（P0）。VITE_WF_API=1 时启用。契约源：server/contracts。 */
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
export const runExportUrl = (runId: string) => `${WF_BASE}/api/runs/${runId}/export`

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
      agentName: "workflow", agentVersion: "-", dataAssetName: "-", dataAssetRevision: 0,
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

/* ---------- 质检业务层联调：quality_result/evidence ---------- */
import type { ListResponse, QualityResult } from "@/domain/types"

const REVIEW_MAP: Record<string, "NONE" | "PENDING" | "IN_REVIEW" | "COMPLETED" | "REOPENED"> = {
  AI: "PENDING", REVIEWED: "IN_REVIEW", EFFECTIVE: "COMPLETED",
}
const ORG = { agentId: "-", agentName: "-", teamId: "-", teamName: "-", departmentId: "-", departmentName: "-" }
const BC_Q = { brand: "-", productCategory: "-", serviceType: "-", issueTopic: "-" }

export async function realQualityResults(params: { page?: number; pageSize?: number }): Promise<ListResponse<QualityResult>> {
  const r = await req<Paged<Record<string, any>>>(
    `/api/quality-results?page=${params.page ?? 1}&pageSize=${params.pageSize ?? 20}`)
  return {
    items: r.items.map((q) => ({
      interactionId: q.interactionId || q.id, interactionTime: q.interactionTime,
      org: ORG, businessContext: BC_Q, requestType: "-", requestSummary: q.issueSummary ?? "-",
      score: q.score ?? undefined, risk: q.risk ?? undefined, critical: !!q.critical,
      issueCount: q.issueCount ?? 0, issueSummary: q.issueSummary ?? undefined,
      review: { status: REVIEW_MAP[q.review] ?? "PENDING" }, hasAudio: false,
      execution: { runId: q.execution?.runId ?? "-", taskId: "-", status: q.execution?.status ?? "SUCCESS", agentVersion: "-" },
    })),
    total: r.total, page: r.page, pageSize: r.pageSize,
  }
}

export async function realQualityResultDetail(id: string) {
  return req<Record<string, any>>(`/api/quality-results/${id}`)
}
