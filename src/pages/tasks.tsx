import { Plus } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
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
import { parseListFilters, serializeListFilters } from "@/lib/list-filters"
import { bizApi, listDataAssets, wfApi } from "@/services/wf-api"
import { rbac } from "@/services/rbac"

export default function TasksPage() {
  const navigate = useNavigate()
  const { params, update } = useListQuery(20)
  const filters = useMemo(() => parseListFilters(params.filters), [params.filters])
  const { data, loading, error, retry } = useAsyncData(async () => {
    const items = await bizApi.tasks()
    return { items, total: items.length, page: 1, pageSize: 50 }
  }, [
    params.search,
    params.page,
    params.pageSize,
    params.filters,
  ])
  // 09 P0-B4：筛选词表=工作流/数据资产（任务绑定 Workflow，不再借 Agent 名义）
  const [workflows, setWorkflows] = useState<{ id: string; name: string }[]>([])
  const [dataAssets, setDataAssets] = useState<{ id: string; name: string }[]>([])
  useEffect(() => {
    wfApi.list({ pageSize: 100 }).then((r) => setWorkflows(r.items ?? [])).catch(() => undefined)
    listDataAssets().then((r) => setDataAssets(r.items ?? [])).catch(() => undefined)
  }, [])
  const wfName = (id: string) => workflows.find((w) => w.id === id)?.name ?? id.slice(0, 8)

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

  const canManage = rbac.can("task.manage")

  // 09 P0-B4：筛选真生效（此前筛选条件不进任何查询）
  const filteredItems = useMemo(() => {
    let items = data?.items ?? []
    if (filters.status) items = items.filter((t) => t.status === filters.status)
    if (filters.workflow) items = items.filter((t) => t.workflowId === filters.workflow)
    if (filters.asset) items = items.filter((t) => t.dataAssetId === filters.asset)
    if (params.search) {
      const s = params.search.toLowerCase()
      items = items.filter((t) => t.name.toLowerCase().includes(s) || t.description.toLowerCase().includes(s))
    }
    return items
  }, [data, filters, params.search])

  return (
    <PageContainer wide className="space-y-3">
      <PageHeader
        title="分析任务"
        description="管理质检任务的数据范围、执行周期和评价 Agent"
        actions={
          canManage ? (
            <Button asChild>
              <Link to="/config/tasks/new">
                <Plus className="size-4" /> 新建任务
              </Link>
            </Button>
          ) : null
        }
      />

      <FilterBar>
        <SearchField value={searchInput} onChange={setSearchInput} placeholder="搜索任务..." />
        <Select value={filters.status ?? "__all__"} onValueChange={(v) => setFilter("status", v)}>
          <SelectTrigger className="h-9 w-28"><SelectValue placeholder="状态" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">全部状态</SelectItem>
            <SelectItem value="active">启用</SelectItem>
            <SelectItem value="paused">停用</SelectItem>
            <SelectItem value="draft">草稿</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filters.workflow ?? "__all__"} onValueChange={(v) => setFilter("workflow", v)}>
          <SelectTrigger className="h-9 w-40"><SelectValue placeholder="工作流" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">全部工作流</SelectItem>
            {workflows.map((a) => (
              <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.asset ?? "__all__"} onValueChange={(v) => setFilter("asset", v)}>
          <SelectTrigger className="h-9 w-36"><SelectValue placeholder="Data Asset" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">全部 Data Asset</SelectItem>
            {dataAssets.map((a) => (
              <SelectItem key={a.id} value={a.name}>{a.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterBar>

      {error ? (
        <ErrorState title="分析任务加载失败" onRetry={retry} />
      ) : loading ? (
        <TableFrame><TableSkeleton rows={6} columns={6} /></TableFrame>
      ) : !data || filteredItems.length === 0 ? (
        filters.status || filters.workflow || filters.asset || params.search ? (
          <FilteredEmptyState onClear={() => { setSearchInput(""); update({ filters: "", search: "" }, true) }} />
        ) : (
          <EmptyState
            title="暂无分析任务"
            description="创建第一个分析任务，开始对生产数据执行质量评价"
            action={canManage ? <Button asChild><Link to="/config/tasks/new">新建任务</Link></Button> : null}
          />
        )
      ) : (
        <>
          <TableFrame>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>任务名称</TableHead>
                  <TableHead>执行目标</TableHead>
                  <TableHead>配置版本</TableHead>
                  <TableHead>Data Asset</TableHead>
                  <TableHead>状态</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.map((task) => {
                  const assetName = dataAssets.find((a) => a.id === task.dataAssetId)?.name ?? task.dataAssetId.slice(0, 8)
                  const policy = task.taskVersion?.workflowVersionPolicy ?? task.workflowVersionPolicy
                  const et = (task as { executionTargetType?: string; agentName?: string | null; moduleKey?: string | null })
                  return (
                    <TableRow key={task.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/config/tasks/${task.id}`)}>
                      <TableCell>
                        <div className="text-sm font-medium">{task.name}</div>
                        {task.description ? <div className="line-clamp-1 max-w-md text-xs text-muted-foreground">{task.description}</div> : null}
                      </TableCell>
                      <TableCell>
                        {et.executionTargetType === "agent" ? (
                          <><div className="text-sm">{et.agentName ?? "—"}</div>
                            <div className="text-xs text-muted-foreground">Module：{et.moduleKey ?? "—"}</div></>
                        ) : (
                          <><div className="text-sm">{wfName(task.workflowId)}</div>
                            <div className="text-xs text-muted-foreground">{policy === "pinned" ? "Fixed（钉住版本）" : "Latest Published"}</div></>
                        )}
                      </TableCell>
                      <TableCell className="text-sm tabular-nums">
                        {task.taskVersion ? `V${task.taskVersion.versionNo}` : "—"}
                      </TableCell>
                      <TableCell className="text-sm">{assetName}</TableCell>
                      <TableCell><StatusBadge status={task.status} /></TableCell>
                    </TableRow>
                  )
                })}
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
