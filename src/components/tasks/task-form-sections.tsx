import { Plus, X } from "lucide-react"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { FormField } from "@/components/app/form-field"
import { SectionHeader } from "@/components/app/page"
import { agents, agentDetails, dataAssets } from "@/mocks/data"
import type { AgentDetail, DataAsset, DataAssetField } from "@/domain/types"
import { defApi, type DefinitionDTO } from "@/services/resource-api"
import { wfEnabled } from "@/services/wf-api"
import { cn } from "@/lib/utils"

export interface ScopeCondition {
  field: string
  operator: string
  value: string
}

export interface TaskFormState {
  name: string
  description: string
  agentId: string
  versionPolicy: "Latest Published" | "Fixed"
  fixedVersion: string
  assetId: string
  definitionId: string
  mapping: Record<string, string>
  scope: ScopeCondition[]
  samplingType: "全量" | "随机抽样" | "固定数量"
  samplingPercent: number
  samplingCount: number
  scheduleType: "一次性" | "每日" | "每周" | "每月"
  scheduleTime: string
  dataWindowTemplate: string
  dataWindowStart: string
  dataWindowEnd: string
}

export const emptyTaskForm: TaskFormState = {
  name: "",
  description: "",
  agentId: "",
  versionPolicy: "Latest Published",
  fixedVersion: "",
  assetId: "",
  definitionId: "",
  mapping: {},
  scope: [],
  samplingType: "全量",
  samplingPercent: 20,
  samplingCount: 1000,
  scheduleType: "每日",
  scheduleTime: "02:00",
  dataWindowTemplate: "上一自然日",
  dataWindowStart: "",
  dataWindowEnd: "",
}

export function agentOf(form: TaskFormState): AgentDetail | null {
  return agentDetails[form.agentId] ?? null
}

export function assetOf(form: TaskFormState): DataAsset | null {
  return dataAssets.find((a) => a.id === form.assetId) ?? null
}

/** 自动匹配：Exact Field Key Match → Compatible Type。禁止 AI 猜测。 */
export function autoMapping(agent: AgentDetail | null, asset: DataAsset | null): Record<string, string> {
  const mapping: Record<string, string> = {}
  if (!agent || !asset) return mapping
  for (const input of agent.inputSchema) {
    const exact = asset.schema.find((f) => f.key === input.key)
    if (exact) {
      mapping[input.key] = exact.key
      continue
    }
    const compatible = asset.schema.find((f) => f.type === input.type && !Object.values(mapping).includes(f.key))
    if (compatible) mapping[input.key] = compatible.key
  }
  return mapping
}

export function mappingIssues(form: TaskFormState): { key: string; message: string }[] {
  const agent = agentOf(form)
  const asset = assetOf(form)
  if (!agent || !asset) return []
  const issues: { key: string; message: string }[] = []
  for (const input of agent.inputSchema) {
    const mapped = form.mapping[input.key]
    if (input.required && !mapped) {
      issues.push({ key: input.key, message: "Required Input 未 Mapping" })
      continue
    }
    if (mapped) {
      const field = asset.schema.find((f) => f.key === mapped)
      if (field && field.type !== input.type) {
        issues.push({ key: input.key, message: `类型不兼容：${input.type} ← ${field.type}` })
      }
    }
  }
  return issues
}

/* ------------------------------------------------------------------ */

