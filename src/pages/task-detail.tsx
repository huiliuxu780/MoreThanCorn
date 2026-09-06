import { ArrowLeft, Pause, Play, MoreHorizontal as More } from "lucide-react"
import { useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Progress } from "@/components/ui/progress"
import { ErrorState, TableSkeleton } from "@/components/app/list-state"
import { PageContainer, PageHeader, SectionHeader } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status-badge"
import { useAsyncData } from "@/hooks/use-async-data"
import { formatCompactDateTime } from "@/lib/time"
import { WORK_ITEM_STATUS_LABELS } from "@/config/ui-terms"
import { bizApi, workItemsApi, type WorkItemStatus } from "@/services/wf-api"

/** MTC-004：自主任务详情 = 工作档案（非巨型表单）。最近运行复用 WorkItem 真值。 */
export default function TaskDetailPage() {
  const { taskId = "" } = useParams()
  const navigate = useNavigate()
  const { data: task, loading, error, retry } = useAsyncData(() => bizApi.task(taskId), [taskId])
  const { data: versions } = useAsyncData(() => bizApi.taskVersions(taskId), [taskId])
  const { data: schedules } = useAsyncData(() => bizApi.taskSchedules(taskId), [taskId])
  const { data: recent } = useAsyncData(
    () => workItemsApi.list({ automationId: taskId, pageSize: 5 }).then((r) => r.items),
    [taskId],
  )
  const { data: assets } = useAsyncData(() => bizApi.assets(), [])

  if (error) return <PageContainer><ErrorState title="自主任务加载失败" onRetry={retry} /></PageContainer>
  if (loading || !task) return <PageContainer><TableSkeleton rows={6} columns={4} /></PageContainer>

  const v = task.taskVersion
  const et = v?.executionTarget ?? task.executionTarget
  const assetName = assets?.find((a) => a.id === (v?.dataAssetId ?? task.dataAssetId))?.name
    ?? (v?.dataAssetId ?? task.dataAssetId ?? "—")
  const isActive = task.status === "active"

  const runNow = async () => {
    try {
      const r = await bizApi.startTaskRun(task.id)
      toast.success(`批次已启动（${r.taskRunId.slice(0, 8)}）`)
    } catch (e) {
      toast.error(`启动失败：${(e as Error).message}`)
    }
  }
  const toggleStatus = async () => {
    try {
      const r = await bizApi.setTaskStatus(task.id, isActive ? "paused" : "active")
      toast.success(r.status === "active" ? "自主任务已启用" : "自主任务已暂停")
      retry()
    } catch (e) {
      toast.error(`操作失败：${(e as Error).message}`)
    }
  }

  return (
    <PageContainer wide className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" className="gap-1 px-2" onClick={() => navigate("/autonomous-tasks")}>
          <ArrowLeft className="size-4" /> 自主任务
        </Button>
      </div>
      <PageHeader
        title={task.name}
        status={<StatusBadge status={task.status} />}
        description={task.description || "长期自动化工作定义"}
        actions={
          <>
            <Button size="sm" variant="outline" disabled={!isActive} onClick={() => void runNow()}>
              <Play className="size-3.5" /> 立即运行
            </Button>
            <Button size="sm" variant="outline" onClick={() => navigate(`/autonomous-tasks/${task.id}/edit`)}>
              编辑
            </Button>
            <Button size="sm" variant="outline" onClick={() => void toggleStatus()}>
              <Pause className="size-3.5" /> {isActive ? "暂停" : "启用"}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8" aria-label="更多操作">
                  <More className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => { navigator.clipboard.writeText(task.id); toast.success("已复制自主任务 ID") }}>
                  复制 ID
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <section className="space-y-2">
        <SectionHeader title="工作概览" description="长期定义与其最近活动的摘要" />
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-lg border bg-surface p-3 text-xs">
            <div className="text-muted-foreground">配置版本</div>
            <div className="mt-1 text-sm font-medium">V{v?.versionNo ?? "—"}</div>
          </div>
          <div className="rounded-lg border bg-surface p-3 text-xs">
            <div className="text-muted-foreground">最近运行</div>
            <div className="mt-1 text-sm font-medium">
              {recent?.[0] ? WORK_ITEM_STATUS_LABELS[recent[0].status as WorkItemStatus] : "暂无运行记录"}
            </div>
          </div>
          <div className="rounded-lg border bg-surface p-3 text-xs">
            <div className="text-muted-foreground">下一次计划</div>
            <div className="mt-1 text-sm font-medium">
              {schedules?.[0]?.nextRunAt ? formatCompactDateTime(schedules[0].nextRunAt) : "—"}
            </div>
          </div>
          <div className="rounded-lg border bg-surface p-3 text-xs">
            <div className="text-muted-foreground">最近活动</div>
            <div className="mt-1 text-sm font-medium">
              {formatCompactDateTime(task.updatedAt ?? task.createdAt ?? "")}
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <SectionHeader title="执行目标" />
        <div className="rounded-lg border bg-surface p-3 text-xs">
          <div className="grid gap-2 md:grid-cols-3">
            <span>类型：{et?.type === "agent" ? "领域 Agent" : "工作流"}</span>
            <span>目标：{et?.type === "agent" ? (et.agentId ?? "—") : (et?.workflowId ?? task.workflowId ?? "—")}</span>
            <span>
              版本策略：{et?.type === "agent" ? (et.versionPolicy ?? "—") : (v?.workflowVersionPolicy ?? task.workflowVersionPolicy ?? "—")}
              {et?.type === "agent" && et.versionPolicy === "pinned" ? `（${(et.pinnedAgentVersionId ?? "").slice(0, 8)}）` : ""}
              {et?.type !== "agent" && v?.workflowVersionPolicy === "pinned" ? `（${(v?.pinnedWorkflowVersionId ?? "").slice(0, 8)}）` : ""}
            </span>
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <SectionHeader title="输入与数据范围" />
        <div className="rounded-lg border bg-surface p-3 text-xs">
          <div className="grid gap-2 md:grid-cols-3">
            <span>数据资产：{assetName}</span>
            <span>定义版本：{(v?.dataDefinitionVersionId ?? "—").toString().slice(0, 8)}</span>
            <span>
              范围：{(() => {
                const sc = v?.scope as { conditions?: unknown[] } | undefined
                return sc?.conditions?.length ? `${sc.conditions.length} 个条件` : "全部 Eligible Data"
              })()}
            </span>
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <SectionHeader title="调度 / Trigger" />
        {(schedules ?? []).length === 0 ? (
          <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
            无调度配置：仅手动 / API 触发
          </div>
        ) : (
          <ul className="space-y-1.5 text-xs">
            {(schedules ?? []).map((s) => (
              <li key={s.id} className="flex items-center justify-between rounded-md border bg-surface px-3 py-2">
                <span className="font-mono">{s.cron}（{s.timezone}）</span>
                <Badge variant={s.enabled ? "success" : "neutral"}>{s.enabled ? "启用" : "停用"}</Badge>
                <span className="text-muted-foreground">
                  下次：{s.nextRunAt ? formatCompactDateTime(s.nextRunAt) : "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <SectionHeader
          title="最近运行"
          description="复用 WorkItem / TaskRun 真值（非前端猜测）"
          actions={
            <Button variant="outline" size="sm" onClick={() => navigate(`/operations/task-runs?taskId=${task.id}`)}>
              查看全部运行
            </Button>
          }
        />
        {(recent ?? []).length === 0 ? (
          <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">暂无运行记录</div>
        ) : (
          <ul className="space-y-1.5 text-xs">
            {(recent ?? []).map((w) => (
              <li key={w.id} className="flex items-center gap-3 rounded-md border bg-surface px-3 py-2">
                <Badge variant={w.status === "needs_action" ? "warning" : w.status === "running" ? "info" : w.status === "completed" ? "success" : w.status === "queued" ? "neutral" : "danger"}>
                  {WORK_ITEM_STATUS_LABELS[w.status as WorkItemStatus]}
                </Badge>
                <span className="text-muted-foreground">
                  {w.startedAt ? formatCompactDateTime(w.startedAt) : w.scheduledAt ? `计划 ${formatCompactDateTime(w.scheduledAt)}` : "—"}
                </span>
                {w.taskRunId !== null ? (
                  <span className="flex flex-1 items-center gap-2">
                    <Progress value={w.progress.percent ?? 0} className="h-1.5 flex-1" aria-label="执行进度" />
                    <span className="tabular-nums">{w.progress.succeeded}/{w.progress.total}</span>
                  </span>
                ) : <span className="flex-1 text-muted-foreground">等待调度</span>}
                <Button variant="ghost" size="sm" onClick={() => w.taskRunId && navigate(`/operations/task-runs/${w.taskRunId}`)}>
                  详情
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <SectionHeader title="配置版本" description="不可变快照；编辑生成新版本" />
        <ul className="space-y-1.5 text-xs">
          {(versions ?? []).slice(0, 8).map((ver) => (
            <li key={ver.id} className="flex items-center justify-between rounded-md border bg-surface px-3 py-2">
              <span className="font-medium">V{ver.versionNo}</span>
              <span className="text-muted-foreground">{ver.note || "—"}</span>
              <span className="text-muted-foreground">{formatCompactDateTime(ver.createdAt)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <SectionHeader title="活动记录" />
        <ul className="space-y-1.5 text-xs text-muted-foreground">
          <li>配置更新：{formatCompactDateTime(task.updatedAt ?? "")}</li>
          {(recent ?? []).slice(0, 3).map((w) => (
            <li key={w.id}>
              运行 {w.id.slice(-8)}：{WORK_ITEM_STATUS_LABELS[w.status as WorkItemStatus]} · {w.updatedAt ? formatCompactDateTime(w.updatedAt) : "—"}
            </li>
          ))}
        </ul>
      </section>
    </PageContainer>
  )
}
