/** 07-SDD §3/§4：节点抽屉增强分区（健壮性/输出变量/Schema 编辑器/映射表/P2 三节点/工具参数）。 */
import { useEffect, useState } from "react"
import { Plus, X } from "lucide-react"

import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { resApi } from "@/services/resource-api"
import { formsApi, wfApi, type NodeDefinition, type WfEdge, type WfNode } from "@/services/wf-api"

import { C, PromptArea, ResourceSelect, Section, VarButton, parseIoOutputs } from "./controls"
/** 09 §5.7 已登记豁免：节点配置为注册表 schema 驱动的自由 JSONB，设计器按松散对象处理（统一别名，可审计）。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NodeCfgLoose = Record<string, any>


/* ---------- 健壮性分区（07-SDD §3.2 execution 块） ---------- */
export function RobustnessSection({ node, onChange }: { node: WfNode; onChange: (n: WfNode) => void }) {
  const ex = (node.execution ?? {}) as Record<string, unknown>
  const setEx = (k: string, v: unknown) => onChange({ ...node, execution: { ...node.execution, [k]: v } } as WfNode)
  const onError = (ex.onError as string) || "fail"
  return (
    <Section title="健壮性" defaultOpen={false}>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <div className="pb-1" style={{ color: C.ink2 }}>超时 ms</div>
          <Input type="number" className="h-7 text-xs" value={String(ex.timeoutMs ?? 60000)}
            onChange={(e) => setEx("timeoutMs", Number(e.target.value) || 60000)} />
        </div>
        <div>
          <div className="pb-1" style={{ color: C.ink2 }}>重试次数</div>
          <Input type="number" className="h-7 text-xs" value={String(ex.retries ?? 0)}
            onChange={(e) => setEx("retries", Math.max(0, Math.min(3, Number(e.target.value) || 0)))} />
        </div>
        <div>
          <div className="pb-1" style={{ color: C.ink2 }}>间隔 ms</div>
          <Input type="number" className="h-7 text-xs" value={String(ex.retryIntervalMs ?? 1000)}
            onChange={(e) => setEx("retryIntervalMs", Number(e.target.value) || 1000)} />
        </div>
      </div>
      <div className="pb-1 pt-2 text-xs" style={{ color: C.ink2 }}>失败策略</div>
      <ToggleGroup type="single" size="sm" value={onError} onValueChange={(v) => v && setEx("onError", v)}>
        <ToggleGroupItem value="fail" className="h-6 px-2 text-[10px]">停止</ToggleGroupItem>
        <ToggleGroupItem value="skip" className="h-6 px-2 text-[10px]">跳过</ToggleGroupItem>
        <ToggleGroupItem value="branch" className="h-6 px-2 text-[10px]">走错误分支</ToggleGroupItem>
      </ToggleGroup>
      <p className="pt-1 text-[11px]" style={{ color: C.ink3 }}>
        仅 retryable（5xx/timeout/连接错误）触发重试；走错误分支需画布拉出 error 出口边，下游可引 {"{{节点.error.message}}"}。
      </p>
    </Section>
  )
}

