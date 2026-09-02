import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react"
import { useEffect, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ErrorState, TableSkeleton } from "@/components/app/list-state"
import { PageContainer, PageHeader } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status-badge"
import { TableFrame } from "@/components/app/table-frame"
import { formatCompactDateTime } from "@/lib/time"
import { opsApi, type OpsHistoryItem } from "@/services/wf-api"

/** SDD 13 §10.6：批次历史=表格 + 服务端分页；所有筛选/排序写入 URL Query（前进后退可恢复）。 */
export default function OperationsHistoryPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const page = Math.max(1, Number(params.get("page") ?? 1))
  const pageSize = Math.min(200, Math.max(1, Number(params.get("pageSize") ?? 20)))
  const [items, setItems] = useState<OpsHistoryItem[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const filters = {
    q: params.get("q") ?? "", taskId: params.get("taskId") ?? "",
    status: params.get("status") ?? "", deliveryStatus: params.get("deliveryStatus") ?? "",
    trigger: params.get("trigger") ?? "", environment: params.get("environment") ?? "",
    startedFrom: params.get("startedFrom") ?? "", startedTo: params.get("startedTo") ?? "",
    sort: params.get("sort") ?? "-createdAt",
  }

  const update = (patch: Record<string, string>, resetPage = true) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    if (resetPage) next.delete("page")
    setParams(next, { replace: false })
  }

  useEffect(() => {
    let cancelled = false
    opsApi.history({ page, pageSize, ...filters })
      .then((r) => { if (!cancelled) { setItems(r.items); setTotal(r.total); setError(null) } })
      .catch((e) => { if (!cancelled) setError((e as Error).message) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  const pages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <PageContainer wide className="space-y-4">
      <PageHeader title="批次历史" description="跨日、跨 Task 检索 TaskRun；筛选与排序保存在 URL" />

      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="搜索 Task 名称 / TaskRun ID" className="h-8 w-56" value={filters.q}
          onChange={(e) => update({ q: e.target.value })} />
        <Input placeholder="taskId" className="h-8 w-40" value={filters.taskId}
          onChange={(e) => update({ taskId: e.target.value })} />
        <Select value={filters.status || "all"} onValueChange={(v) => update({ status: v === "all" ? "" : v })}>
          <SelectTrigger className="h-8 w-32"><SelectValue placeholder="执行状态" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部执行状态</SelectItem>
            {["queued", "running", "succeeded", "partial", "failed", "cancelled"].map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>))}
          </SelectContent>
        </Select>
        <Select value={filters.deliveryStatus || "all"} onValueChange={(v) => update({ deliveryStatus: v === "all" ? "" : v })}>
          <SelectTrigger className="h-8 w-32"><SelectValue placeholder="投递状态" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部投递状态</SelectItem>
            {["not_configured", "pending", "running", "succeeded", "partial", "failed"].map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>))}
          </SelectContent>
        </Select>
        <Select value={filters.trigger || "all"} onValueChange={(v) => update({ trigger: v === "all" ? "" : v })}>
          <SelectTrigger className="h-8 w-30"><SelectValue placeholder="Trigger" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部 Trigger</SelectItem>
            {["schedule", "manual", "api", "backfill"].map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>))}
          </SelectContent>
        </Select>
        <Input type="date" className="h-8 w-36" value={filters.startedFrom}
          onChange={(e) => update({ startedFrom: e.target.value })} aria-label="开始日期" />
        <span className="text-xs text-muted-foreground">→</span>
        <Input type="date" className="h-8 w-36" value={filters.startedTo}
          onChange={(e) => update({ startedTo: e.target.value })} aria-label="结束日期" />
        <Select value={filters.sort} onValueChange={(v) => update({ sort: v }, false)}>
          <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="-createdAt">最新创建优先</SelectItem>
            <SelectItem value="createdAt">最早创建优先</SelectItem>
            <SelectItem value="-durationMs">耗时最长优先</SelectItem>
            <SelectItem value="durationMs">耗时最短优先</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {error ? <ErrorState title="批次历史加载失败" onRetry={() => update({}, false)} /> : null}
      <TableFrame>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>启动时间</TableHead>
              <TableHead>Task</TableHead>
              <TableHead>Trigger</TableHead>
              <TableHead>执行</TableHead>
              <TableHead>投递</TableHead>
              <TableHead className="text-right">数量</TableHead>
              <TableHead>耗时</TableHead>
              <TableHead>Environment</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items === null && !error ? (
              <TableRow><TableCell colSpan={9}><TableSkeleton rows={8} columns={8} /></TableCell></TableRow>
            ) : (items ?? []).length === 0 ? (
              <TableRow><TableCell colSpan={9} className="py-6 text-center text-sm text-muted-foreground">没有匹配的批次</TableCell></TableRow>
            ) : (items ?? []).map((it) => (
              <TableRow key={it.id} className="cursor-pointer hover:bg-muted/50"
                onClick={() => navigate(`/operations/task-runs/${it.id}`)}>
                <TableCell className="text-sm tabular-nums">
                  {it.startedAt ? formatCompactDateTime(it.startedAt) : formatCompactDateTime(it.createdAt)}
                </TableCell>
                <TableCell className="text-sm">{it.taskName}</TableCell>
                <TableCell className="text-sm">{it.trigger}</TableCell>
                <TableCell>
                  <StatusBadge status={it.execution.status} context="run" />
                  <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">
                    {it.execution.succeeded}/{it.execution.total}
                  </span>
                </TableCell>
                <TableCell>
                  {/* 投递状态文本化，不只依赖颜色（SDD §10.3） */}
                  <span className="rounded border px-1.5 py-0.5 text-[11px]">{it.delivery.status}</span>
                  <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">
                    成 {it.delivery.succeeded} / 败 {it.delivery.failed}
                  </span>
                </TableCell>
                <TableCell className="text-right text-sm tabular-nums">{it.execution.total}</TableCell>
                <TableCell className="text-sm tabular-nums">
                  {it.durationMs != null ? `${Math.round(it.durationMs / 1000)}s` : "—"}
                </TableCell>
                <TableCell className="text-sm">{it.environment}</TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="size-7" aria-label="操作">
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => navigate(`/operations/task-runs/${it.id}`)}>批次详情</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => navigate(`/config/tasks/${it.taskId}`)}>Task 定义</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableFrame>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>共 {total} 条 · 第 {page} / {pages} 页</span>
        <div className="flex items-center gap-2">
          <Select value={String(pageSize)} onValueChange={(v) => update({ pageSize: v })}>
            <SelectTrigger className="h-8 w-24"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[10, 20, 50, 100, 200].map((n) => <SelectItem key={n} value={String(n)}>{n} / 页</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" disabled={page <= 1}
            onClick={() => update({ page: String(page - 1) }, false)}>
            <ChevronLeft className="size-4" /> 上一页
          </Button>
          <Button variant="outline" size="sm" disabled={page >= pages}
            onClick={() => update({ page: String(page + 1) }, false)}>
            下一页 <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    </PageContainer>
  )
}
