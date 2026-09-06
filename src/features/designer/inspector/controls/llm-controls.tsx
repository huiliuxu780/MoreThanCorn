/** LLM 族 x-control：模型选择 / 提示词（含 AI 润色）/ 输出（格式+JSON Schema）/ 批处理 / 路由模型。
 *  07-SDD §4.3：润色=真后端 wfApi.polish，支持撤销；R1 修复语义保留（无假开关/假按钮）。 */
import { useState } from "react"
import { CheckCircle2, ChevronDown, Zap } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { C, PromptArea, TypeChip, VarButton } from "@/components/wf/controls"
import { OutputSchemaEditor } from "@/components/wf/sections"
import { wfApi } from "@/services/wf-api"
import { toast } from "../../toast"
import { useModelCatalog } from "../data-hooks"
import type { FieldControl } from "../inspector-types"

/** AI 润色行（替换/撤销）。 */
function PolishRow({ text, onApply }: { text: string; onApply: (v: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [prev, setPrev] = useState<string | null>(null)
  return (
    <div className="flex items-center gap-2 pt-1">
      <button className="rounded border px-2 py-0.5 text-[11px] disabled:opacity-40" style={{ borderColor: C.cardBorder, color: C.primary }}
        disabled={busy || !text}
        onClick={async () => {
          setBusy(true); setPrev(text)
          try { onApply((await wfApi.polish(text)).text) } catch { toast.error("润色失败") } finally { setBusy(false) }
        }}>
        {busy ? "润色中…" : "AI 润色"}
      </button>
      {prev !== null && (
        <button className="text-[11px]" style={{ color: C.ink2 }} onClick={() => { onApply(prev); setPrev(null) }}>撤销</button>
      )}
    </div>
  )
}

export const ModelPickerControl: FieldControl = ({ fieldKey, ctx }) => {
  const models = useModelCatalog()
  const ref = (ctx.cfg[fieldKey] ?? {}) as { modelId?: string }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="flex w-full items-center gap-2 rounded-md border bg-popover px-2 py-1.5 text-left text-xs" style={{ borderColor: C.cardBorder, color: C.ink }}>
          <span className="flex size-4 items-center justify-center rounded" style={{ background: "var(--status-running)" }}><Zap className="size-2.5 text-background" /></span>
          <span className="flex-1 truncate">{ref.modelId || "请选择模型"}</span>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-1" align="start">
        {models.map((m) => (
          <button key={m.id} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent" style={{ color: C.ink }}
            onClick={() => ctx.set(fieldKey, { ...ref, modelId: m.id })}>
            <span className="flex size-4 items-center justify-center rounded" style={{ background: "var(--status-running)" }}><Zap className="size-2.5 text-background" /></span>
            <span className="flex-1 truncate text-left">{m.id}</span>
            {m.caps.map((c) => <span key={c} className="rounded px-1 text-[10px]" style={{ background: C.chipBg, color: C.chipInk }}>{c}</span>)}
            {ref.modelId === m.id && <CheckCircle2 className="size-3.5" style={{ color: C.primary }} />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

export const LlmPromptControl: FieldControl = ({ fieldKey, schema, ctx }) => (
  <div>
    <PromptArea value={typeof ctx.cfg[fieldKey] === "string" ? ctx.cfg[fieldKey] : ""}
      onChange={(v) => ctx.set(fieldKey, v)}
      nodes={ctx.nodes} edges={ctx.edges} selfId={ctx.node.id} defs={ctx.defs}
      placeholder={(schema["x-params"]?.placeholder as string) ?? "请输入提示词"}
      minH={(schema["x-params"]?.minH as string) ?? "min-h-24"} />
    <PolishRow text={(ctx.cfg[fieldKey] as string) ?? ""} onApply={(v) => ctx.set(fieldKey, v)} />
  </div>
)

export const LlmOutputControl: FieldControl = ({ ctx }) => {
  const fmt = String(ctx.cfg.outputFormat ?? "Markdown")
  return (
    <div>
      <div className="flex items-center gap-2 text-xs"><span style={{ color: C.ink2 }}>输出格式 :</span>
        <Select value={fmt} onValueChange={(v) => ctx.set("outputFormat", v)}>
          <SelectTrigger className="h-6 w-28 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="Markdown">Markdown</SelectItem><SelectItem value="JSON">JSON</SelectItem></SelectContent>
        </Select>
      </div>
      {fmt === "JSON" && (
        <OutputSchemaEditor value={ctx.cfg.outputSchema} onChange={(v) => ctx.set("outputSchema", v)} />
      )}
      <p className="py-1 text-[11px]" style={{ color: C.ink3 }}>大模型将以{fmt}形式输出最终答案</p>
      <div className="space-y-1 py-1 text-xs">
        {[["output", "大模型的全部输出"], ["thought", "大模型的思考过程"], ["answer", "大模型的回复答案"]].map(([k, dsc]) => (
          <div key={k} className="grid grid-cols-[1fr_auto_1.4fr] gap-1"><span style={{ color: C.ink }}>{k}</span><TypeChip t="Str" /><span style={{ color: C.ink3 }}>{dsc}</span></div>
        ))}
      </div>
    </div>
  )
}

export const LlmBatchControl: FieldControl = ({ ctx }) => (
  <div>
    <ToggleGroup type="single" size="sm" value={ctx.cfg.batchMode === "batch" ? "batch" : "single"}
      onValueChange={(v) => v && ctx.set("batchMode", v)}>
      <ToggleGroupItem value="single" className="h-6 px-2 text-[10px]">单次</ToggleGroupItem>
      <ToggleGroupItem value="batch" className="h-6 px-2 text-[10px]">批处理</ToggleGroupItem>
    </ToggleGroup>
    {ctx.cfg.batchMode === "batch" && (
      <div className="pt-2">
        <VarButton value={(ctx.cfg.batchListRef as string) ?? ""} nodes={ctx.nodes} edges={ctx.edges}
          selfId={ctx.node.id} defs={ctx.defs} onPick={(v) => ctx.set("batchListRef", v)} />
        <div className="grid grid-cols-2 gap-2 pt-2 text-xs">
          <div><div className="pb-1" style={{ color: C.ink2 }}>最大批次数</div>
            <Input type="number" className="h-7 text-xs" value={String(ctx.cfg.maxBatches ?? 100)}
              onChange={(e) => ctx.set("maxBatches", Number(e.target.value) || 100)} /></div>
          <div><div className="pb-1" style={{ color: C.ink2 }}>并发数</div>
            <Input type="number" className="h-7 text-xs" value={String(ctx.cfg.batchParallel ?? 10)}
              onChange={(e) => ctx.set("batchParallel", Number(e.target.value) || 10)} /></div>
        </div>
        <p className="pt-1 text-[11px]" style={{ color: C.ink3 }}>输出 outputList:Array（批量列表变量限 Array）。</p>
      </div>
    )}
  </div>
)

export const RoutingModelControl: FieldControl = ({ ctx }) => {
  const models = useModelCatalog()
  return (
    <Select value={(ctx.cfg.routingModel as string) ?? "qwen-plus"} onValueChange={(v) => ctx.set("routingModel", v)}>
      <SelectTrigger className="h-7 w-full text-xs"><SelectValue /></SelectTrigger>
      <SelectContent>{models.map((m) => <SelectItem key={m.id} value={m.id}>{m.id}</SelectItem>)}</SelectContent>
    </Select>
  )
}
