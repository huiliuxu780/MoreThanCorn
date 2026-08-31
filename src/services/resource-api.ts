/** 资源管理 API 客户端（P3+）。契约：uiux/03-backend-frontend-design.md §6。 */
import { WF_BASE, wfApiToken, type Paged } from "@/services/wf-api"

export interface ResourceDTO {
  id: string
  type: string
  name: string
  description: string
  status: "enabled" | "disabled"
  /** SDD-12 §11.2：untested/healthy/degraded/failed/stale（untested 不得显示为 healthy） */
  health: "untested" | "healthy" | "degraded" | "failed" | "stale" | "error"
  metadata: Record<string, unknown>
  usage: { refCount: number; calls7d: number }
  updatedAt: string
  config?: Record<string, unknown>
  changeLog?: { action: string; actor: string; detail: Record<string, unknown>; at: string }[]
}

export interface RefInfo {
  kind: string
  label?: string
  id?: string
  workflowId?: string
  workflowName?: string
  version?: string
  nodeName?: string
}

export interface TestResult {
  ok: boolean; error?: string; latencyMs?: number; output?: Record<string, unknown>
  /** SDD-12 P0-04：服务端 CheckRun 记录与配置指纹（启用门禁依据） */
  checkRunId?: string; configFingerprint?: string; traceId?: string
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const tok = typeof wfApiToken === "function" ? wfApiToken() : ""
  const res = await fetch(`${WF_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
    ...init,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    const err = new Error(`${res.status}`) as Error & { status?: number; refs?: RefInfo[]; code?: string }
    err.status = res.status
    if (body?.detail && typeof body.detail === "object" && Array.isArray(body.detail.refs)) err.refs = body.detail.refs
    // SDD-12 §13.4 统一错误信封：{code, message, ...}
    if (body?.detail && typeof body.detail === "object" && typeof body.detail.message === "string") {
      err.message = body.detail.message
      if (body.detail.code) err.code = body.detail.code
    } else if (typeof body?.detail === "string") err.message = body.detail
    throw err
  }
  return res.json() as Promise<T>
}

export const AI_COLL = { model: "models", tool: "tools", mcp: "mcp-servers", knowledge: "knowledge-sources" } as const
export const DATA_COLL = { datasource: "datasources", asset: "assets" } as const
export type AiType = keyof typeof AI_COLL
export type DataType = keyof typeof DATA_COLL

function base(type: string): string {
  if (type in AI_COLL) return `/api/ai-resources/${AI_COLL[type as AiType]}`
  return `/api/data-resources/${DATA_COLL[type as DataType]}`
}

export interface ListParams { page?: number; pageSize?: number; search?: string; status?: string; health?: string; type?: string }

export const resApi = {
  list: (type: string, p: ListParams = {}) => {
    const q = new URLSearchParams()
    if (p.page) q.set("page", String(p.page))
    if (p.pageSize) q.set("pageSize", String(p.pageSize))
    if (p.search) q.set("search", p.search)
    if (p.status) q.set("status", p.status)
    if (p.health) q.set("health", p.health)
    if (p.type) q.set("type", p.type)
    return req<Paged<ResourceDTO>>(`${base(type)}?${q}`)
  },
  get: (type: string, id: string) => req<ResourceDTO>(`${base(type)}/${id}`),
  create: (type: string, body: Record<string, unknown>) =>
    req<{ id: string; name: string; status: string }>(base(type), { method: "POST", body: JSON.stringify(body) }),
  update: (type: string, id: string, body: Record<string, unknown>) =>
    req<Record<string, unknown>>(`${base(type)}/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  remove: (type: string, id: string) => req<{ ok: boolean }>(`${base(type)}/${id}`, { method: "DELETE" }),
  toggle: (type: string, id: string, enabled: boolean) =>
    req<{ enabled: boolean }>(`${base(type)}/${id}/toggle`, { method: "POST", body: JSON.stringify({ enabled }) }),
  test: (type: string, id: string, input?: Record<string, unknown>) =>
    req<TestResult>(`${base(type)}/${id}/test`, { method: "POST", body: JSON.stringify(input ?? {}) }),
  usage: (type: string, id: string) => req<{ refs: RefInfo[] }>(`${base(type)}/${id}/usage`),
  toolVersions: (id: string) => req<{ id: string; version: number; status: string; spec: Record<string, unknown> }[]>(`/api/ai-resources/tools/${id}/versions`),
  newToolVersion: (id: string) => req<{ version: number; status: string }>(`/api/ai-resources/tools/${id}/versions`, { method: "POST" }),
  registry: (types: string, enabledOnly = true) =>
    req<{ items: { id: string; type: string; name: string; status: string; metadata: Record<string, unknown> }[] }>(
      `/api/registry/resources?types=${types}&enabledOnly=${enabledOnly}`),
}

export interface DefinitionDTO {
  id: string; name: string; assetId: string; assetName: string;
  lifecycle: "Draft" | "Ready" | "Deprecated"; revision: number;
  fieldCount: number; taskCount: number; updatedAt: string;
  /** 09 P0-B4：最新已发布版本（任务绑定用） */
  latestVersionId?: string | null; latestVersionNo?: number | null;
  fieldSchema?: { key: string; displayName: string; type: string; required: boolean; description?: string }[];
  eligibility?: string[];
  changeLog?: { action: string; actor: string; detail: Record<string, unknown>; at: string }[];
}

export const defApi = {
  list: (p: { assetId?: string; search?: string; page?: number; pageSize?: number } = {}) => {
    const q = new URLSearchParams()
    if (p.assetId) q.set("assetId", p.assetId)
    if (p.search) q.set("search", p.search)
    if (p.page) q.set("page", String(p.page))
    if (p.pageSize) q.set("pageSize", String(p.pageSize))
    return req<Paged<DefinitionDTO>>(`/api/data-definitions?${q}`)
  },
  get: (id: string) => req<DefinitionDTO>(`/api/data-definitions/${id}`),
  create: (body: { name: string; assetId: string; fieldSchema?: unknown[]; eligibility?: string[] }) =>
    req<{ id: string }>("/api/data-definitions", { method: "POST", body: JSON.stringify(body) }),
  update: (id: string, body: Record<string, unknown>) =>
    req<Record<string, unknown>>(`/api/data-definitions/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  publish: (id: string) => req<{ revision: number; lifecycle: string; versionId: string; versionNo: number }>(`/api/data-definitions/${id}/publish`, { method: "POST" }),
  infer: (id: string) => req<{ fieldSchema: DefinitionDTO["fieldSchema"] }>(`/api/data-definitions/${id}/infer`, { method: "POST" }),
  remove: (id: string) => req<{ ok: boolean }>(`/api/data-definitions/${id}`, { method: "DELETE" }),
}

export interface SecretRevisionInfo { configured: boolean; versionNo?: number; rotatedAt?: string; rotatedBy?: string }
export interface ConnectionEnvDTO {
  code: string; label?: string; endpoint?: Record<string, unknown>; secretConfigured?: boolean
  /** SDD-12 §11.2 环境级健康度 */
  health?: string
  secretRevision?: SecretRevisionInfo
}
export interface ConnectionDTO {
  id: string; name: string; kind: string; protocol: string; endpoint: Record<string, unknown>;
  status: string; secretConfigured: boolean; updatedAt: string;
  /** SDD-12：生命周期（draft/active/disabled/archived）与健康度分离 */
  lifecycle?: "draft" | "active" | "disabled" | "archived"; health?: string;
  revision?: number; archivedAt?: string | null; secretRevision?: SecretRevisionInfo;
  providerHint?: string; environments?: ConnectionEnvDTO[]; defaultEnv?: string | null; authScript?: string;
}
export type ConnSecret = string | Record<string, string>
/** 更新路径的环境条目=纯 patch（SDD-12 修复轮 B-03）：不接受任何 secret 字段，
 * 凭据写入一律走 rotateSecret/clearSecret。 */
export interface ConnectionEnvPatch {
  code: string; label?: string; endpoint?: Record<string, unknown>; remove?: boolean
}
export interface ConnectionBody {
  name: string; protocol: string; endpoint: Record<string, unknown>; kind?: string;
  providerHint?: string; secret?: ConnSecret; authScript?: string | null; default_env?: string | null;
  environments?: ConnectionEnvPatch[];
}

export const connApi = {
  list: (p: { type?: string; search?: string; lifecycle?: string } = {}) => {
    const q = new URLSearchParams()
    if (p.type) q.set("type", p.type)
    if (p.search) q.set("search", p.search)
    if (p.lifecycle) q.set("lifecycle", p.lifecycle)
    return req<Paged<ConnectionDTO>>(`/api/connections?${q}`)
  },
  get: (id: string) => req<ConnectionDTO>(`/api/connections/${id}`),
  create: (body: ConnectionBody) =>
    req<{ id: string; name: string; lifecycle?: string }>("/api/connections", { method: "POST", body: JSON.stringify(body) }),
  /** SDD-12 P0-01：secret 缺省/空=保留原密钥；根级 secret 变更一律走 rotateSecret
   *（PUT 携带 secret 会被服务端 422 拒绝，这里防御性剥离）。 */
  update: (id: string, body: Partial<ConnectionBody>) => {
    const { secret: _ignored, ...rest } = body
    return req<{ id: string; name: string; revision?: number }>(`/api/connections/${id}`, { method: "PUT", body: JSON.stringify(rest) })
  },
  test: (id: string, env?: string) =>
    req<{ ok: boolean; error?: string; checkRunId?: string; traceId?: string; latencyMs?: number; envCode?: string; diagnostics?: Record<string, unknown> }>(`/api/connections/${id}/test`, {
      method: "POST", body: JSON.stringify(env ? { env } : {}),
    }),
  /** 空跑鉴权（内置算法/脚本）：不落库、不打网络 */
  dryRunSign: (body: { kind: string; secret?: ConnSecret | null; script?: string | null; envVars?: Record<string, string> }) =>
    req<{ headers: Record<string, string>; logs: string[] }>("/api/connections/dry-run-sign", {
      method: "POST", body: JSON.stringify(body),
    }),
  /** SDD-12 §5.3：唯一常规写 Secret 入口；旧版本退役，新版本生效。不回显明文。 */
  rotateSecret: (id: string, secret: ConnSecret, envCode?: string) =>
    req<{ ok: boolean; envCode: string; versionNo: number; rotatedAt: string }>(
      `/api/connections/${id}/secret:rotate`,
      { method: "POST", body: JSON.stringify({ secret, envCode: envCode || null }) }),
  /** SDD-12 §5.3/B-03：confirm 必须为 CLEAR_SECRET；有引用时需 force。 */
  clearSecret: (id: string, confirm: string, opts: { envCode?: string; force?: boolean } = {}) =>
    req<{ ok: boolean; envCode: string; retired: number }>(
      `/api/connections/${id}/secret:clear`,
      { method: "POST", body: JSON.stringify({ envCode: opts.envCode || null, confirm, force: !!opts.force }) }),
  /** SDD-12 C-02：启用须通过当前配置指纹的真实检查 */
  enable: (id: string) => req<{ id: string; lifecycle: string }>(`/api/connections/${id}:enable`, { method: "POST" }),
  disable: (id: string) => req<{ id: string; lifecycle: string }>(`/api/connections/${id}:disable`, { method: "POST" }),
  /** SDD-12 B-05~B-07：有引用 409；默认归档；hard=true 仅限无引用 draft */
  remove: (id: string, opts: { hard?: boolean } = {}) =>
    req<{ ok: boolean; lifecycle?: string; hardDeleted?: boolean }>(
      `/api/connections/${id}${opts.hard ? "?hard=true" : ""}`, { method: "DELETE" }),
}
