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
import { DefinitionRow } from "@/components/app/form-field"
import { ErrorState, TableSkeleton } from "@/components/app/list-state"
import { PageContainer, PageHeader, SectionHeader } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status-badge"
import { TableFrame } from "@/components/app/table-frame"
import { useAsyncData } from "@/hooks/use-async-data"
import { formatCompactDateTime } from "@/lib/time"
import { getTask, listRuns } from "@/services/mock-service"
import { rbac } from "@/services/rbac"

export default function TaskDetailPage() {
  const { taskId = "" } = useParams()
  const navigate = useNavigate()
  const { data: task, loading, error, retry } = useAsyncData(() => getTask(taskId), [taskId])
  const { data: runs } = useAsyncData(() => listRuns(taskId, { page: 1, pageSize: 20 }), [taskId])

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
                  onClick={() => {
                    setEnabled(!isActive)
                    toast.success(!isActive ? "任务已启用" : "任务已停用：不再创建新的 Scheduled Run，已创建 / 已运行 Run 不受影响")
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
                    <DropdownMenuItem onClick={() => toast.info("已复制任务 ID")}>复制任务 ID</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : null
          }
        />
      </div>

      {/* 任务配置 */}
      <div className="rounded-lg border bg-card px-4 py-2">
        <DefinitionRow label="Agent">{task.agentName}</DefinitionRow>
        <DefinitionRow label="版本策略">
          {task.agentVersionPolicy === "Latest Published" ? "Latest Published" : `Fixed ${task.fixedAgentVersion}`}
        </DefinitionRow>
        <DefinitionRow label="Data Asset">{task.dataAssetName}</DefinitionRow>
        <DefinitionRow label="Data Scope">{task.scope}</DefinitionRow>
        <DefinitionRow label="Sampling">{task.sampling}</DefinitionRow>
        <DefinitionRow label="Schedule">{task.schedule}</DefinitionRow>
        <DefinitionRow label="Data Window">{task.dataWindow}</DefinitionRow>
        <DefinitionRow label="下次运行">{isActive ? task.nextRunAt ?? "—" : "—"}</DefinitionRow>
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
              {(runs?.items ?? []).map((run) => (
                <TableRow key={run.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/config/tasks/${task.id}/runs/${run.id}`)}>
                  <TableCell className="text-sm tabular-nums">{formatCompactDateTime(run.startedAt)}</TableCell>
                  <TableCell className="text-sm">{run.dataWindow.label}</TableCell>
                  <TableCell className="text-sm">{run.snapshot.agentVersion}</TableCell>
                  <TableCell className="text-sm">R{run.snapshot.dataAssetRevision}</TableCell>
                  <TableCell className="text-right tabular-nums">{run.summary.input.toLocaleString("zh-CN")}</TableCell>
                  <TableCell><StatusBadge status={run.status} context="run" /></TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{run.duration ?? "—"}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-7"><MoreHorizontal className="size-4" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => navigate(`/config/tasks/${task.id}/runs/${run.id}`)}>查看详情</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setRerunId(run.id)}>重新运行</DropdownMenuItem>
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
              onClick={() => {
                setBackfillOpen(false)
                toast.success(`已创建回填 Run（${backfillStart} → ${backfillEnd}）`)
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
              onClick={() => {
                toast.success("已创建新的 Run")
                setRerunId(null)
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
