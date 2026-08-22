import { ArrowLeft, Copy, MoreHorizontal, RotateCw } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { DefinitionRow } from "@/components/app/form-field"
import { FilterBar, SearchField } from "@/components/app/filters"
import { ErrorState, TableSkeleton } from "@/components/app/list-state"
import { PageContainer, PageHeader, SectionHeader } from "@/components/app/page"
import { Pagination } from "@/components/app/pagination"
import { RiskBadge, StatusBadge } from "@/components/app/status-badge"
import { StatusNotice } from "@/components/app/status-indicator"
import { TableFrame } from "@/components/app/table-frame"
import { useAsyncData } from "@/hooks/use-async-data"
import { useListQuery } from "@/hooks/use-list-query"
import { formatDateTime } from "@/lib/time"
import { parseListFilters, serializeListFilters } from "@/lib/list-filters"
import { getRun, listExecutions } from "@/services/mock-service"
import { realRunDetail, wfEnabled, WF_BASE } from "@/services/wf-api"
import type { InteractionExecution } from "@/domain/types"

export default function RunDetailPage() {
  const { taskId = "", runId = "" } = useParams()
  const navigate = useNavigate()
  const { data: run, loading, error, retry } = useAsyncData(() => (wfEnabled() ? realRunDetail(runId).then((r) => r.run) : getRun(runId)), [runId])
  const { params, update } = useListQuery(50)
  const filters = useMemo(() => parseListFilters(params.filters), [params.filters])
  const [events, setEvents] = useState<{ sequence: number; type: string; nodeId: string | null; at: string }[]>([])
  useEffect(() => {
    if (wfEnabled() && runId) {
      fetch(`${WF_BASE}/api/runs/${runId}/events-list`).then((r) => r.json()).then((r) => setEvents(r.items ?? [])).catch(() => undefined)
    }
  }, [runId])

  const { data: executions, loading: execLoading } = useAsyncData(
    () => (wfEnabled() ? realRunDetail(runId).then((r) => r.executions) : listExecutions(runId, params)),
    [runId, params.search, params.page, params.pageSize, params.filters],
  )

  const [searchInput, setSearchInput] = useState(params.search ?? "")
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput !== (params.search ?? "")) update({ search: searchInput }, true)
    }, 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput])

  const [toolsOpen, setToolsOpen] = useState(false)
  const [mappingOpen, setMappingOpen] = useState(false)
  const [rerunOpen, setRerunOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [selectedExecution, setSelectedExecution] = useState<InteractionExecution | null>(null)

  if (error) return <PageContainer><ErrorState title="Run 加载失败" onRetry={retry} /></PageContainer>
  if (loading || !run) return <PageContainer><TableSkeleton rows={8} columns={6} /></PageContainer>

  const hasErrors = (run.summary.error ?? 0) > 0

  return (
    <PageContainer wide className="space-y-5">
      <div>
        <Button variant="ghost" size="sm" className="gap-1 px-2" onClick={() => navigate(`/config/tasks/${taskId}`)}>
          <ArrowLeft className="size-4" /> {run.taskName}
        </Button>
        <PageHeader
          className="mt-2"
          title={`Run #${run.id}`}
          status={<StatusBadge status={run.status} context="run" />}
          description={`${formatDateTime(run.startedAt, true)} → ${run.finishedAt ? formatDateTime(run.finishedAt, true) : "进行中"}`}
          actions={
            <>
              {run.status === "RUNNING" ? (
                <Button variant="destructive" size="sm" onClick={() => setCancelOpen(true)}>取消运行</Button>
              ) : run.status === "FAILED" || run.status === "PARTIAL_SUCCESS" ? (
                <Button variant="outline" size="sm" onClick={() => setRerunOpen(true)}>重新运行</Button>
              ) : null}
                  {wfEnabled() && run?.status === "FAILED" && (
                    <Button variant="outline" size="sm" className="gap-1" onClick={async () => {
                      const r = await fetch(`${WF_BASE}/api/runs/${runId}/retry`, { method: "POST" })
                      if (r.ok) { toast.success("已创建重试 Run"); retry() } else toast.error("重试失败")
                    }}><RotateCw className="size-3.5" /> 重试</Button>
                  )}
                  {wfEnabled() && (
                    <Button variant="outline" size="sm" className="gap-1" onClick={async () => {
                      await navigator.clipboard.writeText(JSON.stringify(run, null, 2))
                      toast.success("Run JSON 已复制")
                    }}><Copy className="size-3.5" /> 复制</Button>
                  )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-8"><MoreHorizontal className="size-4" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => { navigator.clipboard.writeText(run.id); toast.success("已复制 Run ID") }}>复制 Run ID</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate(`/config/tasks/${taskId}`)}>查看 Task</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => toast.info("Run Trace（高级）：原型中展示于 Execution Detail Sheet")}>查看运行 Trace</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          }
        />
      </div>

      {/* Execution Summary */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          { label: "输入", value: run.summary.input },
          { label: "成功", value: run.summary.success },
          { label: "跳过", value: run.summary.skipped },
          { label: "错误", value: run.summary.error },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border bg-card px-4 py-3">
            <div className="text-xs text-muted-foreground">{s.label}</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{s.value.toLocaleString("zh-CN")}</div>
          </div>
        ))}
        <div className="rounded-lg border bg-card px-4 py-3">
          <div className="text-xs text-muted-foreground">耗时</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{run.duration ?? "—"}</div>
        </div>
      </div>

      {/* Error / Blocked summary */}
      {run.status === "BLOCKED" && run.blockedReason ? (
        <StatusNotice tone="danger" title="运行被阻塞">
          <p className="text-sm">{run.blockedReason}</p>
        </StatusNotice>
      ) : hasErrors ? (
        <StatusNotice tone="warning" title={`${run.summary.error} 个 Interaction 执行失败`}>
          <div className="space-y-0.5 text-sm">
            {(run.errors ?? []).map((e) => (
              <div key={e.type} className="flex justify-between gap-6">
                <span>{e.type}</span>
                <span className="tabular-nums">{e.count}</span>
              </div>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="mt-2 h-7"
            onClick={() => update({ filters: serializeListFilters({ ...filters, executionStatus: "ERROR" }) }, true)}
          >
            查看失败 Interaction
          </Button>
        </StatusNotice>
      ) : null}

      {/* Frozen Snapshot */}
      <div className="space-y-2">
        <SectionHeader title="Frozen Snapshot" description="Run 为不可变执行事实：冻结当次实际依赖" />
        <div className="grid grid-cols-1 gap-x-6 rounded-lg border bg-card px-4 py-2 md:grid-cols-2 xl:grid-cols-3">
          <DefinitionRow label="Analysis Task">{run.taskName}</DefinitionRow>
          <DefinitionRow label="Agent + Version">{run.snapshot.agentName} · {run.snapshot.agentVersion}</DefinitionRow>
          <DefinitionRow label="Data Asset + Revision">{run.snapshot.dataAssetName} · R{run.snapshot.dataAssetRevision}</DefinitionRow>
          <DefinitionRow label="Data Window">{run.dataWindow.label}（{run.dataWindow.start} → {run.dataWindow.end}，[start, end)）</DefinitionRow>
          <DefinitionRow label="Data Scope">{run.snapshot.scope}</DefinitionRow>
          <DefinitionRow label="Sampling">{run.snapshot.sampling}</DefinitionRow>
          <DefinitionRow label="Result Rules">{run.snapshot.resultRulesVersion ?? "—"}</DefinitionRow>
          <DefinitionRow label="Runtime">{run.snapshot.runtime}</DefinitionRow>
          <DefinitionRow label="Tools">
            <span className="mr-2">{run.snapshot.toolVersions.length} 个固定版本</span>
            <Button variant="outline" size="sm" className="h-7" onClick={() => setToolsOpen(true)}>查看</Button>
          </DefinitionRow>
          <DefinitionRow label="Input Mapping">
            <span className="mr-2">{run.snapshot.inputMapping.length} 个字段</span>
            <Button variant="outline" size="sm" className="h-7" onClick={() => setMappingOpen(true)}>查看</Button>
          </DefinitionRow>
        </div>
      </div>

      {/* 节点时间线 */}
      {executions && executions.items.length > 0 && (
        <div className="space-y-2">
          <SectionHeader title="节点时间线" description="按执行顺序与耗时展示" />
          <div className="space-y-1.5 rounded-lg border bg-card px-4 py-3">
            {(() => {
              const max = Math.max(...executions.items.map((e) => parseInt(e.duration ?? "0") || 1), 1)
              return executions.items.map((e) => (
                <div key={e.id} className="flex items-center gap-3 text-xs">
                  <span className="w-28 truncate" style={{ color: "#1F2329" }}>{e.interactionId}</span>
                  <span className="w-14" style={{ color: "#B9C2CF" }}>{e.agentName}</span>
                  <div className="h-2 flex-1 rounded bg-neutral-100">
                    <div className={`h-2 rounded ${e.status === "ERROR" ? "bg-red-400" : e.status === "SKIPPED" ? "bg-neutral-300" : "bg-emerald-400"}`}
                      style={{ width: `${Math.max(4, Math.round((parseInt(e.duration ?? "0") || 1) / max * 100))}%` }} />
                  </div>
                  <span className="w-16 text-right" style={{ color: "#5A6472" }}>{e.duration ?? "—"}</span>
                </div>
              ))
            })()}
          </div>
        </div>
      )}

      {/* 事件流 */}
      {events.length > 0 && (
        <div className="space-y-2">
          <SectionHeader title="事件流" description="run_event 序列（SSE 同源）" />
          <div className="max-h-64 overflow-y-auto rounded-lg border bg-card px-4 py-2">
            {events.map((e) => (
              <div key={e.sequence} className="flex items-center gap-3 border-b py-1 text-xs last:border-0" style={{ borderColor: "#EDF0F4" }}>
                <span className="w-8 text-right" style={{ color: "#B9C2CF" }}>#{e.sequence}</span>
                <span className="w-40 font-mono" style={{ color: "#1F2329" }}>{e.type}</span>
                <span className="flex-1 truncate" style={{ color: "#5A6472" }}>{e.nodeId ?? ""}</span>
                <span style={{ color: "#B9C2CF" }}>{new Date(e.at).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Interaction Executions */}
      <div className="space-y-2">
        <SectionHeader title="Interaction Executions" description="SUCCESS + High Risk 合法；ERROR 表示没有成功产生有效业务结果" />
        <FilterBar>
          <SearchField value={searchInput} onChange={setSearchInput} placeholder="搜索 Interaction..." />
          <Select value={filters.executionStatus ?? "__all__"} onValueChange={(v) => update({ filters: serializeListFilters({ ...filters, executionStatus: v === "__all__" ? "" : v }) }, true)}>
            <SelectTrigger className="h-9 w-32"><SelectValue placeholder="执行状态" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">全部状态</SelectItem>
              <SelectItem value="SUCCESS">SUCCESS</SelectItem>
              <SelectItem value="ERROR">ERROR</SelectItem>
              <SelectItem value="SKIPPED">SKIPPED</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filters.errorType ?? "__all__"} onValueChange={(v) => update({ filters: serializeListFilters({ ...filters, errorType: v === "__all__" ? "" : v }) }, true)}>
            <SelectTrigger className="h-9 w-48"><SelectValue placeholder="错误类型" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">全部错误类型</SelectItem>
              <SelectItem value="Tool timeout">Tool timeout</SelectItem>
              <SelectItem value="Structured output invalid">Structured output invalid</SelectItem>
              <SelectItem value="Missing required input">Missing required input</SelectItem>
            </SelectContent>
          </Select>
        </FilterBar>
        {execLoading ? (
          <TableFrame><TableSkeleton rows={8} columns={6} /></TableFrame>
        ) : (
          <>
            <TableFrame>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Interaction</TableHead>
                    <TableHead>坐席</TableHead>
                    <TableHead>业务场景</TableHead>
                    <TableHead>执行状态</TableHead>
                    <TableHead>质量结果</TableHead>
                    <TableHead className="text-right">耗时</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(executions?.items ?? []).map((exec) => (
                    <TableRow
                      key={exec.id}
                      className={exec.status === "SUCCESS" ? "cursor-pointer hover:bg-muted/50" : exec.status === "ERROR" ? "cursor-pointer hover:bg-muted/50" : undefined}
                      onClick={() => {
                        if (exec.status === "SUCCESS") navigate(`/quality/results/${exec.interactionId}`)
                        else if (exec.status === "ERROR") setSelectedExecution(exec)
                      }}
                    >
                      <TableCell className="font-mono text-xs">{exec.interactionId}</TableCell>
                      <TableCell className="text-sm">{exec.agentName}</TableCell>
                      <TableCell>
                        <div className="text-sm">{exec.businessContext.serviceType}</div>
                        <div className="text-xs text-muted-foreground">{exec.businessContext.productCategory} · {exec.businessContext.issueTopic}</div>
                      </TableCell>
                      <TableCell><StatusBadge status={exec.status} /></TableCell>
                      <TableCell>
                        {exec.status === "SUCCESS" ? (
                          <div className="flex items-center gap-2">
                            <span className="text-sm tabular-nums">{exec.score !== undefined ? `${exec.score} 分` : "—"}</span>
                            <RiskBadge risk={exec.risk} />
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{exec.duration ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableFrame>
            {executions ? (
              <Pagination
                page={executions.page}
                pageSize={executions.pageSize}
                total={executions.total}
                onPageChange={(page) => update({ page })}
                onPageSizeChange={(pageSize) => update({ pageSize })}
              />
            ) : null}
          </>
        )}
      </div>

      {/* Tool Versions Sheet */}
      <Sheet open={toolsOpen} onOpenChange={setToolsOpen}>
        <SheetContent className="w-[380px]">
          <SheetHeader>
            <SheetTitle>Tool Versions</SheetTitle>
            <SheetDescription>本次 Run 冻结的 Tool 具体版本</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-2">
            {run.snapshot.toolVersions.map((t) => (
              <div key={t.toolName} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                <span>{t.toolName}</span>
                <span className="text-muted-foreground">{t.version}</span>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      {/* Input Mapping Sheet */}
      <Sheet open={mappingOpen} onOpenChange={setMappingOpen}>
        <SheetContent className="w-[380px]">
          <SheetHeader>
            <SheetTitle>Input Mapping Snapshot</SheetTitle>
            <SheetDescription>Agent Input ← Data Asset Field</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-2">
            {run.snapshot.inputMapping.map((m) => (
              <div key={m.agentInput} className="flex items-center justify-between rounded-md border px-3 py-2 font-mono text-xs">
                <span>{m.agentInput}</span>
                <span className="text-muted-foreground">← {m.assetField}</span>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      {/* Execution Detail Sheet（ERROR Row） */}
      <Sheet open={selectedExecution !== null} onOpenChange={(open) => !open && setSelectedExecution(null)}>
        <SheetContent className="w-[440px] overflow-y-auto">
          {selectedExecution ? (
            <>
              <SheetHeader>
                <SheetTitle>Execution Detail</SheetTitle>
                <SheetDescription>{selectedExecution.interactionId}</SheetDescription>
              </SheetHeader>
              <div className="mt-4 space-y-4 text-sm">
                <div className="flex items-center gap-2">
                  <StatusBadge status={selectedExecution.status} />
                  {selectedExecution.errorType ? <span className="text-xs text-muted-foreground">{selectedExecution.errorType}</span> : null}
                </div>
                <div className="space-y-1.5">
                  <div className="text-xs font-medium text-muted-foreground">Attempts</div>
                  <div className="space-y-1">
                    {selectedExecution.attempts.map((a) => (
                      <div key={a.no} className="flex items-center justify-between rounded-md border px-3 py-1.5 text-xs">
                        <span>Attempt {a.no}</span>
                        <span className="flex items-center gap-2">
                          {a.error ? <span className="text-muted-foreground">{a.error}</span> : null}
                          <StatusBadge status={a.status} />
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <div className="text-xs font-medium text-muted-foreground">Error Detail</div>
                  <pre className="overflow-x-auto rounded-md bg-muted/60 p-3 text-[11px] leading-5">
{JSON.stringify({ interaction: selectedExecution.interactionId, errorType: selectedExecution.errorType, failedNode: "查询服务请求", duration: selectedExecution.duration }, null, 2)}
                  </pre>
                </div>
                <div className="space-y-1.5">
                  <div className="text-xs font-medium text-muted-foreground">Tool Calls</div>
                  <div className="flex items-center justify-between rounded-md border px-3 py-1.5 text-xs">
                    <span>查询服务请求 V2</span>
                    <StatusBadge status="ERROR" />
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => toast.info("完整 Trace（高级）原型占位")}>查看完整 Trace</Button>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      {/* Rerun Dialog */}
      <Dialog open={rerunOpen} onOpenChange={setRerunOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重新运行此 Run？</DialogTitle>
            <DialogDescription>
              数据窗口：{run.dataWindow.label}。将创建新的 Run；当前 Run 和历史结果不会被覆盖。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRerunOpen(false)}>取消</Button>
            <Button onClick={() => { toast.success("已创建新的 Run"); setRerunOpen(false) }}>重新运行</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Dialog */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>取消运行？</DialogTitle>
            <DialogDescription>将停止当前 Run，已完成的 Execution 保留为部分结果。此操作不可逆。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>继续运行</Button>
            <Button variant="destructive" onClick={() => { toast.success("Run 已取消"); setCancelOpen(false) }}>取消运行</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
