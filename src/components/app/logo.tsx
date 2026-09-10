/** CORTEX 品牌标识（09-08 成品资产版）：用户提供成品 PNG，抠透明底后 ink/paper 双变体。
 *  ink=黑墨（浅色主题用）/ paper=白（深色主题用），经 dark 自定义变体（data-theme dark/dark-parchment）切换。
 *  源资产存 public/brand/cortex-{mark,lockup}-{ink,paper}.png。 */
import { cn } from "@/lib/utils"

export function CortexMark({ className }: { className?: string }) {
  return (
    <>
      <img src="/brand/cortex-mark-ink.png" alt="CORTEX" draggable={false}
        className={cn("object-contain dark:hidden", className)} />
      <img src="/brand/cortex-mark-paper.png" alt="CORTEX" draggable={false}
        className={cn("hidden object-contain dark:block", className)} />
    </>
  )
}

export function CortexLockup({ className }: { className?: string }) {
  return (
    <>
      <img src="/brand/cortex-lockup-ink.png" alt="CORTEX" draggable={false}
        className={cn("h-7 w-auto dark:hidden", className)} />
      <img src="/brand/cortex-lockup-paper.png" alt="CORTEX" draggable={false}
        className={cn("hidden h-7 w-auto dark:block", className)} />
    </>
  )
}

/** 侧栏折叠/展开图标（QoderWake qc-quests-sidebar__fold 同构）。
 *  原站为无箭头的 panel-left 面板图标（fill=currentColor）：展开态=左栏实心块，
 *  收起态=左侧细竖线；几何取原站实测 SVG path 原值（勿换 lucide 带箭头版本）。 */
export function PanelFoldIcon({ collapsed, className }: { collapsed: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true" className={className}>
      <path
        d={
          collapsed
            ? "M21 3C21.5523 3 22 3.44772 22 4V20C22 20.5523 21.5523 21 21 21H3C2.44772 21 2 20.5523 2 20V4C2 3.44772 2.44772 3 3 3H21ZM20 5H4V19H20V5ZM8 7V17H6V7H8Z"
            : "M21 3C21.5523 3 22 3.44772 22 4V20C22 20.5523 21.5523 21 21 21H3C2.44772 21 2 20.5523 2 20V4C2 3.44772 2.44772 3 3 3H21ZM7 5H4V19H7V5ZM20 5H9V19H20V5Z"
        }
      />
    </svg>
  )
}
