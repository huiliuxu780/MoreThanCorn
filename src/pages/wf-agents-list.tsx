/** MTC-005 + 09-07 原站对齐：Agent 列表 = 数字员工档案卡（竖排居中卡 + 统计行真数据）。
 * 度量/色值来源：.tmp-docs/agent-cap/measurements.md §1/§1b/§4（IAB 实测台账）。
 * 声明偏差：控件高度沿用我方 h-8 全局规格；segment 浅色用中性 token（原站浅色不可见=缺陷）。 */
import { useCallback, useEffect, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { MessageCircleMore, Plus, Settings2, Share2 } from "lucide-react"
import { toast } from "sonner"
import { useListQuery } from "@/hooks/use-list-query"
import { Pagination } from "@/components/app/pagination"
import { agentApi, pagedApi } from "@/services/wf-api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { ErrorState, TableSkeleton } from "@/components/app/list-state"
import { PageContainer, PageHeader } from "@/components/app/page"
import { AVATARS, avatarFor } from "@/lib/agent-avatar"

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

/** 原站统计行用相对日期（前天/暂无），窄列不折行（台账 §10）。 */
function relRun(v: string | null | undefined): string {
  if (!v) return "暂无"
  const d = Math.floor((Date.now() - new Date(v).getTime()) / 86400000)
  if (d <= 0) return "今天"
  if (d === 1) return "昨天"
  if (d === 2) return "前天"
  if (d < 30) return `${d} 天前`
  return v.slice(5, 10)
}

/** 统计行单列：label 三级色 13px + value 二级色 13px（台账 §1）。 */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-center justify-center gap-2 text-[13px] leading-5">
      <span className="text-(--text-tertiary)">{label}</span>
      <span className="whitespace-nowrap text-muted-foreground">{value}</span>
    </span>
  )
}

/** 卡片（台账 §1/§1b 修正版）：r6/pad16/gap8/统计行 h45；名称行纯居中，
 *  生命周期徽章占原站右上角空槽（absolute）；开卡按钮不嵌套交互元素。 */
function AgentCard({ r, role, onOpen, onChat, onConfig }: {
  r: AgentRow; role: string; onOpen: () => void; onChat?: () => void; onConfig: () => void
}) {
  const lc = lifecycleOf(r)
  return (
    <div className="group relative flex flex-col rounded-lg border bg-surface px-4 pt-5 pb-0 text-center shadow-sm transition-colors hover:border-brand/50 hover:bg-surface-raised">
      <span className="absolute right-3 top-3">
        <Badge variant={lc.variant}>{lc.label}</Badge>
      </span>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full flex-col items-center gap-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
      >
        <img src={avatarFor(r.id, r.avatar)} alt="" className="size-12 rounded-full object-cover" />
        <span className="flex w-full flex-col gap-1">
          <span className="flex w-full min-w-0 items-center justify-center gap-2">
            <span className="truncate text-base font-medium leading-6">{r.name}</span>
            <span className="flex shrink-0 items-center gap-1 truncate rounded-lg px-1.5 py-0.5 text-xs leading-[14px] text-(--text-tertiary)">
              {role}
            </span>
          </span>
          {r.description
            ? <span className="line-clamp-2 w-full text-xs leading-[18px] text-(--text-tertiary)">{r.description}</span>
            : null}
        </span>
      </button>
      {/* 台账 §7：footer 同格堆叠交叉淡入淡出（原站实测：hover 统计淡出/动作淡入，卡高恒定 212） */}
      <div className="relative mt-1 grid w-full py-1.5">
        <div className="col-start-1 row-start-1 grid grid-cols-[1fr_auto_1fr] items-center border-t py-3 transition-opacity duration-200 group-hover:opacity-0">
          <Stat label="任务数" value={String(r.runCount ?? 0)} />
          <span className="h-[18px] w-px bg-border" />
          <Stat label="最近运行" value={relRun(r.lastRunAt)} />
        </div>
        <div className="col-start-1 row-start-1 flex items-center gap-2 self-center opacity-0 pointer-events-none transition-opacity duration-200 group-hover:pointer-events-auto group-hover:opacity-100">
          <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label="配置" onClick={onConfig}>
            <Settings2 className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label="复制 ID"
            onClick={() => { void navigator.clipboard.writeText(r.id); toast.success("已复制 ID") }}>
            <Share2 className="size-4" />
          </Button>
          {onChat ? (
            <Button size="sm" className="h-8 min-w-0 flex-1 gap-1.5" onClick={onChat}>
              <MessageCircleMore className="size-4" /> 对话
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/** 首格虚线占位卡（台账 §1b：dashed + 叠卡 art + 标签）。 */
function CreateCard() {
  return (
    <Link
      to="/agents/new"
      className="flex min-h-[212px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-surface p-4 text-center transition-colors hover:border-brand/60"
    >
      <span className="relative flex h-[90px] w-[120px] items-center justify-center" aria-hidden="true">
        {AVATARS.map((a, i) => (
          <img key={a} src={a} alt=""
            className="absolute size-14 rounded-lg border bg-surface-raised object-cover shadow-sm"
            style={{ transform: `rotate(${(i - 2.5) * 7}deg) translateX(${(i - 2.5) * 12}px)`, zIndex: i }} />
        ))}
      </span>
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
    <PageContainer wide>
      <div className="space-y-4">
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
      <div className="flex h-8 w-fit items-center gap-1 rounded-lg bg-(--segment-bg) p-1">
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
          <SelectTrigger className="h-8 w-44"><span className="shrink-0 text-(--text-tertiary)">运行时</span><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部运行时</SelectItem>
            <SelectItem value="module">领域 Module</SelectItem>
            <SelectItem value="autonomous">自主规划</SelectItem>
            <SelectItem value="dialogue">对话编排</SelectItem>
            <SelectItem value="expert-group">专家组</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => setSort(v as "updated" | "name")}>
          <SelectTrigger className="h-8 w-44"><span className="shrink-0 text-(--text-tertiary)">排序</span><SelectValue /></SelectTrigger>
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
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,268px),1fr))]">
              <CreateCard />
            </div>
          ) : (
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,268px),1fr))]">
              {statusFilter === "active" ? <CreateCard /> : null}
              {filtered.map((r) => (
                <AgentCard key={r.id} r={r} role={roleOf(r)}
                  onOpen={() => navigate(`/agents/${r.id}`)}
                  onConfig={() => navigate(`/agents/${r.id}/config`)}
                  onChat={r.archived ? undefined : () => navigate(`/agents/${r.id}/chat`)} />
              ))}
            </div>
          )}

      <Pagination page={params.page ?? 1} pageSize={params.pageSize ?? 12} total={total}
        onPageChange={(p: number) => update({ page: p }, true)}
        onPageSizeChange={(ps: number) => update({ pageSize: ps, page: 1 }, true)} />
      </div>
    </PageContainer>
  )
}
