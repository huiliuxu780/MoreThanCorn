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

/* MTC-001：状态色统一走 --status-* token，明暗两套值由 CSS 变量切换。 */
const toneText: Record<StatusTone, string> = {
  neutral: "text-muted-foreground",
  info: "text-status-running",
  success: "text-status-success",
  warning: "text-status-warning",
  danger: "text-status-danger",
}

const toneBlock: Record<StatusTone, string> = {
  neutral: "border-border bg-muted/50 text-foreground",
  info: "border-status-running/30 bg-status-running/10 text-status-running",
  success:
    "border-status-success/30 bg-status-success/10 text-status-success",
  warning:
    "border-status-warning/30 bg-status-warning/10 text-status-warning",
  danger:
    "border-status-danger/30 bg-status-danger/10 text-status-danger",
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
