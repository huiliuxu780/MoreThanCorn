import { ArrowLeft, Copy, MoreHorizontal, RefreshCw, RotateCw } from "lucide-react"
import { useEffect, useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ErrorState, TableSkeleton } from "@/components/app/list-state"
import { PageContainer, PageHeader, SectionHeader } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status-badge"
import { TableFrame } from "@/components/app/table-frame"
import { formatCompactDateTime } from "@/lib/time"
import { bizApi, opsApi, type OpsDeliveryItem, type OpsRunItem, type OpsTaskRunDetail } from "@/services/wf-api"
import { rbac } from "@/services/rbac"

/** SDD 13 §10.7：批次详情=Header 双状态 + 概览卡 + 四 Tabs（Interaction Runs/结果投递/失败分析/配置快照）。 */
export default function TaskRunDetailPage() {
  const { taskRunId = "" } = useParams()
  const navigate = useNavigate()
  const canManage = rbac.can("task.manage")
  const { data, loading, error, retry } = useAsyncDetail(taskRunId)
  const [tab, setTab] = useState("runs")

  if (error) return <PageContainer><ErrorState title="批次加载失败" onRetry={retry} /></PageContainer>
  if (loading || !data) return <PageContainer><TableSkeleton rows={8} columns={6} /></PageContainer>

  const d = data
  const exec = d.execution ?? {}
  const del = d.delivery ?? {}

  return (
    <PageContainer wide className="space-y-4">
      <div>
        <Button variant="ghost" size="sm" className="gap-1 px-2" onClick={() => navigate(-1)}>
          <ArrowLeft className="size-4" /> 返回运行中心
        </Button>
        <PageHeader
          className="mt-2"
          title={`${d.taskName || "Task"} · 批次 ${d.id.slice(0, 8)}`}
          status={
            <span className="flex items-center gap-1.5">
              <StatusBadge status={exec.status} context="run" />
              <span className="rounded border px-1.5 py-0.5 text-[11px]">投递 {del.status}</span>
            </span>
          }
          description={`planned ${d.plannedAt ? formatCompactDateTime(d.plannedAt) : "—"} · started ${d.startedAt ? formatCompactDateTime(d.startedAt) : "—"} · ended ${d.endedAt ? formatCompactDateTime(d.endedAt) : "—"} · ${d.durationMs != null ? `${Math.round(d.durationMs / 1000)}s` : "—"} · ${d.trigger} · ${d.environment}`}
          actions={canManage ? (
            <>
              <Button variant="outline" size="sm"
                onClick={async () => {
                  try {
                    const r = await bizApi.retryFailed(d.taskId, d.id)
                    toast.success(r.retried ? `重试执行已入队 ${r.retried} 条（新 attempt，不覆盖历史）` : "无失败执行可重试")
                    retry()
                  } catch (e) { toast.error(`重试执行失败：${(e as Error).message}`) }
                }}>
                <RotateCw className="size-3.5" /> 重试失败执行
              </Button>
              <Button variant="outline" size="sm"
                onClick={async () => {
                  try {
                    const r = await opsApi.retryFailedDeliveries(d.id)
                    toast.success(`重试投递 accepted=${r.accepted} skipped=${r.skipped}（不调用模型）`)
                    retry()
                  } catch (e) { toast.error(`重试投递失败：${(e as Error).message}`) }
                }}>
                <RefreshCw className="size-3.5" /> 重试失败投递
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-8" aria-label="更多操作"><MoreHorizontal className="size-4" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => { navigator.clipboard.writeText(d.id); toast.success("已复制批次 ID") }}>
                    <Copy className="size-3.5" /> 复制批次 ID
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate(`/config/tasks/${d.taskId}`)}>查看 Task 定义</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : null}
        />
      </div>

      {/* 概览卡（SDD §10.7）：执行/投递/冻结版本/快照 */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 rounded-lg border bg-card px-4 py-3 md:grid-cols-4">
        <Overview label="执行" value={`total ${exec.total ?? 0} · 成功 ${exec.succeeded ?? 0} · 失败 ${exec.failed ?? 0} · 跳过 ${exec.skipped ?? 0} · 取消 ${exec.cancelled ?? 0}`} />
        <Overview label="投递" value={`pending ${del.pending ?? 0} · 成功 ${del.succeeded ?? 0} · 失败 ${del.failed ?? 0}`} />
        <Overview label="冻结版本" value={`Agent ${(d.frozen?.agentVersionId ?? "").slice(0, 8) || "—"} · WF ${(d.frozen?.workflowVersionId ?? "").slice(0, 8) || "—"} · Release ${(d.frozen?.releaseId ?? "").slice(0, 8) || "—"} · Rule ${(d.frozen?.ruleVersionId ?? "").slice(0, 8) || "—"}`} />
        <Overview label="ScheduleOccurrence" value={d.occurrence ? `${d.occurrence.status}${d.plannedAt ? ` · ${formatCompactDateTime(d.plannedAt)}` : ""}` : "无（manual/api/backfill）"} />
        <Overview label="Output Schema" value={del.outputSchemaRef || "—"} />
        <Overview label="目标表" value={del.targetTable ?? "仅平台保存"} />
        <Overview label="写入模式 / 唯一键" value={`${del.writeMode ?? "—"} / ${(del.keyFields ?? []).join("+") || "—"}`} />
        <Overview label="DataSnapshot" value={d.frozen?.dataSnapshot ? `read ${d.frozen.dataSnapshot.readCount} / expected ${d.frozen.dataSnapshot.expectedCount}` : "—"} />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="runs">Interaction Runs</TabsTrigger>
          <TabsTrigger value="delivery">结果投递</TabsTrigger>
          <TabsTrigger value="failure">失败分析</TabsTrigger>
          <TabsTrigger value="snapshot">配置快照</TabsTrigger>
        </TabsList>
        <TabsContent value="runs"><InteractionRunsTab taskRunId={taskRunId} /></TabsContent>
        <TabsContent value="delivery"><DeliveryTab taskRunId={taskRunId} onChanged={retry} canManage={canManage} /></TabsContent>
        <TabsContent value="failure"><FailureTab taskRunId={taskRunId} /></TabsContent>
        <TabsContent value="snapshot"><SnapshotTab data={d} /></TabsContent>
      </Tabs>
    </PageContainer>
  )
}

function Overview({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="pb-0.5 text-[11px] text-muted-foreground">{label}</div>
      <div className="truncate text-sm" title={value}>{value}</div>
    </div>
  )
}

function useAsyncDetail(taskRunId: string) {
  const [data, setData] = useState<OpsTaskRunDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    opsApi.detail(taskRunId)
      .then((r) => { if (!cancelled) { setData(r); setError(null) } })
      .catch((e) => { if (!cancelled) setError((e as Error).message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [taskRunId, tick])
  return { data, loading, error, retry: () => setTick((t) => t + 1) }
}

/** §10.8：服务端分页 + URL Query（status/deliveryStatus/q/page）+ 行点击 Run 详情。 */
function InteractionRunsTab({ taskRunId }: { taskRunId: string }) {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const page = Math.max(1, Number(params.get("rpage") ?? 1))
  const status = params.get("rstatus") ?? ""
  const deliveryStatus = params.get("rdelivery") ?? ""
  const q = params.get("rq") ?? ""
  const [body, setBody] = useState<{ items: OpsRunItem[]; total: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    opsApi.runs(taskRunId, { page, status: status || undefined,
      deliveryStatus: deliveryStatus || undefined, q: q || undefined })
      .then((r) => { if (!cancelled) setBody(r) })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [taskRunId, page, status, deliveryStatus, q])

  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k) }
    next.delete("rpage")
    setParams(next)
  }

  const items = body?.items ?? []
  const total = body?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / 50))

  return (
    <div className="space-y-3 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="interactionRef 搜索" className="h-8 w-52" value={q} onChange={(e) => update({ rq: e.target.value })} />
        <Select value={status || "all"} onValueChange={(v) => update({ rstatus: v === "all" ? "" : v })}>
          <SelectTrigger className="h-8 w-32"><SelectValue placeholder="执行状态" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部执行状态</SelectItem>
            {["queued", "running", "succeeded", "failed", "cancelled"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={deliveryStatus || "all"} onValueChange={(v) => update({ rdelivery: v === "all" ? "" : v })}>
          <SelectTrigger className="h-8 w-32"><SelectValue placeholder="投递状态" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部投递状态</SelectItem>
            {["pending", "running", "retrying", "succeeded", "failed", "dead_letter"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="ml-auto text-xs text-muted-foreground">{total} 条 · {page}/{pages} 页</span>
      </div>
      <TableFrame>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Interaction</TableHead>
              <TableHead>执行状态</TableHead>
              <TableHead>投递状态</TableHead>
              <TableHead className="text-right">Attempt</TableHead>
              <TableHead>耗时</TableHead>
              <TableHead>Output</TableHead>
              <TableHead>更新时间</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">无 Interaction Run</TableCell></TableRow>
            ) : items.map((r) => (
              <TableRow key={r.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/operations/runs/${r.id}`)}>
                <TableCell className="font-mono text-xs">{r.interactionRef || "（空）"}</TableCell>
                <TableCell><StatusBadge status={r.status} context="run" /></TableCell>
                <TableCell>
                  <span className="rounded border px-1.5 py-0.5 text-[11px]">{r.delivery?.status ?? "not_configured"}</span>
                  {r.delivery?.error ? <span className="ml-1 text-[11px] text-destructive">{String(r.delivery.error.message ?? "").slice(0, 40)}</span> : null}
                </TableCell>
                <TableCell className="text-right tabular-nums">{r.attempt}</TableCell>
                <TableCell className="text-xs tabular-nums">{r.durationMs != null ? `${r.durationMs}ms` : "—"}</TableCell>
                <TableCell className="text-xs">{r.outputAvailable ? "可用" : "无"}</TableCell>
                <TableCell className="text-xs tabular-nums">{r.endedAt ? formatCompactDateTime(r.endedAt) : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableFrame>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => { const n = new URLSearchParams(params); n.set("rpage", String(page - 1)); setParams(n) }}>上一页</Button>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => { const n = new URLSearchParams(params); n.set("rpage", String(page + 1)); setParams(n) }}>下一页</Button>
      </div>
    </div>
  )
}

/** §10.9：目标表/写模式/指纹/状态分布/attempts/单条与批量重试。 */
function DeliveryTab({ taskRunId, onChanged, canManage }: { taskRunId: string; onChanged: () => void; canManage: boolean }) {
  const [body, setBody] = useState<{ items: OpsDeliveryItem[]; total: number } | null>(null)
  useEffect(() => {
    opsApi.deliveries(taskRunId, { pageSize: 100 }).then(setBody).catch(() => undefined)
  }, [taskRunId])
  const items = body?.items ?? []
  return (
    <div className="space-y-3 pt-3">
      <SectionHeader title="结果投递" description="Outbox exactly-once creation；目标表 at-least-once + 唯一键幂等" />
      <TableFrame>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Interaction</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="text-right">Attempts</TableHead>
              <TableHead>最后错误</TableHead>
              <TableHead>下次重试</TableHead>
              <TableHead>目标引用</TableHead>
              {canManage ? <TableHead className="w-16" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">该批次未配置目标表投递</TableCell></TableRow>
            ) : items.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="font-mono text-xs">{d.interactionRef}</TableCell>
                <TableCell><span className="rounded border px-1.5 py-0.5 text-[11px]">{d.status}</span></TableCell>
                <TableCell className="text-right tabular-nums">{d.attempts}/{d.maxAttempts}</TableCell>
                <TableCell className="max-w-64 truncate text-xs text-muted-foreground" title={d.error ? `${d.error.code}: ${d.error.message}` : ""}>
                  {d.error ? `${d.error.code}: ${d.error.message}` : "—"}
                </TableCell>
                <TableCell className="text-xs tabular-nums">{d.nextAttemptAt ? formatCompactDateTime(d.nextAttemptAt) : "—"}</TableCell>
                <TableCell className="font-mono text-xs">{d.targetReference ? JSON.stringify(d.targetReference.key ?? {}) : "—"}</TableCell>
                {canManage ? (
                  <TableCell>
                    {(d.status === "failed" || d.status === "dead_letter") ? (
                      <Button variant="outline" size="sm" className="h-7 px-2 text-xs"
                        onClick={async () => {
                          try {
                            const r = await opsApi.retryDelivery(d.id)
                            toast.success(`accepted=${r.accepted ?? 0}`)
                            onChanged()
                            opsApi.deliveries(taskRunId, { pageSize: 100 }).then(setBody)
                          } catch (e) { toast.error((e as Error).message) }
                        }}>重试投递</Button>
                    ) : null}
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableFrame>
    </div>
  )
}

/** §10.10：分类聚合，禁止合并成一条字符串。 */
function FailureTab({ taskRunId }: { taskRunId: string }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof opsApi.failureAnalysis>> | null>(null)
  useEffect(() => {
    opsApi.failureAnalysis(taskRunId).then(setData).catch(() => undefined)
  }, [taskRunId])
  const LABEL: Record<string, string> = {
    schedule: "Schedule missed / 触发错误",
    runtime: "Runtime / Model / Tool 执行错误",
    output_schema: "Output Schema / 语义校验错误",
    mapping: "Mapping 错误",
    target: "目标连接 / 权限 / 约束错误",
    retry_exhausted: "重试耗尽（dead-letter）",
  }
  return (
    <div className="grid grid-cols-1 gap-3 pt-3 md:grid-cols-2 xl:grid-cols-3">
      {(data?.categories ?? []).map((c) => (
        <div key={c.key} className="space-y-1.5 rounded-lg border bg-card p-3">
          <div className="flex items-center justify-between text-sm font-medium">
            {LABEL[c.key] ?? c.key}
            <span className="text-xs tabular-nums text-muted-foreground">{c.count}</span>
          </div>
          {c.count === 0 ? <div className="text-xs text-muted-foreground">无</div> :
            c.samples.slice(0, 5).map((s, i) => (
              <div key={i} className="truncate rounded bg-muted/40 px-2 py-1 font-mono text-[11px]"
                title={`${s.code ?? ""} ${s.message ?? ""}`}>
                {s.interactionRef ?? s.runId ?? s.deliveryId ?? ""} · {s.code ?? ""} · {String(s.message ?? "").slice(0, 60)}
              </div>
            ))}
        </div>
      ))}
    </div>
  )
}

/** §10.11：只读冻结值，不得从当前 Task 草稿回填。 */
function SnapshotTab({ data }: { data: OpsTaskRunDetail }) {
  const blocks: [string, unknown][] = [
    ["ScheduleOccurrence", data.occurrence],
    ["TaskVersion", { id: data.taskVersionId, versionNo: data.versionNo }],
    ["DataSnapshot", data.frozen?.dataSnapshot],
    ["AgentVersion / WorkflowVersion / Release", {
      agentVersionId: data.frozen?.agentVersionId, workflowVersionId: data.frozen?.workflowVersionId,
      releaseId: data.frozen?.releaseId, ruleVersionId: data.frozen?.ruleVersionId }],
    ["OutputBinding snapshot", data.frozen?.outputBinding],
    ["Runtime binding", data.frozen?.runtimeBinding],
  ]
  return (
    <div className="grid grid-cols-1 gap-3 pt-3 md:grid-cols-2">
      {blocks.map(([label, value]) => (
        <div key={label} className="space-y-1 rounded-lg border bg-card p-3">
          <div className="text-sm font-medium">{label}</div>
          <pre className="max-h-56 overflow-auto rounded bg-muted/40 p-2 text-[11px] leading-relaxed">
            {value ? JSON.stringify(value, null, 2) : "—"}
          </pre>
        </div>
      ))}
    </div>
  )
}
