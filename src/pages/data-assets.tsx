import { Plus } from "lucide-react"
import { useEffect, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { FilterBar, SearchField } from "@/components/app/filters"
import { EmptyState, ErrorState, FilteredEmptyState, TableSkeleton } from "@/components/app/list-state"
import { PageContainer, PageHeader } from "@/components/app/page"
import { Pagination } from "@/components/app/pagination"
import { StatusBadge } from "@/components/app/status-badge"
import { TableFrame } from "@/components/app/table-frame"
import { useAsyncData } from "@/hooks/use-async-data"
import { useListQuery } from "@/hooks/use-list-query"
import { formatDateTime } from "@/lib/time"
import { parseListFilters, serializeListFilters } from "@/lib/list-filters"
import { listDataAssets } from "@/services/mock-service"
import { rbac } from "@/services/rbac"

export default function DataAssetsPage() {
  const navigate = useNavigate()
  const { params, update } = useListQuery(20)
  const filters = parseListFilters(params.filters)
  const { data, loading, error, retry } = useAsyncData(() => listDataAssets(params), [
    params.search,
    params.page,
    params.pageSize,
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

  const canManage = rbac.can("asset.manage")

  return (
    <PageContainer wide className="space-y-3">
      <PageHeader
        title="数据定义"
        description="定义什么数据可以被分析，以及数据字段的含义"
        actions={
          canManage ? (
            <Button asChild>
              <Link to="/config/data-assets/new"><Plus className="size-4" /> 创建数据资产</Link>
            </Button>
          ) : null
        }
      />

      <FilterBar>
        <SearchField value={searchInput} onChange={setSearchInput} placeholder="搜索数据资产..." />
        <Select value={filters.lifecycle ?? "__all__"} onValueChange={(v) => setFilter("lifecycle", v)}>
          <SelectTrigger className="h-9 w-32"><SelectValue placeholder="Lifecycle" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">全部 Lifecycle</SelectItem>
            <SelectItem value="Draft">Draft</SelectItem>
            <SelectItem value="Ready">Ready</SelectItem>
            <SelectItem value="Deprecated">Deprecated</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filters.health ?? "__all__"} onValueChange={(v) => setFilter("health", v)}>
          <SelectTrigger className="h-9 w-32"><SelectValue placeholder="Health" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">全部 Health</SelectItem>
            <SelectItem value="Healthy">Healthy</SelectItem>
            <SelectItem value="Degraded">Degraded</SelectItem>
            <SelectItem value="Error">Error</SelectItem>
          </SelectContent>
        </Select>
      </FilterBar>

      {error ? (
        <ErrorState title="数据资产加载失败" onRetry={retry} />
      ) : loading ? (
        <TableFrame><TableSkeleton rows={5} columns={7} /></TableFrame>
      ) : !data || data.items.length === 0 ? (
        filters.lifecycle || filters.health || params.search ? (
          <FilteredEmptyState onClear={() => { setSearchInput(""); update({ filters: "", search: "" }, true) }} />
        ) : (
          <EmptyState title="暂无数据资产" description="创建第一个 Data Asset，定义可分析的生产数据" />
        )
      ) : (
        <>
          <TableFrame>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>来源</TableHead>
                  <TableHead>一条数据代表什么</TableHead>
                  <TableHead>时间字段</TableHead>
                  <TableHead>Lifecycle</TableHead>
                  <TableHead>Health</TableHead>
                  <TableHead>最近更新</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((asset) => (
                  <TableRow key={asset.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/config/data-assets/${asset.id}`)}>
                    <TableCell>
                      <div className="text-sm font-medium">{asset.name}</div>
                      {asset.currentRevision > 0 ? <div className="text-xs text-muted-foreground">R{asset.currentRevision}</div> : null}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{asset.source}</TableCell>
                    <TableCell className="text-sm">{asset.recordMeaning}</TableCell>
                    <TableCell className="text-sm">{asset.timeFieldLabel}</TableCell>
                    <TableCell><StatusBadge status={asset.lifecycle} /></TableCell>
                    <TableCell><StatusBadge status={asset.health} /></TableCell>
                    <TableCell className="text-sm tabular-nums">{formatDateTime(asset.updatedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableFrame>
          <Pagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            onPageChange={(page) => update({ page })}
            onPageSizeChange={(pageSize) => update({ pageSize })}
          />
        </>
      )}
    </PageContainer>
  )
}
