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
  const res = await fetch(`${WF_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
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
