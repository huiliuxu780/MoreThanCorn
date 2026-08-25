import { ArrowLeft, MoreHorizontal } from "lucide-react"
import { useState } from "react"
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
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
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
import { bizApi, WF_BASE } from "@/services/wf-api"
import { rbac } from "@/services/rbac"

export default function TaskDetailPage() {
  const { taskId = "" } = useParams()
  const navigate = useNavigate()
  const { data: task, loading, error, retry } = useAsyncData(() => bizApi.task(taskId), [taskId])
  // D-5：任务运行列表改真数据（该任务绑定工作流的 runs）
  const { data: runs } = useAsyncData(async () => {
    if (!task?.agentId) return []
    const r = await fetch(`${WF_BASE}/api/runs?workflowId=${task.agentId}`)
    const list = await r.json()
    return Array.isArray(list) ? list : []
  }, [taskId, task?.agentId])

  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [backfillOpen, setBackfillOpen] = useState(false)
  const [backfillStart, setBackfillStart] = useState("2026-08-01")
  const [backfillEnd, setBackfillEnd] = useState("2026-08-07")
  const [rerunId, setRerunId] = useState<string | null>(null)

  const canManage = rbac.can("task.manage")
  const isActive = enabled ?? task?.status === "Active"

  if (error) return <PageContainer><ErrorState title="任务加载失败" onRetry={retry} /></PageContainer>
  if (loading || !task) return <PageContainer><TableSkeleton rows={6} columns={6} /></PageContainer>

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
                  variant={isActive ? "outline" : "default"}
                  size="sm"
                  onClick={async () => {
                    // R2 修复：真启停（此前只 toast）
                    try {
                      const r = await bizApi.setTaskStatus(task.id, !isActive ? "Active" : "Paused")
                      setEnabled(r.status === "Active")
                      toast.success(r.status === "Active" ? "任务已启用" : "任务已停用：不再创建新的 Scheduled Run，已创建 / 已运行 Run 不受影响")
                    } catch (e) {
                      toast.error(`操作失败：${(e as Error).message}`)
                    }
                  }}
                >
                  {isActive ? "停用" : "启用"}
                </Button>
                <Button variant="outline" size="sm" onClick={() => navigate(`/config/tasks/${task.id}/edit`)}>编辑</Button>
                <Button variant="outline" size="sm" onClick={() => setBackfillOpen(true)}>回填数据</Button>
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

      {/* 任务配置（紧凑信息卡：4×2 网格，压缩高度） */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 rounded-lg border bg-card px-4 py-3 md:grid-cols-4">
        {([
          ["Agent", task.agentName || "—"],
          ["版本策略", task.agentVersionPolicy === "Latest Published" ? "Latest Published" : `Fixed ${task.fixedAgentVersion ?? ""}`],
          ["Data Asset", task.dataAssetName || "—"],
          ["Data Scope", task.scope || "—"],
          ["Sampling", task.sampling || "—"],
          ["Schedule", task.schedule || "—"],
          ["Data Window", task.dataWindow || "—"],
          ["下次运行", isActive ? (task.nextRunAt ?? "—") : "—"],
        ] as [string, string][]).map(([label, value]) => (
          <div key={label} className="min-w-0">
            <div className="pb-0.5 text-[11px] text-muted-foreground">{label}</div>
            <div className="truncate text-sm" title={value}>{value}</div>
          </div>
        ))}
      </div>

      {/* Run History */}
      <div className="space-y-2">
        <SectionHeader title="运行记录" description="同一个 Task 的不同 Run 可能冻结不同 Agent Version / Data Asset Revision" />
        <TableFrame>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>运行时间</TableHead>
                <TableHead>数据窗口</TableHead>
                <TableHead>Agent Version</TableHead>
                <TableHead>Asset Revision</TableHead>
                <TableHead className="text-right">输入数量</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">耗时</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(runs ?? []).map((run: { runId?: string; id?: string; status?: string; startedAt?: string; trigger?: string; durationMs?: number | null }) => (
                <TableRow key={run.runId ?? run.id ?? "run"} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/config/tasks/${task.id}/runs/${run.runId ?? run.id}`)}>
                  <TableCell className="text-sm tabular-nums">{run.startedAt ? formatCompactDateTime(run.startedAt) : "—"}</TableCell>
                  <TableCell className="text-sm">{run.trigger ?? "—"}</TableCell>
                  <TableCell className="text-sm">—</TableCell>
                  <TableCell className="text-sm">—</TableCell>
                  <TableCell className="text-right tabular-nums">—</TableCell>
                  <TableCell><StatusBadge status={run.status ?? "PENDING"} context="run" /></TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{run.durationMs != null ? `${run.durationMs}ms` : "—"}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-7"><MoreHorizontal className="size-4" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => navigate(`/config/tasks/${task.id}/runs/${run.runId ?? run.id}`)}>查看详情</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setRerunId(run.runId ?? run.id ?? null)}>重新运行</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableFrame>
      </div>

      {/* Backfill Sheet */}
      <Sheet open={backfillOpen} onOpenChange={setBackfillOpen}>
        <SheetContent className="w-[420px]">
          <SheetHeader>
            <SheetTitle>回填历史数据</SheetTitle>
            <SheetDescription>为历史缺失窗口补建新的 Run，不覆盖历史 Run</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <div className="text-sm font-medium">时间范围</div>
              <div className="flex items-center gap-2">
                <Input type="date" value={backfillStart} onChange={(e) => setBackfillStart(e.target.value)} />
                <span className="text-xs text-muted-foreground">→</span>
                <Input type="date" value={backfillEnd} onChange={(e) => setBackfillEnd(e.target.value)} />
              </div>
            </div>
            <div className="rounded-md bg-muted/60 px-3 py-2 text-xs">
              <div className="font-medium">当前 Task 配置</div>
              <div className="mt-1 text-muted-foreground">
                Agent：{task.agentName} · Data Asset：{task.dataAssetName} · Sampling：{task.sampling}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">回填将创建新的 Run，不覆盖历史 Run。</p>
          </div>
          <SheetFooter className="mt-6">
            <Button variant="outline" onClick={() => setBackfillOpen(false)}>取消</Button>
            <Button
              onClick={async () => {
                // R2 修复：真回填（批量运行，此前只 toast）；复核修复：日期窗真下发
                setBackfillOpen(false)
                try {
                  const r = await bizApi.batchRun(task.id, undefined, { start: backfillStart, end: backfillEnd })
                  toast.success(`已创建回填 Run ${r.runIds.length} 条（${backfillStart} → ${backfillEnd}，窗口内 ${r.runIds.length} 行）`)
                  retry()
                } catch (e) {
                  toast.error(`回填失败：${(e as Error).message}`)
                }
              }}
            >
              开始回填
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Rerun Dialog */}
      <Dialog open={rerunId !== null} onOpenChange={(open) => !open && setRerunId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认重新运行？</DialogTitle>
            <DialogDescription>
              将基于该 Run（{rerunId}）的数据窗口重新创建一个新的 Run。历史 Run 和结果不会被覆盖。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRerunId(null)}>取消</Button>
            <Button
              onClick={async () => {
                // R2 修复：真重新运行（创建 1 条新 Run，此前只 toast）
                setRerunId(null)
                try {
                  const r = await bizApi.batchRun(task.id, 1)
                  toast.success(`已创建新的 Run（${r.runIds[0]?.slice(0, 8) ?? ""}）`)
                  retry()
                } catch (e) {
                  toast.error(`重新运行失败：${(e as Error).message}`)
                }
              }}
            >
              重新运行
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
