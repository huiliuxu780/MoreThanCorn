/**
 * 任务看板（2026-09-09 换底）：QoderWake 同构只读投影。
 * 数据源：/api/board/*（AgentScope Session 索引 + Workflow Run + AgentFlow Run）。
 * 不新建 canonical WorkItem 状态机；状态映射见 server/app/board_projection.py。
 */
import * as React from "react"
import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Waypoints, Workflow } from "lucide-react"
import { avatarFor } from "@/lib/agent-avatar"
import { asApi, type BoardSummary, type BoardTask } from "@/services/as-api"
import { useAsyncData } from "@/hooks/use-async-data"

/** 泳道中文标签（09-13 审计修复：与后端 board_projection 语义对齐——
 *  pending = queued/无消息（排队中）；waiting = 运行时 waiting/parked（需要操作）。
 *  原映射两词写反，行徽章与「需要操作」计数互相矛盾。 */
const LANE_LABEL: Record<string, string> = {
  pending: "排队中",
  running: "执行中",
  done: "已完成",
  waiting: "需要操作",
  failed: "失败",
  cancelled: "取消",
}

/** 执行者图标（每类型一个固定 icon，与导航/列表统一；原站 qc-work-management-assignee 同构）：
 *  - Agent 会话 → 该 Agent 头像（圆形 20px）；
 *  - Workflow 运行 → Workflow 图标（中性方块）；
 *  - AgentFlow 运行 → AgentFlow 图标（原站 flow-avatar：软绿方块 radius 4 / 20×20 / 图标 ~18）。 */
function ExecutorIcon({ t }: { t: BoardTask }) {
  if (t.kind === "workflow-run") {
    return (
      <span
        className="flex size-5 shrink-0 items-center justify-center rounded"
        style={{ background: "var(--fill-tertiary)", color: "var(--text-secondary)" }}
        title="Workflow"
      >
        <Workflow className="size-3.5" />
      </span>
    )
  }
  if (t.kind === "agentflow-run") {
    return (
      <span
        className="flex size-5 shrink-0 items-center justify-center rounded"
        style={{ background: "var(--status-success-soft)", color: "var(--status-success)" }}
        title="AgentFlow"
      >
        <Waypoints className="size-3.5" />
      </span>
    )
  }
  return (
    <img
      src={avatarFor(t.executor_id ?? t.executor, null)}
      alt=""
      className="size-5 shrink-0 rounded-full object-cover"
    />
  )
}

function laneOf(task: BoardTask): string {
  if (task.lane === "failed" || task.lane === "cancelled") return "failed,cancelled"
  return task.lane
}

