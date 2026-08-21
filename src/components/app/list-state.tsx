import { CircleAlert, Inbox } from "lucide-react"
import type * as React from "react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table"

/** Loading → Skeleton（Implementation Spec §7）。 */
export function TableSkeleton({
  rows = 6,
  columns = 6,
}: {
  rows?: number
  columns?: number
}) {
  return (
    <Table>
      <TableBody>
        {Array.from({ length: rows }).map((_, row) => (
          <TableRow key={row}>
            {Array.from({ length: columns }).map((__, col) => (
              <TableCell key={col}>
                <Skeleton className="h-4 w-full max-w-40" />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function CardGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-36 rounded-lg" />
      ))}
    </div>
  )
}

/**
 * Empty State（Implementation Spec §7 / Design Spec §2.1）：
 * 说明为什么没有内容 + 下一步动作，避免纯插画占位。
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center">
      <Inbox className="size-8 text-muted-foreground/60" />
      <div className="text-sm font-medium">{title}</div>
      {description ? (
        <p className="max-w-sm text-xs text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}

/** 筛选后无结果：保留 Toolbar + 清除筛选（Design Spec §10.13）。 */
export function FilteredEmptyState({ onClear }: { onClear: () => void }) {
  return (
    <EmptyState
      title="没有找到符合条件的数据"
      description="尝试调整搜索或筛选条件"
      action={
        <Button variant="outline" size="sm" onClick={onClear}>
          清除筛选
        </Button>
      }
    />
  )
}

/** Request Error → Inline Error + Retry（Implementation Spec §7）。 */
export function ErrorState({
  title = "内容加载失败",
  description,
  onRetry,
}: {
  title?: string
  description?: string
  onRetry?: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center">
      <CircleAlert className="size-8 text-destructive/70" />
      <div className="text-sm font-medium">{title}</div>
      {description ? (
        <p className="max-w-sm text-xs text-muted-foreground">{description}</p>
      ) : null}
      {onRetry ? (
        <div className="mt-2">
          <Button variant="outline" size="sm" onClick={onRetry}>
            重新加载
          </Button>
        </div>
      ) : null}
    </div>
  )
}
