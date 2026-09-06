import { ArrowLeft, ArrowRight, Save } from "lucide-react"
import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { DefinitionRow } from "@/components/app/form-field"
import { PageHeader } from "@/components/app/page"
import {
  agentOf,
  assetOf,
  BasicTaskFields,
  DataTaskFields,
  emptyTaskForm,
  mappingIssues,
  OutputBindingFields,
  StrategyTaskFields,
  TargetTaskFields,
  type TaskFormState,
} from "@/components/tasks/task-form-sections"
import { cn } from "@/lib/utils"
import { buildTaskPayload, buildTaskSchedule, samplingLabelOf, windowLabelOf } from "@/domain/task-mapper"
import { bizApi } from "@/services/wf-api"
import type { AnalysisTaskDTO } from "@/services/api-types"

/** MTC-004：自主任务统一编辑器（新建/编辑共用，避免字段漂移）。四步：
 *  1 基本信息与执行目标；2 输入、数据范围、映射；3 调度与执行策略；4 检查并保存。 */
const STEPS = ["基本信息与执行目标", "输入、数据范围、映射", "调度与执行策略", "检查并保存"] as const

/** 编辑回填：从服务端 TaskVersion 快照构造表单（真实 DTO 往返保真）。 */
export function formFromTask(task: AnalysisTaskDTO): TaskFormState {
  const v = task.taskVersion
  const sampling = v?.sampling
  const window = v?.dataWindow
  const et = v?.executionTarget ?? task.executionTarget
  const isAgent = et?.type === "agent"
  const OP_LABEL: Record<string, string> = { eq: "=", neq: "≠", gt: ">", lt: "<", contains: "IN", exists: "IS NOT NULL" }
  return {
    ...emptyTaskForm,
    name: task.name,
    description: task.description ?? "",
    targetType: isAgent ? "agent" : "workflow",
    agentId: isAgent ? (et?.agentId ?? "") : (task.workflowId ?? ""),
    agentVersionPolicy: et?.versionPolicy === "pinned" ? "pinned"
      : et?.versionPolicy === "latest_prod_release" ? "latest_prod" : "latest_sandbox",
    versionPolicy: (v?.workflowVersionPolicy ?? task.workflowVersionPolicy) === "pinned" ? "Fixed" : "Latest Published",
    fixedVersion: isAgent ? (et?.pinnedAgentVersionId ?? "") : (v?.pinnedWorkflowVersionId ?? ""),
    assetId: v?.dataAssetId ?? task.dataAssetId,
    definitionVersionId: v?.dataDefinitionVersionId ?? "",
    ruleVersionId: v?.resultRuleVersionId ?? "",
    mapping: v?.inputMapping ?? {},
    scope: ((v?.scope as { conditions?: { field: string; op: string; value?: unknown }[] } | undefined)?.conditions ?? []).map((c) => ({
      field: c.field, operator: OP_LABEL[c.op] ?? "=", value: String(c.value ?? ""),
    })),
    samplingType: sampling?.mode === "count" ? "固定数量" : sampling?.mode === "random" ? "随机抽样" : "全量",
    samplingCount: sampling?.count ?? 1000,
    samplingPercent: sampling?.percent ?? 20,
    dataWindowTemplate: window?.mode === "relative"
      ? (window.value === "previous_week" ? "上一自然周" : window.value === "previous_month" ? "上一自然月" : "上一自然日")
      : "上一自然日",
    outputMode: (v?.outputBinding?.mode as "platform_only" | "target_table" | undefined) ?? "platform_only",
    outputAssetId: v?.outputBinding?.assetId ?? "",
    outputDefinitionVersionId: v?.outputBinding?.definitionVersionId ?? "",
    outputWriteMode: (v?.outputBinding?.writeMode as "append" | "upsert" | undefined) ?? "upsert",
    outputKeyFields: (v?.outputBinding?.keyFields ?? []).join(","),
    outputMappingRows: Object.entries(v?.outputBinding?.mapping ?? {}).map(([column, expr]) => ({ column, expr: String(expr) })),
  }
}

