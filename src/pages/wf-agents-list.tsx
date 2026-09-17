/** MTC-005 + 09-07 原站对齐：Agent 列表 = 数字员工档案卡（竖排居中卡 + 统计行真数据）。
 * 度量/色值来源：.tmp-docs/agent-cap/measurements.md §1/§1b/§4（IAB 实测台账）。
 * 声明偏差：控件高度沿用我方 h-8 全局规格；segment 浅色用中性 token（原站浅色不可见=缺陷）。 */
import { useCallback, useEffect, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { Archive, ArchiveRestore, Contact, MessageCircleMore, Plus, Search, Settings2, Share2 } from "lucide-react"
import { toast } from "sonner"
import { useListQuery } from "@/hooks/use-list-query"
import { Pagination } from "@/components/app/pagination"
import { asApi } from "@/services/as-api"
import { agentApi, pagedApi } from "@/services/wf-api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { ErrorState, TableSkeleton } from "@/components/app/list-state"
import { PageContainer, PageHeader } from "@/components/app/page"
import { AVATARS, avatarFor } from "@/lib/agent-avatar"
import { GroupsView } from "@/features/groups/groups-view"

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
  if (r.type === "custom") return { label: "自定义角色", variant: "info" }
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
function AgentCard({ r, role, onOpen, onChat, onConfig, onToggleArchive }: {
  r: AgentRow; role: string; onOpen: () => void; onChat?: () => void; onConfig: () => void
  onToggleArchive: () => void
}) {
  const lc = lifecycleOf(r)
  return (
    <div className={`group relative flex min-h-[212px] flex-col rounded-lg border bg-surface px-4 pt-5 pb-0 text-center shadow-sm transition-[border-color,background-color,box-shadow] duration-200 hover:shadow-md ${r.archived ? "opacity-80" : ""}`}>
      <span className="absolute right-3 top-3 z-10">
        <Badge variant={lc.variant}>{lc.label}</Badge>
      </span>
      {/* identity：原站覆盖规则=居中竖列 gap16；main 居中竖列 gap4；desc clamp2 lh20 min-h40 恒占两行（行内对齐关键） */}
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full flex-col items-center gap-4 text-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
      >
        <img src={avatarFor(r.id, r.avatar)} alt="" className="size-12 shrink-0 rounded-full object-cover" />
        <span className="flex w-full flex-col items-center gap-1 text-center">
          <span className="flex w-full items-center justify-center gap-2.5">
            <span className="min-w-0 max-w-[calc((100%-10px)/2)] truncate text-base leading-6 font-[650]">{r.name}</span>
            <span className="flex min-w-0 max-w-[calc((100%-10px)/2)] shrink-0 items-center gap-[3px] rounded-lg px-1.5 py-0.5 text-xs leading-[14px] text-(--text-tertiary)">
              <Contact className="size-4 shrink-0" />
              <span className="truncate">{role}</span>
            </span>
          </span>
          <span className="line-clamp-2 min-h-10 w-full text-center text-xs leading-5 text-(--text-tertiary)">
            {r.description || ""}
          </span>
        </span>
      </button>
      {/* footer：stats 虚线上边线+py12；actions 同格堆叠、不透明底、底对齐 mb12、gap12；hover 交叉淡入淡出 */}
      <div className="relative mt-1 grid w-full pt-2">
        <div className="col-start-1 row-start-1 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center border-t border-dashed py-3 pointer-events-none transition-opacity duration-200 group-hover:opacity-0 group-hover:border-transparent">
          <Stat label="任务数" value={String(r.runCount ?? 0)} />
          <span className="h-[18px] w-px bg-border" />
          <Stat label="最近运行" value={relRun(r.lastRunAt)} />
        </div>
        {/* 操作行：z-10 必压过同格统计行（否则不可见统计层吞掉点击 = 假按钮） */}
        <div className="pointer-events-none col-start-1 row-start-1 z-10 mb-3 flex h-8 items-center gap-3 self-end bg-surface opacity-0 transition-opacity duration-200 group-hover:pointer-events-auto group-hover:opacity-100">
          <Button variant="ghost" size="icon" className="size-8 shrink-0 border-0" aria-label="配置与档案" title="配置与档案" onClick={onConfig}>
            <Settings2 className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" className="size-8 shrink-0 border-0" aria-label="分享" title="分享"
            onClick={() => { void navigator.clipboard.writeText(`${location.origin}/agents/${r.id}`); toast.success("已复制分享链接") }}>
            <Share2 className="size-4" />
          </Button>
          {onChat ? (
            <Button size="sm" className="h-8 min-w-0 flex-1 gap-1.5" onClick={onChat}>
              <MessageCircleMore className="size-4" /> 对话
            </Button>
          ) : null}
          <Button
            variant="ghost" size="icon" className="size-8 shrink-0 border-0"
            aria-label={r.archived ? "解封" : "封存"}
            title={r.archived ? "解封（恢复到使用中）" : "封存（隐藏且不可再执行，可解封）"}
            onClick={onToggleArchive}
          >
            {r.archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
          </Button>
        </div>
      </div>
    </div>
  )
}

/** 首格虚线占位卡（台账 §1b：dashed + 叠卡 art + 标签）。
 *  09-11：每次悬停回收（mouse-leave）五张工牌洗牌换序——牌堆"活"的手感。 */
export function CreateCard() {
  const [order, setOrder] = useState([0, 1, 2, 3, 4])
  const reshuffle = () => {
    setOrder((cur) => {
      const next = [...cur]
      for (let i = next.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[next[i], next[j]] = [next[j], next[i]]
      }
      if (next.every((v, k) => v === cur[k])) next.push(next.shift() as number)
      return next
    })
  }
  return (
    <Link
      to="/agents/new"
      onMouseLeave={reshuffle}
      className="group flex min-h-[212px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-surface p-4 text-center transition-colors hover:border-brand/60"
    >
      {/* 09-11：叠卡=工牌形态（挂绳孔+证件照+姓名/职级条），扇出几何仍为原站实测度量 */}
      <span className="create-fan flex h-[104px] items-center justify-center" aria-hidden="true">
        {order.map((idx, i) => (
          <span
            key={AVATARS[idx]}
            className="fan-badge flex h-[93px] w-[74px] flex-col items-center overflow-hidden rounded-lg border bg-surface-raised pt-1 shadow-sm"
            style={{ marginLeft: i === 0 ? 0 : -58, zIndex: i }}
          >
            <span className="h-1 w-5 shrink-0 rounded-full" style={{ background: "var(--fill-tertiary)" }} />
            <img src={AVATARS[idx]} alt="" className="mt-0.5 h-[64px] w-[58px] shrink-0 rounded-md object-cover" />
            <span className="mt-1 h-1 w-8 shrink-0 rounded-full" style={{ background: "var(--fill-secondary)" }} />
          </span>
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
  // Group Spec §5.2：管理页分段 Agent|Group（原站 /management 分段控件同构）
  const [topView, setTopView] = useState<"agents" | "groups">("agents")
  const [modules, setModules] = useState<ModuleMeta[]>([])
  const [archivedTotal, setArchivedTotal] = useState(0)
  // F-arch：封存/解封确认（引用清单在弹窗内拉取）
  const [archTarget, setArchTarget] = useState<AgentRow | null>(null)
  const [archRefs, setArchRefs] = useState<Awaited<ReturnType<typeof agentApi.references>> | null>(null)
  const [archBusy, setArchBusy] = useState(false)
  // 09-16 封存闸门 UI：联动暂停为确认框可选项（默认仅提示不联动）
  const [archPauseRefs, setArchPauseRefs] = useState(false)

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

  const openToggleArchive = (r: AgentRow) => {
    setArchTarget(r)
    setArchRefs(null)
    agentApi.references(r.id).then(setArchRefs).catch(() => setArchRefs(null))
  }
  const applyArchive = async () => {
    if (!archTarget) return
    setArchBusy(true)
    try {
      await agentApi.setArchived(archTarget.id, !archTarget.archived)
      toast.success(archTarget.archived ? "已解封，Agent 恢复到使用中" : "已封存，Agent 不再出现在使用中列表且不可再执行")
      // 可选联动：暂停引用该 Agent 的 enabled 自动任务
      if (!archTarget.archived && archPauseRefs) {
        try {
          const list = await asApi.automations()
          const hits = (list.items ?? []).filter(
            (a: Record<string, unknown>) => a.target_kind === "agent"
              && a.agent_id === archTarget.id && a.enabled === true)
          for (const a of hits) {
            await asApi.setEnabled(String(a.id), false)
          }
          if (hits.length) toast.success(`已联动暂停 ${hits.length} 个自动任务`)
        } catch (e) {
          toast.error(`联动暂停失败：${(e as Error).message}`)
        }
        setArchPauseRefs(false)
      }
      setArchTarget(null)
      load()
      pagedApi.agents({ page: 1, pageSize: 1, archived: "true" })
        .then((r) => setArchivedTotal(r.total)).catch(() => undefined)
    } catch (e) {
      toast.error(`操作失败：${(e as Error).message}`)
    } finally {
      setArchBusy(false)
    }
  }
  const refLine = (label: string, v: { count: number; samples?: string[] } | undefined) => (
    <li key={label}>
      {label}：<strong>{v?.count ?? 0}</strong> 个
      {v?.samples?.length ? <span className="text-muted-foreground">（{v.samples.join("、")}）</span> : null}
    </li>
  )

  const filtered = rows
    .filter((r) => typeFilter === "all" || r.type === typeFilter)
    .sort((a, b) => (sort === "name"
      ? a.name.localeCompare(b.name, "zh-CN")
      : (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")))

  return (
    <PageContainer wide>
      <div
        className="mb-4 flex h-8 w-fit items-center gap-2.5 rounded-lg bg-(--segment-bg) p-1"
        role="tablist"
        aria-label="管理分类"
      >
        {(["agents", "groups"] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={topView === v}
            onClick={() => setTopView(v)}
            className={`h-6 rounded px-2.5 text-xs leading-4 transition-colors ${topView === v
              ? "bg-(--segment-active) font-medium text-foreground"
              : "text-muted-foreground hover:text-foreground"}`}
          >
            {v === "agents" ? "Agent" : "Group"}
          </button>
        ))}
      </div>
      {topView === "groups" ? (
        <GroupsView />
      ) : (
      <div className="space-y-4">
      <div className="mb-2">
      <PageHeader
        title="Agent"
        description={`有身份、有角色、有能力、有工作状态的数字员工${archivedTotal > 0 ? ` · 旧版 Agent 已封存 ${archivedTotal} 个，仅历史查询` : ""}`}
        actions={
          <Button asChild size="sm">
            <Link to="/agents/new"><Plus className="size-4" /> 新建 Agent</Link>
          </Button>
        }
      />
      </div>
      {/* segment：使用中/已封存（台账 §4/§12：list gap10、bar mb24） */}
      <div className="mb-2 flex h-8 w-fit items-center gap-2.5 rounded-lg bg-(--segment-bg) p-1" role="radiogroup" aria-label="Agent 状态筛选">
        {(["active", "archived"] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={statusFilter === s}
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
        <span className="relative inline-flex h-8 w-[220px]">
          <Input placeholder="搜索名称或角色…" aria-label="搜索 Agent" className="h-8 w-full pr-8" style={{ fontSize: 13 }}
            value={search} onChange={(e) => update({ search: e.target.value || undefined }, true)} />
          <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-(--text-tertiary)" />
        </span>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="h-8 w-44 gap-3" style={{ fontSize: 13 }}><span className="shrink-0 text-(--text-tertiary)">运行时</span><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部运行时</SelectItem>
            <SelectItem value="module">领域 Module</SelectItem>
            <SelectItem value="autonomous">自主规划</SelectItem>
            <SelectItem value="dialogue">对话编排</SelectItem>
            <SelectItem value="expert-group">专家组</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => setSort(v as "updated" | "name")}>
          <SelectTrigger className="h-8 w-44 gap-3" style={{ fontSize: 13 }}><span className="shrink-0 text-(--text-tertiary)">排序</span><SelectValue /></SelectTrigger>
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
                  onConfig={() => navigate(r.type === "module" || r.type === "custom"
                    ? `/agents/${r.id}/profile` : `/agents/${r.id}/config`)}
                  onChat={r.archived ? undefined : () => navigate(`/agents/${r.id}/chat`)}
                  onToggleArchive={() => openToggleArchive(r)} />
              ))}
            </div>
          )}

      <Pagination page={params.page ?? 1} pageSize={params.pageSize ?? 12} total={total}
        onPageChange={(p: number) => update({ page: p }, true)}
        onPageSizeChange={(ps: number) => update({ pageSize: ps, page: 1 }, true)} />

      {/* F-arch：封存/解封确认（含引用清单） */}
      <Dialog open={!!archTarget} onOpenChange={(o) => { if (!o) setArchTarget(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {archTarget?.archived ? `解封「${archTarget?.name}」？` : `封存「${archTarget?.name}」？`}
            </DialogTitle>
            <DialogDescription>
              {archTarget?.archived
                ? "解封后 Agent 恢复到使用中列表，可再次创建版本、发布与执行。"
                : "封存后 Agent 从使用中列表隐藏，且不可再创建版本、发布或被执行（运行中的执行不受影响，历史全部保留）。随时可解封。"}
            </DialogDescription>
          </DialogHeader>
          {!archTarget?.archived && (
            <div className="rounded-md border bg-surface p-3 text-sm">
              <p className="mb-1 font-medium">当前引用：</p>
              <ul className="space-y-1 text-muted-foreground">
                {archRefs
                  ? [
                      refLine("分析任务", archRefs.analysisTasks),
                      refLine("自动任务", archRefs.automations),
                      refLine("脚本/流程节点", { count: archRefs.agentflowNodes.count + archRefs.scriptReferences.count }),
                    ]
                  : <li>引用清单加载中…</li>}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">
                封存不解除引用；引用它的任务下次执行会得到「AGENT_ARCHIVED」拒绝。默认不自动暂停相关自动任务。
              </p>
              <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={archPauseRefs}
                  onChange={(e) => setArchPauseRefs(e.target.checked)}
                />
                同时暂停引用该 Agent 的自动任务（可选联动）
              </label>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchTarget(null)}>取消</Button>
            <Button
              variant={archTarget?.archived ? "default" : "destructive"}
              disabled={archBusy}
              onClick={() => void applyArchive()}
            >
              {archBusy ? "处理中…" : archTarget?.archived ? "确认解封" : "确认封存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
      )}
    </PageContainer>
  )
}
