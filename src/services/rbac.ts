/**
 * RBAC（09 P0-B4）：服务端身份优先的前端权限矩阵。
 *
 * 规则：
 * - 鉴权开启（服务端要求登录）时：角色来自 /api/auth/me（operator→publisher 映射）；
 *   未登录 → viewer 且标记 authRequired（页面应引导登录）。
 * - 开发环境（服务端匿名放行）：允许本地角色切换（原型调试用），默认 admin。
 * - 服务端是最终强制点：即使前端显示按钮，越权请求会被 403 拒绝。
 */
import { authApi, setWfApiToken } from "@/services/wf-api"

export type Permission =
  | "quality.view"
  | "quality.review"
  | "task.view"
  | "task.manage"
  | "agent.view"
  | "agent.edit"
  | "agent.publish"
  | "tool.view"
  | "tool.manage"
  | "tool.publish"
  | "asset.view"
  | "asset.manage"
  | "rules.view"
  | "rules.manage"
  | "rules.publish"
  | "connection.view"
  | "connection.manage"
  | "admin.audit"
  | "admin.force-unlock"

export type Role = "viewer" | "editor" | "publisher" | "admin"

const VIEW_PERMS: Permission[] = [
  "quality.view", "task.view", "agent.view", "tool.view", "asset.view",
  "rules.view", "connection.view",
]
const MANAGE_PERMS: Permission[] = [
  "task.manage", "agent.edit", "tool.manage", "asset.manage",
  "rules.manage", "connection.manage", "quality.review",
]
const PUBLISH_PERMS: Permission[] = ["agent.publish", "tool.publish", "rules.publish"]
const ADMIN_PERMS: Permission[] = ["admin.audit", "admin.force-unlock"]

export const ROLES: { value: Role; label: string }[] = [
  { value: "viewer", label: "Viewer（只读）" },
  { value: "editor", label: "Editor（可编辑）" },
  { value: "publisher", label: "Publisher（可发布）" },
  { value: "admin", label: "Admin（全部）" },
]

/** 服务端角色 → 前端角色映射（09 P0-10 后端角色：admin|operator|viewer）。 */
export function mapServerRole(role: string): Role {
  if (role === "admin") return "admin"
  if (role === "operator") return "publisher"
  return "viewer"
}

let serverRole: Role | null = null      // null=尚未初始化/匿名
let authRequired = false                 // true=服务端强制登录且当前未登录
let serverUsername = ""

/** 启动时解析身份：尝试 /api/auth/me；401 → 需要登录。 */
export async function initAuth(): Promise<{ authenticated: boolean; username: string; role: Role | null }> {
  try {
    const me = await authApi.me()
    serverRole = mapServerRole(me.role)
    serverUsername = me.username
    authRequired = false
    if (typeof localStorage !== "undefined") localStorage.setItem("wf_role", serverRole)
    return { authenticated: true, username: serverUsername, role: serverRole }
  } catch (e) {
    const status = (e as { status?: number }).status
    if (status === 401 || status === 403) {
      serverRole = null
      authRequired = true
      return { authenticated: false, username: "", role: null }
    }
    // 服务端不可达/其他错误：回退本地角色（开发态）
    serverRole = null
    authRequired = false
    return { authenticated: false, username: "", role: currentRole() }
  }
}

export function isAuthenticated(): boolean {
  return serverRole !== null
}

export function isAuthRequired(): boolean {
  return authRequired
}

export function currentUsername(): string {
  return serverUsername || "dev"
}

export async function login(username: string, password: string): Promise<Role> {
  const r = await authApi.login(username, password)
  setWfApiToken(r.token)
  serverRole = mapServerRole(r.user.role)
  serverUsername = r.user.username
  authRequired = false
  if (typeof localStorage !== "undefined") localStorage.setItem("wf_role", serverRole)
  return serverRole
}

export function logout() {
  setWfApiToken("")
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem("wf_api_token")
    localStorage.removeItem("wf_role")
  }
  serverRole = null
  serverUsername = ""
}

export function currentRole(): Role {
  if (serverRole) return serverRole
  if (typeof localStorage === "undefined") return "admin"
  const r = localStorage.getItem("wf_role")
  return (["viewer", "editor", "publisher", "admin"].includes(r ?? "") ? r : "admin") as Role
}

export function setRole(r: Role) {
  if (typeof localStorage !== "undefined") localStorage.setItem("wf_role", r)
}

function permsFor(role: Role): Set<Permission> {
  if (role === "viewer") return new Set(VIEW_PERMS)
  if (role === "editor") return new Set([...VIEW_PERMS, ...MANAGE_PERMS])
  if (role === "publisher") return new Set([...VIEW_PERMS, ...MANAGE_PERMS, ...PUBLISH_PERMS])
  return new Set([...VIEW_PERMS, ...MANAGE_PERMS, ...PUBLISH_PERMS, ...ADMIN_PERMS])
}

export const rbac = {
  can(permission: Permission): boolean {
    return permsFor(currentRole()).has(permission)
  },
  /**
   * 返回动作可见性：
   * - hidden：无权限，隐藏
   * - enabled：可执行
   * - disabled：有权限，但当前对象状态不允许（需 Tooltip 解释）
   */
  actionVisibility(
    permission: Permission,
    allowedByState = true,
  ): "hidden" | "enabled" | "disabled" {
    if (!rbac.can(permission)) return "hidden"
    return allowedByState ? "enabled" : "disabled"
  },
}
