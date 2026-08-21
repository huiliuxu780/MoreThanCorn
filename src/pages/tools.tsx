import { Plus } from "lucide-react"
import { useEffect, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { FilterBar, SearchField } from "@/components/app/filters"
import { CardGridSkeleton, EmptyState, ErrorState, FilteredEmptyState } from "@/components/app/list-state"
import { PageContainer, PageHeader } from "@/components/app/page"
import { Pagination } from "@/components/app/pagination"
import { StatusBadge } from "@/components/app/status-badge"
import { useAsyncData } from "@/hooks/use-async-data"
import { useListQuery } from "@/hooks/use-list-query"
import { formatDateTime } from "@/lib/time"
import { parseListFilters, serializeListFilters } from "@/lib/list-filters"
import { listTools } from "@/services/mock-service"
import { rbac } from "@/services/rbac"

/** Tools 列表：4 列紧凑卡片 + 分页（Design Spec §15.2）。 */
export default function ToolsPage() {
  const navigate = useNavigate()
  const { params, update } = useListQuery(24)
  const filters = parseListFilters(params.filters)
  const { data, loading, error, retry } = useAsyncData(() => listTools(params), [
    params.search,
    params.page,
    params.pageSize,
    params.sort,
    params.filters,
  ])

  const [searchInput, setSearchInput] = useState(params.search ?? "")
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput !== (params.search ?? "")) update({ search: searchInput }, true)
    }, 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput])

  const setFilter = (key: string, value: string) => {
    const next = { ...filters }
    if (!value || value === "__all__") delete next[key]
    else next[key] = value
    update({ filters: serializeListFilters(next) }, true)
  }

  const canManage = rbac.can("tool.manage")

  return (
    <PageContainer wide className="space-y-3">
      <PageHeader
        title="Tools"
        description="Agent 可消费的可复用能力资产"
        actions={
          canManage ? (
            <Button asChild>
              <Link to="/config/tools/new"><Plus className="size-4" /> 创建 Tool</Link>
            </Button>
          ) : null
        }
      />

      <FilterBar>
        <SearchField value={searchInput} onChange={setSearchInput} placeholder="搜索 Tool..." />
        <Select value={filters.capability ?? "__all__"} onValueChange={(v) => setFilter("capability", v)}>
          <SelectTrigger className="h-9 w-32"><SelectValue placeholder="Capability" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">全部 Capability</SelectItem>
            <SelectItem value="READ">READ</SelectItem>
            <SelectItem value="WRITE">WRITE</SelectItem>
            <SelectItem value="ACTION">ACTION</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filters.governance ?? "__all__"} onValueChange={(v) => setFilter("governance", v)}>
          <SelectTrigger className="h-9 w-32"><SelectValue placeholder="状态" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">全部状态</SelectItem>
            <SelectItem value="Enabled">Enabled</SelectItem>
            <SelectItem value="Disabled">Disabled</SelectItem>
            <SelectItem value="Deprecated">Deprecated</SelectItem>
          </SelectContent>
        </Select>
        <Select value={params.sort || "updated:desc"} onValueChange={(v) => update({ sort: v }, true)}>
          <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="updated:desc">更新时间 · 最新优先</SelectItem>
            <SelectItem value="updated:asc">更新时间 · 最早优先</SelectItem>
            <SelectItem value="created:desc">创建时间 · 最新优先</SelectItem>
            <SelectItem value="created:asc">创建时间 · 最早优先</SelectItem>
          </SelectContent>
        </Select>
      </FilterBar>

      {error ? (
        <ErrorState title="Tools 加载失败" onRetry={retry} />
      ) : loading ? (
        <CardGridSkeleton count={8} />
      ) : !data || data.items.length === 0 ? (
        filters.capability || filters.governance || params.search ? (
          <FilteredEmptyState onClear={() => { setSearchInput(""); update({ filters: "", search: "" }, true) }} />
        ) : (
          <EmptyState title="暂无 Tool" description="创建第一个 API Tool，连接企业能力" />
        )
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {data.items.map((tool) => (
              <button
                key={tool.id}
                type="button"
                onClick={() => navigate(`/config/tools/${tool.id}`)}
                className="flex h-40 flex-col rounded-lg border bg-card p-3.5 text-left hover:border-muted-foreground/40"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{tool.name}</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {tool.source === "Built-in" ? "Built-in" : "API"} · {tool.connectionName ?? "平台内置"}
                    </div>
                  </div>
                  <Badge variant="outline" className="shrink-0 font-mono text-[10px]">{tool.capability}</Badge>
                </div>
                <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{tool.description}</p>
                <div className="mt-auto flex items-center justify-between pt-2 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <StatusBadge status={tool.governance} />
                    <span>{tool.currentVersion}{tool.versionStatus === "Draft" ? " · Draft" : ""}</span>
                  </span>
                  <span>{formatDateTime(tool.updatedAt).slice(5)}</span>
                </div>
              </button>
            ))}
          </div>
          <Pagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            pageSizeOptions={[12, 24, 48]}
            onPageChange={(page) => update({ page })}
            onPageSizeChange={(pageSize) => update({ pageSize })}
          />
        </>
      )}
    </PageContainer>
  )
}
