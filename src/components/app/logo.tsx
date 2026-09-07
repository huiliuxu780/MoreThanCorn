/** CORTEX 品牌标识（09-07 用户提供 logo 复刻）：叠方块 mark + 字标锁排。
 * 明暗双变体走 token（--logo-front-a/b、--logo-back），源图存 public/brand/。 */
import { useId } from "react"
import { cn } from "@/lib/utils"

export function CortexMark({ className }: { className?: string }) {
  const id = useId()
  return (
    <svg viewBox="0 0 64 64" className={cn("block", className)} aria-label="CORTEX" role="img">
      <defs>
        <linearGradient id={`${id}-f`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--logo-front-a)" />
          <stop offset="1" stopColor="var(--logo-front-b)" />
        </linearGradient>
      </defs>
      <rect x="6" y="22" width="38" height="38" rx="11" fill="var(--logo-back)" />
      <rect x="20" y="4" width="38" height="38" rx="11" fill={`url(#${id}-f)`} />
      <path d="M20 15a11 11 0 0 1 11-11h16L20 31Z" fill="#FFFFFF" opacity="0.14" />
    </svg>
  )
}

export function CortexLockup({ className, markClass = "size-7" }: { className?: string; markClass?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <CortexMark className={markClass} />
      <span className="text-xl font-black leading-none tracking-[0.04em]">CORTEX</span>
    </span>
  )
}
