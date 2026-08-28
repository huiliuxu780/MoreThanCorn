import { ArrowLeft, Copy, Download, MoreHorizontal, RotateCw } from "lucide-react"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TraceView, type TraceEvent } from "@/components/run/trace-view"
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
import { realRunDetail, runCancel, runEventsList, runRetry, runTrace, wfApi } from "@/services/wf-api"
import type { InteractionExecution } from "@/domain/types"

export default function RunDetailPage() {
  const { taskId = "", runId = "" } = useParams()
  const navigate = useNavigate()
  const { data: run, loading, error, retry } = useAsyncData(() => realRunDetail(runId).then((r) => r.run), [runId])
  const { params, update } = useListQuery(50)
  const filters = useMemo(() => parseListFilters(params.filters), [params.filters])
  const [events, setEvents] = useState<TraceEvent[]>([])
  useEffect(() => {
    if (runId) {
      runEventsList(runId).then((r) => setEvents((r.items ?? []) as unknown as TraceEvent[])).catch(() => undefined)
    }
  }, [runId])
  /* 观测升级：span 树 + 四 Tab（SDD design-run-observability） */
  const { data: trace } = useAsyncData(() => runTrace(runId).catch(() => null), [runId])
  const [tab, setTab] = useState<"trace" | "events" | "executions" | "snapshot">("trace")
  const [focusSpanId, setFocusSpanId] = useState<string | null>(null)
  const [evType, setEvType] = useState("__all__")
  const [evChannel, setEvChannel] = useState("__all__")
  const evTypes = useMemo(() => [...new Set(events.map((e) => e.type))], [events])
  const filteredEvents = useMemo(() => events.filter((e) =>
    (evType === "__all__" || e.type === evType) && (evChannel === "__all__" || e.channel === evChannel)), [events, evType, evChannel])

  const { data: executions, loading: execLoading } = useAsyncData(
    () => realRunDetail(runId).then((r) => r.executions),
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
          status={
            <span className="flex items-center gap-2">
              <StatusBadge status={run.status} context="run" />
              {run.snapshot.agentVersion !== "-" && (
                <span className="rounded border px-1.5 py-0.5 text-xs text-muted-foreground">
                  {run.snapshot.agentVersion === "草稿" ? "草稿运行" : run.snapshot.agentVersion}
                </span>
              )}
            </span>
          }
          description={`${formatDateTime(run.startedAt, true)} → ${run.finishedAt ? formatDateTime(run.finishedAt, true) : "进行中"}`}
          actions={
            <>
              {run.status === "RUNNING" ? (
                <Button variant="destructive" size="sm" onClick={() => setCancelOpen(true)}>取消运行</Button>
              ) : run.status === "PAUSED" ? (
                /* 07-SDD §4.17：wait-review 审核动作在运行详情页完成 */
                <span className="flex gap-2">
                  <Button size="sm" onClick={async () => {
                    try { await wfApi.resume(runId, { action: "pass" }); toast.success("已续跑（通过）"); retry() }
                    catch { toast.error("resume 失败") }
                  }}>审核通过</Button>
                  <Button variant="outline" size="sm" onClick={async () => {
                    try { await wfApi.resume(runId, { action: "reject" }); toast.success("已续跑（驳回）"); retry() }
                    catch { toast.error("resume 失败") }
                  }}>驳回</Button>
                </span>
              ) : run.status === "FAILED" || run.status === "PARTIAL_SUCCESS" ? (
                <Button variant="outline" size="sm" onClick={() => setRerunOpen(true)}>重新运行</Button>
              ) : null}
                  {run?.status === "FAILED" && !run?.agentId && (
                    <Button variant="outline" size="sm" className="gap-1" onClick={async () => {
                      try { await runRetry(runId); toast.success("已创建重试 Run"); retry() }
                      catch { toast.error("重试失败") }
                    }}><RotateCw className="size-3.5" /> 重试</Button>
                  )}
                  {(
                    <Button variant="outline" size="sm" className="gap-1" onClick={async () => {
                      await navigator.clipboard.writeText(JSON.stringify(run, null, 2))
                      toast.success("Run JSON 已复制")
                    }}><Copy className="size-3.5" /> 复制</Button>
                  )}
                  {/* E-3.1：导出 Trace（/trace 全量 + events） */}
                  <Button variant="outline" size="sm" className="gap-1" onClick={async () => {
                    try {
                      const [trace, events] = await Promise.all([
                        runTrace(runId).catch(() => null), runEventsList(runId).catch(() => ({ items: [] }))])
                      const blob = new Blob([JSON.stringify({
                        exportedAt: new Date().toISOString(), runId, trace, events: events.items ?? [],
                      }, null, 2)], { type: "application/json" })
                      const a = document.createElement("a")
                      a.href = URL.createObjectURL(blob)
                      a.download = `run-${runId}-trace.json`
                      a.click()
                      URL.revokeObjectURL(a.href)
                      toast.success("Trace 已导出")
                    } catch { toast.error("导出失败") }
                  }}><Download className="size-3.5" /> 导出 Trace</Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-8"><MoreHorizontal className="size-4" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => { navigator.clipboard.writeText(run.id); toast.success("已复制 Run ID") }}>复制 Run ID</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate(`/config/tasks/${taskId}`)}>查看 Task</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setTab("trace")}>查看运行 Trace</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          }
        />
        {/* E-3.2 重试谱系：向上=来源，向下=派生 */}
        {(run.originRunId || (run.retryChildren?.length ?? 0) > 0) && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span>重试谱系：</span>
            {run.originRunId && (
              <button className="rounded border px-1.5 py-0.5 hover:bg-muted"
                onClick={() => navigate(`/config/tasks/${taskId}/runs/${run.originRunId}`)}>
                ← 源自 #{run.originRunId.slice(0, 8)}
              </button>
            )}
            <span className="rounded border px-1.5 py-0.5">#{run.id.slice(0, 8)}</span>
            {(run.retryChildren ?? []).map((c) => (
              <button key={c.runId} className="rounded border px-1.5 py-0.5 hover:bg-muted"
                onClick={() => navigate(`/config/tasks/${taskId}/runs/${c.runId}`)}>
                重试 → #{c.runId.slice(0, 8)}（{c.status}）
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 07-SDD §4.16/B7：loop 容器专属日志（逐轮状态/失败项） */}
      {events.some((e) => e.type === "loop_iter" || e.type === "loop_iter_failed") && (
        <div className="mt-3 rounded-lg border bg-card p-3 text-xs">
          <div className="pb-1 font-medium">循环容器日志</div>
          <div className="max-h-48 space-y-0.5 overflow-y-auto">
            {events.filter((e) => e.type === "loop_iter" || e.type === "loop_iter_failed").map((e, i) => (
              <div key={i} className="flex gap-2 py-0.5">
                <span className="tabular-nums">#{String(((e as unknown as { payload?: { iter?: number } }).payload)?.iter ?? "")}</span>
                <span>{e.nodeId}</span>
                <span className={e.type === "loop_iter_failed" ? "text-red-500" : "text-muted-foreground"}>
                  {e.type === "loop_iter_failed"
                    ? String(((e as unknown as { payload?: { error?: string } }).payload)?.error ?? "")
                    : JSON.stringify(((e as unknown as { payload?: { output?: unknown } }).payload)?.output ?? {}).slice(0, 100)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Execution Summary */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-7">
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
        <div className="rounded-lg border bg-card px-4 py-3">
          <div className="text-xs text-muted-foreground">Tokens</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{trace ? trace.totalTokens.toLocaleString("zh-CN") : "—"}</div>
        </div>
        <div className="rounded-lg border bg-card px-4 py-3">
          <div className="text-xs text-muted-foreground">LLM 调用</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{trace ? trace.modelCalls : "—"}</div>
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

      {/* 观测升级：平铺五段 → 四 Tab（SDD design-run-observability） */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList className="h-9 w-full justify-start rounded-lg p-0.5" style={{ background: "#F1F3F7" }}>
          <TabsTrigger value="trace">Trace</TabsTrigger>
          <TabsTrigger value="events">Events（{events.length}）</TabsTrigger>
          <TabsTrigger value="executions">业务结果</TabsTrigger>
          <TabsTrigger value="snapshot">Snapshot</TabsTrigger>
        </TabsList>

        <TabsContent value="trace" className="mt-3">
          {trace ? (
            <div className="flex h-[560px]"><TraceView trace={trace} events={events} focusSpanId={focusSpanId} /></div>
          ) : (
            <div className="rounded-lg border bg-card px-4 py-10 text-center text-sm text-muted-foreground">无 Trace 数据（该 Run 无节点执行记录）</div>
          )}
        </TabsContent>

        <TabsContent value="events" className="mt-3 space-y-2">
          <FilterBar>
            <Select value={evType} onValueChange={setEvType}>
              <SelectTrigger className="h-9 w-48"><SelectValue placeholder="事件类型" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">全部类型</SelectItem>
                {evTypes.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={evChannel} onValueChange={setEvChannel}>
              <SelectTrigger className="h-9 w-36"><SelectValue placeholder="通道" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">全部通道</SelectItem>
                <SelectItem value="CONTROL">CONTROL</SelectItem>
                <SelectItem value="CONTENT">CONTENT</SelectItem>
              </SelectContent>
            </Select>
          </FilterBar>
          <div className="max-h-[520px] overflow-y-auto rounded-lg border bg-card px-4 py-2">
            {filteredEvents.length === 0 && <p className="py-6 text-center text-xs text-muted-foreground">无事件</p>}
            {filteredEvents.map((e) => (
              <div key={e.sequence} className="flex cursor-pointer items-center gap-3 border-b py-1 text-xs last:border-0 hover:bg-muted/40" style={{ borderColor: "#EDF0F4" }}
                title={e.nodeRunId ? "点击定位到 Trace span" : undefined}
                onClick={() => { if (e.nodeRunId) { setFocusSpanId(e.nodeRunId); setTab("trace") } }}>
                <span className="w-8 text-right" style={{ color: "#B9C2CF" }}>#{e.sequence}</span>
                <span className="w-40 font-mono" style={{ color: "#1F2329" }}>{e.type}</span>
                <span className="rounded px-1 text-[10px]" style={{ background: e.channel === "CONTENT" ? "#EFF6FF" : "#F1F3F7", color: "#5A6472" }}>{e.channel}</span>
                <span className="flex-1 truncate" style={{ color: "#5A6472" }}>{e.nodeId ?? ""}</span>
                <span style={{ color: "#B9C2CF" }}>{new Date(e.at).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="executions" className="mt-3 space-y-2">
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
        </TabsContent>

        <TabsContent value="snapshot" className="mt-3 space-y-2">
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
        </TabsContent>
      </Tabs>

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
                <Button variant="outline" size="sm" onClick={() => { setSelectedExecution(null); setTab("trace") }}>查看完整 Trace</Button>
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
            <Button onClick={async () => {
              // R2 修复：真重新运行（此前只 toast）
              try {
                const r = await runRetry(runId)
                toast.success(`已创建重试 Run（${r.runId.slice(0, 8)}）`)
                setRerunOpen(false)
                retry()
              } catch (e) {
                toast.error(`重新运行失败：${(e as Error).message}`)
              }
            }}>重新运行</Button>
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
            <Button variant="destructive" onClick={async () => {
              // R2 修复：真取消（此前只 toast）
              try {
                await runCancel(runId)
                toast.success("Run 已取消")
                setCancelOpen(false)
                retry()
              } catch (e) {
                toast.error(`取消失败：${(e as Error).message}`)
              }
            }}>取消运行</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </PageContainer>
  )
}
