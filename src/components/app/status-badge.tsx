import { STATUS_LABELS, STATUS_TONES } from "@/config/ui-terms"
import type { StatusTone } from "@/domain/types"
import { Badge } from "@/components/ui/badge"

/**
 * 统一状态 Badge（Implementation Spec §2）。
 * 颜色只是辅助语义，状态文字始终存在。
 *
 * context 用于消歧：
 * - PENDING 在 Review 语境为 warning（待复核），在 Run 语境为 neutral（等待中）。
 */
export function StatusBadge({
  status,
  label,
  context,
  className,
}: {
  status: string
  label?: string
  context?: "review" | "run"
  className?: string
}) {
  let tone: StatusTone = STATUS_TONES[status] ?? "neutral"
  let text = label ?? STATUS_LABELS[status] ?? status

  if (status === "PENDING" && context === "review") {
    tone = "warning"
    text = label ?? "待复核"
  }
  if (status === "PENDING" && context === "run") {
    tone = "neutral"
    text = label ?? "等待中"
  }

  return (
    <Badge variant={tone} className={className}>
      {text}
    </Badge>
  )
}

/** 风险等级 Badge：Critical / High / Medium / Low。 */
export function RiskBadge({
  risk,
  className,
}: {
  risk?: string
  className?: string
}) {
  if (!risk) {
    return <span className={className}>—</span>
  }
  const tone: StatusTone =
    risk === "Critical" ? "danger" : risk === "High" ? "warning" : "neutral"
  return (
    <Badge variant={tone} className={className}>
      {risk}
    </Badge>
  )
}

/** 复核状态 Badge。 */
export function ReviewBadge({
  status,
  className,
}: {
  status: "PENDING" | "IN_REVIEW" | "COMPLETED" | "REOPENED" | "NONE"
  className?: string
}) {
  if (status === "NONE") return <span className={className}>—</span>
  return <StatusBadge status={status} context="review" className={className} />
}
