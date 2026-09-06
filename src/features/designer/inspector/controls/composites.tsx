/** 复合 x-control：一个控件管理一组配置键（schema 目录以 absorbs 声明吸收）。
 *  开始表单 / 工具绑定+参数 / 检索配置 / 工作流执行绑定 / 版本策略 / 输入映射 / Query 策略 / 决策分类。 */
import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  C, PromptArea, ResourceSelect, VarButton, WorkflowPicker,
} from "@/components/wf/controls"
import { formsApi, wfApi, type FormDef } from "@/services/wf-api"
import { resApi } from "@/services/resource-api"
import { toast } from "../../toast"
import type { NodeCfgLoose } from "../../designer-types"
import type { FieldControl } from "../inspector-types"

/* ---- 开始节点：引用集中表单（07-SDD form；字段=全局固定输入变量，不允许追加） ---- */

const LEGACY_SIX_CLIENT = [
  { key: "userQuery", type: "textarea", dataType: "string", label: "用户问题", required: true },
  { key: "chatHistory", type: "textarea", dataType: "string", label: "历史对话" },
  { key: "userId", type: "text", dataType: "string", label: "用户 ID" },
  { key: "conversationId", type: "text", dataType: "string", label: "会话 ID" },
  { key: "chatId", type: "text", dataType: "string", label: "对话 ID" },
  { key: "reference", type: "text", dataType: "string", label: "引用内容" },
]

