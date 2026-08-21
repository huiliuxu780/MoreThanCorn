import type * as React from "react"
import {
  CircleAlert,
  CircleCheck,
  CircleSlash,
  Info,
  LoaderCircle,
  TriangleAlert,
} from "lucide-react"
import type { StatusTone } from "@/domain/types"
import { cn } from "@/lib/utils"

const toneText: Record<StatusTone, string> = {
  neutral: "text-muted-foreground",
  info: "text-blue-600 dark:text-blue-400",
  success: "text-emerald-600 dark:text-emerald-400",
  warning: "text-amber-600 dark:text-amber-400",
  danger: "text-red-600 dark:text-red-400",
}

const toneBlock: Record<StatusTone, string> = {
  neutral: "border-border bg-muted/50 text-foreground",
  info: "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-200",
  success:
    "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200",
  warning:
    "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200",
  danger:
    "border-red-200 bg-red-50 text-red-900 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200",
}

/** Icon + Label 的状态指示（Implementation Spec §2.1）。 */
export function StatusIcon({
  tone,
  className,
  spinning = false,
}: {
  tone: StatusTone
  className?: string
  spinning?: boolean
}) {
  if (spinning) {
    return <LoaderCircle className={cn("size-4 animate-spin", toneText[tone], className)} />
  }
  const Icon =
    tone === "success"
      ? CircleCheck
      : tone === "danger"
        ? CircleAlert
        : tone === "warning"
          ? TriangleAlert
          : tone === "info"
            ? Info
            : CircleSlash
  return <Icon className={cn("size-4", toneText[tone], className)} />
}

/** 页面级状态提示条（错误摘要、阻塞原因等）。 */
export function StatusNotice({
  tone,
  title,
  children,
  className,
}: {
  tone: StatusTone
  title?: React.ReactNode
  children?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("rounded-lg border px-4 py-3 text-sm", toneBlock[tone], className)}>
      {title ? <div className="font-medium">{title}</div> : null}
      {children ? <div className="mt-1 space-y-1">{children}</div> : null}
    </div>
  )
}
