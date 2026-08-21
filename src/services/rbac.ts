/**
 * RBAC UI 行为（Implementation Spec §3）。
 * 原型阶段默认授予全部权限；真实接入时替换为权限服务 adapter。
 *
 * 规则：
 * - 无 View 权限 → 隐藏导航项 / route 403
 * - 无 Action 权限 → 默认隐藏（避免永久 Disabled 按钮）
 * - 有权限但对象状态约束 → Disabled + Tooltip 解释
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

export const rbac = {
  can(_permission: Permission): boolean {
    return true
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