export const StartFormControl: FieldControl = ({ ctx }) => {
  const [forms, setForms] = useState<FormDef[]>([])
  const [cur, setCur] = useState<FormDef | null>(null)
  const navigate = useNavigate()
  useEffect(() => { formsApi.list().then((r) => setForms(r.items)).catch(() => undefined) }, [])
  useEffect(() => {
    if (!ctx.cfg.formId) { setCur(null); return }
    formsApi.get(ctx.cfg.formId).then(setCur).catch(() => setCur(null))
  }, [ctx.cfg.formId])
  return (
    <div>
      <Select value={(ctx.cfg.formId as string) || undefined} onValueChange={(v) => ctx.set("formId", v)}>
        <SelectTrigger className="h-7 w-full text-xs"><SelectValue placeholder="选择表单（字段=全局输入变量）" /></SelectTrigger>
        <SelectContent>{forms.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent>
      </Select>
      {cur && (
        <div className="flex flex-wrap gap-1 pt-2">
          {(cur.fields ?? []).map((f) => (
            <span key={f.key} className="rounded px-1.5 py-0.5 text-[10px]" style={{ background: C.chipBg, color: C.chipInk }}>
              {f.key}{f.validation?.required ? " *" : ""} <span style={{ color: C.ink3 }}>{f.dataType}</span>
            </span>
          ))}
        </div>
      )}
      {cur && <p className="pt-1 text-[11px]" style={{ color: C.ink3 }}>表单字段即本流程固定输入变量，不允许追加；需变体请“创建副本并编辑”。</p>}
      {!ctx.cfg.formId && (
        <Button variant="outline" size="sm" className="mt-2" onClick={async () => {
          try {
            const f = await formsApi.create({ name: `对话六件套-${new Date().getMinutes()}${new Date().getSeconds()}`, description: "存量六件套转表单", fields: LEGACY_SIX_CLIENT })
            ctx.set("formId", f.id)
            toast.success("已转为表单")
          } catch { toast.error("转表单失败") }
        }}>转为表单（ legacy 六件套）</Button>
      )}
      <div className="pt-2">
        {/* MTC-006R：新产生的链接一律走 canonical /resources/* */}
        <button className="text-[11px] underline" style={{ color: C.primary }} onClick={() => navigate("/resources/forms")}>管理表单</button>
      </div>
    </div>
  )
}

/* ---- 插件工具：绑定 Tool + 自动取最新版本 ---- */

export const ToolBindingControl: FieldControl = ({ ctx }) => (
  <ResourceSelect types="tool" value={(ctx.cfg.toolId as string) ?? ""} placeholder="选择 Tool（仅 Enabled）"
    onPick={async (m) => {
      let versionId = ""
      try {
        const vs = await resApi.toolVersions(m.id)
        versionId = vs[0]?.id ?? ""
      } catch { /* 忽略 */ }
      ctx.onChange({ ...ctx.node, config: { ...ctx.cfg, toolId: m.id, toolVersionId: versionId } })
    }} />
)

/** 工具参数双模式（07-SDD §4.9）：参数表来自工具版本 spec.params。 */
export const ToolParamsControl: FieldControl = ({ ctx }) => {
  const [params, setParams] = useState<NodeCfgLoose>({})
  useEffect(() => {
    if (!ctx.cfg.toolId) { setParams({}); return }
    resApi.toolVersions(ctx.cfg.toolId).then((vs) => {
      const spec = (vs[0]?.spec ?? {}) as NodeCfgLoose
      setParams(((spec.params ?? {}) as NodeCfgLoose).properties ?? {})
    }).catch(() => setParams({}))
  }, [ctx.cfg.toolId])
  const vals = (ctx.cfg.toolParams ?? {}) as Record<string, { mode?: string; value?: string }>
  const keys = Object.keys(params)
  if (keys.length === 0) return null
  return (
    <div className="space-y-1">
      {keys.map((k) => {
        const cur = vals[k] ?? { mode: "constant", value: "" }
        const setVal = (patch: { mode?: string; value?: string }) =>
          ctx.set("toolParams", { ...vals, [k]: { ...cur, ...patch } })
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
                <VarButton value={cur.value ?? ""} nodes={ctx.nodes} edges={ctx.edges} selfId={ctx.node.id} defs={ctx.defs}
                  onPick={(v) => setVal({ value: v })} />
              ) : (
                <Input className="h-6 text-xs" value={cur.value ?? ""} onChange={(e) => setVal({ value: e.target.value })} />
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ---- 知识检索：topK / 检索模式 / 阈值 / rerank ---- */

export const RetrievalConfigControl: FieldControl = ({ ctx }) => {
  const mode = (ctx.cfg.retrievalMode as string) ?? "multiWay"
  return (
    <div>
      <div className="flex items-center gap-2 text-xs" style={{ color: C.ink3 }}>
        topK
        <Input type="number" className="h-7 w-20 text-xs"
          value={ctx.cfg.topK ?? 5} onChange={(e) => ctx.set("topK", Number(e.target.value))} />
      </div>
      <div className="flex items-center gap-2 pt-2 text-xs" style={{ color: C.ink2 }}>
        检索模式
        <ToggleGroup type="single" size="sm" value={mode}
          onValueChange={(v) => v && ctx.set("retrievalMode", v)}>
          <ToggleGroupItem value="oneWay" className="h-6 px-2 text-[10px]">单路</ToggleGroupItem>
          <ToggleGroupItem value="multiWay" className="h-6 px-2 text-[10px]">多路</ToggleGroupItem>
        </ToggleGroup>
      </div>
      {mode === "multiWay" && (
        <div className="grid grid-cols-2 gap-2 pt-2 text-xs">
          <div><div className="pb-1" style={{ color: C.ink2 }}>分数阈值</div>
            <Input type="number" className="h-7 text-xs" value={String(ctx.cfg.scoreThreshold ?? "")}
              placeholder="0.5" onChange={(e) => ctx.set("scoreThreshold", Number(e.target.value))} /></div>
          <div className="flex items-end justify-between pb-1">
            <span style={{ color: C.ink2 }}>rerank</span>
            <Switch checked={!!ctx.cfg.rerankEnable} onCheckedChange={(v) => ctx.set("rerankEnable", v)} />
          </div>
        </div>
      )}
    </div>
  )
}

/* ---- 工作流执行：固定（选工作流）/ 动态（输入绑定 workflowCode） ---- */

export const WorkflowExecBindingControl: FieldControl = ({ ctx }) => {
  const mode = (ctx.cfg.mode as string) ?? "fixed"
  return (
    <div>
      <ToggleGroup type="single" size="sm" value={mode} onValueChange={(v) => v && ctx.set("mode", v)}>
        <ToggleGroupItem value="fixed" className="h-6 px-2 text-[10px]">固定</ToggleGroupItem>
        <ToggleGroupItem value="dynamic" className="h-6 px-2 text-[10px]">动态</ToggleGroupItem>
      </ToggleGroup>
      {mode === "fixed" ? (
        <div className="pt-2"><WorkflowPicker value={(ctx.cfg.workflowCode as string) ?? ""} onPick={(v) => ctx.set("workflowCode", v)} /></div>
      ) : (
        <div className="pt-2">
          <VarButton value={((ctx.node.inputs ?? []).find((b) => b.name === "workflowCode")?.source as { value?: string } | undefined)?.value ?? ""}
            nodes={ctx.nodes} edges={ctx.edges} selfId={ctx.node.id} defs={ctx.defs}
            onPick={(v) => ctx.onChange({ ...ctx.node, inputs: [...(ctx.node.inputs ?? []).filter((b) => b.name !== "workflowCode"), { name: "workflowCode", type: "string", source: { kind: "fixed", value: v } }] })} />
          <p className="pt-1 text-[11px]" style={{ color: C.ink3 }}>workflowCode 来自输入绑定（接路由输出）。</p>
        </div>
      )}
    </div>
  )
}

/* ---- 工作流（固定）：版本策略 ---- */

export const VersionPolicyControl: FieldControl = ({ ctx }) => (
  <div>
    <ToggleGroup type="single" size="sm" value={(ctx.cfg.versionPolicy as string) ?? "latest"} onValueChange={(v) => v && ctx.set("versionPolicy", v)}>
      <ToggleGroupItem value="latest" className="h-6 px-2 text-[10px]">最新已发布</ToggleGroupItem>
      <ToggleGroupItem value="pinned" className="h-6 px-2 text-[10px]">钉版本</ToggleGroupItem>
    </ToggleGroup>
    {(ctx.cfg.versionPolicy as string) === "pinned" && (
      <div className="pt-2"><Input className="h-7 text-xs" placeholder="pinnedVersionId" value={ctx.cfg.pinnedVersionId ?? ""} onChange={(e) => ctx.set("pinnedVersionId", e.target.value)} /></div>
    )}
  </div>
)

/* ---- 工作流（固定）：输入变量映射（07-SDD §4.13；行=子流程开始 form 字段，fallback 六件套） ---- */

const STD_VARS = ["userQuery", "chatHistory", "userId", "conversationId", "chatId", "reference"]

export const InputMappingControl: FieldControl = ({ ctx }) => {
  const [childFields, setChildFields] = useState<string[] | null>(null)
  useEffect(() => {
    if (!ctx.cfg.workflowId) { setChildFields(null); return }
    wfApi.get(ctx.cfg.workflowId).then(async (d) => {
      const start = ((d.definition as { graph?: { nodes?: { type: string; config?: { formId?: string } }[] } })?.graph?.nodes ?? [])
        .find((n) => n.type === "input")
      const fid = start?.config?.formId
      if (!fid) { setChildFields(null); return }
      const f = await formsApi.get(fid)
      setChildFields((f.fields ?? []).map((x) => x.key ?? (x as unknown as { name?: string }).name ?? ""))
    }).catch(() => setChildFields(null))
  }, [ctx.cfg.workflowId])
  const mapping = (ctx.cfg.inputMapping ?? {}) as Record<string, string>
  const base = childFields ?? STD_VARS
  const rows = [...base, ...Object.keys(mapping).filter((k) => !base.includes(k))]
  const setRow = (k: string, v: string) => ctx.set("inputMapping", { ...mapping, [k]: v })
  return (
    <div>
      <div className="space-y-1">
        {rows.map((k) => (
          <div key={k} className="flex items-center gap-2 text-xs">
            <span className="w-28 truncate" style={{ color: C.ink }}>{k}</span>
            <div className="flex-1">
              <VarButton value={mapping[k] ?? ""} nodes={ctx.nodes} edges={ctx.edges} selfId={ctx.node.id} defs={ctx.defs}
                onPick={(v) => setRow(k, v)} />
            </div>
            {!STD_VARS.includes(k) && (
              <button onClick={() => { const n = { ...mapping }; delete n[k]; ctx.set("inputMapping", n) }}>
                <X className="size-3 text-muted-foreground" />
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
    </div>
  )
}

/* ---- Query 改写：策略 + 自定义模板 ---- */

export const QueryStrategyControl: FieldControl = ({ ctx }) => (
  <div>
    <div className="flex items-center gap-2 pb-1 text-xs" style={{ color: C.ink2 }}>
      <span>策略</span>
      <Select value={(ctx.cfg.strategy as string) ?? "default"} onValueChange={(v) => ctx.set("strategy", v)}>
        <SelectTrigger className="h-7 flex-1 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="default">默认（透传原问题）</SelectItem>
          <SelectItem value="custom">自定义（LLM 改写）</SelectItem>
        </SelectContent>
      </Select>
    </div>
    {ctx.cfg.strategy === "custom" && (
      <PromptArea value={typeof ctx.cfg.template === "string" ? ctx.cfg.template : ""} onChange={(v) => ctx.set("template", v)}
        nodes={ctx.nodes} edges={ctx.edges} selfId={ctx.node.id} defs={ctx.defs}
        placeholder="改写提示词（真 LLM 生效；无模型配置时回落透传）" />
    )}
    <p className="pt-1 text-[11px]" style={{ color: C.ink3 }}>输出 queryList（数组）。输入绑定在下方输入区（query / chatHistory）。</p>
  </div>
)

/* ---- 决策分类：分类项列表（出口 cN，画布拉线即分支） ---- */

export const DecisionClassesControl: FieldControl = ({ fieldKey, ctx }) => {
  const list = ((ctx.cfg[fieldKey] as { title?: string; description?: string }[] | undefined) ?? [])
  const write = (next: object[]) => ctx.set(fieldKey, next)
  return (
    <div>
      {list.map((br, i) => (
        <div key={i} className="mb-1 space-y-1 rounded border p-1.5" style={{ borderColor: C.cardBorder }}>
          <div className="flex items-center gap-1">
            <Input className="h-6 flex-1 text-xs" placeholder={`分类 ${i + 1} 名称`} value={br.title ?? ""}
              onChange={(e) => { const bs = [...list]; bs[i] = { ...bs[i], title: e.target.value }; write(bs) }} />
            <button onClick={() => write(list.filter((_, j) => j !== i))}><X className="size-3 text-muted-foreground" /></button>
          </div>
          <Input className="h-6 text-xs" placeholder="分类说明（供路由判断）" value={br.description ?? ""}
            onChange={(e) => { const bs = [...list]; bs[i] = { ...bs[i], description: e.target.value }; write(bs) }} />
          <div className="text-[10px]" style={{ color: C.ink3 }}>分支出口：c{i}（在画布上从该节点拉线即分支）</div>
        </div>
      ))}
      <button className="flex items-center gap-1 pt-1 text-xs" style={{ color: C.primary }}
        onClick={() => write([...list, { title: "", description: "" }])}>
        <Plus className="size-3" /> 添加分类
      </button>
    </div>
  )
}
