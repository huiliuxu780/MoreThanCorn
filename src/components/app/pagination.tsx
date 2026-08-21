import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

/**
 * 统一分页（Implementation Spec §4 / §6）。
 * server-side 分页形态：total 由服务端返回。
 */
export function Pagination({
  page,
  pageSize,
  total,
  pageSizeOptions = [20, 50, 100],
  onPageChange,
  onPageSizeChange,
}: {
  page: number
  pageSize: number
  total: number
  pageSizeOptions?: number[]
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1
  const end = Math.min(total, page * pageSize)

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1 py-2 text-sm text-muted-foreground">
      <span>
        {start}–{end} / {total.toLocaleString("zh-CN")}
      </span>
      <div className="flex items-center gap-3">
        <Select
          value={String(pageSize)}
          onValueChange={(value) => onPageSizeChange(Number(value))}
        >
          <SelectTrigger className="h-8 w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {pageSizeOptions.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size} 条/页
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            aria-label="上一页"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="px-2 text-xs tabular-nums">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            aria-label="下一页"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
