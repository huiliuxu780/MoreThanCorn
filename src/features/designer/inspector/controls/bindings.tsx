/** 输入/输出绑定类 x-control：直接操作 node.inputs（固定值 / 上游引用），
 *  变量级联在控件内部就地完成（MTC-007R：移除旧 varTarget 跨控件状态机）。 */
import { Inbox, Plus, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { C, TypeChip, VarCascader } from "@/components/wf/controls"
import type { FieldControl } from "../inspector-types"

const refOf = (source: unknown) => source as { kind: string; value?: unknown; nodeId?: string; path?: string }

/** LLM 风格输入绑定表：变量名/类型/变量值（点击值列唤起级联，可选字面量或引用）。 */
export const InputsBindingControl: FieldControl = ({ ctx }) => (
  <div>
    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2 pb-1 text-xs" style={{ color: C.ink3 }}>
      <span>变量名</span><span>类型</span><span className="w-24">变量值</span>
    </div>
    {(ctx.node.inputs ?? []).length === 0 && (
      <div className="flex flex-col items-center gap-1 py-6" style={{ color: C.ink3 }}>
        <Inbox className="size-8" />
        <span className="text-[11px]">No data</span>
      </div>
    )}
    {(ctx.node.inputs ?? []).map((b) => (
      <div key={b.name} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 py-1 text-xs">
        <span style={{ color: C.ink }}>{b.name}</span>
        <TypeChip t={b.type === "string" ? "Str" : b.type} />
        <Popover>
          <PopoverTrigger asChild>
            <button className="w-24 truncate rounded border px-1 py-0.5 text-left" style={{ borderColor: C.cardBorder, color: C.ink2 }}>
              {b.source.kind === "fixed" ? String(refOf(b.source).value || "请输入或引用变量值") : "引用"}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start">
            <VarCascader nodes={ctx.nodes} edges={ctx.edges} selfId={ctx.node.id} defs={ctx.defs}
              onPick={(v) => ctx.onChange({
                ...ctx.node,
                inputs: (ctx.node.inputs ?? []).map((x) => (x.name === b.name ? { ...x, source: { kind: "fixed", value: v } } : x)),
              })} />
          </PopoverContent>
        </Popover>
      </div>
    ))}
    <button className="flex items-center gap-1 pt-1 text-xs" style={{ color: C.primary }}
      onClick={() => ctx.onChange({ ...ctx.node, inputs: [...(ctx.node.inputs ?? []), { name: `var${(ctx.node.inputs ?? []).length + 1}`, type: "string", source: { kind: "fixed", value: "" } }] })}>
      <Plus className="size-3" /> 添加
    </button>
  </div>
)

/** 结束节点输出表：变量值支持固定值与上游引用（{{node.outputs.x}} 解析为 upstream 源）。 */
export const EndOutputsControl: FieldControl = ({ ctx }) => (
  <div>
    <div className="grid grid-cols-[1fr_auto_1.4fr] items-center gap-2 pb-1 text-xs" style={{ color: C.ink3 }}><span>变量名</span><span>类型</span><span>变量值（可引用上游）</span></div>
    {(ctx.node.inputs ?? []).map((b) => (
      <div key={b.name} className="grid grid-cols-[1fr_auto_1.4fr] items-center gap-2 py-1 text-xs">
        <span style={{ color: C.ink }}>{b.name}</span><TypeChip t="Str" />
        {b.source.kind === "upstream" ? (
          <div className="flex items-center gap-1">
            <span className="flex-1 truncate rounded border px-1 py-0.5" style={{ borderColor: C.cardBorder, color: C.primary }}>
              {`{{${refOf(b.source).nodeId}.outputs.${(refOf(b.source).path ?? "").replace(/^outputs\./, "")}}}`}
            </span>
            <button title="改为固定值" onClick={() => ctx.onChange({ ...ctx.node, inputs: (ctx.node.inputs ?? []).map((x) => (x.name === b.name ? { ...x, source: { kind: "fixed", value: "" } } : x)) })}>
              <X className="size-3 text-muted-foreground" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <Input className="h-6 flex-1 text-xs" placeholder="固定值" value={String(refOf(b.source).value ?? "")}
              onChange={(e) => ctx.onChange({ ...ctx.node, inputs: (ctx.node.inputs ?? []).map((x) => (x.name === b.name ? { ...x, source: { kind: "fixed", value: e.target.value } } : x)) })} />
            <Popover>
              <PopoverTrigger asChild>
                <button className="shrink-0 rounded border px-1 py-0.5 text-[10px]" style={{ borderColor: C.cardBorder, color: C.primary }} title="引用变量">引用</button>
              </PopoverTrigger>
              <PopoverContent className="w-72" align="start">
                <VarCascader nodes={ctx.nodes} edges={ctx.edges} selfId={ctx.node.id} defs={ctx.defs}
                  onPick={(v) => {
                    const m = /^\{\{(.+?)\.outputs\.(.+?)\}\}$/.exec(v)
                    if (m) ctx.onChange({ ...ctx.node, inputs: (ctx.node.inputs ?? []).map((x) => (x.name === b.name ? { ...x, source: { kind: "upstream", nodeId: m[1], path: `outputs.${m[2]}` } } : x)) })
                  }} />
              </PopoverContent>
            </Popover>
          </div>
        )}
      </div>
    ))}
    <button className="flex items-center gap-1 pt-1 text-xs" style={{ color: C.primary }}
      onClick={() => ctx.onChange({ ...ctx.node, inputs: [...(ctx.node.inputs ?? []), { name: `out${(ctx.node.inputs ?? []).length + 1}`, type: "string", source: { kind: "fixed", value: "" } }] })}>
      <Plus className="size-3" /> 添加
    </button>
  </div>
)

/** 记忆变量写入值：输入绑定行（变量名=记忆键），值可引用上游。 */
export const MemoryWriteValuesControl: FieldControl = ({ ctx }) => (
  <div>
    {(ctx.node.inputs ?? []).map((b) => (
      <div key={b.name} className="flex items-center gap-2 pb-1 text-xs">
        <span style={{ color: C.ink }}>{b.name}</span>
        <Input className="h-6 flex-1 text-xs" placeholder="请输入或引用变量值"
          value={b.source.kind === "fixed" ? String(refOf(b.source).value ?? "") : `{{引用}}`}
          onChange={(e) => ctx.onChange({ ...ctx.node, inputs: (ctx.node.inputs ?? []).map((x) => (x.name === b.name ? { ...x, source: { kind: "fixed", value: e.target.value } } : x)) })} />
        <Popover>
          <PopoverTrigger asChild>
            <button className="shrink-0 rounded border px-1 text-[10px]" style={{ borderColor: C.cardBorder, color: C.primary }} title="引用变量">⚙</button>
          </PopoverTrigger>
          <PopoverContent align="start">
            <VarCascader nodes={ctx.nodes} edges={ctx.edges} selfId={ctx.node.id} defs={ctx.defs} onPick={(v) => {
              const m = /^\{\{(.+?)\.outputs\.(.+?)\}\}$/.exec(v)
              if (m) ctx.onChange({ ...ctx.node, inputs: (ctx.node.inputs ?? []).map((x) => (x.name === b.name ? { ...x, source: { kind: "upstream", nodeId: m[1], path: `outputs.${m[2]}` } } : x)) })
            }} />
          </PopoverContent>
        </Popover>
      </div>
    ))}
    <button className="flex items-center gap-1 pt-1 text-xs" style={{ color: C.primary }}
      onClick={() => ctx.onChange({ ...ctx.node, inputs: [...(ctx.node.inputs ?? []), { name: `mem${(ctx.node.inputs ?? []).length + 1}`, type: "string", source: { kind: "fixed", value: "" } }] })}>
      <Plus className="size-3" /> 添加写入键
    </button>
  </div>
)
