/** 原语字段控件：schema type/enum 的默认渲染（无 x-control 时的派生落点）。
 *  与专项控件同走 FieldControlRegistry 注册，保证“注册表即全集”可测试。 */
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { C } from "@/components/wf/controls"
import type { FieldControl } from "../inspector-types"

function Label({ text }: { text: string }) {
  return <div className="pb-1 text-xs" style={{ color: C.ink2 }}>{text}</div>
}

export const TextControl: FieldControl = ({ fieldKey, label, schema, ctx }) => (
  <div>
    <Label text={label} />
    <Input className="h-7 text-xs" placeholder={(schema["x-params"]?.placeholder as string) ?? ""}
      value={String(ctx.cfg[fieldKey] ?? "")}
      onChange={(e) => ctx.set(fieldKey, e.target.value)} />
  </div>
)

export const TextareaControl: FieldControl = ({ fieldKey, label, schema, ctx }) => (
  <div>
    <Label text={label} />
    <Textarea className={`min-h-20 text-xs ${schema["x-control"] === undefined && fieldKey === "code" ? "font-mono" : ""}`}
      value={typeof ctx.cfg[fieldKey] === "string" ? ctx.cfg[fieldKey] : JSON.stringify(ctx.cfg[fieldKey] ?? "", null, 2)}
      onChange={(e) => ctx.set(fieldKey, e.target.value)} />
  </div>
)

export const NumberControl: FieldControl = ({ fieldKey, label, schema, ctx }) => (
  <div>
    <Label text={label} />
    <Input className="h-7 text-xs" type="number"
      value={String(ctx.cfg[fieldKey] ?? schema.default ?? "")}
      onChange={(e) => ctx.set(fieldKey, Number(e.target.value))} />
  </div>
)

export const BooleanControl: FieldControl = ({ fieldKey, label, schema, ctx }) => (
  <label className="flex items-center justify-between text-xs" style={{ color: C.ink2 }}>
    <span>{label}</span>
    <Switch checked={Boolean(ctx.cfg[fieldKey] ?? schema.default ?? false)}
      onCheckedChange={(v) => ctx.set(fieldKey, v)} />
  </label>
)

export const EnumSelectControl: FieldControl = ({ fieldKey, label, schema, ctx }) => {
  const enums = schema.enum ?? []
  const labels = schema["x-enum-labels"] ?? {}
  const value = (ctx.cfg[fieldKey] ?? schema.default) as string | undefined
  return (
    <div>
      <Label text={label} />
      <Select value={value || undefined} onValueChange={(v) => ctx.set(fieldKey, v)}>
        <SelectTrigger className="h-7 w-full text-xs"><SelectValue placeholder="请选择" /></SelectTrigger>
        <SelectContent>
          {enums.map((v) => <SelectItem key={v} value={v}>{labels[v] ?? v}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )
}

export const ArrayLinesControl: FieldControl = ({ fieldKey, label, ctx }) => {
  const arr = Array.isArray(ctx.cfg[fieldKey]) ? (ctx.cfg[fieldKey] as unknown[]) : []
  return (
    <div>
      <Label text={`${label}（每行一项）`} />
      <Textarea className="min-h-14 text-xs" value={arr.join("\n")}
        onChange={(e) => ctx.set(fieldKey, e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))} />
    </div>
  )
}

export const JsonEditorControl: FieldControl = ({ fieldKey, label, ctx }) => (
  <div>
    <Label text={label} />
    <Textarea className="min-h-16 font-mono text-xs"
      value={typeof ctx.cfg[fieldKey] === "string" ? ctx.cfg[fieldKey] : JSON.stringify(ctx.cfg[fieldKey] ?? {}, null, 2)}
      onChange={(e) => {
        const raw = e.target.value
        try { ctx.set(fieldKey, JSON.parse(raw)) } catch { /* 编辑中间态不写回，避免打断输入 */ }
      }} />
  </div>
)

export const HintTextControl: FieldControl = ({ schema }) => (
  <p className="text-[11px] leading-4" style={{ color: C.ink3 }}>{schema["x-params"]?.text as string}</p>
)
