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
import { useAsyncData } from "@/hooks/use-async-data"
import { defApi, type DefinitionDTO } from "@/services/resource-api"
import { agentApi, bizApi, formsApi, listDataAssets, wfApi } from "@/services/wf-api"
import type { AgentDetail, DataAsset, DataAssetField } from "@/domain/types"
import { cn } from "@/lib/utils"

/* D-5 mock 清退：agents/agentDetails/dataAssets 改为真实接口（模块级缓存+订阅）。
   inputSchema 无真实来源时使用标准会话字段缺省（非 AI 猜测）。 */
const DEFAULT_INPUT_SCHEMA: DataAssetField[] = []
let agents: AgentDetail[] = []
let dataAssets: DataAsset[] = []
const agentDetails: Record<string, AgentDetail> = {}
const subs = new Set<() => void>()
let catalogLoaded = false
function loadCatalog() {
  if (catalogLoaded) return
  catalogLoaded = true
  // 08-27 用户链路：任务挂 workflow 主干——catalog 源换成工作流，inputSchema 取自开始节点 form
  // 09 P0-B4：同时加载已发布版本列表（Fixed 策略需要真实 versionId）
  // R7-3：Module Agent 作为默认执行目标（输入 Schema 取自 Module inputSchema）。
  agentApi.modules().then(async (mods) => {
    const list = await agentApi.list({ pageSize: 100, archived: "" }).catch(() => ({ items: [] }))
    const schemaByKey = new Map((mods.items ?? []).map((m) => [m.key, m]))
    const out: AgentDetail[] = []
    for (const a of (list.items ?? []) as { id: string; name: string; type?: string; moduleKey?: string; sandboxVersion?: number | null }[]) {
      if (a.type !== "module") continue
      const m = schemaByKey.get(a.moduleKey ?? "")
      const schema = ((m?.inputSchema?.properties ?? {}) as Record<string, { type?: string }>)
      const required = new Set((m?.inputSchema?.required ?? []) as string[])
      out.push({
        id: a.id, name: `${a.name}（Module）`, status: a.sandboxVersion != null ? "Published" : "Draft",
        moduleKey: a.moduleKey,
        inputSchema: Object.entries(schema).map(([key, v]) => ({ key, type: (v?.type ?? "string"), label: key, required: required.has(key) })) as unknown as DataAssetField[],
        versions: [],
      } as unknown as AgentDetail)
    }
    // R8-UI：钉住版本策略需要真实版本列表+artifactHash 前 8 位
    await Promise.all(out.map(async (d) => {
      const vs = await agentApi.versions(d.id).catch(() => [])
      d.versions = vs.map((v) => ({
        version: `v${v.versionNo}`, status: "Published" as const, versionId: v.versionId,
        publishedAt: v.createdAt, artifactHash: v.artifactHash,
      } as unknown as AgentDetail["versions"][number] & { artifactHash?: string }))
    }))
    agents = [...out, ...agents.filter((x) => !(x as { moduleKey?: string }).moduleKey)]
    for (const a of agents) agentDetails[a.id] = a
    subs.forEach((f) => f())
  }).catch(() => undefined)
  wfApi.list({ pageSize: 100 }).then(async (r) => {
    const out: AgentDetail[] = []
    for (const w of (r.items ?? []) as { id: string; name: string; status?: string }[]) {
      let schema = DEFAULT_INPUT_SCHEMA
      try {
        const d = await wfApi.get(w.id)
        const start = ((d.definition as { graph?: { nodes?: { type: string; config?: { formId?: string } }[] } })?.graph?.nodes ?? [])
          .find((n) => n.type === "input")
        const fid = start?.config?.formId
        if (fid) {
          const f = await formsApi.get(fid).catch(() => null)
          if (f) schema = (f.fields ?? []).map((fd) => ({ key: fd.key, type: fd.dataType, label: fd.label })) as unknown as DataAssetField[]
        }
      } catch { /* 回退缺省 */ }
      const versions = await wfApi.versions(w.id).catch(() => [])
      out.push({
        id: w.id, name: w.name, status: w.status === "published" ? "Published" : "Draft",
        inputSchema: schema,
        versions: versions.map((v) => ({ version: `v${v.versionNo}`, status: "Published" as const, versionId: v.versionId, publishedAt: v.publishedAt })),
      } as unknown as AgentDetail)
    }
    agents = [...agents.filter((x) => (x as { moduleKey?: string }).moduleKey), ...out]
    for (const a of agents) agentDetails[a.id] = a
    subs.forEach((f) => f())
  }).catch(() => undefined)
  listDataAssets().then((r) => {
    dataAssets = ((r.items ?? []) as { id: string; name: string; lifecycle?: string }[]).map((a) => ({
      id: a.id, name: a.name, lifecycle: a.lifecycle ?? "Ready", fields: [],
    } as unknown as DataAsset))
    subs.forEach((f) => f())
  }).catch(() => undefined)
}
function useCatalog() {
  const [, force] = useState(0)
  useEffect(() => {
    const f = () => force((x) => x + 1)
    subs.add(f)
    loadCatalog()
    return () => { subs.delete(f) }
  }, [])
}