/** 原站泳道卡时间用相对格式（45分钟前/前天）。 */
function relTime(v: string | null | undefined): string {
  if (!v) return "—"
  const diff = Date.now() - new Date(v).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return "刚刚"
  if (min < 60) return `${min}分钟前`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}小时前`
  const d = Math.floor(h / 24)
  if (d === 1) return "昨天"
  if (d === 2) return "前天"
  if (d < 30) return `${d}天前`
  return v.slice(5, 10)
}

/** 状态 chip（原站 qc-work-management-status 同构）：dot + label，软底+语义色。 */
/* 09-14 D1 拍板：徽章字色读 -text 文本角色 token（过 WCAG 4.5:1）；
   色点继续用原站值（StatusChip 内 dot 单独取原色，见下） */
const LANE_CHIP: Record<string, { bg: string; fg: string; dot: string }> = {
  done: { bg: "var(--status-success-soft)", fg: "var(--status-success-text)", dot: "var(--status-success)" },
  running: { bg: "var(--status-running-soft)", fg: "var(--status-running)", dot: "var(--status-running)" },
  waiting: { bg: "var(--status-warning-soft)", fg: "var(--status-warning-text)", dot: "var(--status-warning)" },
  pending: { bg: "var(--status-warning-soft)", fg: "var(--status-warning-text)", dot: "var(--status-warning)" },
  failed: { bg: "var(--status-danger-soft)", fg: "var(--status-danger-text)", dot: "var(--status-danger)" },
  cancelled: { bg: "var(--status-danger-soft)", fg: "var(--status-danger-text)", dot: "var(--status-danger)" },
}
function StatusChip({ lane, label }: { lane: string; label: string }) {
  const c = LANE_CHIP[lane] ?? { bg: "var(--fill-tertiary)", fg: "var(--text-tertiary)",
                                 dot: "var(--text-tertiary)" }
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-0.5 text-xs font-medium"
      style={{ background: c.bg, color: c.fg }}
    >
      <span aria-hidden className="size-[5px] rounded-full" style={{ background: c.dot }} />
      {label}
    </span>
  )
}

export default function TaskBoardPage() {
  const navigate = useNavigate()
  const [period, setPeriod] = React.useState("30d")
  const [keyword, setKeyword] = React.useState("")
  const [source, setSource] = React.useState("all")
  const [lane, setLane] = React.useState("all")
  // 09-16 D4：Group 维度筛选（原站看板 Waker/Group 同构）
  const [groupFilter, setGroupFilter] = React.useState("all")
  const [view, setView] = React.useState<"list" | "lanes">("list")
  const [offset, setOffset] = React.useState(0)
  const limit = 20

  const query = React.useMemo(
    () => ({ period, keyword, source, lane, group: groupFilter, offset: String(offset), limit: String(limit) }),
    [period, keyword, source, lane, groupFilter, offset],
  )
  const summary = useAsyncData((o) => asApi.boardSummary(period, o?.signal), [period])
  const tasks = useAsyncData(
    (o) =>
      asApi.boardTasks({
        period,
        offset: query.offset,
        limit: query.limit,
        keyword: keyword || "",
        lane: lane === "all" ? "" : lane,
        source: source === "all" ? "" : source,
        group: groupFilter === "all" ? "" : groupFilter,
      }, o?.signal),
    [period, offset, keyword, lane, source, groupFilter],
  )
  const filters = useAsyncData((o) => asApi.boardFilters(o?.signal), [])

  const s: BoardSummary | null = summary.data
  const lanes = s?.lanes ?? {}
  const items = (tasks.data?.items ?? []) as BoardTask[]

  const openTask = (t: BoardTask) => {
    if (t.kind === "agent-session" && t.session_id) {
      navigate(`/agents/${t.detail_route.split("/agents/")[1]?.split("/chat")[0] ?? ""}/chat?session=${t.session_id}`)
      return
    }
    navigate(t.detail_route)
  }

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <header>
        <h1 className="text-xl font-semibold">任务看板</h1>
        <p className="text-sm text-muted-foreground">
          从「事」出发：查看 Agent 做了什么，处理需要操作的任务，并查看执行结果。
        </p>
      </header>

      {/* 工作记录（原站 qc-work-management-summary 同构：白底卡 py6 + header 同行周期 +
          4 张白底 metric 卡，值 26px·600） */}
      <section
        aria-label="工作记录"
        className="flex flex-col gap-4 border bg-surface py-6 shadow-sm"
        style={{ borderColor: "var(--border)", borderRadius: "8px" }}
      >
        <div className="flex items-center gap-2 px-6">
          <h2 className="text-sm font-medium">工作记录</h2>
          <Select value={period} onValueChange={(v) => { setPeriod(v); setOffset(0) }}>
            <SelectTrigger className="ml-2 w-32" aria-label="数据周期">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">一周</SelectItem>
              <SelectItem value="30d">一个月</SelectItem>
              <SelectItem value="90d">三个月</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {/* 09-13 审计修复：摘要失败禁止伪装成业务 0——错误态显式渲染+重试 */}
        {summary.error ? (
          <div className="flex items-center gap-3 px-6 pb-2 text-sm" role="alert">
            <span className="text-status-danger">工作记录摘要加载失败：{summary.error}</span>
            <Button size="sm" variant="outline" onClick={() => summary.retry()}>重试</Button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 px-6 md:grid-cols-4">
            {[
              { label: "任务总数", value: s?.total },
              { label: "进行中任务", value: s?.running },
              { label: "需要操作", value: s?.needs_action },
              { label: "已结束任务", value: s?.ended },
            ].map((m) => (
              <div
                key={m.label}
                className="flex flex-col gap-1 border bg-surface px-6 py-4 shadow-sm"
                style={{ borderColor: "var(--border)", borderRadius: "6px" }}
              >
                <strong className="text-[26px] font-semibold leading-8">
                  {summary.loading && m.value === undefined ? "…" : String(m.value ?? 0)}
                </strong>
                <span className="text-[13px] text-muted-foreground">{m.label}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 09-13 审计修复：移除暴露内部实施阶段的禁用页签（查收能力未做即不展示） */}
      <section aria-label="需要关注" className="rounded-md border">
        <div className="flex items-center gap-2 border-b px-4 py-2.5">
          <h2 className="text-sm font-medium">需要操作（{lanes.waiting ?? 0}）</h2>
        </div>
        <div className="p-4 text-sm text-muted-foreground">
          需要你确认、回答或补充信息的任务会显示在这里（来源：运行时 waiting/parked 状态）。
        </div>
      </section>

      <section aria-label="全部任务" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-medium">全部任务</h2>
          <Tabs value={view} onValueChange={(v) => setView(v as "list" | "lanes")}>
            <TabsList>
              <TabsTrigger value="list">列表</TabsTrigger>
              <TabsTrigger value="lanes">泳道</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Input
              placeholder="搜索任务、Agent"
              aria-label="搜索任务、Agent"
              value={keyword}
              onChange={(e) => { setKeyword(e.target.value); setOffset(0) }}
              className="w-48"
            />
            <Select value={source} onValueChange={(v) => { setSource(v); setOffset(0) }}>
              <SelectTrigger className="w-32" aria-label="触发方式">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                {(((filters.data as Record<string, { value: string; label: string }[]>)?.sources) ?? []).map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={groupFilter} onValueChange={(v) => { setGroupFilter(v); setOffset(0) }}>
              <SelectTrigger className="w-32" aria-label="Waker / Group">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                {(((filters.data as Record<string, { value: string; label: string }[]>)?.groups) ?? []).map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={lane} onValueChange={(v) => { setLane(v); setOffset(0) }}>
              <SelectTrigger className="w-32" aria-label="任务状态">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="pending">需要操作</SelectItem>
                <SelectItem value="running">执行中</SelectItem>
                <SelectItem value="done">已完成</SelectItem>
                <SelectItem value="waiting">排队中</SelectItem>
                <SelectItem value="failed,cancelled">失败/取消</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {tasks.error && (
          <p className="text-sm text-destructive">加载失败：{String(tasks.error)}</p>
        )}

        {view === "list" ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>任务</TableHead>
                <TableHead>执行者</TableHead>
                <TableHead>来源</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>最近更新</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((t) => (
                <TableRow
                  key={t.id}
                  className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  tabIndex={0}
                  role="link"
                  aria-label={`打开任务 ${t.title}`}
                  onClick={() => openTask(t)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      openTask(t)
                    }
                  }}
                >
                  <TableCell className="font-medium">{t.title}</TableCell>
                  {/* 执行者（原站 qc-work-management-assignee 同构）：avatar 20px + 名称 */}
                  <TableCell>
                    <span className="flex items-center gap-2">
                      <ExecutorIcon t={t} />
                      <span className="truncate text-sm">{t.executor}</span>
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{t.source_label}</TableCell>
                  <TableCell>
                    <StatusChip lane={t.lane} label={LANE_LABEL[t.lane] ?? t.lane} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(t.updated_at).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
              {!items.length && !tasks.loading && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    暂无任务
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        ) : (
          <div className="grid gap-3 md:grid-cols-5">
            {(["pending", "running", "done", "waiting", "failed,cancelled"] as const).map((l) => (
              <div
                key={l}
                className="rounded-lg border bg-(--fill-tertiary) py-3 pl-3"
                style={{ borderColor: "var(--border)", borderRadius: "8px" }}
              >
                {/* 列头：<strong>名称</strong> + 计数（原站 header 同构） */}
                <header className="flex items-center gap-2 pr-3 text-sm text-muted-foreground">
                  <strong className="font-normal">{l === "failed,cancelled" ? "失败/取消" : LANE_LABEL[l]}</strong>
                  <span>
                    {l === "failed,cancelled"
                      ? (lanes.failed ?? 0) + (lanes.cancelled ?? 0)
                      : lanes[l] ?? 0}
                  </span>
                </header>
                <div className="mt-3 flex max-h-[586px] flex-col gap-3 overflow-y-auto pr-3">
                  {items
                    .filter((t) => laneOf(t) === l)
                    .map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => openTask(t)}
                        className="flex flex-col gap-2 border bg-surface p-3 text-left shadow-sm transition-colors hover:border-muted-foreground/40"
                        style={{ borderColor: "var(--border)", borderRadius: "6px" }}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-2">
                            <ExecutorIcon t={t} />
                            <span className="truncate text-sm">{t.executor}</span>
                          </span>
                          <time className="shrink-0 text-xs text-(--text-tertiary)">{relTime(t.updated_at)}</time>
                        </span>
                        <strong className="text-sm font-medium">{t.title}</strong>
                        <span className="flex items-center gap-2">
                          <span className="text-xs text-(--text-tertiary)">来源：{t.source_label}</span>
                          <StatusChip lane={t.lane} label={LANE_LABEL[t.lane] ?? t.lane} />
                        </span>
                      </button>
                    ))}
                  {!items.filter((t) => laneOf(t) === l).length && (
                    <p className="py-6 text-center text-xs text-(--text-tertiary)">暂无任务</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>共 {tasks.data?.total ?? 0} 条</span>
          <Button
            variant="outline"
            size="sm"
            disabled={offset === 0}
            onClick={() => setOffset((o) => Math.max(0, o - limit))}
          >
            上一页
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={offset + limit >= (tasks.data?.total ?? 0)}
            onClick={() => setOffset((o) => o + limit)}
          >
            下一页
          </Button>
        </div>
      </section>
    </div>
  )
}
