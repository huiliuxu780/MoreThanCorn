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
import { bizApi } from "@/services/wf-api"

export default function TaskEditPage() {
  const { taskId = "" } = useParams()
  const navigate = useNavigate()
  const { data: task, loading } = useAsyncData(() => bizApi.task(taskId), [taskId])
  const [form, setForm] = useState<TaskFormState>(emptyTaskForm)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!task) return
    setForm({
      ...emptyTaskForm,
      name: task.name,
      description: task.description ?? "",
      agentId: task.agentId,
      versionPolicy: task.agentVersionPolicy,
      fixedVersion: task.fixedAgentVersion ?? "",
      assetId: task.dataAssetId,
      mapping: {
        interaction_id: "call_id",
        transcript: "asr_text",
        agent_id: "servicer_id",
        start_time: "call_start_time",
        phone_number: "consumer_phone",
      },
      scope: task.scope && task.scope !== "全部接通通话" ? [{ field: "service_type", operator: "=", value: task.scope.split("= ")[1] ?? "" }] : [],
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
            // R2 修复：真保存（此前只 toast）
            setSaving(true)
            try {
              await bizApi.updateTask(task.id, {
                name: form.name.trim(),
                description: form.description ?? "",
                scope: (form.scope ?? []).map((c) => `${c.field} ${c.operator} ${c.value}`).join(";") || "all",
                sampling: form.samplingType === "全量" ? "all" : `first_${form.samplingCount || 100}`,
              })
              toast.success("任务配置已保存")
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
