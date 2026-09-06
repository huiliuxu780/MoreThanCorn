import {
  CalendarDays, CircleAlert, Loader2, RefreshCw, Workflow as WorkflowIcon,
} from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
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
import { formatCompactDateTime } from "@/lib/time"
import {
  WORK_ITEM_ORIGIN_LABELS, WORK_ITEM_STATUS_LABELS,
} from "@/config/ui-terms"
import {
  bizApi, streamWorkItems, workItemsApi, type WorkItemDTO, type WorkItemStatus,
} from "@/services/wf-api"
import type { TaskRunRunDTO } from "@/services/api-types"

/** MTC-003：任务工作台 = 看板 / 列表双视图 + WorkItem Drawer；状态机仍为后端唯一投影。 */
const LANES: { key: WorkItemStatus; badge: "warning" | "info" | "success" | "neutral" | "danger" }[] = [
  { key: "needs_action", badge: "warning" },
  { key: "running", badge: "info" },
  { key: "completed", badge: "success" },
  { key: "queued", badge: "neutral" },
  { key: "failed_cancelled", badge: "danger" },
]

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
                  <span>{w.assignee ? `${w.assignee.name}（${w.assignee.type === "agent" ? "Agent" : "Workflow"}）` : "—"}</span>
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
  const [date, setDate] = useState("")
  const [q, setQ] = useState("")
  const [origin, setOrigin] = useState("")
  const [attentionOnly, setAttentionOnly] = useState(false)
  const [resp, setResp] = useState<Awaited<ReturnType<typeof workItemsApi.list>> | null>(null)
  const [items, setItems] = useState<WorkItemDTO[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [lastSeq, setLastSeq] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const [channel, setChannel] = useState<"connecting" | "sse" | "polling">("connecting")
  const [selected, setSelected] = useState<WorkItemDTO | null>(null)
  const pollRef = useRef<number | null>(null)
  const pageRef = useRef(1)
  const reconcileTimer = useRef<number | null>(null)

  const listParams = useCallback((pg: number) => ({
    dateFrom: date || undefined, q: q || undefined, origin: origin || undefined,
    attentionOnly: attentionOnly || undefined, pageSize: 200, page: pg,
  }), [date, q, origin, attentionOnly])

  const load = useCallback(async () => {
    try {
      const r = await workItemsApi.list(listParams(1))
      setResp(r)
      setItems(r.items)
      setTotal(r.total)
      setPage(1)
      pageRef.current = 1
      setLastUpdated(new Date().toISOString())
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [listParams])

  // R4：静默原地 reconcile（重拉已加载页、按 id 去重、保持滚动与上下文）
  const reconcile = useCallback(async () => {
    try {
      const pages = pageRef.current
      const fetched: WorkItemDTO[] = []
      let lastResp: Awaited<ReturnType<typeof workItemsApi.list>> | null = null
      for (let pg = 1; pg <= pages; pg++) {
        const r = await workItemsApi.list(listParams(pg))
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
      const r = await workItemsApi.list(listParams(page + 1))
      setItems((prev) => {
        const seen = new Set(prev.map((w) => w.id))
        return [...prev, ...r.items.filter((w) => !seen.has(w.id))]
      })
      setTotal(r.total)
      setPage(page + 1)
      pageRef.current = page + 1
      setLastUpdated(new Date().toISOString())
    } catch (e) {
      setError((e as Error).message)
    }
  }, [listParams, page])

  useEffect(() => {
    let cancelled = false
    const ctrl = new AbortController()
    const startPolling = () => {
      if (pollRef.current != null) return
      setChannel("polling")
      pollRef.current = window.setInterval(() => {
        if (!document.hidden) void reconcile()
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
            if (!cancelled) void reconcile()
          }, 2500)
        }
      },
      {
        onError: () => { if (!cancelled) { setChannel("polling"); startPolling() } },
        signal: ctrl.signal,
        dateFrom: date || undefined,
        timezone: "Asia/Shanghai",
      },
    )
    const onVis = () => { if (!document.hidden) void reconcile() }
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
  }, [reconcile, date])

  useEffect(() => { void load() }, [load])

  const setView = (v: string) => {
    const next = new URLSearchParams(searchParams)
    if (v === "list") next.set("view", "list")
    else next.delete("view")
    setSearchParams(next, { replace: true })
  }

  return (
    <PageContainer wide className="space-y-4">
      <PageHeader
        title="任务工作台"
        description={`业务日期 ${resp?.businessDate ?? "今天"} · 时区 ${resp?.timezone ?? "Asia/Shanghai"} · 一件工作 = 一个批次或未触发计划`}
        actions={
          <div className="flex items-center gap-2 text-xs text-muted-foreground" data-sse-seq={lastSeq || undefined}>
            <RefreshCw className="size-3.5" aria-hidden />
            <span>
              {channel === "sse" ? "实时（SSE）" : channel === "connecting" ? "连接实时更新中" : "降级轮询 5s"}
            </span>
            {lastUpdated ? <span>· 更新 {formatCompactDateTime(lastUpdated)}</span> : null}
            <Button variant="ghost" size="icon" className="size-7" onClick={() => void load()} aria-label="手动刷新">
              <RefreshCw className="size-3.5" />
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          <CalendarDays className="size-4 text-muted-foreground" aria-hidden />
          <Input type="date" className="h-8 w-40" aria-label="业务日期" value={date}
            onChange={(e) => setDate(e.target.value)} />
        </div>
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
        <Button variant={attentionOnly ? "default" : "outline"} size="sm"
          onClick={() => setAttentionOnly((v) => !v)}>
          <CircleAlert className="size-3.5" aria-hidden /> 仅看需要操作
        </Button>
        <ToggleGroup type="single" value={view} onValueChange={(v) => { if (v) setView(v) }}
          className="ml-auto" aria-label="视图切换">
          <ToggleGroupItem value="board" aria-label="看板视图">看板</ToggleGroupItem>
          <ToggleGroupItem value="list" aria-label="列表视图">列表</ToggleGroupItem>
        </ToggleGroup>
        <div className="flex items-center gap-1.5 text-xs">
          {LANES.map((l) => (
            <Badge key={l.key} variant={l.badge}>
              {WORK_ITEM_STATUS_LABELS[l.key]} {resp?.counts?.[l.key] ?? 0}
            </Badge>
          ))}
        </div>
      </div>

      {error && !resp ? <ErrorState title="看板加载失败" onRetry={() => void load()} /> : null}

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
                      {w.assignee ? `${w.assignee.name}（${w.assignee.type === "agent" ? "Agent" : "Workflow"}）` : "—"}
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
        <div className="rounded-lg border bg-surface">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>任务</TableHead>
                <TableHead>执行对象</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>触发方式</TableHead>
                <TableHead className="w-40">进度</TableHead>
                <TableHead>开始 / 计划时间</TableHead>
                <TableHead>耗时</TableHead>
                <TableHead>最近活动</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                    当前筛选下没有工作项
                  </TableCell>
                </TableRow>
              ) : items.map((w) => (
                <TableRow key={w.id} data-workitem-id={w.id} data-status={w.status}
                  className="cursor-pointer hover:bg-surface-muted/60" onClick={() => setSelected(w)}>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      <AssigneeMark w={w} />
                      <span className="text-sm font-medium">{w.title}</span>
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {w.assignee ? `${w.assignee.name}（${w.assignee.type === "agent" ? "Agent" : "Workflow"}）` : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={LANES.find((l) => l.key === w.status)?.badge ?? "secondary"}>
                      {WORK_ITEM_STATUS_LABELS[w.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{WORK_ITEM_ORIGIN_LABELS[w.origin] ?? w.origin}</TableCell>
                  <TableCell>
                    {w.taskRunId !== null ? (
                      <span className="flex items-center gap-2">
                        <Progress value={w.progress.percent ?? 0} className="h-1.5 flex-1" aria-label="执行进度" />
                        <span className="tabular-nums text-xs">{w.progress.succeeded}/{w.progress.total}</span>
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">等待调度</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {w.startedAt ? formatCompactDateTime(w.startedAt)
                      : w.scheduledAt ? `计划 ${formatCompactDateTime(w.scheduledAt)}` : "—"}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums">{liveDuration(w)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {w.updatedAt ? formatCompactDateTime(w.updatedAt) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {resp?.truncated ? (
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground" data-testid="load-more">
          已显示 {items.length} / {total} 件工作（其余在后续页）
          <Button variant="outline" size="sm" onClick={() => void loadMore()}>加载更多</Button>
        </div>
      ) : null}

      <WorkItemDrawer w={selected} onClose={() => setSelected(null)} />
    </PageContainer>
  )
}
