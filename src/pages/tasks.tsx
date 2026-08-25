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
import { agentApi, bizApi, listDataAssets } from "@/services/wf-api"
import { formatCompactDateTime } from "@/lib/time"
import { toast } from "sonner"
import { rbac } from "@/services/rbac"

export default function TasksPage() {
  const navigate = useNavigate()
  const { params, update } = useListQuery(20)
  const filters = useMemo(() => parseListFilters(params.filters), [params.filters])
  const { data, loading, error, retry } = useAsyncData(() => bizApi.tasks().then((items) => ({ items, total: items.length, page: 1, pageSize: 50 })), [
    params.search,
    params.page,
    params.pageSize,
    params.filters,
  ])
  // D-5：筛选选项改真数据（此前来自 mocks/data）
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([])
  const [dataAssets, setDataAssets] = useState<{ id: string; name: string }[]>([])
  useEffect(() => {
    agentApi.list({ page: 1, pageSize: 100 }).then((r) => setAgents(r.items ?? [])).catch(() => undefined)
    listDataAssets().then((r) => setDataAssets(r.items ?? [])).catch(() => undefined)
  }, [])

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
            <SelectItem value="启用">启用</SelectItem>
            <SelectItem value="停用">停用</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filters.agent ?? "__all__"} onValueChange={(v) => setFilter("agent", v)}>
          <SelectTrigger className="h-9 w-40"><SelectValue placeholder="Agent" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">全部 Agent</SelectItem>
            {agents.map((a) => (
              <SelectItem key={a.id} value={a.name}>{a.name}</SelectItem>
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
      ) : !data || data.items.length === 0 ? (
        filters.status || filters.agent || filters.asset || params.search ? (
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
                  <TableHead>Agent</TableHead>
                  <TableHead>Data Asset</TableHead>
                  <TableHead>调度</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>最近运行</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((task) => (
                  <TableRow key={task.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/config/tasks/${task.id}`)}>
                    <TableCell>
                      <div className="text-sm font-medium">{task.name}</div>
                      {task.description ? <div className="line-clamp-1 max-w-md text-xs text-muted-foreground">{task.description}</div> : null}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{task.agentName}</div>
                      <div className="text-xs text-muted-foreground">
                        {task.agentVersionPolicy === "Latest Published" ? "Latest Published" : `Fixed ${task.fixedAgentVersion}`}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{task.dataAssetName}</TableCell>
                    <TableCell>
                      <div className="text-sm">{task.schedule}</div>
                      <div className="text-xs text-muted-foreground">{task.dataWindow}</div>
                    </TableCell>
                    <TableCell><StatusBadge status={task.status} /></TableCell>
                    <TableCell>
                      {task.lastRun ? (
                        <>
                          <StatusBadge status={task.lastRun.status} context="run" />
                          {task.lastRun.finishedAt ? (
                            <div className="mt-0.5 text-xs text-muted-foreground">{formatCompactDateTime(task.lastRun.finishedAt)}</div>
                          ) : null}
                        </>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                        {(
                          <>
                            <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={async () => {
                              const r = await bizApi.batchRun(task.id)
                              toast.success(`批跑已启动 ${r.runIds.length} 个 Run`)
                            }}>批跑</Button>
                            <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={async () => {
                              const r = await bizApi.taskSchedule(task.id, "0 9 * * *")
                              toast.success(`周期已设置：${new Date(r.nextRunAt).toLocaleString()}`)
                            }}>周期</Button>
                          </>
                        )}
                      </div>
                    </TableCell></TableRow>
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
