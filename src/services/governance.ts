/**
 * 发布治理（09 P2-08）：版本 Diff / 审批 / Canary / 发布 / 回滚 的前端服务。
 *
 * 服务端是最终强制点；此处同时提供可在纯前端单测的状态机/摘要纯函数，
 * 供发布治理面板渲染"当前可执行动作"与 Diff 摘要。
 */
import { WF_BASE, wfApiToken, ApiError } from "@/services/wf-api"

export type GovernanceResourceType = "workflow" | "rule" | "definition" | "task"
export type ReleaseState = "pending" | "approved" | "rejected" | "released" | "rolled_back"
export type ReleaseAction = "approve" | "reject" | "release" | "promote" | "rollback"

export interface ReleaseRequest {
  id: string
  resourceType: GovernanceResourceType
  resourceId: string
  fromVersionNo: number | null
  toVersionNo: number
  state: ReleaseState
  canary: boolean
  canaryScope: Record<string, unknown>
  canaryPromoted: boolean
  requestedBy: string
  approvedBy: string | null
  approvedAt: string | null
  rejectedReason: string
  releasedAt: string | null
  rolledBackAt: string | null
  note: string
  createdAt: string
}

export interface VersionDiff {
  resourceType: GovernanceResourceType
  resourceId: string
  from: number
  to: number
  added: Record<string, unknown>
  removed: Record<string, unknown>
  changed: Record<string, { from: unknown; to: unknown }>
  hasChanges: boolean
}

// ---------- 纯函数：状态机 ----------

/** 给定当前状态，返回可执行的动作集合（与服务端门禁一致）。 */
export function allowedActions(state: ReleaseState, canary: boolean, canaryPromoted: boolean): ReleaseAction[] {
  switch (state) {
    case "pending":
      return ["approve", "reject"]
    case "approved":
      return ["release"]
    case "released": {
      const acts: ReleaseAction[] = []
      if (canary && !canaryPromoted) acts.push("promote")
      acts.push("rollback")
      return acts
    }
    case "rejected":
    case "rolled_back":
      return []
    default:
      return []
  }
}

/** 终态：不再允许任何动作。 */
export function isTerminal(state: ReleaseState): boolean {
  return state === "rejected" || state === "rolled_back"
}

export const STATE_LABEL: Record<ReleaseState, string> = {
  pending: "待审批",
  approved: "已批准",
  rejected: "已驳回",
  released: "已发布",
  rolled_back: "已回滚",
}

export const ACTION_LABEL: Record<ReleaseAction, string> = {
  approve: "批准",
  reject: "驳回",
  release: "发布",
  promote: "转全量",
  rollback: "回滚",
}

export const RESOURCE_TYPE_LABEL: Record<GovernanceResourceType, string> = {
  workflow: "工作流",
  rule: "结果规则",
  definition: "数据定义",
  task: "分析任务",
}

// ---------- 纯函数：Diff 摘要 ----------

export interface DiffSummary {
  added: number
  removed: number
  changed: number
  total: number
}

export function summarizeDiff(d: Pick<VersionDiff, "added" | "removed" | "changed">): DiffSummary {
  const added = Object.keys(d.added ?? {}).length
  const removed = Object.keys(d.removed ?? {}).length
  const changed = Object.keys(d.changed ?? {}).length
  return { added, removed, changed, total: added + removed + changed }
}

/** 把 Diff 拍平成可渲染的行列表（按 path 排序，稳定输出）。 */
export function diffRows(d: Pick<VersionDiff, "added" | "removed" | "changed">):
  Array<{ path: string; kind: "added" | "removed" | "changed"; from?: unknown; to?: unknown }> {
  const rows: Array<{ path: string; kind: "added" | "removed" | "changed"; from?: unknown; to?: unknown }> = []
  for (const [path, v] of Object.entries(d.added ?? {})) rows.push({ path, kind: "added", to: v })
  for (const [path, v] of Object.entries(d.removed ?? {})) rows.push({ path, kind: "removed", from: v })
  for (const [path, c] of Object.entries(d.changed ?? {})) rows.push({ path, kind: "changed", from: c.from, to: c.to })
  return rows.sort((a, b) => a.path.localeCompare(b.path))
}

// ---------- API 客户端 ----------

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const tok = wfApiToken()
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

export const governanceApi = {
  diff: (resourceType: GovernanceResourceType, resourceId: string, from: number, to: number) =>
    req<VersionDiff>(`/api/governance/diff?resourceType=${resourceType}&resourceId=${resourceId}&from=${from}&to=${to}`),
  list: (params?: { resourceType?: GovernanceResourceType; resourceId?: string; state?: ReleaseState }) => {
    const q = new URLSearchParams()
    if (params?.resourceType) q.set("resourceType", params.resourceType)
    if (params?.resourceId) q.set("resourceId", params.resourceId)
    if (params?.state) q.set("state", params.state)
    const s = q.toString()
    return req<{ items: ReleaseRequest[] }>(`/api/governance/release-requests${s ? `?${s}` : ""}`)
  },
  get: (id: string) => req<ReleaseRequest>(`/api/governance/release-requests/${id}`),
  create: (body: { resourceType: GovernanceResourceType; resourceId: string; toVersionNo: number; canary?: boolean; canaryScope?: Record<string, unknown>; note?: string }) =>
    req<ReleaseRequest>("/api/governance/release-requests", { method: "POST", body: JSON.stringify(body) }),
  approve: (id: string) => req<ReleaseRequest>(`/api/governance/release-requests/${id}/approve`, { method: "POST" }),
  reject: (id: string, reason = "") =>
    req<ReleaseRequest>(`/api/governance/release-requests/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) }),
  release: (id: string) => req<ReleaseRequest>(`/api/governance/release-requests/${id}/release`, { method: "POST" }),
  promote: (id: string) => req<ReleaseRequest>(`/api/governance/release-requests/${id}/promote`, { method: "POST" }),
  rollback: (id: string) => req<ReleaseRequest>(`/api/governance/release-requests/${id}/rollback`, { method: "POST" }),
}
