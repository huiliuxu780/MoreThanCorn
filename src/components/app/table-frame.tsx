import type * as React from "react"
import { cn } from "@/lib/utils"

/** 统一表格外框：圆角 + 边框 + 卡片背景。 */
export function TableFrame({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("overflow-hidden rounded-lg border bg-card", className)}>
      {children}
    </div>
  )
}