export interface ScopeCondition {
  field: string
  operator: string
  value: string
}

export interface TaskFormState {
  name: string
  description: string
  /** R7-1：执行目标类型（agent 默认 / workflow 兼容） */
  targetType: "agent" | "workflow"
  /** 09 P0-02：任务直接绑定 Workflow（历史命名沿用字段名，语义=工作流） */
  agentId: string
  versionPolicy: "Latest Published" | "Fixed"
  /** R8-UI（11 §7-④ / §6-1）：Agent 版本策略三选，默认最新沙箱发布 */
  agentVersionPolicy: "latest_sandbox" | "latest_prod" | "pinned"
  /** Fixed 策略选中的工作流版本 ID（pinnedWorkflowVersionId） */
  fixedVersion: string
  assetId: string
  definitionId: string
  /** 09 §9.2：数据定义已发布版本 ID（dataDefinitionVersionId） */
  definitionVersionId: string
  /** 09 §9.2：冻结的规则版本 ID（resultRuleVersionId；空=执行时取最新发布版本） */
  ruleVersionId: string
  /** 09 闭环修复：follow_latest 的 RuleSet 作用域（resultRuleSetId） */
  ruleSetId: string
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
  /** SDD 13 §9.1：结果输出（目标表投递 / 仅平台保存） */
  outputMode: "platform_only" | "target_table"
  outputAssetId: string
  outputDefinitionVersionId: string
  outputWriteMode: "append" | "upsert"
  outputKeyFields: string
  outputMappingRows: { column: string; expr: string }[]
}

export const emptyTaskForm: TaskFormState = {
  name: "",
  description: "",
  targetType: "agent",
  agentId: "",
  versionPolicy: "Latest Published",
  agentVersionPolicy: "latest_sandbox",
  fixedVersion: "",
  assetId: "",
  definitionId: "",
  definitionVersionId: "",
  ruleVersionId: "",
  ruleSetId: "",
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
  outputMode: "platform_only",
  outputAssetId: "",
  outputDefinitionVersionId: "",
  outputWriteMode: "upsert",
  outputKeyFields: "_run_id",
  outputMappingRows: [],
}

/** SDD 13 §4.5：目标表最小系统列的默认来源表达式。 */
export const SYSTEM_MAPPING_DEFAULTS: Record<string, string> = {
  _run_id: "$run.id",
  _task_run_id: "$run.taskRunId",
  _task_id: "$run.taskId",
  _task_version_id: "$run.taskVersionId",
  _interaction_ref: "$run.interactionRef",
  _output_schema_ref: "$schema.ref",
  _written_at: "$system.completedAt",
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
  const fields = (asset.schema ?? (asset as { fields?: DataAssetField[] }).fields ?? []) as DataAssetField[]
  for (const input of (agent.inputSchema ?? [])) {
    const exact = fields.find((f) => f.key === input.key)
    if (exact) {
      mapping[input.key] = exact.key
      continue
    }
    const compatible = fields.find((f) => f.type === input.type && !Object.values(mapping).includes(f.key))
    if (compatible) mapping[input.key] = compatible.key
  }
  return mapping
}