/* ---------- 输出变量统一区（07-SDD §2.6-4） ---------- */
export function OutputVarsSection({ def }: { def: NodeDefinition | undefined }) {
  const outs = parseIoOutputs(def)
  return (
    <Section title="输出变量" defaultOpen={false}>
      {outs ? (
        <div className="space-y-1 text-xs">
          {outs.map((o) => (
            <div key={o.name} className="flex items-center gap-2">
              <span style={{ color: C.ink }}>{o.name}</span>
              <span className="rounded px-1 text-[10px]" style={{ background: C.chipBg, color: C.chipInk }}>
                {o.type === "array" ? "Arr" : o.type === "object" ? "Obj" : o.type === "number" ? "Num" : "Str"}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[11px]" style={{ color: C.ink3 }}>输出由资源配置决定</p>
      )}
    </Section>
  )
}

/* ---------- llm JSON Schema 编辑器（07-SDD §4.3） ---------- */
export function OutputSchemaEditor({ value, onChange }: {
  value: Record<string, { type?: string; description?: string }> | undefined
  onChange: (v: Record<string, { type?: string; description?: string }>) => void
}) {
  const schema = value ?? {}
  const keys = Object.keys(schema)
  const setRow = (k: string, patch: { type?: string; description?: string }) =>
    onChange({ ...schema, [k]: { ...schema[k], ...patch } })
  return (
    <div className="space-y-1 pt-1">
      {keys.map((k) => (
        <div key={k} className="flex items-center gap-1 text-xs">
          <Input key={k} className="h-6 flex-1 font-mono text-xs" defaultValue={k} placeholder="field_key"
            title="字段名（回车/失焦生效）"
            onBlur={(e) => {
              const nk = e.target.value.trim()
              if (!nk || nk === k || schema[nk]) return
              const next: typeof schema = {}
              for (const [ok, ov] of Object.entries(schema)) next[ok === k ? nk : ok] = ov
              onChange(next)
            }} />
          <Select value={schema[k]?.type ?? "string"} onValueChange={(v) => setRow(k, { type: v })}>
            <SelectTrigger className="h-6 w-24 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {["string", "number", "boolean", "object", "array", "enum"].map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>))}
            </SelectContent>
          </Select>
          <Input className="h-6 flex-1 text-xs" placeholder="描述" value={schema[k]?.description ?? ""}
            onChange={(e) => setRow(k, { description: e.target.value })} />
          <button onClick={() => { const n = { ...schema }; delete n[k]; onChange(n) }}><X className="size-3 text-neutral-400" /></button>
        </div>
      ))}
      <button className="flex items-center gap-1 text-xs" style={{ color: C.primary }}
        onClick={() => onChange({ ...schema, [`field_${keys.length + 1}`]: { type: "string", description: "" } })}>
        <Plus className="size-3" /> 添加字段
      </button>
      <p className="text-[11px]" style={{ color: C.ink3 }}>支持 object 嵌套/array items/enum（后端按 schema 校验输出）。</p>
    </div>
  )
}

/* ---------- 输入变量映射表（07-SDD §4.13，workflow-fixed 吸收原 agent 节点） ---------- */
const STD_VARS = ["userQuery", "chatHistory", "userId", "conversationId", "chatId", "reference"]
export function InputMappingTable({ cfg, set, nodes, edges, selfId, defs }: {
  cfg: NodeCfgLoose; set: (k: string, v: unknown) => void
  nodes: WfNode[]; edges: WfEdge[]; selfId: string; defs: NodeDefinition[]
}) {
  // 07-SDD form：行=子工作流开始 form 字段（契约驱动），fallback legacy 六件套
  const [childFields, setChildFields] = useState<string[] | null>(null)
  useEffect(() => {
    if (!cfg.workflowId) { setChildFields(null); return }
    wfApi.get(cfg.workflowId).then(async (d) => {
      const start = ((d.definition as { graph?: { nodes?: { type: string; config?: { formId?: string } }[] } })?.graph?.nodes ?? [])
        .find((n) => n.type === "input")
      const fid = start?.config?.formId
      if (!fid) { setChildFields(null); return }
      const f = await formsApi.get(fid)
      setChildFields((f.fields ?? []).map((x) => x.key ?? (x as unknown as { name?: string }).name ?? ""))
    }).catch(() => setChildFields(null))
  }, [cfg.workflowId])
  const mapping = (cfg.inputMapping ?? {}) as Record<string, string>
  const base = childFields ?? STD_VARS
  const rows = [...base, ...Object.keys(mapping).filter((k) => !base.includes(k))]
  const setRow = (k: string, v: string) => set("inputMapping", { ...mapping, [k]: v })
  return (
    <Section title="输入变量映射">
      <div className="space-y-1">
        {rows.map((k) => (
          <div key={k} className="flex items-center gap-2 text-xs">
            <span className="w-28 truncate" style={{ color: C.ink }}>{k}</span>
            <div className="flex-1">
              <VarButton value={mapping[k] ?? ""} nodes={nodes} edges={edges} selfId={selfId} defs={defs}
                onPick={(v) => setRow(k, v)} />
            </div>
            {!STD_VARS.includes(k) && (
              <button onClick={() => { const n = { ...mapping }; delete n[k]; set("inputMapping", n) }}>
                <X className="size-3 text-neutral-400" />
              </button>
            )}
          </div>
        ))}
      </div>
      <button className="flex items-center gap-1 pt-1 text-xs" style={{ color: C.primary }}
        onClick={() => setRow(`var_${rows.length + 1}`, "")}>
        <Plus className="size-3" /> 添加
      </button>
      <p className="pt-1 text-[11px]" style={{ color: C.ink3 }}>默认同名透传 run_input；⚙ 可改可清空。</p>
    </Section>
  )
}

/* ---------- 工具参数双模式（07-SDD §4.9） ---------- */
export function ToolParamsSection({ cfg, set, nodes, edges, selfId, defs }: {
  cfg: NodeCfgLoose; set: (k: string, v: unknown) => void
  nodes: WfNode[]; edges: WfEdge[]; selfId: string; defs: NodeDefinition[]
}) {
  const [params, setParams] = useState<NodeCfgLoose>({})
  useEffect(() => {
    if (!cfg.toolId) { setParams({}); return }
    resApi.toolVersions(cfg.toolId).then((vs) => {
      const spec = (vs[0]?.spec ?? {}) as NodeCfgLoose
      setParams(((spec.params ?? {}) as NodeCfgLoose).properties ?? {})
    }).catch(() => setParams({}))
  }, [cfg.toolId])
  const vals = (cfg.toolParams ?? {}) as Record<string, { mode?: string; value?: string }>
  const keys = Object.keys(params)
  if (keys.length === 0) return null
  return (
    <Section title="参数（常量｜变量）">
      <div className="space-y-1">
        {keys.map((k) => {
          const cur = vals[k] ?? { mode: "constant", value: "" }
          const setVal = (patch: { mode?: string; value?: string }) =>
            set("toolParams", { ...vals, [k]: { ...cur, ...patch } })
          return (
            <div key={k} className="flex items-center gap-1 text-xs">
              <span className="w-20 truncate" style={{ color: C.ink }}>{k}</span>
              <ToggleGroup type="single" size="sm" value={cur.mode ?? "constant"}
                onValueChange={(v) => v && setVal({ mode: v })}>
                <ToggleGroupItem value="constant" className="h-5 px-1.5 text-[10px]">常量</ToggleGroupItem>
                <ToggleGroupItem value="variable" className="h-5 px-1.5 text-[10px]">变量</ToggleGroupItem>
              </ToggleGroup>
              <div className="min-w-0 flex-1">
                {cur.mode === "variable" ? (
                  <VarButton value={cur.value ?? ""} nodes={nodes} edges={edges} selfId={selfId} defs={defs}
                    onPick={(v) => setVal({ value: v })} />
                ) : (
                  <Input className="h-6 text-xs" value={cur.value ?? ""} onChange={(e) => setVal({ value: e.target.value })} />
                )}
              </div>
            </div>
          )
        })}
      </div>
    </Section>
  )
}

/* ---------- loop 抽屉（07-SDD §4.16） ---------- */
export function LoopSection({ cfg, set, nodes, edges, selfId, defs }: {
  cfg: NodeCfgLoose; set: (k: string, v: unknown) => void
  nodes: WfNode[]; edges: WfEdge[]; selfId: string; defs: NodeDefinition[]
}) {
  return (
    <>
      <Section title="循环源">
        <VarButton value={(cfg.iteratorRef as string) ?? ""} nodes={nodes} edges={edges} selfId={selfId} defs={defs}
          onPick={(v) => set("iteratorRef", v)} />
        <div className="grid grid-cols-2 gap-2 pt-2 text-xs">
          <div><div className="pb-1" style={{ color: C.ink2 }}>迭代变量</div>
            <Input className="h-7 text-xs" value={cfg.itemVar ?? "item"} onChange={(e) => set("itemVar", e.target.value)} /></div>
          <div><div className="pb-1" style={{ color: C.ink2 }}>索引变量</div>
            <Input className="h-7 text-xs" value={cfg.indexVar ?? "index"} onChange={(e) => set("indexVar", e.target.value)} /></div>
        </div>
        <p className="pt-1 text-[11px]" style={{ color: C.ink3 }}>限 Array 类型；画布 body 口拉回边构成循环体。</p>
      </Section>
      <Section title="执行限制" defaultOpen={false}>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div><div className="pb-1" style={{ color: C.ink2 }}>最大迭代数</div>
            <Input type="number" className="h-7 text-xs" value={String(cfg.maxIterations ?? 1000)}
              onChange={(e) => set("maxIterations", Number(e.target.value) || 1000)} /></div>
          <div><div className="pb-1" style={{ color: C.ink2 }}>并行度</div>
            <Input type="number" className="h-7 text-xs" value={String(cfg.parallelNums ?? 10)}
              onChange={(e) => set("parallelNums", Number(e.target.value) || 10)} /></div>
        </div>
        <label className="flex items-center justify-between pt-2 text-xs" style={{ color: C.ink2 }}>
          <span>并行执行</span><Switch checked={!!cfg.parallel} onCheckedChange={(v) => set("parallel", v)} />
        </label>
        <div className="pb-1 pt-2 text-xs" style={{ color: C.ink2 }}>错误响应</div>
        <Select value={(cfg.errorHandleMode as string) ?? "terminated"} onValueChange={(v) => set("errorHandleMode", v)}>
          <SelectTrigger className="h-7 w-full text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="terminated">Terminated（终止）</SelectItem>
            <SelectItem value="continue_on_error">ContinueOnError（继续）</SelectItem>
            <SelectItem value="remove_abnormal">RemoveAbnormal（剔除）</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex items-center justify-between pt-2 text-xs" style={{ color: C.ink2 }}>
          <span>展平输出 flatten_output</span><Switch checked={cfg.flattenOutput !== false} onCheckedChange={(v) => set("flattenOutput", v)} />
        </label>
      </Section>
    </>
  )
}

/* ---------- wait-review 抽屉（07-SDD §4.17） ---------- */
export function WaitReviewSection({ cfg, set, nodes, edges, selfId, defs }: {
  cfg: NodeCfgLoose; set: (k: string, v: unknown) => void
  nodes: WfNode[]; edges: WfEdge[]; selfId: string; defs: NodeDefinition[]
}) {
  const mode = (cfg.resumeMode as string) || "human"
  return (
    <>
      <Section title="恢复方式">
        <ToggleGroup type="single" size="sm" value={mode} onValueChange={(v) => v && set("resumeMode", v)}>
          <ToggleGroupItem value="human" className="h-6 px-2 text-[10px]">人审表单</ToggleGroupItem>
          <ToggleGroupItem value="interval" className="h-6 px-2 text-[10px]">定时间隔</ToggleGroupItem>
          <ToggleGroupItem value="specific" className="h-6 px-2 text-[10px]">指定时刻</ToggleGroupItem>
        </ToggleGroup>
        {mode === "human" && (
          <div className="pt-2">
            <PromptArea value={cfg.formContent ?? ""} onChange={(v) => set("formContent", v)}
              nodes={nodes} edges={edges} selfId={selfId} defs={defs}
              placeholder="审核提示（markdown，可预览）" minH="min-h-14" />
            <div className="grid grid-cols-3 gap-2 pt-1 text-xs">
              <div><div className="pb-1" style={{ color: C.ink2 }}>超时值</div>
                <Input type="number" className="h-7 text-xs" value={String(cfg.amount ?? 24)}
                  onChange={(e) => set("amount", Number(e.target.value) || 24)} /></div>
              <div><div className="pb-1" style={{ color: C.ink2 }}>单位</div>
                <Select value={(cfg.unit as string) ?? "hour"} onValueChange={(v) => set("unit", v)}>
                  <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="hour">hour</SelectItem><SelectItem value="day">day</SelectItem></SelectContent>
                </Select></div>
              <div><div className="pb-1" style={{ color: C.ink2 }}>超时策略</div>
                <Select value={(cfg.timeoutPolicy as string) ?? "escalate"} onValueChange={(v) => set("timeoutPolicy", v)}>
                  <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto_pass">自动通过</SelectItem>
                    <SelectItem value="auto_reject">自动驳回</SelectItem>
                    <SelectItem value="escalate">升级</SelectItem>
                  </SelectContent>
                </Select></div>
            </div>
          </div>
        )}
        {mode !== "human" && (
          <div className="grid grid-cols-2 gap-2 pt-2 text-xs">
            <div><div className="pb-1" style={{ color: C.ink2 }}>时长值</div>
              <Input type="number" className="h-7 text-xs" value={String(cfg.amount ?? 24)}
                onChange={(e) => set("amount", Number(e.target.value) || 24)} /></div>
            <div><div className="pb-1" style={{ color: C.ink2 }}>单位</div>
              <Select value={(cfg.unit as string) ?? "hour"} onValueChange={(v) => set("unit", v)}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="hour">hour</SelectItem><SelectItem value="day">day</SelectItem></SelectContent>
              </Select></div>
          </div>
        )}
      </Section>
      <Section title="输出与出口" defaultOpen={false}>
        <p className="text-[11px]" style={{ color: C.ink3 }}>
          decision / comment / waitedMs；画布 pass / reject 双出口；运行时卡内橙环“待审核”，恢复 URL tooltip 回显。
        </p>
      </Section>
    </>
  )
}

/* ---------- data-read 抽屉（07-SDD §4.18） ---------- */
export function DataReadSection({ cfg, set }: { cfg: NodeCfgLoose; set: (k: string, v: unknown) => void }) {
  return (
    <>
      <Section title="数据资产">
        <ResourceSelect types="asset" value={(cfg.dataAssetId as string) ?? ""} placeholder="选择 DataAsset"
          onPick={(m) => set("dataAssetId", m.id)} />
      </Section>
      <Section title="窗口与抽样">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div><div className="pb-1" style={{ color: C.ink2 }}>数据窗口</div>
            <Select value={(cfg.window as string) ?? "all"} onValueChange={(v) => set("window", v)}>
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["all", "last_24h", "last_7d", "last_30d"].map((w) => <SelectItem key={w} value={w}>{w}</SelectItem>)}
              </SelectContent>
            </Select></div>
          <div><div className="pb-1" style={{ color: C.ink2 }}>抽样</div>
            <Select value={(cfg.sampling as string) ?? "all"} onValueChange={(v) => set("sampling", v)}>
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["all", "random_n", "stratify"].map((w) => <SelectItem key={w} value={w}>{w}</SelectItem>)}
              </SelectContent>
            </Select></div>
        </div>
        {(cfg.sampling === "random_n" || cfg.sampling === "stratify") && (
          <div className="pt-2 text-xs"><div className="pb-1" style={{ color: C.ink2 }}>样本数 n</div>
            <Input type="number" className="h-7 w-24 text-xs" value={String(cfg.sampleN ?? 10)}
              onChange={(e) => set("sampleN", Number(e.target.value) || 10)} /></div>
        )}
        <p className="pt-1 text-[11px]" style={{ color: C.ink3 }}>访问身份=流程创建者（触发者预留置灰）。</p>
      </Section>
    </>
  )
}

/* ---------- workflow-select 候选多选（07-SDD §4.14） ---------- */
export function CandidatesMulti({ cfg, set }: { cfg: NodeCfgLoose; set: (k: string, v: unknown) => void }) {
  const [list, setList] = useState<{ id: string; name: string }[]>([])
  useEffect(() => { wfApi.list({ pageSize: 100 }).then((r) => setList(r.items as { id: string; name: string }[])).catch(() => undefined) }, [])
  const sel = Array.isArray(cfg.candidates) ? (cfg.candidates as string[]) : []
  return (
    <Section title="候选工作流（多选）">
      <div className="max-h-36 space-y-0.5 overflow-y-auto rounded border p-1" style={{ borderColor: C.cardBorder }}>
        {list.length === 0 && <div className="px-1 py-1 text-[11px]" style={{ color: C.ink3 }}>暂无工作流</div>}
        {list.map((w) => (
          <label key={w.id} className="flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-xs hover:bg-neutral-50" style={{ color: C.ink }}>
            <Checkbox checked={sel.includes(w.id)}
              onCheckedChange={(v) => set("candidates", v ? [...sel, w.id] : sel.filter((id) => id !== w.id))} />
            <span className="truncate">{w.name}</span>
          </label>
        ))}
      </div>
      <p className="pt-1 text-[11px]" style={{ color: C.ink3 }}>未命中任何候选 → else 分支。</p>
    </Section>
  )
}
