import { ArrowLeft } from "lucide-react"
import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { PageContainer, PageHeader } from "@/components/app/page"
import {
  BasicTaskFields,
  DataTaskFields,
  emptyTaskForm,
  StrategyTaskFields,
  type TaskFormState,
} from "@/components/tasks/task-form-sections"
import { useAsyncData } from "@/hooks/use-async-data"
import { buildTaskPayload } from "@/domain/task-mapper"
import { bizApi } from "@/services/wf-api"

export default function TaskEditPage() {
  const { taskId = "" } = useParams()
  const navigate = useNavigate()
  const { data: task, loading } = useAsyncData(() => bizApi.task(taskId), [taskId])
  const [form, setForm] = useState<TaskFormState>(emptyTaskForm)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!task) return
    // 09 P0-B4：从服务端 TaskVersion 快照回填（删除硬编码映射）
    const v = task.taskVersion
    const sampling = v?.sampling
    const window = v?.dataWindow
    const OP_LABEL: Record<string, string> = { eq: "=", neq: "≠", gt: ">", lt: "<", contains: "IN", exists: "IS NOT NULL" }
    setForm({
      ...emptyTaskForm,
      name: task.name,
      description: task.description ?? "",
      agentId: task.workflowId,
      versionPolicy: (v?.workflowVersionPolicy ?? task.workflowVersionPolicy) === "pinned" ? "Fixed" : "Latest Published",
      fixedVersion: v?.pinnedWorkflowVersionId ?? "",
      assetId: v?.dataAssetId ?? task.dataAssetId,
      definitionVersionId: v?.dataDefinitionVersionId ?? "",
      ruleVersionId: v?.resultRuleVersionId ?? "",
      mapping: v?.inputMapping ?? {},
      scope: (v?.scope?.conditions ?? []).map((c) => ({
        field: c.field, operator: OP_LABEL[c.op] ?? "=", value: String(c.value ?? ""),
      })),
      samplingType: sampling?.mode === "count" ? "固定数量" : sampling?.mode === "random" ? "随机抽样" : "全量",
      samplingCount: sampling?.count ?? 1000,
      samplingPercent: sampling?.percent ?? 20,
      dataWindowTemplate: window?.mode === "relative"
        ? (window.value === "previous_week" ? "上一自然周" : window.value === "previous_month" ? "上一自然月" : "上一自然日")
        : "上一自然日",
      dataWindowStart: window?.mode === "fixed" ? window.start ?? "" : "",
      dataWindowEnd: window?.mode === "fixed" ? window.end ?? "" : "",
    })
  }, [task])

  if (loading || !task) {
    return <PageContainer className="max-w-3xl"><p className="text-sm text-muted-foreground">加载中...</p></PageContainer>
  }

  return (
    <PageContainer className="max-w-3xl space-y-5">
      <div>
        <Button variant="ghost" size="sm" className="gap-1 px-2" onClick={() => navigate(`/config/tasks/${task.id}`)}>
          <ArrowLeft className="size-4" /> {task.name}
        </Button>
        <PageHeader className="mt-2" title="编辑任务" description="单页表单：修改某一项配置时不强迫重复走向导" />
      </div>

      <div className="space-y-6 rounded-lg border bg-card p-5">
        <BasicTaskFields form={form} onChange={setForm} />
        <Separator />
        <DataTaskFields form={form} onChange={setForm} />
        <Separator />
        <StrategyTaskFields form={form} onChange={setForm} />
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => navigate(`/config/tasks/${task.id}`)}>取消</Button>
        <Button
          disabled={saving}
          onClick={async () => {
            // 09 P0-B4：保存=生成新的不可变 TaskVersion（全字段结构化提交）
            setSaving(true)
            try {
              const payload = buildTaskPayload(form)
              const r = await bizApi.updateTask(task.id, payload)
              toast.success(`已保存为配置版本 V${r.taskVersion.versionNo}`)
              navigate(`/config/tasks/${task.id}`)
            } catch (e) {
              toast.error(`保存失败：${(e as Error).message}`)
            } finally {
              setSaving(false)
            }
          }}
        >
          {saving ? "保存中…" : "保存"}
        </Button>
      </div>
    </PageContainer>
  )
}
