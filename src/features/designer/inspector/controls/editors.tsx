/** 编辑器类 x-control：提示词 / 表达式 / 代码（CodeMirror 主题随 Light/Dark 切换）。 */
import CodeMirror from "@uiw/react-codemirror"
import { python } from "@codemirror/lang-python"
import { Plus } from "lucide-react"
import { Input } from "@/components/ui/input"
import { C, PromptArea } from "@/components/wf/controls"
import { toast } from "../../toast"
import { codeTheme, useUiTheme } from "../../theme/workflow-theme"
import type { FieldControl } from "../inspector-types"

export const PromptEditorControl: FieldControl = ({ fieldKey, label, schema, ctx }) => (
  <div>
    <div className="pb-1 text-xs" style={{ color: C.ink2 }}>{label}</div>
    <PromptArea value={typeof ctx.cfg[fieldKey] === "string" ? ctx.cfg[fieldKey] : ""}
      onChange={(v) => ctx.set(fieldKey, v)}
      nodes={ctx.nodes} edges={ctx.edges} selfId={ctx.node.id} defs={ctx.defs}
      placeholder={(schema["x-params"]?.placeholder as string) ?? "请输入"}
      minH={(schema["x-params"]?.minH as string) ?? "min-h-20"} />
  </div>
)

export const ExpressionEditorControl: FieldControl = (props) => (
  <PromptEditorControl {...props} />
)

export const CodeEditorControl: FieldControl = ({ fieldKey, label, ctx }) => {
  const ui = useUiTheme()
  return (
    <div>
      <div className="pb-1 text-xs" style={{ color: C.ink2 }}>{label}</div>
      <div className="overflow-hidden rounded-md border" style={{ borderColor: C.cardBorder }}>
        <CodeMirror value={typeof ctx.cfg[fieldKey] === "string" ? ctx.cfg[fieldKey] : ""}
          onChange={(v) => ctx.set(fieldKey, v)} theme={codeTheme(ui)} height="160px"
          extensions={[python()]}
          basicSetup={{ lineNumbers: true, foldGutter: true, autocompletion: true, bracketMatching: true, highlightActiveLine: true }}
          style={{ fontSize: 12 }} />
      </div>
    </div>
  )
}

/** code-write 专项：Python 沙箱编辑器 + 「同步函数签名」（解析 args.params.get 与 return 键）。 */
export const PythonCodeControl: FieldControl = ({ fieldKey, ctx }) => {
  const ui = useUiTheme()
  return (
    <div>
      <div className="overflow-hidden rounded-md border" style={{ borderColor: C.cardBorder }}>
        <CodeMirror
          value={typeof ctx.cfg[fieldKey] === "string" ? ctx.cfg[fieldKey] : ""}
          onChange={(v) => ctx.set(fieldKey, v)}
          theme={codeTheme(ui)}
          height="180px"
          extensions={[python()]}
          placeholder={'def main(args):\n    # args.params 为输入绑定值字典\n    return {"output": args.params.get("input", "")}'}
          basicSetup={{ lineNumbers: true, foldGutter: true, autocompletion: true, bracketMatching: true, highlightActiveLine: true }}
          style={{ fontSize: 12 }} />
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button className="rounded border px-2 py-0.5 text-[11px]" style={{ borderColor: C.cardBorder, color: C.primary }}
          onClick={() => {
            const code = String(ctx.cfg[fieldKey] ?? "")
            const ins = [...code.matchAll(/args\.params\.get\(\s*["']([A-Za-z0-9_]+)["']/g)].map((m) => m[1])
            const ret = code.match(/return\s*\{([^}]*)\}/)
            const outs = ret ? [...ret[1].matchAll(/["']?([A-Za-z0-9_]+)["']?\s*:/g)].map((m) => m[1]) : []
            ctx.onChange({
              ...ctx.node,
              inputs: ins.map((nme) => ({ name: nme, type: "string", source: { kind: "fixed", value: "" } })),
              config: { ...ctx.cfg, outputs: Object.fromEntries(outs.map((o) => [o, { type: "string" }])) },
            })
            toast.success("已同步函数签名")
          }}>⇄ 同步函数签名</button>
        <span className="text-[11px]" style={{ color: C.ink3 }}>解析 args.params.get 与 return 键</span>
      </div>
    </div>
  )
}

/** 简单输入绑定行（固定值直填；query-rewrite / code-write 用）。
 *  x-params: namePrefix（新增名前缀）| sequentialNames（按序取名）| placeholder */
export const InputsSimpleControl: FieldControl = ({ schema, ctx }) => {
  const params = schema["x-params"] ?? {}
  const placeholder = (params.placeholder as string) ?? "固定值"
  const sequential = params.sequentialNames as string[] | undefined
  const prefix = (params.namePrefix as string) ?? "in"
  const nextName = () => {
    const cur = (ctx.node.inputs ?? []).length
    if (sequential) return sequential[Math.min(cur, sequential.length - 1)]
    return `${prefix}${cur + 1}`
  }
  return (
    <div>
      {(ctx.node.inputs ?? []).map((b) => (
        <div key={b.name} className="flex items-center gap-2 pb-1 text-xs">
          <span className="w-24 truncate" style={{ color: C.ink }}>{b.name}</span>
          <Input className="h-6 flex-1 text-xs"
            placeholder={placeholder}
            value={b.source.kind === "fixed" ? String((b.source as { value?: unknown }).value ?? "") : ""}
            onChange={(e) => ctx.onChange({ ...ctx.node, inputs: (ctx.node.inputs ?? []).map((x) => (x.name === b.name ? { ...x, source: { kind: "fixed", value: e.target.value } } : x)) })} />
        </div>
      ))}
      <button className="flex items-center gap-1 pt-1 text-xs" style={{ color: C.primary }}
        onClick={() => ctx.onChange({ ...ctx.node, inputs: [...(ctx.node.inputs ?? []), { name: nextName(), type: "string", source: { kind: "fixed", value: "" } }] })}>
        <Plus className="size-3" /> 添加输入
      </button>
    </div>
  )
}
