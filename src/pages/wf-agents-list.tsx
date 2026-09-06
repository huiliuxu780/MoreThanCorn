/** MTC-005：Agent 列表 = 数字员工档案卡。真 API；封存 Agent 独立折叠区只读。 */
import { useCallback, useEffect, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { ChevronDown, Plus } from "lucide-react"
import { useListQuery } from "@/hooks/use-list-query"
import { Pagination } from "@/components/app/pagination"
import { agentApi, pagedApi } from "@/services/wf-api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { EmptyState, ErrorState, TableSkeleton } from "@/components/app/list-state"
import { PageContainer, PageHeader } from "@/components/app/page"
import { formatCompactDateTime } from "@/lib/time"

export const AVATARS = Array.from({ length: 20 }, (_, i) => `/avatars/avatar-${i}.png`)

/** 头像回落：按 id 哈希稳定取图，保证列表/详情一致。 */
export function avatarFor(id: string, avatar?: string | null) {
  return avatar ?? AVATARS[id.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % AVATARS.length]
}

interface AgentRow {
  id: string; name: string; type: string; typeLabel: string; status: string; updatedAt: string; description?: string; avatar?: string | null;
  archived?: boolean;
  moduleKey?: string | null; moduleVersion?: string | null;
  latestVersion?: number | null; sandboxVersion?: number | null; prodVersion?: number | null
}

interface ModuleMeta { key: string; version: string; displayName: string; description: string; riskClass: string; providers: string[]; logicalTools: string[]; criteria: string[] }

function lifecycleOf(r: AgentRow): { label: string; variant: "neutral" | "info" | "success" | "warning" } {
  if (r.archived) return { label: "已封存", variant: "neutral" }
  if (r.prodVersion != null) return { label: `生产 V${r.prodVersion}`, variant: "success" }
  if (r.sandboxVersion != null) return { label: `沙箱 V${r.sandboxVersion}`, variant: "info" }
  if (r.latestVersion != null) return { label: `草稿 V${r.latestVersion}`, variant: "warning" }
  return { label: "草稿", variant: "warning" }
}

function AgentCard({ r, role, onOpen }: { r: AgentRow; role: string; onOpen: () => void }) {
  const lc = lifecycleOf(r)
  return (
    <button
      type="button"
      onClick={onOpen}
      className="space-y-2 rounded-lg border bg-surface p-4 text-left shadow-sm transition-colors hover:border-brand/50 hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
    >
      <div className="flex items-start gap-3">
        <img src={avatarFor(r.id, r.avatar)} alt="" className="size-10 rounded-lg object-cover" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-semibold">{r.name}</span>
            <Badge variant={lc.variant}>{lc.label}</Badge>
          </div>
          <div className="truncate text-xs text-muted-foreground">Role：{role}</div>
        </div>
      </div>
      {r.description ? <div className="line-clamp-2 text-xs text-muted-foreground">{r.description}</div> : null}
      <div className="space-y-1 text-xs text-muted-foreground">
        <div>Module：{r.moduleKey ?? "—"} · Runtime：{r.typeLabel}</div>
        <div>当前版本：V{r.latestVersion ?? "—"} · 更新：{r.updatedAt ? formatCompactDateTime(r.updatedAt) : "—"}</div>
        <div>运行摘要：—</div>
      </div>
    </button>
  )
}

export default function WfAgentsListPage() {
  const navigate = useNavigate()
  const { params, update } = useListQuery(12)
  const search = params.search ?? ""
  const [rows, setRows] = useState<AgentRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [sort, setSort] = useState<"updated" | "name">("updated")
  const [typeFilter, setTypeFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState<"active" | "archived">("active")
  const [modules, setModules] = useState<ModuleMeta[]>([])
  const [archOpen, setArchOpen] = useState(false)

  useEffect(() => {
    agentApi.modules().then((r) => setModules(r.items)).catch(() => undefined)
  }, [])

  const load = useCallback(() => {
    setLoading(true)
    setError(false)
    pagedApi.agents({ page: params.page, pageSize: params.pageSize, search, archived: statusFilter === "archived" ? "true" : undefined })
      .then((r) => { setRows(r.items as AgentRow[]); setTotal(r.total); setLoading(false) })
      .catch(() => { setLoading(false); setError(true) })
  }, [params.page, params.pageSize, search, statusFilter])
  useEffect(() => { load() }, [load])

  const roleOf = (r: AgentRow) => modules.find((m) => m.key === r.moduleKey)?.displayName ?? r.typeLabel

  const filtered = rows
    .filter((r) => typeFilter === "all" || r.type === typeFilter)
    .sort((a, b) => (sort === "name"
      ? a.name.localeCompare(b.name, "zh-CN")
      : (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")))
  const active = filtered.filter((r) => !r.archived)
  const archived = filtered.filter((r) => r.archived)

  return (
    <PageContainer wide className="space-y-4">
      <PageHeader
        title="Agent"
        description="有身份、有角色、有能力、有工作状态的数字员工"
        actions={
          <Button asChild size="sm">
            <Link to="/agents/new"><Plus className="size-4" /> 新建 Agent</Link>
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="搜索 Agent" aria-label="搜索 Agent" className="h-8 w-48"
          value={search} onChange={(e) => update({ search: e.target.value || undefined }, true)} />
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as "active" | "archived")}>
          <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="active">使用中</SelectItem>
            <SelectItem value="archived">已封存</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部运行时</SelectItem>
            <SelectItem value="module">领域 Module</SelectItem>
            <SelectItem value="autonomous">自主规划</SelectItem>
            <SelectItem value="dialogue">对话编排</SelectItem>
            <SelectItem value="expert-group">专家组</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => setSort(v as "updated" | "name")}>
          <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="updated">按更新时间</SelectItem>
            <SelectItem value="name">按名称</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {error ? <ErrorState title="Agent 加载失败" onRetry={load} />
        : loading ? <TableSkeleton rows={6} columns={4} />
          : active.length === 0 && statusFilter === "active" ? (
            <EmptyState title="暂无 Agent" description="从官方 Module 模板或空白模板创建第一个数字员工" />
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {active.map((r) => (
                <AgentCard key={r.id} r={r} role={roleOf(r)} onOpen={() => navigate(`/agents/${r.id}`)} />
              ))}
            </div>
          )}

      {statusFilter === "active" && archived.length > 0 ? (
        <Collapsible open={archOpen} onOpenChange={setArchOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground">
              <ChevronDown className={`size-4 transition-transform ${archOpen ? "rotate-180" : ""}`} />
              已封存 Agent（{archived.length}）· 只读
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 grid gap-3 md:grid-cols-2 xl:grid-cols-3 opacity-80">
              {archived.map((r) => (
                <AgentCard key={r.id} r={r} role={roleOf(r)} onOpen={() => navigate(`/agents/${r.id}`)} />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      ) : null}

      <Pagination page={params.page ?? 1} pageSize={params.pageSize ?? 12} total={total}
        onPageChange={(p: number) => update({ page: p }, true)}
        onPageSizeChange={(ps: number) => update({ pageSize: ps, page: 1 }, true)} />
    </PageContainer>
  )
}
