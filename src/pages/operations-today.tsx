import {
  CircleAlert, Loader2, RefreshCw, Workflow as WorkflowIcon,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { ErrorState } from "@/components/app/list-state"
import { PageContainer, PageHeader } from "@/components/app/page"
import { Pagination } from "@/components/app/pagination"
import { formatCompactDateTime } from "@/lib/time"
import {
  WORK_ITEM_ORIGIN_LABELS, WORK_ITEM_STATUS_LABELS,
} from "@/config/ui-terms"
import {
  bizApi, pagedApi, streamWorkItems, wfApi, workItemsApi,
  type WorkItemDTO, type WorkItemStatus,
} from "@/services/wf-api"
import type { TaskRunRunDTO } from "@/services/api-types"

/** MTC-003：任务工作台 = 看板 / 列表双视图 + WorkItem Drawer；状态机仍为后端唯一投影。
 *  09-07 原站对齐：工作记录汇总带（周期+指标瓦片+执行者活跃态）/ 需要操作区一级化 /
 *  全部任务区（列表 run 级行 + 分页）；看板默认视图与 SSE 实时为冻结资产，保留。 */
const LANES: { key: WorkItemStatus; badge: "warning" | "info" | "success" | "neutral" | "danger" }[] = [
  { key: "needs_action", badge: "warning" },
  { key: "running", badge: "info" },
  { key: "completed", badge: "success" },
  { key: "queued", badge: "neutral" },
  { key: "failed_cancelled", badge: "danger" },
]

/** 09-07：数据周期（今天 = 单日实时窗口；历史周期走取数路径）。 */
const PERIODS = [
  { value: "today", label: "今天", back: 0 },
  { value: "7d", label: "近 7 天", back: 6 },
  { value: "30d", label: "近 30 天", back: 29 },
] as const
type Period = (typeof PERIODS)[number]["value"]

function periodStart(p: Period): string {
  const back = PERIODS.find((x) => x.value === p)?.back ?? 0
  if (!back) return ""
  const d = new Date()
  d.setDate(d.getDate() - back)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function liveDuration(w: WorkItemDTO): string {
  if (w.durationMs == null) return "—"
  const s = Math.round(w.durationMs / 1000)
  return s >= 60 ? `${Math.floor(s / 60)}m${s % 60}s` : `${s}s`
}

function AssigneeMark({ w }: { w: WorkItemDTO }) {
  if (!w.assignee) return <span className="size-7 rounded-md border bg-surface-muted" aria-hidden />
  if (w.assignee.type === "workflow") {
    return (
      <span className="flex size-7 items-center justify-center rounded-md border bg-surface-muted text-muted-foreground" aria-hidden>
        <WorkflowIcon className="size-3.5" />
      </span>
    )
  }
  return (
    <Avatar className="size-7">
      <AvatarFallback className="bg-brand-soft text-[10px] text-selected-foreground">
        {w.assignee.name.slice(0, 2).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  )
}

function assigneeLabel(w: WorkItemDTO): string {
  if (!w.assignee) return "—"
  return `${w.assignee.name}（${w.assignee.type === "agent" ? "Agent" : "Workflow"}）`
}

/** R3 语义：等待调度仅限未触发 occurrence；已触发卡显示真实执行信息。 */
function CardBody({ w }: { w: WorkItemDTO }) {
  const hasExecution = w.taskRunId !== null
  if (!hasExecution) {
    return (
      <div className="text-muted-foreground">
        {w.status === "needs_action"
          ? (w.diagnostics?.occurrenceStatus === "missed"
            ? "计划时间已到但未触发批次"
            : "调度已标记触发，但执行批次缺失")
          : "等待调度"}
      </div>
    )
  }
  return (
    <>
      <div className="flex items-center gap-2">
        <Progress value={w.progress.percent ?? 0} className="h-1.5 flex-1" aria-label="执行进度" />
        <span className="tabular-nums text-muted-foreground">
          {w.progress.succeeded}/{w.progress.total}
        </span>
      </div>
      <div className="flex items-center justify-between tabular-nums text-muted-foreground">
        <span>
          {w.startedAt ? `启动 ${formatCompactDateTime(w.startedAt)}` : "启动 —"}
          {w.finishedAt ? ` · 完成 ${formatCompactDateTime(w.finishedAt)}` : ""}
        </span>
        <span>{liveDuration(w)}</span>
      </div>
      {w.kind === "schedule_occurrence" && w.scheduledAt ? (
        <div className="text-muted-foreground">原计划：{formatCompactDateTime(w.scheduledAt)}</div>
      ) : null}
    </>
  )
}

function WorkItemDrawer({ w, onClose }: { w: WorkItemDTO | null; onClose: () => void }) {
  const navigate = useNavigate()
  const [timeline, setTimeline] = useState<{ runId: string; status: string; startedAt: string | null }[]>([])
  const taskRunId = w?.taskRunId ?? null
  useEffect(() => {
    let cancelled = false
    if (taskRunId) {
      bizApi.taskRunRuns(taskRunId).then((r: TaskRunRunDTO[]) => {
        if (!cancelled) {
          setTimeline(r.slice(0, 8).map((t) => ({
            runId: t.id, status: t.status, startedAt: t.startedAt,
          })))
        }
      }).catch(() => { if (!cancelled) setTimeline([]) })
    } else {
      setTimeline([])
    }
    return () => { cancelled = true }
  }, [taskRunId])
  return (
    <Sheet open={w !== null} onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent side="right" className="w-[440px] overflow-y-auto">
        {w ? (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <AssigneeMark w={w} />
                <span className="truncate">{w.title}</span>
              </SheetTitle>
              <SheetDescription>
                <span className="flex flex-wrap items-center gap-2">
                  <Badge variant={LANES.find((l) => l.key === w.status)?.badge ?? "secondary"}>
                    {WORK_ITEM_STATUS_LABELS[w.status]}
                  </Badge>
                  <span>{assigneeLabel(w)}</span>
                  <span>触发：{WORK_ITEM_ORIGIN_LABELS[w.origin] ?? w.origin}</span>
                </span>
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-5 px-4 pb-6">
              <section className="space-y-2">
                <h3 className="text-sm font-medium">执行摘要</h3>
                <div className="rounded-lg border bg-surface p-3 text-xs">
                  <div className="flex items-center gap-2">
                    <Progress value={w.progress.percent ?? 0} className="h-1.5 flex-1" aria-label="执行进度" />
                    <span className="tabular-nums">{w.progress.succeeded}/{w.progress.total}</span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-muted-foreground">
                    <span>开始：{w.startedAt ? formatCompactDateTime(w.startedAt) : "—"}</span>
                    <span>结束：{w.finishedAt ? formatCompactDateTime(w.finishedAt) : "—"}</span>
                    <span>耗时：{liveDuration(w)}</span>
                    <span>失败：{w.progress.failed}</span>
                  </div>
                </div>
              </section>
              <section className="space-y-2">
                <h3 className="text-sm font-medium">调度上下文</h3>
                <div className="rounded-lg border bg-surface p-3 text-xs text-muted-foreground">
                  <div>计划时间：{w.scheduledAt ? formatCompactDateTime(w.scheduledAt) : "—"}</div>
                  {w.kind === "schedule_occurrence" && w.scheduledAt ? (
                    <div>原计划：{formatCompactDateTime(w.scheduledAt)}</div>
                  ) : null}
                  {w.diagnostics?.occurrenceStatus && w.diagnostics.occurrenceStatus !== "planned" ? (
                    <div>occurrence 状态：{w.diagnostics.occurrenceStatus}</div>
                  ) : null}
                </div>
              </section>
              <section className="space-y-2">
                <h3 className="text-sm font-medium">活动时间线</h3>
                {timeline.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                    {w.taskRunId ? "暂无交互运行记录" : "未触发批次，无运行时间线"}
                  </div>
                ) : (
                  <ul className="space-y-1.5 text-xs">
                    {timeline.map((t) => (
                      <li key={t.runId} className="flex items-center justify-between rounded-md border bg-surface px-2 py-1.5">
                        <span className="truncate text-muted-foreground">{t.runId.slice(0, 8)}</span>
                        <span>{t.status}</span>
                        <span className="text-muted-foreground">
                          {t.startedAt ? formatCompactDateTime(t.startedAt) : "—"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              {w.attention.required ? (
                <section className="space-y-2">
                  <h3 className="text-sm font-medium">需要操作</h3>
                  <div className="rounded-lg border border-status-warning/40 bg-status-warning/10 p-3 text-xs">
                    <div className="flex items-center gap-2">
                      <CircleAlert className="size-3.5 text-status-warning" aria-hidden />
                      <span className="font-medium text-status-warning">
                        {w.attention.severity === "critical" ? "严重" : "警告"} · {w.attention.code}
                      </span>
                    </div>
                    <p className="mt-1 text-status-warning">{w.attention.message}</p>
                  </div>
                </section>
              ) : null}
              <section className="flex gap-2">
                {w.taskRunId ? (
                  <Button variant="outline" size="sm" onClick={() => navigate(`/operations/task-runs/${w.taskRunId}`)}>
                    TaskRun 详情
                  </Button>
                ) : null}
                <Button variant="outline" size="sm" onClick={() => navigate(`/autonomous-tasks/${w.automationId}`)}>
                  所属自主任务
                </Button>
              </section>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

export default function OperationsTodayPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const view = searchParams.get("view") === "list" ? "list" : "board"
  const [period, setPeriod] = useState<Period>("today")
  const periodFrom = useMemo(() => periodStart(period), [period])
  const [q, setQ] = useState("")
  const [origin, setOrigin] = useState("")
  const [status, setStatus] = useState("")
  const [assignee, setAssignee] = useState("")
  const [attentionOnly, setAttentionOnly] = useState(false)
  const [page, setPage] = useState(1)
  const [listPageSize, setListPageSize] = useState(10)
  const [resp, setResp] = useState<Awaited<ReturnType<typeof workItemsApi.list>> | null>(null)
  const [items, setItems] = useState<WorkItemDTO[]>([])
  const [total, setTotal] = useState(0)
  const [band, setBand] = useState<{ total: number; counts: Record<string, number> | null }>({ total: 0, counts: null })
  const [attentionItems, setAttentionItems] = useState<WorkItemDTO[]>([])
  const [activeAssignees, setActiveAssignees] = useState<NonNullable<WorkItemDTO["assignee"]>[]>([])
  const [agentOpts, setAgentOpts] = useState<{ id: string; name: string }[]>([])
  const [wfOpts, setWfOpts] = useState<{ id: string; name: string }[]>([])
  const [lastSeq, setLastSeq] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const [channel, setChannel] = useState<"connecting" | "sse" | "polling">("connecting")
  const [selected, setSelected] = useState<WorkItemDTO | null>(null)
  const pollRef = useRef<number | null>(null)
  const pageRef = useRef(1)
  const reconcileTimer = useRef<number | null>(null)

  useEffect(() => {
    pagedApi.agents({ pageSize: 100 }).then((r) => setAgentOpts(r.items.map((a) => ({ id: a.id, name: a.name })))).catch(() => undefined)
    wfApi.list({ pageSize: 100 }).then((r) => setWfOpts(r.items.map((w) => ({ id: w.id, name: w.name })))).catch(() => undefined)
  }, [])

  const listParams = useCallback((pg: number, ps: number) => ({
    dateFrom: periodFrom || undefined, q: q || undefined, origin: origin || undefined,
    status: status || undefined, attentionOnly: attentionOnly || undefined,
    agentId: assignee.startsWith("agent:") ? assignee.slice(6) : undefined,
    automationId: assignee.startsWith("workflow:") ? assignee.slice(9) : undefined,
    pageSize: ps, page: pg,
  }), [periodFrom, q, origin, status, attentionOnly, assignee])

  const loadBoard = useCallback(async () => {
    try {
      const r = await workItemsApi.list(listParams(1, 200))
      setResp(r)
      setItems(r.items)
      setTotal(r.total)
      pageRef.current = 1
      setLastUpdated(new Date().toISOString())
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [listParams])

  const fetchListPage = useCallback(async (pg: number, ps: number) => {
    try {
      const r = await workItemsApi.list(listParams(pg, ps))
      setResp(r)
      setItems(r.items)
      setTotal(r.total)
      setLastUpdated(new Date().toISOString())
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [listParams])

  // R4：静默原地 reconcile（重拉已加载页、按 id 去重、保持滚动与上下文）；仅看板多页语义需要
  const reconcile = useCallback(async () => {
    try {
      const pages = pageRef.current
      const fetched: WorkItemDTO[] = []
      let lastResp: Awaited<ReturnType<typeof workItemsApi.list>> | null = null
      for (let pg = 1; pg <= pages; pg++) {
        const r = await workItemsApi.list(listParams(pg, 200))
        lastResp = r
        fetched.push(...r.items)
        if (r.items.length < 200) break
      }
      if (lastResp) {
        setResp(lastResp)
        setTotal(lastResp.total)
      }
      setItems(() => {
        const seen = new Set<string>()
        return fetched.filter((w) => (seen.has(w.id) ? false : (seen.add(w.id), true)))
      })
      setLastUpdated(new Date().toISOString())
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [listParams])

  const loadMore = useCallback(async () => {
    try {
      const r = await workItemsApi.list(listParams(pageRef.current + 1, 200))
      setItems((prev) => {
        const seen = new Set(prev.map((w) => w.id))
        return [...prev, ...r.items.filter((w) => !seen.has(w.id))]
      })
      setTotal(r.total)
      pageRef.current += 1
      setLastUpdated(new Date().toISOString())
    } catch (e) {
      setError((e as Error).message)
    }
  }, [listParams])

  /* 09-07 汇总带 / 需要操作区 / 活跃执行对象：窗口级独立取数（不随视图筛选变化） */
  const loadBand = useCallback(async () => {
    try {
      const r = await workItemsApi.list({ dateFrom: periodFrom || undefined, pageSize: 1 })
      setBand({ total: r.total, counts: r.counts })
    } catch { /* 汇总带失败不阻塞主视图 */ }
  }, [periodFrom])
  const loadAttention = useCallback(async () => {
    try {
      const r = await workItemsApi.list({ dateFrom: periodFrom || undefined, attentionOnly: true, pageSize: 50 })
      setAttentionItems(r.items)
    } catch { setAttentionItems([]) }
  }, [periodFrom])
  const loadActive = useCallback(async () => {
    try {
      const r = await workItemsApi.list({ dateFrom: periodFrom || undefined, status: "running", pageSize: 100 })
      const seen = new Set<string>()
      setActiveAssignees(r.items.flatMap((w) => {
        const a = w.assignee
        if (!a) return []
        const k = `${a.type}:${a.id}`
        if (seen.has(k)) return []
        seen.add(k)
        return [a]
      }))
    } catch { setActiveAssignees([]) }
  }, [periodFrom])
  const refreshAux = useCallback(() => Promise.all([loadBand(), loadAttention(), loadActive()]),
    [loadBand, loadAttention, loadActive])

  useEffect(() => { if (view === "board") void loadBoard() }, [view, loadBoard])
  useEffect(() => { if (view === "list") void fetchListPage(page, listPageSize) }, [view, page, listPageSize, fetchListPage])
  useEffect(() => { void refreshAux() }, [refreshAux])
  useEffect(() => { setPage(1) }, [periodFrom, q, origin, status, assignee, attentionOnly, view])

  const liveRefresh = useCallback(() => {
    if (view === "board") void reconcile()
    else void fetchListPage(page, listPageSize)
    void refreshAux()
  }, [view, reconcile, fetchListPage, page, listPageSize, refreshAux])

  useEffect(() => {
    let cancelled = false
    const ctrl = new AbortController()
    const startPolling = () => {
      if (pollRef.current != null) return
      setChannel("polling")
      pollRef.current = window.setInterval(() => {
        if (!document.hidden) liveRefresh()
      }, 5000)
    }
    const stopPolling = () => {
      if (pollRef.current != null) { window.clearInterval(pollRef.current); pollRef.current = null }
    }
    setChannel("connecting")
    void streamWorkItems(
      (seq) => {
        if (cancelled) return
        setChannel("sse")
        setLastSeq(seq)
        stopPolling()
        if (reconcileTimer.current == null) {
          reconcileTimer.current = window.setTimeout(() => {
            reconcileTimer.current = null
            if (!cancelled) liveRefresh()
          }, 2500)
        }
      },
      {
        onError: () => { if (!cancelled) { setChannel("polling"); startPolling() } },
        signal: ctrl.signal,
        dateFrom: periodFrom || undefined,
        timezone: "Asia/Shanghai",
      },
    )
    const onVis = () => { if (!document.hidden) liveRefresh() }
    document.addEventListener("visibilitychange", onVis)
    return () => {
      cancelled = true
      ctrl.abort()
      stopPolling()
      if (reconcileTimer.current != null) {
        window.clearTimeout(reconcileTimer.current)
        reconcileTimer.current = null
      }
      document.removeEventListener("visibilitychange", onVis)
    }
  }, [liveRefresh, periodFrom])

  const setView = (v: string) => {
    const next = new URLSearchParams(searchParams)
    if (v === "list") next.set("view", "list")
    else next.delete("view")
    setSearchParams(next, { replace: true })
  }

  /* 09-07：run 级行序号——同执行对象窗口内按启动时间排序（对齐原站"第 N 次运行"行语义） */
  const runSeq = useMemo(() => {
    const byAuto = new Map<string, WorkItemDTO[]>()
    for (const w of items) {
      const k = w.automationId ?? w.id
      byAuto.set(k, [...(byAuto.get(k) ?? []), w])
    }
    const seq = new Map<string, number>()
    for (const group of byAuto.values()) {
      [...group]
        .sort((a, b) => (a.startedAt ?? a.scheduledAt ?? "").localeCompare(b.startedAt ?? b.scheduledAt ?? ""))
        .forEach((w, i) => seq.set(w.id, i + 1))
    }
    return seq
  }, [items])

  const endedCount = (band.counts?.completed ?? 0) + (band.counts?.failed_cancelled ?? 0)
  const tiles = [
    {
      key: "total", label: "任务总数", value: band.total,
      pressed: !status && !attentionOnly,
      apply: () => { setStatus(""); setAttentionOnly(false) },
    },
    {
      key: "running", label: "进行中任务", value: band.counts?.running ?? 0,
      pressed: status === "running" && !attentionOnly,
      apply: () => { setStatus("running"); setAttentionOnly(false) },
    },
    {
      key: "attention", label: "需要操作", value: band.counts?.needs_action ?? 0,
      pressed: attentionOnly,
      apply: () => { setAttentionOnly((v) => !v); setStatus("") },
    },
    {
      key: "ended", label: "已结束任务", value: endedCount,
      pressed: status === "ended" && !attentionOnly,
      apply: () => { setStatus("ended"); setAttentionOnly(false) },
    },
  ]

  return (
    <PageContainer wide className="space-y-4">
      <PageHeader
        title="任务工作台"
        description="按周期一览各执行对象做过什么、处理需要操作的工作项、回顾全部工作。"
        actions={
          <div className="flex items-center gap-2 text-xs text-muted-foreground" data-sse-seq={lastSeq || undefined}>
            <RefreshCw className="size-3.5" aria-hidden />
            <span>
              {channel === "sse" ? "实时（SSE）" : channel === "connecting" ? "连接实时更新中" : "降级轮询 5s"}
            </span>
            {lastUpdated ? <span>· 更新 {formatCompactDateTime(lastUpdated)}</span> : null}
            <Button variant="ghost" size="icon" className="size-7" onClick={() => {
              if (view === "board") void loadBoard()
              else void fetchListPage(page, listPageSize)
              void refreshAux()
            }} aria-label="手动刷新">
              <RefreshCw className="size-3.5" />
            </Button>
          </div>
        }
      />

      {/* ---- 09-07 工作记录汇总带 ---- */}
      <section className="rounded-xl border bg-surface shadow-sm" data-testid="work-summary-band">
        <div className="space-y-4 px-6 py-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">工作记录</h2>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">数据周期</span>
              <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
                <SelectTrigger className="h-8 w-28" aria-label="数据周期"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PERIODS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {tiles.map((t) => (
              <button
                key={t.key}
                type="button"
                aria-pressed={t.pressed}
                onClick={t.apply}
                className={`flex flex-col gap-1 rounded-xl border bg-surface px-6 py-4 text-left shadow-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring ${
                  t.pressed ? "border-border bg-surface-muted" : "hover:border-brand/40"
                }`}
              >
                <strong className="text-2xl font-semibold tabular-nums">{t.value}</strong>
                <span className="text-xs text-muted-foreground">{t.label}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {activeAssignees.length === 0 ? (
              <span className="flex items-center gap-2">
                <span>执行对象均在空闲</span>
                <span className="mtc-zzz" aria-hidden><span>z</span><span>z</span><span>z</span></span>
              </span>
            ) : (
              <>
                <span>活跃执行对象：</span>
                {activeAssignees.map((a) => (
                  <span key={`${a.type}:${a.id}`} className="flex items-center gap-1.5">
                    {a.type === "workflow"
                      ? <span className="flex size-5 items-center justify-center rounded border bg-surface-muted" aria-hidden><WorkflowIcon className="size-3" /></span>
                      : <Avatar className="size-5"><AvatarFallback className="bg-brand-soft text-[9px] text-selected-foreground">{a.name.slice(0, 2).toUpperCase()}</AvatarFallback></Avatar>}
                    {a.name}
                  </span>
                ))}
              </>
            )}
          </div>
        </div>
      </section>

      {/* ---- 09-07 需要操作区（一级化） ---- */}
      <section aria-labelledby="attention-section-title" className="space-y-2" data-testid="work-attention-section">
        <h2 id="attention-section-title" className="text-sm font-semibold">
          需要操作（{attentionItems.length}）
        </h2>
        {attentionItems.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground">
            进入需要操作状态的工作项会汇总在这里，点击可打开详情处理。
          </div>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {attentionItems.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => setSelected(w)}
                className="flex items-center gap-2 rounded-lg border bg-surface p-2.5 text-left text-xs shadow-sm transition-colors hover:border-brand/50 hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:ring-ring"
              >
                <AssigneeMark w={w} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{w.title}</span>
                  <span className="block truncate text-status-warning">{w.attention.message}</span>
                </span>
                <Badge variant="warning">{WORK_ITEM_STATUS_LABELS[w.status]}</Badge>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* ---- 全部任务区 ---- */}
      <section aria-labelledby="all-items-title" className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="all-items-title" className="text-sm font-semibold">全部工作</h2>
          <Input placeholder="搜索自主任务 / 批次" aria-label="搜索自主任务或批次"
            className="h-8 w-48" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select value={origin || "all"} onValueChange={(v) => setOrigin(v === "all" ? "" : v)}>
            <SelectTrigger className="h-8 w-32"><SelectValue placeholder="触发方式" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部触发</SelectItem>
              <SelectItem value="schedule">调度</SelectItem>
              <SelectItem value="manual">手动</SelectItem>
              <SelectItem value="api">API</SelectItem>
              <SelectItem value="backfill">回填</SelectItem>
            </SelectContent>
          </Select>
          <Select value={status || "all"} onValueChange={(v) => setStatus(v === "all" ? "" : v)}>
            <SelectTrigger className="h-8 w-32"><SelectValue placeholder="任务状态" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              {LANES.map((l) => <SelectItem key={l.key} value={l.key}>{WORK_ITEM_STATUS_LABELS[l.key]}</SelectItem>)}
              <SelectItem value="ended">已结束</SelectItem>
            </SelectContent>
          </Select>
          <Select value={assignee || "all"} onValueChange={(v) => setAssignee(v === "all" ? "" : v)}>
            <SelectTrigger className="h-8 w-36"><SelectValue placeholder="执行对象" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部执行对象</SelectItem>
              {agentOpts.map((a) => <SelectItem key={`agent:${a.id}`} value={`agent:${a.id}`}>{a.name}（Agent）</SelectItem>)}
              {wfOpts.map((w) => <SelectItem key={`workflow:${w.id}`} value={`workflow:${w.id}`}>{w.name}（Workflow）</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant={attentionOnly ? "default" : "outline"} size="sm"
            onClick={() => setAttentionOnly((v) => !v)}>
            <CircleAlert className="size-3.5" aria-hidden /> 仅看需要操作
          </Button>
          <ToggleGroup type="single" value={view} onValueChange={(v) => { if (v) setView(v) }}
            className="ml-auto" aria-label="视图切换">
            <ToggleGroupItem value="board" aria-label="看板视图">看板</ToggleGroupItem>
            <ToggleGroupItem value="list" aria-label="列表视图">列表</ToggleGroupItem>
          </ToggleGroup>
          {view === "board" ? (
            <div className="flex items-center gap-1.5 text-xs">
              {LANES.map((l) => (
                <Badge key={l.key} variant={l.badge}>
                  {WORK_ITEM_STATUS_LABELS[l.key]} {resp?.counts?.[l.key] ?? 0}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>

        {error && !resp ? <ErrorState title="看板加载失败" onRetry={() => void loadBoard()} /> : null}

        {view === "board" ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            {LANES.map((lane) => {
              const cards = items.filter((w) => w.status === lane.key)
              return (
                <div key={lane.key} className="space-y-2 rounded-lg border bg-surface-muted/40 p-2" data-lane={lane.key}>
                  <div className="flex items-center justify-between px-1">
                    <div className="flex items-center gap-1.5 text-sm font-medium">
                      {lane.key === "needs_action" ? <CircleAlert className="size-4 text-status-warning" aria-hidden /> :
                        lane.key === "running" ? <Loader2 className="size-4 animate-spin text-status-running" aria-hidden /> :
                          <span className="size-2 rounded-full bg-muted-foreground/50" aria-hidden />}
                      {WORK_ITEM_STATUS_LABELS[lane.key]}
                    </div>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {resp?.counts?.[lane.key] ?? cards.length}
                    </span>
                  </div>
                  {cards.length === 0 ? (
                    <div className="rounded-md border border-dashed px-2 py-4 text-center text-xs text-muted-foreground">空</div>
                  ) : cards.map((w) => (
                    <button
                      key={w.id}
                      type="button"
                      data-workitem-id={w.id}
                      data-status={w.status}
                      onClick={() => setSelected(w)}
                      className="w-full space-y-1.5 rounded-md border bg-surface p-2.5 text-left text-xs shadow-sm transition-colors hover:border-brand/50 hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2">
                          <AssigneeMark w={w} />
                          <span className="truncate text-sm font-medium" title={w.title}>{w.title}</span>
                        </span>
                        <Badge variant={lane.badge}>{WORK_ITEM_STATUS_LABELS[w.status]}</Badge>
                      </div>
                      <div className="truncate text-muted-foreground">
                        {assigneeLabel(w)}
                        {" · "}{WORK_ITEM_ORIGIN_LABELS[w.origin] ?? w.origin}
                      </div>
                      <CardBody w={w} />
                      {w.attention.required ? (
                        <div className="rounded bg-status-warning/10 px-1.5 py-1 text-status-warning">
                          {w.attention.message}
                        </div>
                      ) : null}
                    </button>
                  ))}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="rounded-lg border bg-surface" data-testid="work-list-table">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>任务</TableHead>
                    <TableHead>执行对象</TableHead>
                    <TableHead>来源</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>最近更新</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                        当前筛选下没有工作项
                      </TableCell>
                    </TableRow>
                  ) : items.map((w) => (
                    <TableRow key={w.id} data-workitem-id={w.id} data-status={w.status}
                      className="cursor-pointer hover:bg-surface-muted/60" onClick={() => setSelected(w)}>
                      <TableCell>
                        <span className="flex items-center gap-2">
                          <AssigneeMark w={w} />
                          <span className="text-sm">
                            <span className="text-muted-foreground">第 {runSeq.get(w.id) ?? 1} 次 </span>
                            <span className="font-medium">{w.title}</span>
                          </span>
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{assigneeLabel(w)}</TableCell>
                      <TableCell className="text-sm">{WORK_ITEM_ORIGIN_LABELS[w.origin] ?? w.origin}</TableCell>
                      <TableCell>
                        <Badge variant={LANES.find((l) => l.key === w.status)?.badge ?? "secondary"}>
                          {WORK_ITEM_STATUS_LABELS[w.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {w.updatedAt ? formatCompactDateTime(w.updatedAt) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Pagination
              page={page}
              pageSize={listPageSize}
              total={total}
              pageSizeOptions={[10, 20, 50]}
              onPageChange={setPage}
              onPageSizeChange={(s) => { setListPageSize(s); setPage(1) }}
            />
          </div>
        )}

        {view === "board" && resp?.truncated ? (
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground" data-testid="load-more">
            已显示 {items.length} / {total} 件工作（其余在后续页）
            <Button variant="outline" size="sm" onClick={() => void loadMore()}>加载更多</Button>
          </div>
        ) : null}
      </section>

      <WorkItemDrawer w={selected} onClose={() => setSelected(null)} />
    </PageContainer>
  )
}