export function AutonomousTaskEditor({ mode, taskId = "", initialForm }: {
  mode: "create" | "edit"
  taskId?: string
  initialForm?: TaskFormState
}) {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [form, setForm] = useState<TaskFormState>(initialForm ?? emptyTaskForm)
  const [saving, setSaving] = useState(false)

  const mappingOk = useMemo(() => {
    const agent = agentOf(form)
    if (!agent || !form.assetId) return false
    return mappingIssues(form).length === 0
      && (agent.inputSchema ?? []).filter((i) => i.required).every((i) => form.mapping[i.key])
  }, [form])

  const stepValid = [
    form.name.trim().length > 0
      && form.agentId !== ""
      && (form.targetType === "agent"
        ? (form.agentVersionPolicy !== "pinned" || form.fixedVersion !== "")
        : (form.versionPolicy === "Latest Published" || form.fixedVersion !== "")),
    mappingOk,
    true,
    true,
  ][step]

  const save = async () => {
    setSaving(true)
    try {
      const payload = buildTaskPayload(form)
      if (mode === "create") {
        const t = await bizApi.createTask(payload)
        const sch = buildTaskSchedule(form)
        if (sch) {
          await bizApi.taskSchedule(t.id, sch.cron, sch.timezone).catch((e) => {
            toast.warning(`自主任务已创建，但调度创建失败：${(e as Error).message}`)
          })
        }
        toast.success(`自主任务已创建（配置版本 V${t.taskVersion.versionNo}）`)
        navigate(`/autonomous-tasks/${t.id}`)
      } else {
        const t = await bizApi.updateTask(taskId, payload)
        toast.success(`已保存为配置版本 V${t.taskVersion.versionNo}`)
        navigate(`/autonomous-tasks/${taskId}`)
      }
    } catch (e) {
      toast.error(`${mode === "create" ? "创建" : "保存"}失败：${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={mode === "create" ? "新建自主任务" : "编辑自主任务"}
        description="长期自动化工作定义：编辑只生成新配置版本，不改变历史 TaskRun 的冻结版本。"
      />
      <ol className="flex flex-wrap items-center gap-2">
        {STEPS.map((label, i) => (
          <li key={label}>
            <button
              type="button"
              disabled={i > step && !stepValid}
              onClick={() => setStep(i)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition-colors",
                i === step ? "border-brand bg-brand-soft text-selected-foreground"
                  : "text-muted-foreground hover:bg-surface-muted",
              )}
            >
              {i + 1}. {label}
            </button>
          </li>
        ))}
      </ol>
      <div className="rounded-lg border bg-surface p-5">
        {step === 0 ? (
          <div className="space-y-6">
            <BasicTaskFields form={form} onChange={setForm} />
            <TargetTaskFields form={form} onChange={setForm} />
          </div>
        ) : null}
        {step === 1 ? <DataTaskFields form={form} onChange={setForm} /> : null}
        {step === 2 ? (
          <div className="space-y-6">
            <StrategyTaskFields form={form} onChange={setForm} />
            <OutputBindingFields form={form} onChange={setForm} />
          </div>
        ) : null}
        {step === 3 ? (
          <div className="space-y-1 text-sm">
            <p className="mb-3 text-muted-foreground">该自主任务将：</p>
            <DefinitionRow label="执行目标">
              {form.targetType === "agent" ? "领域 Agent" : "工作流"} · {agentOf(form)?.name ?? "—"}
            </DefinitionRow>
            <DefinitionRow label="分析">
              {assetOf(form)?.name ?? "—"} 中符合 Eligibility 的数据
            </DefinitionRow>
            <DefinitionRow label="范围">
              {form.scope.length === 0 ? "全部 Eligible Data" : form.scope.map((c) => `${c.field} ${c.operator} ${c.value}`).join(" 且 ")}
            </DefinitionRow>
            <DefinitionRow label="采样">{samplingLabelOf(form)}</DefinitionRow>
            <DefinitionRow label="执行">{buildTaskSchedule(form) ? "按调度重复执行" : "手动 / API 触发"}</DefinitionRow>
            <DefinitionRow label="数据窗口">{windowLabelOf(form)}</DefinitionRow>
            <DefinitionRow label="结果输出">
              {form.outputMode === "target_table" ? "投递目标表" : "仅平台保存"}
            </DefinitionRow>
          </div>
        ) : null}
      </div>
      <div className="flex items-center justify-between">
        <Button variant="outline" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
          <ArrowLeft className="size-4" /> 上一步
        </Button>
        {step < 3 ? (
          <Button disabled={!stepValid} onClick={() => setStep((s) => s + 1)}>
            下一步 <ArrowRight className="size-4" />
          </Button>
        ) : (
          <Button disabled={saving || !stepValid} onClick={() => void save()}>
            <Save className="size-4" /> {mode === "create" ? "创建" : "保存新版本"}
          </Button>
        )}
      </div>
    </div>
  )
}
