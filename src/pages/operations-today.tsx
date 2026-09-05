import { CalendarDays, CircleAlert, Loader2, RefreshCw } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { useNavigate } from "react-router-dom"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { ErrorState } from "@/components/app/list-state"
import { PageContainer, PageHeader } from "@/components/app/page"
import { formatCompactDateTime } from "@/lib/time"
import {
  WORK_ITEM_ORIGIN_LABELS, WORK_ITEM_STATUS_LABELS,
} from "@/config/ui-terms"
import { streamWorkItems, workItemsApi, type WorkItemDTO, type WorkItemStatus } from "@/services/wf-api"

/** MTC-002B：五泳道固定顺序；Delivery 不再是一级状态（技术详情见 /operations/task-runs/:id）。 */
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

export default function OperationsTodayPage() {
  const navigate = useNavigate()
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
  const pollRef = useRef<number | null>(null)

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
      setLastUpdated(new Date().toISOString())
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [listParams])

  // MTC-002B-R：超过一页时显式续载，禁止静默漏卡
  const loadMore = useCallback(async () => {
    try {
      const r = await workItemsApi.list(listParams(page + 1))
      // P2：合并按 WorkItem id 去重，防并发 refresh 与分页交叠产生重复卡
      setItems((prev) => {
        const seen = new Set(prev.map((w) => w.id))
        return [...prev, ...r.items.filter((w) => !seen.has(w.id))]
      })
      setTotal(r.total)
      setPage(page + 1)
      setLastUpdated(new Date().toISOString())
    } catch (e) {
      setError((e as Error).message)
    }
  }, [listParams, page])

  // 实时：授权 fetch SSE（refresh 信号 → 重拉第一页）；401/断线降级 5s 轮询；失败不报错页面
  useEffect(() => {
    let cancelled = false
    const ctrl = new AbortController()
    const startPolling = () => {
      if (pollRef.current != null) return
      setChannel("polling")
      pollRef.current = window.setInterval(() => {
        if (!document.hidden) void load()
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
        // P2：refresh 到达 → 重置第一页并提示，避免已加载页与新增数据交叠漏项
        void load()
        toast.info("列表已更新")
      },
      {
        onError: () => { if (!cancelled) { setChannel("polling"); startPolling() } },
        signal: ctrl.signal,
        dateFrom: date || undefined,
        timezone: "Asia/Shanghai",
      },
    )
    const onVis = () => { if (!document.hidden) void load() }
    document.addEventListener("visibilitychange", onVis)
    return () => {
      cancelled = true
      ctrl.abort()
      stopPolling()
      document.removeEventListener("visibilitychange", onVis)
    }
  }, [load, date])

  useEffect(() => { void load() }, [load])

  const openCard = (w: WorkItemDTO) => navigate(w.links.primary)

  return (
    <PageContainer wide className="space-y-4">
      <PageHeader
        title="今日运行"
        description={`业务日期 ${resp?.businessDate ?? "今天"} · 时区 ${resp?.timezone ?? "Asia/Shanghai"} · 一张卡 = 一件工作（批次或未触发计划）`}
        actions={
          <div className="flex items-center gap-2 text-xs text-muted-foreground" data-sse-seq={lastSeq || undefined}>
            <RefreshCw className="size-3.5" />
            {channel === "sse" ? "实时（SSE）" : channel === "connecting" ? "连接实时更新中" : "降级轮询 5s"}
            {lastUpdated ? ` · 更新 ${formatCompactDateTime(lastUpdated)}` : ""}
            <Button variant="ghost" size="icon" className="size-7" onClick={() => void load()} aria-label="刷新">
              <RefreshCw className="size-3.5" />
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          <CalendarDays className="size-4 text-muted-foreground" />
          <Input type="date" className="h-8 w-40" aria-label="业务日期" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <Input placeholder="搜索自主任务 / 批次" aria-label="搜索自主任务或批次" className="h-8 w-48" value={q} onChange={(e) => setQ(e.target.value)} />
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
          <CircleAlert className="size-3.5" /> 仅看需要操作
        </Button>
        <div className="ml-auto flex items-center gap-1.5 text-xs">
          {LANES.map((l) => (
            <Badge key={l.key} variant={l.badge}>
              {WORK_ITEM_STATUS_LABELS[l.key]} {resp?.counts?.[l.key] ?? 0}
            </Badge>
          ))}
        </div>
      </div>

      {error && !resp ? <ErrorState title="看板加载失败" onRetry={() => void load()} /> : null}

      {/* 五泳道固定看板：不拖拽、不手工加卡（Awake 视觉属 MTC-003） */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {LANES.map((lane) => {
          const cards = items.filter((w) => w.status === lane.key)
          return (
            <div key={lane.key} className="space-y-2 rounded-lg border bg-muted/20 p-2" data-lane={lane.key}>
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  {lane.key === "needs_action" ? <CircleAlert className="size-4 text-status-warning" /> :
                    lane.key === "running" ? <Loader2 className="size-4 animate-spin text-status-running" /> :
                      <span className="size-2 rounded-full bg-muted-foreground/50" aria-hidden />}
                  {WORK_ITEM_STATUS_LABELS[lane.key]}
                </div>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {resp?.counts?.[lane.key] ?? cards.length}
                </span>
              </div>
              {cards.length === 0 ? (
                <div className="rounded-md border border-dashed px-2 py-4 text-center text-xs text-muted-foreground">空</div>
              ) : cards.map((w) => {
                // MTC-002B-R3：是否已有真实执行的唯一权威判断是 taskRunId != null；
                // kind=schedule_occurrence 仅表示稳定身份来自调度计划，不等于“尚未执行”。
                const hasExecution = w.taskRunId !== null
                const isUnfiredSchedule = w.kind === "schedule_occurrence" && w.taskRunId === null
                return (
                <button
                  key={w.id}
                  type="button"
                  data-workitem-id={w.id}
                  data-status={w.status}
                  onClick={() => openCard(w)}
                  className="w-full space-y-1.5 rounded-md border bg-card p-2.5 text-left text-xs shadow-sm transition-colors hover:border-primary/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="truncate text-sm font-medium" title={w.title}>{w.title}</div>
                    <Badge variant={LANES.find((l) => l.key === w.status)?.badge ?? "secondary"}>
                      {WORK_ITEM_STATUS_LABELS[w.status]}
                    </Badge>
                  </div>
                  {w.assignee ? (
                    <div className="truncate text-muted-foreground">
                      {w.assignee.name}（{w.assignee.type === "agent" ? "Agent" : "Workflow"}）
                    </div>
                  ) : null}
                  <div className="text-muted-foreground">
                    {WORK_ITEM_ORIGIN_LABELS[w.origin] ?? w.origin}
                    {isUnfiredSchedule && w.scheduledAt ? ` · 计划于 ${formatCompactDateTime(w.scheduledAt)}` : ""}
                    {w.startedAt ? ` · 启动 ${formatCompactDateTime(w.startedAt)}` : ""}
                    {w.finishedAt ? ` · 完成 ${formatCompactDateTime(w.finishedAt)}` : ""}
                  </div>
                  {hasExecution ? (
                    <>
                      <div className="flex items-center justify-between tabular-nums">
                        <span>执行 {w.progress.succeeded} / {w.progress.total}</span>
                        <span>{liveDuration(w)}</span>
                      </div>
                      {w.kind === "schedule_occurrence" && w.scheduledAt ? (
                        <div className="text-muted-foreground">
                          原计划：{formatCompactDateTime(w.scheduledAt)}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="text-muted-foreground">
                      {w.status === "needs_action"
                        ? (w.diagnostics?.occurrenceStatus === "missed"
                          ? "计划时间已到但未触发批次"
                          : "调度已标记触发，但执行批次缺失")
                        : "等待调度"}
                    </div>
                  )}
                  {w.attention.required ? (
                    <div className="rounded bg-status-warning/10 px-1.5 py-1 text-status-warning">
                      {w.attention.message}
                    </div>
                  ) : null}
                </button>
                )
              })}
            </div>
          )
        })}
      </div>

      {resp?.truncated ? (
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground" data-testid="load-more">
          已显示 {items.length} / {total} 件工作（其余在后续页）
          <Button variant="outline" size="sm" onClick={() => void loadMore()}>加载更多</Button>
        </div>
      ) : null}
    </PageContainer>
  )
}
