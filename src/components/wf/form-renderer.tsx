/** 07-SDD V1.5：Form Renderer——消费 Form Schema 真渲染（预览模式/运行时共用）。
 *  不显示 builder 边框/Key/拖拽柄（开发方案 §54）。 */
import * as React from "react"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import type { FormField } from "@/services/wf-api"

import { DatePicker, FilePick, MultiSelect } from "./field-controls"

export function evalVisibleWhen(f: FormField, values: Record<string, unknown>): boolean {
  const vw = f.condition?.visibleWhen
  if (!vw?.field) return true
  const v = values[vw.field]
  const s = v == null ? "" : String(v)
  switch (vw.operator) {
    case "neq": return s !== String(vw.value ?? "")
    case "contains": return s.includes(String(vw.value ?? ""))
    case "not_contains": return !s.includes(String(vw.value ?? ""))
    case "empty": return s === ""
    case "not_empty": return s !== ""
    case "gt": return Number(s) > Number(vw.value ?? 0)
    case "lt": return Number(s) < Number(vw.value ?? 0)
    default: return s === String(vw.value ?? "")
  }
}

export function validateFieldLocal(f: FormField, v: unknown): string | null {
  const val = f.validation ?? {}
  const empty = v == null || v === "" || (Array.isArray(v) && v.length === 0)
  if (val.required && empty && !f.default) return "必填"
  if (empty) return null
  const s = String(v)
  if (val.minLength != null && s.length < val.minLength) return `至少 ${val.minLength} 字符`
  if (val.maxLength != null && s.length > val.maxLength) return `至多 ${val.maxLength} 字符`
  if (f.dataType === "number") {
    const n = Number(v)
    if (Number.isNaN(n)) return "非数值"
    if (val.min != null && n < val.min) return `小于 ${val.min}`
    if (val.max != null && n > val.max) return `大于 ${val.max}`
  }
  if (val.pattern) { try { if (!new RegExp(val.pattern).test(s)) return "格式不符" } catch { /* ignore */ } }
  return null
}

export function FormRenderer({ fields, values, onChange, showErrors = false }: {
  fields: FormField[]
  values: Record<string, unknown>
  onChange?: (key: string, v: unknown) => void
  showErrors?: boolean
}) {
  const set = (k: string, v: unknown) => onChange?.(k, v)
  return (
    <div className="grid grid-cols-12 content-start gap-3">
      {fields.map((f) => {
        if (!evalVisibleWhen(f, values)) return null
        const err = showErrors ? validateFieldLocal(f, values[f.key]) : null
        const opts = f.options ?? []
        let control: React.ReactNode
        switch (f.type) {
          case "textarea":
            control = <Textarea className="min-h-16 text-xs" placeholder={f.placeholder || f.label}
              value={(values[f.key] as string) ?? f.default ?? ""} onChange={(e) => set(f.key, e.target.value)} />
            break
          case "number":
            control = <Input type="number" className="h-8 text-xs" placeholder={f.placeholder || "0"}
              value={(values[f.key] as string) ?? f.default ?? ""} onChange={(e) => set(f.key, e.target.value)} />
            break
          case "switch":
            control = <Switch checked={values[f.key] === true || values[f.key] === "true"} onCheckedChange={(v) => set(f.key, v)} />
            break
          case "date":
            control = <DatePicker value={(values[f.key] as string) ?? ""} onChange={(v) => set(f.key, v)} />
            break
          case "datetime":
            control = <DatePicker withTime value={(values[f.key] as string) ?? ""} onChange={(v) => set(f.key, v)} />
            break
          case "file":
            control = <FilePick value={(values[f.key] as string) ?? ""} onChange={(v) => set(f.key, v)} />
            break
          case "radio":
            control = (
              <RadioGroup value={(values[f.key] as string) ?? f.default ?? undefined} onValueChange={(v) => set(f.key, v)} className="flex gap-3">
                {opts.map((o) => (
                  <label key={o.value} className="flex items-center gap-1.5 text-xs">
                    <RadioGroupItem value={o.value} /> {o.label}
                  </label>
                ))}
              </RadioGroup>
            )
            break
          case "select":
            control = (
              <Select value={(values[f.key] as string) ?? f.default ?? undefined} onValueChange={(v) => set(f.key, v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={f.placeholder || "请选择"} /></SelectTrigger>
                <SelectContent>{opts.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            )
            break
          case "multi-select":
          case "checkbox-group":
            control = <MultiSelect options={opts} values={(values[f.key] as string[]) ?? []} onChange={(v) => set(f.key, v)} />
            break
          case "heading":
            control = <div className="text-sm font-semibold">{f.label}</div>
            break
          case "description":
            control = <p className="text-xs text-neutral-500">{f.description || f.label}</p>
            break
          case "divider":
            control = <div className="h-px w-full bg-neutral-200" />
            break
          case "section":
            control = <div className="border-b pb-1 text-xs font-medium text-neutral-600">{f.label}</div>
            break
          default:
            control = <Input className="h-8 text-xs" placeholder={f.placeholder || f.label}
              value={(values[f.key] as string) ?? f.default ?? ""} onChange={(e) => set(f.key, e.target.value)} />
        }
        return (
          <div key={f.id ?? f.key} style={{ gridColumn: `span ${f.layout?.span ?? 12} / span ${f.layout?.span ?? 12}` }} className="space-y-1.5">
            {f.dataType !== "none" && (
              <Label className="text-xs">
                {f.label}{f.validation?.required && <span className="text-red-500"> *</span>}
              </Label>
            )}
            {control}
            {err && <p className="text-[10px] text-red-500">{err}</p>}
          </div>
        )
      })}
    </div>
  )
}
