import { ArrowLeft, ArrowRight, Check } from "lucide-react"
import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { DefinitionRow } from "@/components/app/form-field"
import { PageContainer, PageHeader } from "@/components/app/page"
import {
  agentOf,
  assetOf,
  BasicTaskFields,
  DataTaskFields,
  emptyTaskForm,
  mappingIssues,
  StrategyTaskFields,
  type TaskFormState,
} from "@/components/tasks/task-form-sections"
import { cn } from "@/lib/utils"
import { bizApi } from "@/services/wf-api"

const STEPS = ["基本设置", "分析数据", "执行策略", "确认并创建"] as const

export default function TaskWizardPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [form, setForm] = useState<TaskFormState>(emptyTaskForm)
  const [creating, setCreating] = useState(false)

  const mappingOk = useMemo(() => {
    const agent = agentOf(form)
    if (!agent || !form.assetId) return false
    return mappingIssues(form).length === 0 && agent.inputSchema.filter((i) => i.required).every((i) => form.mapping[i.key])
  }, [form])

  const stepValid = [
    form.name.trim().length > 0 && form.agentId !== "" && (form.versionPolicy === "Latest Published" || form.fixedVersion !== ""),
    form.assetId !== "" && mappingOk,
    form.scheduleType === "一次性" ? form.dataWindowStart !== "" && form.dataWindowEnd !== "" : true,
    true,
  ][step]

  const samplingLabel =
    form.samplingType === "全量" ? "全量" : form.samplingType === "随机抽样" ? `随机抽样 ${form.samplingPercent}%` : `固定数量 ${form.samplingCount} 条`
  const scheduleLabel =
    form.scheduleType === "一次性" ? "一次性" : `${form.scheduleType} ${form.scheduleTime} 执行`
  const windowLabel =
    form.scheduleType === "一次性" ? `${form.dataWindowStart} → ${form.dataWindowEnd}` : form.dataWindowTemplate

  return (
    <PageContainer className="max-w-3xl space-y-6">
      <div>
        <Button variant="ghost" size="sm" className="gap-1 px-2" onClick={() => navigate("/config/tasks")}>
          <ArrowLeft className="size-4" /> 分析任务
        </Button>
        <PageHeader className="mt-2" title="新建分析任务" description="按依赖顺序完成任务配置" />
      </div>

      {/* Step Indicator */}
      <div className="flex items-center gap-2">
        {STEPS.map((label, idx) => (
          <div key={label} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => idx < step && setStep(idx)}
              className={cn(
                "flex items-center gap-2 rounded-full border px-3 py-1 text-xs",
                idx === step
                  ? "border-primary bg-primary text-primary-foreground"
                  : idx < step
                    ? "border-border bg-muted text-foreground"
                    : "border-border text-muted-foreground",
              )}
            >
              <span className="flex size-4 items-center justify-center rounded-full bg-background/20 text-[10px] tabular-nums">
                {idx < step ? <Check className="size-3" /> : idx + 1}
              </span>
              {label}
            </button>
            {idx < STEPS.length - 1 ? <div className="h-px w-6 bg-border" /> : null}
          </div>
        ))}
      </div>

      <div className="rounded-lg border bg-card p-5">
        {step === 0 ? <BasicTaskFields form={form} onChange={setForm} /> : null}
        {step === 1 ? (
          <DataTaskFields
            form={form}
            onChange={(next) => {
              // 切换 Agent 时重新自动匹配
              setForm(next)
            }}
          />
        ) : null}
        {step === 2 ? <StrategyTaskFields form={form} onChange={setForm} /> : null}
        {step === 3 ? (
          <div className="space-y-1 text-sm">
            <p className="mb-3 text-muted-foreground">该任务将：</p>
            <DefinitionRow label="使用">
              {agentOf(form)?.name ?? "—"} · {form.versionPolicy === "Latest Published" ? "Latest Published" : `Fixed ${form.fixedVersion}`}
            </DefinitionRow>
            <DefinitionRow label="分析">
              {assetOf(form)?.name ?? "—"} 中符合 Eligibility 的数据
            </DefinitionRow>
            <DefinitionRow label="范围">
              {form.scope.length === 0 ? "全部 Eligible Data" : form.scope.map((c) => `${c.field} ${c.operator} ${c.value}`).join(" 且 ")}
            </DefinitionRow>
            <DefinitionRow label="采样">{samplingLabel}</DefinitionRow>
            <DefinitionRow label="执行">{scheduleLabel}</DefinitionRow>
            <DefinitionRow label="数据窗口">{windowLabel}</DefinitionRow>
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between">
        <Button variant="outline" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
          上一步
        </Button>
        {step < 3 ? (
          <Button disabled={!stepValid} onClick={() => setStep((s) => s + 1)}>
            下一步 <ArrowRight className="size-4" />
          </Button>
        ) : (
          <Button
            disabled={creating}
            onClick={async () => {
              // R2 修复：真创建任务（此前只 toast + 硬编码 T-1001）
              const agent = agentOf(form)
              setCreating(true)
              try {
                const sampling = form.samplingType === "全量" ? "all"
                  : form.samplingType === "固定数量" ? `first_${form.samplingCount}` : "all"
                const t = await bizApi.createTask({
                  name: form.name.trim(),
                  workflowId: agent?.id ?? form.agentId,
                  dataAssetId: form.assetId,
                  scope: form.scope.length === 0 ? "all" : form.scope.map((c) => `${c.field}${c.operator}${c.value}`).join(";"),
                  sampling,
                  dataWindow: windowLabel,
                })
                toast.success("任务已创建并启用")
                navigate(`/config/tasks/${t.id}`)
              } catch (e) {
                toast.error(`创建失败：${(e as Error).message}`)
              } finally {
                setCreating(false)
              }
            }}
          >
            {creating ? "创建中…" : "创建并启用"}
          </Button>
        )}
      </div>
    </PageContainer>
  )
}
