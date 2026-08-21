import { Plus } from "lucide-react"
import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { FilterBar, SearchField } from "@/components/app/filters"
import { EmptyState, ErrorState, FilteredEmptyState, TableSkeleton } from "@/components/app/list-state"
import { PageContainer, PageHeader } from "@/components/app/page"
import { Pagination } from "@/components/app/pagination"
import { StatusBadge } from "@/components/app/status-badge"
import { TableFrame } from "@/components/app/table-frame"
import { FormField } from "@/components/app/form-field"
import { useAsyncData } from "@/hooks/use-async-data"
import { useListQuery } from "@/hooks/use-list-query"
import { formatDateTime } from "@/lib/time"
import { parseListFilters, serializeListFilters } from "@/lib/list-filters"
import { listAgents } from "@/services/mock-service"
import { rbac } from "@/services/rbac"

export default function AgentsPage() {
  const navigate = useNavigate()
  const { params, update } = useListQuery(20)
  const filters = parseListFilters(params.filters)
  const { data, loading, error, retry } = useAsyncData(() => listAgents(params), [
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

  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")

  const canEdit = rbac.can("agent.edit")

  return (
    <PageContainer wide className="space-y-3">
      <PageHeader
        title="Agents"
        description="管理用于质量评价的 Agent"
        actions={
          canEdit ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" /> 新建 Agent
            </Button>
          ) : null
        }
      />

      <FilterBar>
        <SearchField value={searchInput} onChange={setSearchInput} placeholder="搜索 Agent..." />
        <Select
          value={filters.status ?? "__all__"}
          onValueChange={(v) => {
            const next = { ...filters }
            if (v === "__all__") delete next.status
            else next.status = v
            update({ filters: serializeListFilters(next) }, true)
          }}
        >
          <SelectTrigger className="h-9 w-32"><SelectValue placeholder="状态" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">全部状态</SelectItem>
            <SelectItem value="Draft">Draft</SelectItem>
            <SelectItem value="Testing">Testing</SelectItem>
            <SelectItem value="Published">Published</SelectItem>
            <SelectItem value="Deprecated">Deprecated</SelectItem>
          </SelectContent>
        </Select>
      </FilterBar>

      {error ? (
        <ErrorState title="Agents 加载失败" onRetry={retry} />
      ) : loading ? (
        <TableFrame><TableSkeleton rows={6} columns={4} /></TableFrame>
      ) : !data || data.items.length === 0 ? (
        filters.status || params.search ? (
          <FilteredEmptyState onClear={() => { setSearchInput(""); update({ filters: "", search: "" }, true) }} />
        ) : (
          <EmptyState title="暂无 Agent" description="创建第一个 Agent，进入 Designer 编排评价流程" />
        )
      ) : (
        <>
          <TableFrame>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称 + 描述</TableHead>
                  <TableHead>当前版本</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>最近更新</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((agent) => (
                  <TableRow key={agent.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/config/agents/${agent.id}`)}>
                    <TableCell>
                      <div className="text-sm font-medium">{agent.name}</div>
                      <div className="line-clamp-1 max-w-xl text-xs text-muted-foreground">{agent.description}</div>
                    </TableCell>
                    <TableCell className="text-sm">{agent.currentVersion}</TableCell>
                    <TableCell><StatusBadge status={agent.status} /></TableCell>
                    <TableCell>
                      <div className="text-sm tabular-nums">{formatDateTime(agent.updatedAt)}</div>
                      <div className="text-xs text-muted-foreground">{agent.updatedBy}</div>
                    </TableCell>
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

      {/* Create Agent：只填名称 + 描述（Design Spec §14.3） */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建 Agent</DialogTitle>
            <DialogDescription>创建后直接进入 Agent Designer；Model / Prompt / Tool 在 Designer 内配置</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <FormField label="名称" required>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：服务质量评价" />
            </FormField>
            <FormField label="描述">
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-16" />
            </FormField>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
            <Button
              disabled={!name.trim()}
              onClick={() => {
                toast.success("Agent 已创建：Draft V1")
                setCreateOpen(false)
                navigate("/config/agents/AG-01")
              }}
            >
              创建并进入 Designer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
