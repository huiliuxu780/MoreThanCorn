/** CORTEX 品牌标识（09-08 v2，用户提供新 logo）：三等距圆角块 C 标 + 小写字标锁排。
 * mark 用 currentColor 吃四主题（light 黑/dark 白）；源图存 public/brand/cortex-mark-v2.png。 */
import { cn } from "@/lib/utils"

export function CortexMark({ className }: { className?: string }) {
  /* 09-08 v2：三等距圆角块 C 标；currentColor 吃四主题（light 黑 / dark 白）；圆角靠同色 stroke+linejoin round */
  return (
    <svg viewBox="0 0 64 64" className={cn("block", className)} aria-label="CORTEX" role="img"
      fill="currentColor" stroke="currentColor" strokeWidth="5" strokeLinejoin="round">
      <path d="M24 10 L44 2 L60 11 L40 20 Z" />
      <path d="M6 20 L20 13 L20 45 L6 52 Z" />
      <path d="M24 54 L44 45 L60 54 L40 63 Z" />
    </svg>
  )
}

export function CortexLockup({ className, markClass = "size-7" }: { className?: string; markClass?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <CortexMark className={markClass} />
      <span className="text-xl font-bold leading-none tracking-[0.02em]">cortex</span>
    </span>
  )
}
