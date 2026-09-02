import { CalendarDays, CircleAlert, Loader2, RefreshCw } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
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
import { opsApi, type OpsBoard, type OpsBoardCard } from "@/services/wf-api"

const COLUMNS: { key: OpsBoardCard["stage"]; label: string }[] = [
  { key: "upcoming", label: "即将运行" },
  { key: "queued", label: "排队中" },
  { key: "running", label: "执行中" },
  { key: "delivering", label: "结果投递" },
  { key: "attention", label: "需关注" },
  { key: "completed", label: "已完成" },
]

const STAGE_TEXT: Record<OpsBoardCard["stage"], string> = {
  upcoming: "计划中", queued: "排队中", running: "执行中",
  delivering: "投递中", attention: "需关注", completed: "已完成",
}

function liveDuration(card: OpsBoardCard): string {
  if (card.durationMs == null) return "—"
  const s = Math.round(card.durationMs / 1000)
  return s >= 60 ? `${Math.floor(s / 60)}m${s % 60}s` : `${s}s`
}

export default function OperationsTodayPage() {
  const navigate = useNavigate()
  const [date, setDate] = useState("")
  const [q, setQ] = useState("")
  const [trigger, setTrigger] = useState("")
  const [environment, setEnvironment] = useState("")
  const [attentionOnly, setAttentionOnly] = useState(false)
  const [board, setBoard] = useState<OpsBoard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const [channel, setChannel] = useState<"sse" | "polling">("sse")
  const esRef = useRef<EventSource | null>(null)
  const pollRef = useRef<number | null>(null)

  const load = useCallback(async () => {
    try {
      const b = await opsApi.today({ date: date || undefined, q: q || undefined,
        trigger, environment, attention: attentionOnly ? "only" : "" })
      setBoard(b)
      setLastUpdated(new Date().toISOString())
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [date, q, trigger, environment, attentionOnly])

  // 实时更新：SSE 优先；断线降级 5s 轮询；页面失焦降频（SDD §8.8）
  useEffect(() => {
    let cancelled = false
    const startPolling = () => {
      if (pollRef.current != null) return
      setChannel("polling")
      const tick = async () => {
        if (document.hidden) return
        await load()
      }
      pollRef.current = window.setInterval(tick, 5000)
    }
    const stopPolling = () => {
      if (pollRef.current != null) { window.clearInterval(pollRef.current); pollRef.current = null }
    }
    try {
      const es = new EventSource(opsApi.streamUrl())
      esRef.current = es
      es.addEventListener("board", (ev) => {
        if (cancelled) return
        try {
          const data = JSON.parse((ev as MessageEvent).data) as { board: OpsBoard }
          setBoard(data.board)
          setLastUpdated(new Date().toISOString())
          setChannel("sse")
          setError(null)
        } catch { /* ignore */ }
      })
      es.onerror = () => { es.close(); esRef.current = null; stopPolling(); startPolling() }
    } catch {
      startPolling()
    }
    const onVis = () => { if (!document.hidden) void load() }
    document.addEventListener("visibilitychange", onVis)
    return () => {
      cancelled = true
      esRef.current?.close()
      stopPolling()
      document.removeEventListener("visibilitychange", onVis)
    }
  }, [load])

  useEffect(() => { void load() }, [load])

  const openCard = (card: OpsBoardCard) => {
    if (card.taskRunId) navigate(`/operations/task-runs/${card.taskRunId}`)
    else navigate(`/config/tasks/${card.task.id}`)
  }

  return (
    <PageContainer wide className="space-y-4">
      <PageHeader
        title="今日运行"
        description={`业务日期 ${board?.date ?? "今天"} · 时区 ${board?.timezone ?? "Asia/Shanghai"} · 一张卡 = 一个 TaskRun 批次或未触发计划`}
        actions={
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <RefreshCw className="size-3.5" />
            {channel === "sse" ? "实时（SSE）" : "降级轮询 5s"}
            {lastUpdated ? ` · 更新 ${formatCompactDateTime(lastUpdated)}` : ""}
            <Button variant="ghost" size="icon" className="size-7" onClick={() => void load()} aria-label="刷新">
              <RefreshCw className="size-3.5" />
            </Button>
          </div>
        }
      />

      {/* 顶部轻量筛选与日期控制（参考 Square UI；状态写入组件态，历史页写 URL） */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          <CalendarDays className="size-4 text-muted-foreground" />
          <Input type="date" className="h-8 w-40" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <Input placeholder="搜索 Task / TaskRun" className="h-8 w-48" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select value={trigger || "all"} onValueChange={(v) => setTrigger(v === "all" ? "" : v)}>
          <SelectTrigger className="h-8 w-32"><SelectValue placeholder="Trigger" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部 Trigger</SelectItem>
            <SelectItem value="schedule">schedule</SelectItem>
            <SelectItem value="manual">manual</SelectItem>
            <SelectItem value="api">api</SelectItem>
            <SelectItem value="backfill">backfill</SelectItem>
          </SelectContent>
        </Select>
        <Select value={environment || "all"} onValueChange={(v) => setEnvironment(v === "all" ? "" : v)}>
          <SelectTrigger className="h-8 w-32"><SelectValue placeholder="Environment" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部环境</SelectItem>
            <SelectItem value="sandbox">sandbox</SelectItem>
            <SelectItem value="prod">prod</SelectItem>
          </SelectContent>
        </Select>
        <Button variant={attentionOnly ? "default" : "outline"} size="sm"
          onClick={() => setAttentionOnly((v) => !v)}>
          <CircleAlert className="size-3.5" /> 仅看需关注
        </Button>
        <div className="ml-auto flex items-center gap-1.5 text-xs">
          {COLUMNS.map((c) => (
            <Badge key={c.key} variant={c.key === "attention" ? "destructive" : "secondary"}>
              {c.label} {board?.summary?.[c.key] ?? 0}
            </Badge>
          ))}
        </div>
      </div>

      {error && !board ? <ErrorState title="看板加载失败" onRetry={() => void load()} /> : null}

      {/* 六列固定看板：不拖拽、不手工加卡（SDD §10.3/§10.4） */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {COLUMNS.map((col) => {
          const cards = board?.columns?.[col.key] ?? []
          return (
            <div key={col.key} className="space-y-2 rounded-lg border bg-muted/20 p-2">
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  {col.key === "attention" ? <CircleAlert className="size-4 text-destructive" /> :
                    col.key === "running" || col.key === "delivering" ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> :
                      <span className="size-2 rounded-full bg-muted-foreground/50" aria-hidden />}
                  {col.label}
                </div>
                <span className="text-xs tabular-nums text-muted-foreground">{cards.length}</span>
              </div>
              {cards.length === 0 ? (
                <div className="rounded-md border border-dashed px-2 py-4 text-center text-xs text-muted-foreground">空</div>
              ) : cards.map((card) => (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => openCard(card)}
                  className="w-full space-y-1.5 rounded-md border bg-card p-2.5 text-left text-xs shadow-sm transition-colors hover:border-primary/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="truncate text-sm font-medium" title={card.task.name}>{card.task.name}</div>
                    <span className={card.stage === "attention" ? "font-medium text-destructive" : "text-muted-foreground"}>
                      {STAGE_TEXT[card.stage]}
                    </span>
                  </div>
                  <div className="text-muted-foreground">
                    {card.plannedAt ? `计划 ${formatCompactDateTime(card.plannedAt)}` : ""}
                    {card.startedAt ? ` · 启动 ${formatCompactDateTime(card.startedAt)}` : ""}
                  </div>
                  <div className="text-muted-foreground">{card.trigger} · {card.environment}</div>
                  {card.kind === "task_run" ? (
                    <>
                      <div className="flex items-center justify-between tabular-nums">
                        <span>执行 {card.execution.succeeded} / {card.execution.total}</span>
                        <span>{liveDuration(card)}</span>
                      </div>
                      <div className="flex items-center justify-between tabular-nums text-muted-foreground">
                        <span>投递 {card.delivery.succeeded + card.delivery.failed} / {card.execution.succeeded}</span>
                        <span>{card.delivery.status}</span>
                      </div>
                    </>
                  ) : (
                    <div className="text-muted-foreground">尚未触发 TaskRun</div>
                  )}
                  {card.attention ? (
                    <div className="rounded bg-destructive/10 px-1.5 py-1 text-destructive">
                      {card.attention.message}
                    </div>
                  ) : null}
                </button>
              ))}
              {col.key === "completed" && board?.completedTruncated ? (
                <button type="button" className="w-full rounded-md border border-dashed px-2 py-1.5 text-center text-xs text-muted-foreground hover:bg-muted/50"
                  onClick={() => navigate("/operations/task-runs")}>
                  仅显示最近 20 个 · 跳批次历史
                </button>
              ) : null}
            </div>
          )
        })}
      </div>
    </PageContainer>
  )
}
