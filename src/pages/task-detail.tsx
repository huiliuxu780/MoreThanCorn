import { ArrowLeft, History, MoreHorizontal, Play } from "lucide-react"
import { useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ErrorState, TableSkeleton } from "@/components/app/list-state"
import { PageContainer, PageHeader, SectionHeader } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status-badge"
import { TableFrame } from "@/components/app/table-frame"
import { useAsyncData } from "@/hooks/use-async-data"
import { formatCompactDateTime } from "@/lib/time"
import { taskVersionSummary } from "@/domain/task-mapper"
import { bizApi } from "@/services/wf-api"
import { rbac } from "@/services/rbac"

export default function TaskDetailPage() {
  const { taskId = "" } = useParams()
  const navigate = useNavigate()
  const { data: task, loading, error, retry } = useAsyncData(() => bizApi.task(taskId), [taskId])
  // 09 P0-B4：运行历史=该任务的 TaskRun 批次（不再借工作流 Run 冒充）
  const { data: taskRuns, retry: retryRuns } = useAsyncData(
    () => bizApi.taskRuns(taskId).catch(() => []),
    [taskId],
  )

  const [runsOpen, setRunsOpen] = useState<string | null>(null)
  // 09 P1-01：历史窗口回填
  const [backfillOpen, setBackfillOpen] = useState(false)
  const [backfillStart, setBackfillStart] = useState("")
  const [backfillEnd, setBackfillEnd] = useState("")

  const canManage = rbac.can("task.manage")
  const isActive = task?.status === "active"

  if (error) return <PageContainer><ErrorState title="任务加载失败" onRetry={retry} /></PageContainer>
  if (loading || !task) return <PageContainer><TableSkeleton rows={6} columns={6} /></PageContainer>

  const version = task.taskVersion
  const latestRun = taskRuns?.[0]

  return (
    <PageContainer wide className="space-y-5">
      <div>
        <Button variant="ghost" size="sm" className="gap-1 px-2" onClick={() => navigate("/config/tasks")}>
          <ArrowLeft className="size-4" /> 分析任务
        </Button>
        <PageHeader
          className="mt-2"
          title={task.name}
          status={<StatusBadge status={task.status} />}
          description={task.description}
          actions={
            canManage ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!isActive}
                  onClick={async () => {
                    // 09 §10.2：启动批次（异步；服务端返回解析后的版本）
                    try {
                      const r = await bizApi.startTaskRun(task.id)
                      toast.success(`批次已启动（${r.taskRunId.slice(0, 8)}）：Workflow 版本 ${r.resolvedVersions.workflowVersionId?.slice(0, 8) ?? "latest"}`)
                      retryRuns()
                    } catch (e) {
                      toast.error(`启动失败：${(e as Error).message}`)
                    }
                  }}
                >
                  <Play className="size-3.5" /> 立即执行
                </Button>
                <Button variant="outline" size="sm" disabled={!isActive} onClick={() => setBackfillOpen(true)}>
                  <History className="size-3.5" /> 回填数据
                </Button>
                <Button
                  variant={isActive ? "outline" : "default"}
                  size="sm"
                  onClick={async () => {
                    try {
                      const r = await bizApi.setTaskStatus(task.id, isActive ? "paused" : "active")
                      toast.success(r.status === "active" ? "任务已启用" : "任务已暂停：不再创建新的批次（INV-10），已运行批次不受影响")
                      retry()
                    } catch (e) {
                      toast.error(`操作失败：${(e as Error).message}`)
                    }
                  }}
                >
                  {isActive ? "暂停" : "启用"}
                </Button>
                <Button variant="outline" size="sm" onClick={() => navigate(`/config/tasks/${task.id}/edit`)}>编辑</Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-8"><MoreHorizontal className="size-4" /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => { navigator.clipboard.writeText(task.id); toast.success("已复制任务 ID") }}>复制任务 ID</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : null
          }
        />
      </div>

      {/* 当前配置版本快照（服务端返回，不用本地态冒充） */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 rounded-lg border bg-card px-4 py-3 md:grid-cols-4">
        {version ? taskVersionSummary(version).map(({ label, value }) => (
          <div key={label} className="min-w-0">
            <div className="pb-0.5 text-[11px] text-muted-foreground">{label}</div>
            <div className="truncate text-sm" title={value}>{value}</div>
          </div>
        )) : (
          <div className="col-span-4 text-sm text-muted-foreground">该任务没有配置版本（旧数据待迁移）</div>
        )}
      </div>

      {/* TaskRun 批次历史（09 §9.4：状态由子 Run 统计确定） */}
      <div className="space-y-2">
        <SectionHeader title="批次运行（TaskRun）" description="每个批次冻结一个 TaskVersion + DataSnapshot；partial=部分成功" />
        <TableFrame>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>启动时间</TableHead>
                <TableHead>触发</TableHead>
                <TableHead className="text-right">输入</TableHead>
                <TableHead className="text-right">成功</TableHead>
                <TableHead className="text-right">失败</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(taskRuns ?? []).length === 0 ? (
                <TableRow><TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">尚未执行过批次</TableCell></TableRow>
              ) : (taskRuns ?? []).map((tr) => (
                <TableRow key={tr.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setRunsOpen(tr.id)}>
                  <TableCell className="text-sm tabular-nums">{tr.startedAt ? formatCompactDateTime(tr.startedAt) : formatCompactDateTime(tr.createdAt)}</TableCell>
                  <TableCell className="text-sm">{tr.trigger}</TableCell>
                  <TableCell className="text-right tabular-nums">{tr.total}</TableCell>
                  <TableCell className="text-right tabular-nums">{tr.succeeded}</TableCell>
                  <TableCell className="text-right tabular-nums">{tr.failed}</TableCell>
                  <TableCell><StatusBadge status={tr.status} context="run" /></TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-7"><MoreHorizontal className="size-4" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setRunsOpen(tr.id)}>查看 Interaction Runs</DropdownMenuItem>
                        {(tr.status === "failed" || tr.status === "partial") && canManage ? (
                          <DropdownMenuItem onClick={async () => {
                            try {
                              const r = await bizApi.retryFailed(task.id, tr.id)
                              toast.success(r.retried ? `已重试 ${r.retried} 条失败交互（新 attempt，不覆盖历史）` : "无失败项可重试")
                              retryRuns()
                            } catch (e) {
                              toast.error(`重试失败：${(e as Error).message}`)
                            }
                          }}>重试失败项</DropdownMenuItem>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableFrame>
        {latestRun?.errorSummary?.errors?.length ? (
          <div className="rounded-md border border-amber-300/60 bg-amber-50/40 px-3 py-2 text-xs dark:bg-amber-950/20">
            最近批次失败原因示例：{latestRun.errorSummary.errors.slice(0, 3).map((e) => e.error).join("；")}
          </div>
        ) : null}
      </div>

      {/* TaskRun 明细 Sheet：Interaction Runs + 结果数 */}
      <Sheet open={runsOpen !== null} onOpenChange={(open) => !open && setRunsOpen(null)}>
        <SheetContent className="w-[560px]">
          <SheetHeader>
            <SheetTitle>批次 Interaction Runs</SheetTitle>
            <SheetDescription>一条 Interaction 一个 Run；失败样本有可解释原因（09 §13.1）</SheetDescription>
          </SheetHeader>
          {runsOpen ? <TaskRunDetail trid={runsOpen} onOpenResult={(rid) => navigate(`/quality/results/${rid}`)} /> : null}
        </SheetContent>
      </Sheet>

      {/* 09 P1-01 回填 Sheet：历史窗口补跑（新批次，不覆盖历史） */}
      <Sheet open={backfillOpen} onOpenChange={setBackfillOpen}>
        <SheetContent className="w-[420px]">
          <SheetHeader>
            <SheetTitle>回填历史数据</SheetTitle>
            <SheetDescription>为指定历史窗口补跑一个新批次；不覆盖既有批次与结果。</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <div className="text-sm font-medium">时间范围（interaction 时间）</div>
              <div className="flex items-center gap-2">
                <Input type="date" value={backfillStart} onChange={(e) => setBackfillStart(e.target.value)} />
                <span className="text-xs text-muted-foreground">→</span>
                <Input type="date" value={backfillEnd} onChange={(e) => setBackfillEnd(e.target.value)} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">回填将创建新的 TaskRun（trigger=backfill），窗口外的交互不会被处理。</p>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setBackfillOpen(false)}>取消</Button>
            <Button
              disabled={!backfillStart && !backfillEnd}
              onClick={async () => {
                setBackfillOpen(false)
                try {
                  const r = await bizApi.backfillTask(task.id, { start: backfillStart || undefined, end: backfillEnd || undefined })
                  toast.success(`回填批次已启动（${r.taskRunId.slice(0, 8)}）`)
                  retryRuns()
                } catch (e) {
                  toast.error(`回填失败：${(e as Error).message}`)
                }
              }}
            >
              开始回填
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </PageContainer>
  )
}

function TaskRunDetail({ trid, onOpenResult }: { trid: string; onOpenResult: (resultId: string) => void }) {
  const { data, loading } = useAsyncData(async () => {
    const [runs, results, tr] = await Promise.all([
      bizApi.taskRunRuns(trid), bizApi.taskRunResults(trid), bizApi.taskRun(trid),
    ])
    return { runs, results, tr }
  }, [trid])
  if (loading || !data) return <div className="mt-4"><TableSkeleton rows={4} columns={4} /></div>
  return (
    <div className="mt-4 space-y-4">
      <div className="text-xs text-muted-foreground">
        批次 {data.tr.id.slice(0, 8)} · 状态 {data.tr.status} · 成功 {data.tr.succeeded} / 失败 {data.tr.failed} / 跳过 {data.tr.skipped}
        {data.tr.dataSnapshotId ? ` · DataSnapshot ${data.tr.dataSnapshotId.slice(0, 8)}` : ""}
      </div>
      <TableFrame>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Interaction</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>耗时</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.runs.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">{r.interactionRef || "（空）"}</TableCell>
                <TableCell><StatusBadge status={r.status} context="run" /></TableCell>
                <TableCell className="text-xs tabular-nums">{r.durationMs != null ? `${r.durationMs}ms` : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableFrame>
      {data.results.length > 0 ? (
        <div className="space-y-1">
          <div className="text-sm font-medium">质检结果（{data.results.length}）</div>
          {data.results.map((q) => (
            <button key={q.id} type="button" className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm hover:bg-muted/50" onClick={() => onOpenResult(q.id)}>
              <span className="font-mono text-xs">{q.interactionRef}</span>
              <span className="text-xs text-muted-foreground">score {q.score ?? "—"} · {q.risk ?? "—"}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
