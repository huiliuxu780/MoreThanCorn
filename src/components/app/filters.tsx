import { Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { FilterMap } from "@/lib/list-filters"
import { cn } from "@/lib/utils"

/** 列表页 Toolbar 容器。 */
export function FilterBar({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {children}
    </div>
  )
}

/** 搜索框（受控 + 清除按钮）。 */
export function SearchField({
  value,
  onChange,
  placeholder = "搜索...",
  className,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}) {
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-64 pl-8"
      />
      {value ? (
        <button
          type="button"
          aria-label="清除搜索"
          onClick={() => onChange("")}
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded-sm text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  )
}

export interface FilterChip {
  key: string
  label: string
}

/** 当前生效筛选 Chips（Design Spec §10.5）：drill-down 进入时自动转换。 */
export function ActiveFilters({
  filters,
  labels,
  onRemove,
  onClear,
}: {
  filters: FilterMap
  labels?: Record<string, (value: string) => string>
  onRemove: (key: string) => void
  onClear: () => void
}) {
  const entries = Object.entries(filters)
  if (entries.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {entries.map(([key, value]) => (
        <button
          key={key}
          type="button"
          onClick={() => onRemove(key)}
          className="inline-flex items-center gap-1 rounded-full border bg-muted px-2.5 py-0.5 text-xs text-foreground hover:bg-muted/70"
        >
          {labels?.[key] ? labels[key](value) : value}
          <X className="size-3 text-muted-foreground" />
        </button>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-2 text-xs text-muted-foreground"
        onClick={onClear}
      >
        清除全部
      </Button>
    </div>
  )
}
