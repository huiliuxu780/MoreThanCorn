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
        moduleKey: a.moduleKey, requiresRuleVersion: m?.requiresRuleVersion ?? false,
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
  const documentField = fields.find((f) => f.key === "canonical_call" && f.type === "Object")
  if (documentField && (agent.inputSchema ?? []).filter((i) => i.required).length > 1) {
    return { $: documentField.key }
  }
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
  if (form.mapping.$) {
    const root = fields.find((f) => f.key === form.mapping.$)
    return root && root.type === "Object" ? [] : [{ key: "$", message: "完整输入映射必须指向 Object 字段" }]
  }
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
                {form.mapping.$ ? (
                  <TableRow>
                    <TableCell>
                      <div className="font-mono text-sm">$（完整输入）</div>
                      <div className="text-xs text-muted-foreground">Object · Required</div>
                    </TableCell>
                    <TableCell>
                      <Select value={form.mapping.$} onValueChange={(v) => set({ mapping: { $: v } })}>
                        <SelectTrigger className={cn("h-8 w-56", issues.length && "border-destructive")}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {assetFields.filter((f) => f.type === "Object").map((f) => (
                            <SelectItem key={f.key} value={f.key}>{f.key}（Object）</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {issues[0] ? <div className="mt-1 text-xs text-destructive">{issues[0].message}</div> : null}
                    </TableCell>
                    <TableCell>{issues.length === 0 ? <span className="text-emerald-600">✓</span> : null}</TableCell>
                  </TableRow>
                ) : (agent.inputSchema ?? []).map((input) => {
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
  const requiresRuleVersion = form.targetType !== "agent" || agentOf(form)?.requiresRuleVersion !== false
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
      {requiresRuleVersion ? <FormField label="质检规则版本" description="绑定后该任务所有批次使用同一冻结版本；缺省跟随最新发布版本。">
        <Select value={form.ruleVersionId || "latest"} onValueChange={(v) => set({ ruleVersionId: v === "latest" ? "" : v })}>
          <SelectTrigger className="h-8 w-64"><SelectValue placeholder="跟随最新发布版本" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="latest">跟随最新发布版本</SelectItem>
            {ruleOptions.map((o) => (
              <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField> : (
        <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          该 Module 不消费质检规则，任务不会绑定 RuleVersion。
        </div>
      )}
      {requiresRuleVersion && !form.ruleVersionId && (
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