export function BasicTaskFields({
  form,
  onChange,
}: {
  form: TaskFormState
  onChange: (next: TaskFormState) => void
}) {
  const set = (patch: Partial<TaskFormState>) => onChange({ ...form, ...patch })
  return (
    <div className="space-y-4">
      <FormField label="任务名称" required>
        <Input value={form.name} placeholder="例如：每日热线全量质检" onChange={(e) => set({ name: e.target.value })} />
      </FormField>
      <FormField label="描述">
        <Textarea value={form.description} className="min-h-16" placeholder="任务用途说明（可选）" onChange={(e) => set({ description: e.target.value })} />
      </FormField>
      <FormField label="Agent" required>
        <Select
          value={form.agentId || undefined}
          onValueChange={(agentId) => {
            const agent = agentDetails[agentId] ?? null
            onChange({ ...form, agentId, mapping: autoMapping(agent, assetOf(form)) })
          }}
        >
          <SelectTrigger><SelectValue placeholder="选择 Evaluation Agent" /></SelectTrigger>
          <SelectContent>
            {agents.filter((a) => a.status !== "Deprecated").map((a) => (
              <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      <div className="space-y-2">
        <Label className="text-sm font-medium">Agent Version Policy</Label>
        <RadioGroup
          value={form.versionPolicy}
          onValueChange={(v) => set({ versionPolicy: v as TaskFormState["versionPolicy"] })}
          className="gap-2"
        >
          <div className="flex items-start gap-2 rounded-md border px-3 py-2">
            <RadioGroupItem value="Latest Published" id="vp-latest" />
            <label htmlFor="vp-latest" className="space-y-0.5 text-sm">
              <div className="font-medium">Latest Published</div>
              <p className="text-xs text-muted-foreground">
                每次创建新 Run 时使用当时最新的 Published Version；已经创建或运行中的 Run 不受后续 Agent 发布影响。
              </p>
            </label>
          </div>
          <div className="flex items-start gap-2 rounded-md border px-3 py-2">
            <RadioGroupItem value="Fixed" id="vp-fixed" />
            <label htmlFor="vp-fixed" className="flex-1 space-y-1 text-sm">
              <div className="font-medium">Fixed Published Version</div>
              {form.versionPolicy === "Fixed" ? (
                <Select value={form.fixedVersion || undefined} onValueChange={(v) => set({ fixedVersion: v })}>
                  <SelectTrigger className="h-8 w-32"><SelectValue placeholder="固定版本" /></SelectTrigger>
                  <SelectContent>
                    {(agentOf(form)?.versions ?? []).filter((v) => v.status === "Published").map((v) => (
                      <SelectItem key={v.version} value={v.version}>{v.version}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-xs text-muted-foreground">锁定某个已发布版本，不随发布变化。</p>
              )}
            </label>
          </div>
        </RadioGroup>
      </div>
    </div>
  )
}

export function DataTaskFields({
  form,
  onChange,
}: {
  form: TaskFormState
  onChange: (next: TaskFormState) => void
}) {
  const set = (patch: Partial<TaskFormState>) => onChange({ ...form, ...patch })
  const agent = agentOf(form)
  const [defs, setDefs] = useState<DefinitionDTO[]>([])
  const [selDef, setSelDef] = useState<DefinitionDTO | null>(null)
  useEffect(() => {
    if (!wfEnabled()) return
    defApi.list({}).then((r) => setDefs(r.items.filter((d) => d.lifecycle === "Ready"))).catch(() => undefined)
  }, [])
  useEffect(() => {
    if (form.definitionId && wfEnabled()) defApi.get(form.definitionId).then(setSelDef).catch(() => undefined)
  }, [form.definitionId])

  /** 真 API 模式：以 Data Definition 的 field_schema 构造映射视图（迭代自现有能力）。 */
  const shellFromDef = (d: DefinitionDTO | null): DataAsset | null => {
    if (!d) return null
    return {
      id: d.assetId, name: d.assetName, description: "", source: "",
      recordMeaning: "见数据定义", recordIdField: "", timeField: "", timeFieldLabel: "",
      lifecycle: "Ready", health: "Healthy", currentRevision: d.revision, updatedAt: "",
      schema: (d.fieldSchema ?? []) as DataAssetField[], eligibility: d.eligibility ?? [],
    }
  }
  const asset = wfEnabled() ? shellFromDef(selDef) : assetOf(form)
  const issues = mappingIssues(form)

  return (
    <div className="space-y-5">
      {wfEnabled() ? (
        <FormField label="Data Definition" required description="选择 Ready 的数据定义（字段 schema + eligibility）；任务按定义字段执行分析。">
          <Select
            value={form.definitionId || undefined}
            onValueChange={(definitionId) => {
              const d = defs.find((x) => x.id === definitionId) ?? null
              onChange({ ...form, definitionId, assetId: d?.assetId ?? "", mapping: autoMapping(agent, shellFromDef(d)), scope: [] })
            }}
          >
            <SelectTrigger><SelectValue placeholder="选择 Data Definition" /></SelectTrigger>
            <SelectContent>
              {defs.map((d) => (
                <SelectItem key={d.id} value={d.id}>{d.name} · {d.assetName} · R{d.revision}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      ) : (
      <FormField label="Data Asset" required description="只允许选择 Ready 资产；Run 创建时自动冻结当前 Ready Revision。">
        <Select
          value={form.assetId || undefined}
          onValueChange={(assetId) => {
            const nextAsset = dataAssets.find((a) => a.id === assetId) ?? null
            onChange({ ...form, assetId, mapping: autoMapping(agent, nextAsset), scope: [] })
          }}
        >
          <SelectTrigger><SelectValue placeholder="选择 Data Asset" /></SelectTrigger>
          <SelectContent>
            {dataAssets.filter((a) => a.lifecycle === "Ready").map((a) => (
              <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      )}

      {asset ? (
        <div className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          一条数据代表：{asset.recordMeaning} · Time Field：{asset.timeFieldLabel} · 当前 Ready Revision：R{asset.currentRevision}
        </div>
      ) : null}

      {agent && asset ? (
        <div className="space-y-2">
          <SectionHeader title="输入映射" description="Agent Input ← Data Asset Field；Required 必须全部完成且类型兼容" />
          <div className="overflow-hidden rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent Input</TableHead>
                  <TableHead>Data Asset Field</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {agent.inputSchema.map((input) => {
                  const issue = issues.find((i) => i.key === input.key)
                  return (
                    <TableRow key={input.key}>
                      <TableCell>
                        <div className="font-mono text-sm">{input.key}</div>
                        <div className="text-xs text-muted-foreground">
                          {input.type}{input.required ? " · Required" : " · Optional"}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={form.mapping[input.key] || undefined}
                          onValueChange={(v) => set({ mapping: { ...form.mapping, [input.key]: v } })}
                        >
                          <SelectTrigger className={cn("h-8 w-56", issue && "border-destructive")}>
                            <SelectValue placeholder="选择字段" />
                          </SelectTrigger>
                          <SelectContent>
                            {asset.schema.map((f) => (
                              <SelectItem key={f.key} value={f.key}>
                                {f.key}（{f.type}）
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {issue ? <div className="mt-1 text-xs text-destructive">{issue.message}</div> : null}
                      </TableCell>
                      <TableCell>
                        {form.mapping[input.key] && !issue ? <span className="text-emerald-600">✓</span> : null}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : null}

      {asset ? (
        <div className="space-y-2">
          <SectionHeader
            title="Data Scope"
            description="仅限定本任务的执行范围；资产自身的 Eligibility 已自动生效"
            actions={
              <Button
                variant="outline"
                size="sm"
                onClick={() => set({ scope: [...form.scope, { field: asset.schema[0]?.key ?? "", operator: "=", value: "" }] })}
              >
                <Plus className="size-3.5" /> 添加条件
              </Button>
            }
          />
          {form.scope.length === 0 ? (
            <p className="text-xs text-muted-foreground">未添加条件时，使用全部 Eligible Data。</p>
          ) : (
            <div className="space-y-2">
              {form.scope.map((cond, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <Select
                    value={cond.field}
                    onValueChange={(v) => set({ scope: form.scope.map((c, i) => (i === idx ? { ...c, field: v } : c)) })}
                  >
                    <SelectTrigger className="h-8 w-44"><SelectValue placeholder="字段" /></SelectTrigger>
                    <SelectContent>
                      {asset.schema.map((f) => (
                        <SelectItem key={f.key} value={f.key}>{f.displayName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={cond.operator}
                    onValueChange={(v) => set({ scope: form.scope.map((c, i) => (i === idx ? { ...c, operator: v } : c)) })}
                  >
                    <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["=", "≠", ">", "<", "IN", "IS NOT NULL"].map((op) => (
                        <SelectItem key={op} value={op}>{op}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {cond.operator !== "IS NOT NULL" ? (
                    <Input
                      className="h-8 w-40"
                      value={cond.value}
                      placeholder="值"
                      onChange={(e) => set({ scope: form.scope.map((c, i) => (i === idx ? { ...c, value: e.target.value } : c)) })}
                    />
                  ) : null}
                  <Button variant="ghost" size="icon" className="size-8" onClick={() => set({ scope: form.scope.filter((_, i) => i !== idx) })}>
                    <X className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}

export function StrategyTaskFields({
  form,
  onChange,
}: {
  form: TaskFormState
  onChange: (next: TaskFormState) => void
}) {
  const set = (patch: Partial<TaskFormState>) => onChange({ ...form, ...patch })
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label className="text-sm font-medium">Sampling</Label>
        <RadioGroup value={form.samplingType} onValueChange={(v) => set({ samplingType: v as TaskFormState["samplingType"] })} className="gap-2">
          <div className="flex items-center gap-2 rounded-md border px-3 py-2">
            <RadioGroupItem value="全量" id="sp-all" />
            <label htmlFor="sp-all" className="text-sm">全量</label>
          </div>
          <div className="flex items-center gap-2 rounded-md border px-3 py-2">
            <RadioGroupItem value="随机抽样" id="sp-rand" />
            <label htmlFor="sp-rand" className="text-sm">随机抽样</label>
            {form.samplingType === "随机抽样" ? (
              <Input type="number" className="h-7 w-20" value={form.samplingPercent} onChange={(e) => set({ samplingPercent: Number(e.target.value) })} />
            ) : null}
            {form.samplingType === "随机抽样" ? <span className="text-xs text-muted-foreground">%</span> : null}
          </div>
          <div className="flex items-center gap-2 rounded-md border px-3 py-2">
            <RadioGroupItem value="固定数量" id="sp-fixed" />
            <label htmlFor="sp-fixed" className="text-sm">固定数量</label>
            {form.samplingType === "固定数量" ? (
              <Input type="number" className="h-7 w-24" value={form.samplingCount} onChange={(e) => set({ samplingCount: Number(e.target.value) })} />
            ) : null}
            {form.samplingType === "固定数量" ? <span className="text-xs text-muted-foreground">条</span> : null}
          </div>
        </RadioGroup>
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-medium">Schedule</Label>
        <div className="flex items-center gap-2">
          <Select value={form.scheduleType} onValueChange={(v) => set({ scheduleType: v as TaskFormState["scheduleType"] })}>
            <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="一次性">一次性</SelectItem>
              <SelectItem value="每日">每日</SelectItem>
              <SelectItem value="每周">每周</SelectItem>
              <SelectItem value="每月">每月</SelectItem>
            </SelectContent>
          </Select>
          {form.scheduleType !== "一次性" ? (
            <Input type="time" className="h-8 w-32" value={form.scheduleTime} onChange={(e) => set({ scheduleTime: e.target.value })} />
          ) : null}
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-medium">Data Window</Label>
        {form.scheduleType === "一次性" ? (
          <div className="flex items-center gap-2">
            <Input type="date" className="h-8 w-40" value={form.dataWindowStart} onChange={(e) => set({ dataWindowStart: e.target.value })} />
            <span className="text-xs text-muted-foreground">→</span>
            <Input type="date" className="h-8 w-40" value={form.dataWindowEnd} onChange={(e) => set({ dataWindowEnd: e.target.value })} />
          </div>
        ) : (
          <Select value={form.dataWindowTemplate} onValueChange={(v) => set({ dataWindowTemplate: v })}>
            <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="上一自然日">上一自然日</SelectItem>
              {form.scheduleType === "每周" ? <SelectItem value="上一自然周">上一自然周</SelectItem> : null}
              {form.scheduleType === "每月" ? <SelectItem value="上一自然月">上一自然月</SelectItem> : null}
            </SelectContent>
          </Select>
        )}
        <p className="text-xs text-muted-foreground">Schedule 与 Data Window 分离：执行周期 ≠ 分析的数据范围。窗口语义为 [start, end)。</p>
      </div>
    </div>
  )
}
