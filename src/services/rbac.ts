/**
 * RBAC（SDD D-4）：四角色权限矩阵，真鉴权（原型阶段角色存 localStorage，可切换）。
 * 规则：
 * - 无 View 权限 → 隐藏导航项 / route 403
 * - 无 Action 权限 → 隐藏或禁用
 * - viewer：只读；editor：可编辑不可发布；publisher：可发布；admin：全部
 */
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

export function currentRole(): Role {
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
