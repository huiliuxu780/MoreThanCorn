/** Theme-R：Workflow 设计器主题桥接。
 *  DOM/内联样式一律走 index.css token（C 色板 = var(--*)，见 components/wf/controls.tsx）；
 *  本文件只服务两类无法用 var() 的场景：
 *  1. SVG attribute / Canvas 语境（MiniMap）——按 resolvedTheme 取具体值；
 *  2. CodeMirror 等需要显式 light/dark 模式名的第三方组件。
 *  禁止在此新增 Light-only 常量：每个值必须双主题成对出现。 */
import { useTheme } from "next-themes"

export type UiTheme = "light" | "dark"

/** 当前生效主题（next-themes resolvedTheme；system 已解析，未挂载时按 light）。 */
export function useUiTheme(): UiTheme {
  const { resolvedTheme } = useTheme()
  return resolvedTheme === "dark" ? "dark" : "light"
}

/** MiniMap 具体色值（SVG attribute 场景），与 --wf-* token 同源同值。 */
export const MINIMAP_THEME: Record<UiTheme, {
  node: string; stroke: string; mask: string; bg: string
}> = {
  light: { node: "#A9B0A6", stroke: "#A9B0A6", mask: "rgba(244, 245, 242, 0.6)", bg: "#FFFFFF" },
  dark: { node: "#4C544E", stroke: "#4C544E", mask: "rgba(11, 12, 11, 0.6)", bg: "#101211" },
}

/** 运行状态 → semantic token（DOM 内联样式场景；品牌绿不承担状态语义）。 */
export const RUN_STATUS_COLOR: Record<string, string> = {
  succeeded: "var(--status-success)",
  success: "var(--status-success)",
  failed: "var(--status-danger)",
  running: "var(--status-running)",
  skipped: "var(--text-secondary)",
  queued: "var(--text-secondary)",
  cancelled: "var(--text-secondary)",
}

/** CodeMirror 主题名（第三方组件按模式名切换）。 */
export function codeTheme(ui: UiTheme): "light" | "dark" {
  return ui === "dark" ? "dark" : "light"
}
