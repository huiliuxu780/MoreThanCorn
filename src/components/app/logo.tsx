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
