/** Agent 任务看板子页（QoderWake /wakers/<id>/task 同构）。
 *
 * 原站事实（09-10 实地）：
 *  - 指标带：任务总数 / 进行中 / 需要操作 / 已结束（+ 数据周期）；
 *  - 筛选：触发方式 / 任务状态 / 数据周期（executor 固定为当前 Agent）；
 *  - 列表列：任务 / 触发方式 / 状态 / 最近更新 + 分页 + 每页条数。
 * 数据源：平台任务投影 /api/board/tasks?executor=<agentId>（真实 Session/Run 投影）。
 */
import * as React from "react"
import { useNavigate } from "react-router-dom"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { asApi, type BoardSummary, type BoardTask } from "@/services/as-api"

const SOURCE_LABEL: Record<string, string> = {
  chat: "对话触发", manual: "手动触发", schedule: "定时", api: "API",
  event: "事件", workflow: "Workflow", agentflow: "AgentFlow", batch: "批次", agent: "Agent",
}

export function AgentTaskBoardSection({ agentId }: { agentId: string }) {
  const navigate = useNavigate()
  const [period, setPeriod] = React.useState("30d")
  const [source, setSource] = React.useState("")
  const [lane, setLane] = React.useState("")
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(10)
  const [data, setData] = React.useState<{ items: BoardTask[]; total: number }>({ items: [], total: 0 })
  const [summary, setSummary] = React.useState<BoardSummary | null>(null)
  const [summaryError, setSummaryError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)

  const reload = React.useCallback(() => {
    setLoading(true)
    asApi
      .boardTasks({
        period, executor: agentId,
        ...(source ? { source } : {}),
        ...(lane ? { lane } : {}),
        offset: String((page - 1) * pageSize),
        limit: String(pageSize),
      })
      .then((r) => setData({ items: r.items, total: r.total }))
      .catch(() => undefined)
      .finally(() => setLoading(false))
  }, [agentId, period, source, lane, page, pageSize])

  React.useEffect(() => { reload() }, [reload])
  React.useEffect(() => {
    // 09-13 审计修复：摘要失败显式呈现，不再伪装成业务 0
    asApi.boardSummary(period)
      .then((s) => { setSummary(s); setSummaryError(null) })
      .catch((e: unknown) => {
        setSummary(null)
        setSummaryError(e instanceof Error ? e.message : "加载失败")
      })
  }, [period])

  const pages = Math.max(1, Math.ceil(data.total / pageSize))

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[28px] font-semibold leading-[38px]">任务看板</h2>
        <p className="mt-1 text-sm text-muted-foreground">从「事」出发：查看该 Agent 做了什么，处理需要操作的任务，并查看执行结果。</p>
      </div>

      {summaryError ? (
        <div className="rounded-md border border-status-danger/40 p-3 text-sm text-status-danger" role="alert">
          指标加载失败：{summaryError}
        </div>
      ) : (
        <section aria-label="指标" className="grid gap-3 md:grid-cols-4">
          {[
            { label: "任务总数", value: summary?.total },
            { label: "进行中任务", value: summary?.running },
            { label: "需要操作", value: summary?.needs_action },
            { label: "已结束任务", value: summary?.ended },
          ].map((m) => (
            <div key={m.label} className="rounded-md border p-3">
              <strong className="text-lg">{summary === null ? "…" : String(m.value ?? 0)}</strong>
              <div className="text-sm">{m.label}</div>
            </div>
          ))}
        </section>
      )}

      <section aria-label="筛选" className="flex flex-wrap items-center gap-2">
        <Select value={period} onValueChange={(v) => { setPeriod(v); setPage(1) }}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7d">最近 7 天</SelectItem>
            <SelectItem value="30d">最近 30 天</SelectItem>
            <SelectItem value="90d">最近 90 天</SelectItem>
          </SelectContent>
        </Select>
        <Select value={source || "__all"} onValueChange={(v) => { setSource(v === "__all" ? "" : v); setPage(1) }}>
          <SelectTrigger className="w-36"><SelectValue placeholder="触发方式" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">全部触发方式</SelectItem>
            {Object.entries(SOURCE_LABEL).map(([k, label]) => (
              <SelectItem key={k} value={k}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={lane || "__all"} onValueChange={(v) => { setLane(v === "__all" ? "" : v); setPage(1) }}>
          <SelectTrigger className="w-32"><SelectValue placeholder="任务状态" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">全部状态</SelectItem>
            <SelectItem value="pending">需要操作</SelectItem>
            <SelectItem value="running">执行中</SelectItem>
            <SelectItem value="done">已完成</SelectItem>
            <SelectItem value="waiting">排队中</SelectItem>
            <SelectItem value="failed,cancelled">失败/取消</SelectItem>
          </SelectContent>
        </Select>
      </section>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>任务</TableHead>
            <TableHead>触发方式</TableHead>
            <TableHead>状态</TableHead>
            <TableHead>最近更新</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.items.map((t) => (
            <TableRow key={t.id} className="cursor-pointer" onClick={() => navigate(t.detail_route || `/tasks`)}>
              <TableCell className="font-medium">{t.title}</TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {t.source_label || SOURCE_LABEL[t.source] || t.source}
              </TableCell>
              <TableCell>
                <Badge variant={t.status_label === "已完成" ? "secondary" : t.lane === "failed,cancelled" ? "destructive" : "outline"}>
                  {t.status_label}
                </Badge>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {t.updated_at ? new Date(t.updated_at).toLocaleString() : "—"}
              </TableCell>
            </TableRow>
          ))}
          {!data.items.length && !loading && (
            <TableRow>
              <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                暂无任务（调整筛选，或到对话页发起第一个任务）
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <footer className="flex items-center gap-3 text-xs text-muted-foreground">
        <span>共 {data.total} 条</span>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>上一页</Button>
          <span>{page} / {pages}</span>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>下一页</Button>
          <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1) }}>
            <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[10, 20, 50].map((n) => <SelectItem key={n} value={String(n)}>{n} 条/页</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </footer>
    </div>
  )
}