export function mappingIssues(form: TaskFormState): { key: string; message: string }[] {
  const agent = agentOf(form)
  const asset = assetOf(form)
  if (!agent || !asset) return []
  const fields = (asset.schema ?? (asset as { fields?: DataAssetField[] }).fields ?? []) as DataAssetField[]
  const issues: { key: string; message: string }[] = []
  for (const input of (agent.inputSchema ?? [])) {
    const mapped = form.mapping[input.key]
    if (input.required && !mapped) {
      issues.push({ key: input.key, message: "Required Input 未 Mapping" })
      continue
    }
    if (mapped) {
      const field = fields.find((f) => f.key === mapped)
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
  useCatalog()
  const set = (patch: Partial<TaskFormState>) => onChange({ ...form, ...patch })
  return (
    <div className="space-y-4">
      <FormField label="任务名称" required>
        <Input value={form.name} placeholder="例如：每日热线全量质检" onChange={(e) => set({ name: e.target.value })} />
      </FormField>
      <FormField label="描述">
        <Textarea value={form.description} className="min-h-16" placeholder="任务用途说明（可选）" onChange={(e) => set({ description: e.target.value })} />
      </FormField>
    </div>
  )
}

/** R8-UI（11 §7-④ / 原型 v1-④）：执行目标步——Workflow 保位 / 领域 Agent 二选一；
 *  Agent 仅列 Module，无发布版本草稿禁选并示原因；版本策略三选（默认最新沙箱发布）。 */
export function TargetTaskFields({
  form,
  onChange,
}: {
  form: TaskFormState
  onChange: (next: TaskFormState) => void
}) {
  useCatalog()
  const set = (patch: Partial<TaskFormState>) => onChange({ ...form, ...patch })
  const isAgent = form.targetType === "agent"
  const moduleAgents = agents.filter((a) => (a as { moduleKey?: string }).moduleKey)
  const workflows = agents.filter((a) => !(a as { moduleKey?: string }).moduleKey)
  const list = isAgent ? moduleAgents : workflows
  const pick = (agentId: string) => {
    const agent = (agentDetails[agentId] ?? null) as (AgentDetail & { moduleKey?: string }) | null
    onChange({ ...form, agentId, mapping: autoMapping(agent, assetOf(form)) })
  }
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className="text-sm font-medium">执行目标类型</Label>
        <div className="grid grid-cols-2 gap-3">
          <button type="button"
            className={`rounded-lg border px-3 py-2.5 text-left ${!isAgent ? "border-primary bg-primary/5" : ""}`}
            onClick={() => onChange({ ...form, targetType: "workflow", agentId: "", fixedVersion: "" })}>
            <div className="text-sm font-medium">工作流 Workflow</div>
            <p className="pt-0.5 text-xs text-muted-foreground">选择工作流与版本策略（现状能力）</p>
          </button>
          <button type="button"
            className={`rounded-lg border px-3 py-2.5 text-left ${isAgent ? "border-primary bg-primary/5" : ""}`}
            onClick={() => onChange({ ...form, targetType: "agent", agentId: "", fixedVersion: "" })}>
            <div className="text-sm font-medium">领域 Agent</div>
            <p className="pt-0.5 text-xs text-muted-foreground">直接对 Agent 跑质检（无需编排工作流）</p>
          </button>
        </div>
      </div>

      <FormField label={isAgent ? "选择 Agent（仅列 Module Agent；旧三类不可选）" : "选择工作流"} required>
        <Select value={form.agentId || undefined} onValueChange={pick}>
          <SelectTrigger><SelectValue placeholder={isAgent ? "选择 Module Agent" : "选择工作流"} /></SelectTrigger>
          <SelectContent>
            {list.map((a) => {
              const noPub = isAgent && a.status !== "Published"
              return (
                <SelectItem key={a.id} value={a.id} disabled={noPub}>
                  {a.name}{noPub ? "（草稿：无发布版本，不可选）" : ""}
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
      </FormField>

      <div className="space-y-2">
        <Label className="text-sm font-medium">{isAgent ? "Agent 版本策略" : "工作流版本策略"}</Label>
        {isAgent ? (
          <RadioGroup
            value={form.agentVersionPolicy}
            onValueChange={(v) => set({ agentVersionPolicy: v as TaskFormState["agentVersionPolicy"] })}
            className="gap-2"
          >
            <div className="flex items-start gap-2 rounded-md border px-3 py-2">
              <RadioGroupItem value="latest_sandbox" id="avp-sandbox" />
              <label htmlFor="avp-sandbox" className="space-y-0.5 text-sm">
                <div className="font-medium">最新沙箱发布（默认）</div>
                <p className="text-xs text-muted-foreground">批次启动即冻结；批次期间新发布不影响已开始批次（重试亦不漂移）。</p>
              </label>
            </div>
            <div className="flex items-start gap-2 rounded-md border px-3 py-2">
              <RadioGroupItem value="latest_prod" id="avp-prod" />
              <label htmlFor="avp-prod" className="space-y-0.5 text-sm">
                <div className="font-medium">最新线上发布</div>
                <p className="text-xs text-muted-foreground">使用当前线上生效版本。</p>
              </label>
            </div>
            <div className="flex items-start gap-2 rounded-md border px-3 py-2">
              <RadioGroupItem value="pinned" id="avp-pinned" />
              <label htmlFor="avp-pinned" className="flex-1 space-y-1 text-sm">
                <div className="font-medium">钉住版本</div>
                {form.agentVersionPolicy === "pinned" ? (
                  <Select value={form.fixedVersion || undefined} onValueChange={(v) => set({ fixedVersion: v })}>
                    <SelectTrigger className="h-8 w-56"><SelectValue placeholder="选择版本" /></SelectTrigger>
                    <SelectContent>
                      {(agentOf(form)?.versions ?? []).filter((v) => v.status === "Published").map((v) => (
                        <SelectItem key={v.versionId ?? v.version} value={v.versionId ?? v.version}>
                          {v.version}{(v as { artifactHash?: string }).artifactHash ? ` · ${(v as { artifactHash?: string }).artifactHash!.slice(0, 8)}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-xs text-muted-foreground">下拉列该 Agent 版本 + artifactHash 前 8 位。</p>
                )}
              </label>
            </div>
          </RadioGroup>
        ) : (
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
                  每次创建新 Run 时使用当时最新的 Published Version；已经创建或运行中的 Run 不受后续发布影响。
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
                        <SelectItem key={v.versionId ?? v.version} value={v.versionId ?? v.version}>{v.version}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-xs text-muted-foreground">锁定某个已发布版本，不随发布变化。</p>
                )}
              </label>
            </div>
          </RadioGroup>
        )}
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
  useCatalog()
  const set = (patch: Partial<TaskFormState>) => onChange({ ...form, ...patch })
  const agent = agentOf(form)
  const [defs, setDefs] = useState<DefinitionDTO[]>([])
  const [selDef, setSelDef] = useState<DefinitionDTO | null>(null)
  useEffect(() => {
    defApi.list({}).then((r) => setDefs(r.items.filter((d) => d.lifecycle === "Ready"))).catch(() => undefined)
  }, [])
  useEffect(() => {
    if (form.definitionId) defApi.get(form.definitionId).then(setSelDef).catch(() => undefined)
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
  const asset = shellFromDef(selDef) ?? assetOf(form)
  const assetFields = (asset?.schema ?? (asset as { fields?: DataAssetField[] } | null)?.fields ?? []) as DataAssetField[]
  const issues = mappingIssues(form)

  return (
    <div className="space-y-5">
      <FormField label="Data Definition" required description="选择 Ready 的数据定义（字段 schema + eligibility）；任务按定义字段执行分析。">
        <Select
          value={form.definitionId || undefined}
          onValueChange={(definitionId) => {
            const d = defs.find((x) => x.id === definitionId) ?? null
            onChange({ ...form, definitionId, assetId: d?.assetId ?? "", definitionVersionId: d?.latestVersionId ?? "", mapping: autoMapping(agent, shellFromDef(d)), scope: [] })
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
                {(agent.inputSchema ?? []).map((input) => {
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
                            {assetFields.map((f) => (
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
  // 09 §9.2：任务绑定冻结规则版本（缺省=执行时取最新发布版本）
  const [ruleOptions, setRuleOptions] = useState<{ id: string; label: string }[]>([])
  // 09 闭环修复：follow_latest 需显式 RuleSet 作用域
  const [ruleSets, setRuleSets] = useState<{ id: string; name: string }[]>([])
  useEffect(() => {
    bizApi.rules().then(async (sets) => {
      setRuleSets(sets.map((s) => ({ id: s.id, name: s.name })))
      const opts: { id: string; label: string }[] = []
      for (const s of sets) {
        const vs = await bizApi.ruleVersions(s.id).catch(() => [])
        for (const v of vs) opts.push({ id: v.id, label: `${s.name} · V${v.versionNo}` })
      }
      setRuleOptions(opts)
    }).catch(() => undefined)
  }, [])
  return (
    <div className="space-y-5">
      <FormField label="质检规则版本" description="绑定后该任务所有批次使用同一冻结版本；缺省跟随最新发布版本。">
        <Select value={form.ruleVersionId || "latest"} onValueChange={(v) => set({ ruleVersionId: v === "latest" ? "" : v })}>
          <SelectTrigger className="h-8 w-64"><SelectValue placeholder="跟随最新发布版本" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="latest">跟随最新发布版本</SelectItem>
            {ruleOptions.map((o) => (
              <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      {!form.ruleVersionId && (
        <FormField
          required
          label="跟随的规则集（RuleSet 作用域）"
          description={form.ruleSetId
            ? "跟随最新发布时限定规则集，避免串用其他规则集版本。"
            : "未选择规则集：跟随最新策略必须指定 RuleSet 作用域，否则提交会被服务端拒绝（422）。"}
        >
          <Select value={form.ruleSetId || undefined} onValueChange={(v) => set({ ruleSetId: v })}>
            <SelectTrigger className="h-8 w-64"><SelectValue placeholder="选择规则集" /></SelectTrigger>
            <SelectContent>
              {ruleSets.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      )}
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

/* ------------------------------------------------------------------ */
/* SDD 13 §9.1：结果输出区块（OutputBinding 配置 + 服务端预检）          */
/* ------------------------------------------------------------------ */

export function OutputBindingFields({
  form,
  onChange,
}: {
  form: TaskFormState
  onChange: (next: TaskFormState) => void
}) {
  const set = (patch: Partial<TaskFormState>) => onChange({ ...form, ...patch })
  const { data: writable } = useAsyncData(() => bizApi.writableAssets(), [])
  const { data: meta, retry: retryMeta } = useAsyncData(
    () => (form.outputAssetId ? bizApi.targetMeta(form.outputAssetId) : Promise.resolve(null)),
    [form.outputAssetId],
  )
  const [issues, setIssues] = useState<{ code: string; message: string; path: (string | number)[] }[] | null>(null)
  const [validating, setValidating] = useState(false)
  const [resolved, setResolved] = useState<string | null>(null)

  const asset = (writable ?? []).find((a) => a.id === form.outputAssetId)
  const columns = meta?.columns ?? []
  const setRow = (i: number, patch: Partial<{ column: string; expr: string }>) =>
    set({ outputMappingRows: form.outputMappingRows.map((r, j) => (j === i ? { ...r, ...patch } : r)) })

  return (
    <div className="space-y-4">
      <SectionHeader title="结果输出" description="SDD 13：执行结果与业务页面解耦；目标表必须预先接入并验证" />
      <div className="space-y-2">
        <Label className="text-sm font-medium">输出方式</Label>
        <RadioGroup value={form.outputMode} onValueChange={(v) => set({ outputMode: v as TaskFormState["outputMode"] })} className="flex gap-4">
          <div className="flex items-center gap-2">
            <RadioGroupItem value="platform_only" id="ob-platform" />
            <Label htmlFor="ob-platform" className="text-sm">仅保存在平台（sandbox/manual）</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="target_table" id="ob-table" />
            <Label htmlFor="ob-table" className="text-sm">投递到目标表（生产默认）</Label>
          </div>
        </RadioGroup>
      </div>

      {form.outputMode === "target_table" ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-sm font-medium">目标 DataAsset（可写 table）</Label>
              <Select value={form.outputAssetId} onValueChange={(v) => set({ outputAssetId: v, outputDefinitionVersionId: "", outputMappingRows: [] })}>
                <SelectTrigger className="h-8"><SelectValue placeholder="选择目标表资产" /></SelectTrigger>
                <SelectContent>
                  {(writable ?? []).map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">DataDefinitionVersion</Label>
              <Select value={form.outputDefinitionVersionId} onValueChange={(v) => set({ outputDefinitionVersionId: v })}>
                <SelectTrigger className="h-8"><SelectValue placeholder="默认最新已发布" /></SelectTrigger>
                <SelectContent>
                  {(meta?.definitions ?? []).map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name} V{d.versionNo}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            物理表：{asset?.location ?? "—"} · Connection：{asset?.connectionName ?? "—"}（只读；写入经服务端参数化 SQL）
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-sm font-medium">写入模式</Label>
              <Select value={form.outputWriteMode} onValueChange={(v) => set({ outputWriteMode: v as "append" | "upsert" })}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="upsert">upsert（按唯一键更新）</SelectItem>
                  <SelectItem value="append">append（冲突跳过）</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">唯一键（覆盖目标表唯一约束）</Label>
              <Input className="h-8" value={form.outputKeyFields} onChange={(e) => set({ outputKeyFields: e.target.value })} placeholder="_run_id" />
              {(meta?.uniqueConstraints ?? []).length > 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  目标唯一约束：{(meta?.uniqueConstraints ?? []).map((u) => u.join("+")).join("；")}
                </p>
              ) : null}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">字段映射（目标列 ← 受限表达式）</Label>
              <div className="flex gap-2">
                <Button
                  type="button" variant="outline" size="sm"
                  onClick={() => {
                    const rows = [...form.outputMappingRows]
                    const have = new Set(rows.map((r) => r.column))
                    for (const [col, expr] of Object.entries(SYSTEM_MAPPING_DEFAULTS)) {
                      if (columns.length === 0 || columns.some((c) => c.name === col)) {
                        if (!have.has(col)) rows.push({ column: col, expr })
                      }
                    }
                    for (const c of columns) {
                      if (!have.has(c.name) && !SYSTEM_MAPPING_DEFAULTS[c.name]) {
                        rows.push({ column: c.name, expr: `$output.${c.name}` })
                      }
                    }
                    set({ outputMappingRows: rows })
                  }}
                >
                  生成默认映射
                </Button>
                <Button type="button" variant="outline" size="sm"
                  onClick={() => set({ outputMappingRows: [...form.outputMappingRows, { column: "", expr: "" }] })}>
                  <Plus className="size-3.5" /> 添加行
                </Button>
              </div>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>目标列</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead>必填</TableHead>
                  <TableHead>来源表达式</TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {form.outputMappingRows.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="py-4 text-center text-xs text-muted-foreground">尚未配置映射；可点击“生成默认映射”</TableCell></TableRow>
                ) : form.outputMappingRows.map((row, i) => {
                  const col = columns.find((c) => c.name === row.column)
                  return (
                    <TableRow key={i}>
                      <TableCell>
                        <Select value={row.column} onValueChange={(v) => setRow(i, { column: v })}>
                          <SelectTrigger className="h-8 w-44"><SelectValue placeholder="目标列" /></SelectTrigger>
                          <SelectContent>
                            {columns.map((c) => <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{col?.type ?? "—"}</TableCell>
                      <TableCell className="text-xs">{col && !col.nullable && !col.hasDefault ? "是" : "否"}</TableCell>
                      <TableCell>
                        <Input className="h-8 font-mono text-xs" value={row.expr} onChange={(e) => setRow(i, { expr: e.target.value })} placeholder="$output.title / $run.id" />
                      </TableCell>
                      <TableCell>
                        <Button type="button" variant="ghost" size="icon" className="size-7"
                          onClick={() => set({ outputMappingRows: form.outputMappingRows.filter((_, j) => j !== i) })}>
                          <X className="size-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center gap-3">
            <Button
              type="button" variant="outline" size="sm" disabled={validating || !form.outputAssetId}
              onClick={async () => {
                setValidating(true)
                setIssues(null)
                setResolved(null)
                try {
                  const rep = await bizApi.validateOutputBinding({
                    executionTarget: { type: form.targetType, agentId: form.agentId,
                      workflowId: form.targetType === "workflow" ? form.agentId : undefined },
                    inputAssetId: form.assetId || undefined,
                    outputBinding: {
                      mode: "target_table", assetId: form.outputAssetId,
                      definitionVersionId: form.outputDefinitionVersionId || undefined,
                      writeMode: form.outputWriteMode,
                      keyFields: form.outputKeyFields.split(",").map((s) => s.trim()).filter(Boolean),
                      mapping: Object.fromEntries(form.outputMappingRows.filter((r) => r.column).map((r) => [r.column, r.expr])),
                    },
                  })
                  if (rep.valid) setResolved(`校验通过${rep.resolved?.targetTable ? `：${rep.resolved.targetTable}` : ""}`)
                  else setIssues(rep.issues)
                } catch (e) {
                  setIssues([{ code: "CLIENT_ERROR", message: (e as Error).message, path: [] }])
                } finally {
                  setValidating(false)
                }
              }}
            >
              {validating ? "校验中…" : "验证连接与映射"}
            </Button>
            {form.outputAssetId && !meta ? (
              <Button type="button" variant="ghost" size="sm" onClick={retryMeta}>重新读取目标表结构</Button>
            ) : null}
          </div>
          {resolved ? (
            <div className="rounded-md border border-emerald-300/60 bg-emerald-50/50 px-3 py-2 text-xs dark:bg-emerald-950/20">{resolved}</div>
          ) : null}
          {issues ? (
            <div className="space-y-1 rounded-md border border-amber-300/60 bg-amber-50/40 px-3 py-2 text-xs dark:bg-amber-950/20">
              <div className="font-medium">校验发现 {issues.length} 个问题（最终校验以服务端保存时为准）：</div>
              {issues.map((i, k) => (
                <div key={k} className="font-mono">{i.code} · {[...i.path].join(".")} — {i.message}</div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
