/** MTC-005 + 09-07 原站对齐：Agent 列表 = 数字员工档案卡（竖排居中卡 + 统计行真数据）。
 * 度量/色值来源：.tmp-docs/agent-cap/measurements.md §1/§1b/§4（IAB 实测台账）。
 * 声明偏差：控件高度沿用我方 h-8 全局规格；segment 浅色用中性 token（原站浅色不可见=缺陷）。 */
import { useCallback, useEffect, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { MessageCircleMore, MoreHorizontal, Plus } from "lucide-react"
import { useListQuery } from "@/hooks/use-list-query"
import { Pagination } from "@/components/app/pagination"
import { agentApi, pagedApi } from "@/services/wf-api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { ErrorState, TableSkeleton } from "@/components/app/list-state"
import { PageContainer, PageHeader } from "@/components/app/page"
import { avatarFor } from "@/lib/agent-avatar"
import { formatCompactDateTime } from "@/lib/time"

interface AgentRow {
  id: string; name: string; type: string; typeLabel: string; status: string; updatedAt: string; description?: string; avatar?: string | null;
  archived?: boolean;
  moduleKey?: string | null; moduleVersion?: string | null;
  latestVersion?: number | null; sandboxVersion?: number | null; prodVersion?: number | null;
  runCount?: number; lastRunAt?: string | null;
}

interface ModuleMeta { key: string; version: string; displayName: string; description: string; riskClass: string; providers: string[]; logicalTools: string[]; criteria: string[] }

function lifecycleOf(r: AgentRow): { label: string; variant: "neutral" | "info" | "success" | "warning" } {
  if (r.archived) return { label: "已封存", variant: "neutral" }
  if (r.prodVersion != null) return { label: `生产 V${r.prodVersion}`, variant: "success" }
  if (r.sandboxVersion != null) return { label: `沙箱 V${r.sandboxVersion}`, variant: "info" }
  if (r.latestVersion != null) return { label: `草稿 V${r.latestVersion}`, variant: "warning" }
  return { label: "草稿", variant: "warning" }
}

/** 统计行单列：label 三级色 13px + value 二级色 13px（台账 §1）。 */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-center justify-center gap-2 text-[13px] leading-5">
      <span className="text-(--text-tertiary)">{label}</span>
      <span className="text-muted-foreground">{value}</span>
    </span>
  )
}

function AgentCard({ r, role, onOpen, onChat }: { r: AgentRow; role: string; onOpen: () => void; onChat?: () => void }) {
  const lc = lifecycleOf(r)
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex flex-col items-center gap-2 rounded-md border bg-surface p-4 text-center shadow-sm transition-colors hover:border-brand/50 hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
    >
      <img src={avatarFor(r.id, r.avatar)} alt="" className="size-12 rounded-full object-cover" />
      <div className="flex w-full min-w-0 items-center justify-center gap-2">
        <span className="truncate text-base font-medium leading-6">{r.name}</span>
        <Badge variant={lc.variant}>{lc.label}</Badge>
      </div>
      <span className="flex max-w-full items-center gap-1 truncate rounded-lg px-1.5 py-0.5 text-xs leading-[14px] text-(--text-tertiary)">
        {role}
      </span>
      {r.description
        ? <p className="line-clamp-2 w-full text-xs leading-[18px] text-(--text-tertiary)">{r.description}</p>
        : null}
      <div className="grid w-full grid-cols-[1fr_auto_1fr] items-center border-t pt-3">
        <Stat label="任务数" value={String(r.runCount ?? 0)} />
        <span className="h-[18px] w-px bg-border" />
        <Stat label="最近运行" value={r.lastRunAt ? formatCompactDateTime(r.lastRunAt) : "暂无"} />
      </div>
      <div className="hidden w-full items-center justify-center gap-3 group-hover:flex" onClick={(e) => e.stopPropagation()}>
        {onChat ? (
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-0 text-[13px] font-medium" onClick={onChat}>
            <MessageCircleMore className="size-4" /> 对话
          </Button>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8" aria-label="更多操作">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center">
            <DropdownMenuItem onClick={() => navigator.clipboard.writeText(r.id)}>复制 ID</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </button>
  )
}

/** 首格虚线占位卡（台账 §1b：dashed + 叠卡 art + 标签）。 */
function CreateCard() {
  return (
    <Link
      to="/agents/new"
      className="flex min-h-[212px] flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-surface p-4 text-center transition-colors hover:border-brand/60"
    >
      <svg viewBox="0 0 72 90" className="h-[90px] w-[72px]" aria-hidden="true">
        <rect x="14" y="10" width="44" height="56" rx="6" fill="var(--brand-soft)" stroke="var(--border)" transform="rotate(-8 36 38)" />
        <rect x="16" y="12" width="44" height="56" rx="6" fill="var(--surface-raised)" stroke="var(--border)" transform="rotate(4 38 40)" />
        <rect x="20" y="16" width="36" height="36" rx="4" fill="var(--brand-subtle)" transform="rotate(4 38 40)" />
        <circle cx="38" cy="30" r="7" fill="var(--text-primary)" transform="rotate(4 38 40)" />
        <path d="M26 50c2-8 7-11 12-11s10 3 12 11Z" fill="var(--text-primary)" transform="rotate(4 38 40)" />
      </svg>
      <span className="flex items-center gap-2 text-base leading-6 text-muted-foreground">
        <Plus className="size-4" /> 新建 Agent
      </span>
    </Link>
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
  const [archivedTotal, setArchivedTotal] = useState(0)

  useEffect(() => {
    agentApi.modules().then((r) => setModules(r.items)).catch(() => undefined)
    pagedApi.agents({ page: 1, pageSize: 1, archived: "true" }).then((r) => setArchivedTotal(r.total)).catch(() => undefined)
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

  return (
    <PageContainer wide className="space-y-4">
      <PageHeader
        title="Agent"
        description={`有身份、有角色、有能力、有工作状态的数字员工${archivedTotal > 0 ? ` · 旧版 Agent 已封存 ${archivedTotal} 个，仅历史查询` : ""}`}
        actions={
          <Button asChild size="sm">
            <Link to="/agents/new"><Plus className="size-4" /> 新建 Agent</Link>
          </Button>
        }
      />
      {/* segment：使用中/已封存（台账 §4 token 化） */}
      <div className="flex h-8 w-fit items-center gap-1 rounded-md bg-(--segment-bg) p-1">
        {(["active", "archived"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => { setStatusFilter(s); update({ page: 1 }, true) }}
            className={`h-6 rounded px-2.5 text-xs leading-4 transition-colors ${statusFilter === s
              ? "bg-(--segment-active) font-medium text-foreground"
              : "text-muted-foreground hover:text-foreground"}`}
          >
            {s === "active" ? "使用中" : "已封存"}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <Input placeholder="搜索名称或角色…" aria-label="搜索 Agent" className="h-8 w-[220px]"
          value={search} onChange={(e) => update({ search: e.target.value || undefined }, true)} />
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
        <span className="ml-auto text-sm leading-5 text-(--text-tertiary)">{total} 个 Agent</span>
      </div>

      {error ? <ErrorState title="Agent 加载失败" onRetry={load} />
        : loading ? <TableSkeleton rows={6} columns={4} />
          : filtered.length === 0 && statusFilter === "active" ? (
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
              <CreateCard />
            </div>
          ) : (
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
              {statusFilter === "active" ? <CreateCard /> : null}
              {filtered.map((r) => (
                <AgentCard key={r.id} r={r} role={roleOf(r)}
                  onOpen={() => navigate(`/agents/${r.id}`)}
                  onChat={r.archived ? undefined : () => navigate(`/agents/${r.id}/chat`)} />
              ))}
            </div>
          )}

      <Pagination page={params.page ?? 1} pageSize={params.pageSize ?? 12} total={total}
        onPageChange={(p: number) => update({ page: p }, true)}
        onPageSizeChange={(ps: number) => update({ pageSize: ps, page: 1 }, true)} />
    </PageContainer>
  )
}
