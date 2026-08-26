/** 07-SDD（08-26 V1.5+v3）：集中表单——列表页 + 独立新建/编辑页（三栏构建器 v3）。
 *  v3：预览模式(FormRenderer 真渲染) + palette 图标 + 属性面板 Accordion 重设计 + 类型感知（dataType 不可改/兼容组切换）。 */
import {
  AlignLeft, ArrowLeft, ArrowUp, ArrowDown, Ban, Calendar as CalendarIcon, CalendarClock, CheckSquare,
  CircleDot, Copy, Eye, FileText, Folder, Hash, Heading1, ListChecks, Minus, Paperclip,
  Pencil, Plus, Redo2, Save, Send, ToggleLeft, Trash2, Type, Undo2,
} from "lucide-react"
import * as React from "react"
import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { ROLES } from "@/services/rbac"
import { toast } from "sonner"

import { EmptyState } from "@/components/app/list-state"
import { PageContainer, PageHeader } from "@/components/app/page"
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { FormRenderer } from "@/components/wf/form-renderer"
import { DatePicker, FilePick, MultiSelect } from "@/components/wf/field-controls"
import { formsApi, type FormDef, type FormField } from "@/services/wf-api"

const PALETTE: { group: string; items: { type: string; label: string; dataType: string; icon: React.ComponentType<{ className?: string }> }[] }[] = [
  { group: "Basic", items: [
    { type: "text", label: "单行文本", dataType: "string", icon: Type },
    { type: "textarea", label: "多行文本", dataType: "string", icon: AlignLeft },
    { type: "number", label: "数字", dataType: "number", icon: Hash },
    { type: "switch", label: "开关", dataType: "boolean", icon: ToggleLeft }] },
  { group: "Choice", items: [
    { type: "radio", label: "单选", dataType: "string", icon: CircleDot },
    { type: "select", label: "下拉单选", dataType: "string", icon: Type },
    { type: "multi-select", label: "下拉多选", dataType: "array", icon: CheckSquare },
    { type: "checkbox-group", label: "多选组", dataType: "array", icon: ListChecks }] },
  { group: "Date", items: [
    { type: "date", label: "日期", dataType: "datetime", icon: CalendarIcon },
    { type: "datetime", label: "日期时间", dataType: "datetime", icon: CalendarClock }] },
  { group: "File", items: [{ type: "file", label: "附件", dataType: "file", icon: Paperclip }] },
  { group: "Layout", items: [
    { type: "heading", label: "标题", dataType: "none", icon: Heading1 },
    { type: "description", label: "描述文本", dataType: "none", icon: FileText },
    { type: "divider", label: "分割线", dataType: "none", icon: Minus },
    { type: "section", label: "分组", dataType: "none", icon: Folder }] },
]
const ALL_ITEMS = PALETTE.flatMap((g) => g.items)
const itemOf = (t: string) => ALL_ITEMS.find((i) => i.type === t)
/* 开发方案 §39 兼容矩阵：仅同组可切换，dataType 随 type 自动派生、不可手改 */
const COMPAT: Record<string, string[]> = {
  text: ["text", "textarea"], textarea: ["text", "textarea"],
  radio: ["radio", "select"], select: ["radio", "select"],
  "multi-select": ["multi-select", "checkbox-group"], "checkbox-group": ["multi-select", "checkbox-group"],
  date: ["date", "datetime"], datetime: ["date", "datetime"],
  number: ["number"], switch: ["switch"], file: ["file"],
  heading: ["heading", "description", "divider", "section"], description: ["heading", "description", "divider", "section"],
  divider: ["heading", "description", "divider", "section"], section: ["heading", "description", "divider", "section"],
}
const SPANS = [3, 6, 9, 12]
const BIND_TYPES = ["manual", "workflow_output", "data_source", "constant", "expression"]
const COND_OPS = ["eq", "neq", "contains", "not_contains", "empty", "not_empty", "gt", "lt"]
const CHOICE_TYPES = ["radio", "select", "multi-select", "checkbox-group"]
/* 08-27 V2：Property Registry 最小化——按 dataType 驱动 Validation 面板 */
const VALIDATION_REGISTRY: Record<string, string[]> = {
  string: ["required", "minLength", "maxLength", "pattern"],
  number: ["required", "min", "max"],
  boolean: ["required"],
  array: ["required", "minSelections", "maxSelections"],
  object: ["required"],
  datetime: ["required"],
  file: ["required"],
  none: [],
}
const VAL_LABEL: Record<string, string> = {
  required: "必填", minLength: "最小长度", maxLength: "最大长度", pattern: "正则",
  min: "最小值", max: "最大值", minSelections: "最少选", maxSelections: "最多选",
}

/* 设计态字段卡：标准 shadcn 控件渲染（v3：日期/附件/多选不再裸 input） */
function DesignControl({ f }: { f: FormField }) {
  const opts = f.options ?? []
  switch (f.type) {
    case "textarea": return <Textarea className="min-h-14 text-xs" placeholder={f.placeholder || f.label} />
    case "number": return <Input type="number" readOnly={f.readOnly} className={`h-8 text-xs ${f.readOnly ? "opacity-60" : ""}`} placeholder={f.placeholder || "0"} />
    case "switch": return <div className="flex h-8 items-center"><Checkbox checked={f.default === "true"} /></div>
    case "date": return <DatePicker value="" onChange={() => undefined} />
    case "datetime": return <DatePicker withTime value="" onChange={() => undefined} />
    case "file": return <FilePick value="" onChange={() => undefined} />
    case "radio": return (
      <div className="flex gap-3">
        {opts.map((o) => (
          <label key={o.value} className={`flex items-center gap-1.5 text-xs ${o.disabled ? "opacity-50" : ""}`}><Checkbox disabled={o.disabled} /> {o.label}</label>
        ))}
      </div>
    )
    case "select": return (
      <Select>
        <SelectTrigger className="h-8 w-full text-xs"><SelectValue placeholder={f.placeholder || "请选择"} /></SelectTrigger>
        <SelectContent>{opts.map((o) => <SelectItem key={o.value} value={o.value} disabled={o.disabled}>{o.label}</SelectItem>)}</SelectContent>
      </Select>
    )
    case "multi-select":
    case "checkbox-group": return <MultiSelect options={opts} values={[]} onChange={() => undefined} />
    case "heading": return <div className="text-sm font-semibold">{f.label}</div>
    case "description": return <p className="text-xs text-neutral-500">{f.description || f.label}</p>
    case "divider": return <div className="h-px w-full bg-neutral-200" />
    case "section": return <div className="border-b pb-1 text-xs font-medium text-neutral-600">{f.label}</div>
    default: return <Input readOnly={f.readOnly} className={`h-8 text-xs ${f.readOnly ? "opacity-60" : ""}`} placeholder={f.placeholder || f.label} />
  }
}

function FormBuilder({ fields, onChange }: { fields: FormField[]; onChange: (f: FormField[]) => void }) {
  const [sel, setSel] = useState<string | null>(fields[0]?.id ?? null)
  const [mode, setMode] = useState<"design" | "preview">("design")
  const [pv, setPv] = useState<Record<string, unknown>>({})
  const [past, setPast] = useState<FormField[][]>([])
  const [future, setFuture] = useState<FormField[][]>([])
  const commit = (next: FormField[]) => { setPast((p) => [...p.slice(-30), fields]); setFuture([]); onChange(next) }
  const undo = () => setPast((p) => {
    if (!p.length) return p
    const prev = p[p.length - 1]
    setFuture((f) => [fields, ...f]); onChange(prev)
    return p.slice(0, -1)
  })
  const redo = () => setFuture((f) => {
    if (!f.length) return f
    const [next, ...rest] = f
    setPast((p) => [...p, fields]); onChange(next)
    return rest
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return
      e.preventDefault()
      if (e.shiftKey) redo(); else undo()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })
  const patch = (id: string, p: Partial<FormField>) =>
    commit(fields.map((f) => (f.id === id ? { ...f, ...p } : f)))
  const add = (type: string, label: string, dataType: string) => {
    const n = fields.length + 1
    const f: FormField = {
      id: `local_${Date.now()}_${n}`, key: `field_${n}`, type, dataType, label,
      options: CHOICE_TYPES.includes(type) ? [{ label: "选项1", value: "opt_1" }, { label: "选项2", value: "opt_2" }] : [],
      validation: {}, layout: { span: 12 }, binding: { type: "manual" }, condition: {},
    }
    commit([...fields, f])
    setSel(f.id!)
  }
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= fields.length) return
    const next = [...fields]
    ;[next[i], next[j]] = [next[j], next[i]]
    commit(next)
  }
  const cur = fields.find((f) => f.id === sel) ?? null
  const val = cur?.validation ?? {}
  const setVal = (p: Record<string, unknown>) => cur && patch(cur.id!, { validation: { ...val, ...p } })
  const isLayout = cur?.dataType === "none"

  if (mode === "preview") {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setMode("design")}><Pencil className="size-3.5" /> 返回设计</Button>
          <span className="text-[10px] text-neutral-400">预览=用户真实看到的表单（无 Key/边框/拖拽柄）</span>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <FormRenderer fields={fields} values={pv} onChange={(k, v) => setPv((s) => ({ ...s, [k]: v }))} showErrors />
        </div>
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={!past.length} onClick={undo}><Undo2 className="size-3.5" /> 撤销</Button>
        <Button variant="outline" size="sm" disabled={!future.length} onClick={redo}><Redo2 className="size-3.5" /> 重做</Button>
        <span className="text-[10px] text-neutral-400">⌘Z / ⌘⇧Z</span>
        <span className="flex-1" />
        <Button size="sm" onClick={() => setMode("preview")}><Eye className="size-3.5" /> 预览</Button>
      </div>
      <div className="grid grid-cols-[190px_1fr_300px] gap-3">
        {/* 左：字段库（图标+分组） */}
        <div className="h-fit space-y-2 rounded-md border bg-white p-2">
          {PALETTE.map((g) => (
            <div key={g.group}>
              <div className="pb-1 text-xs text-muted-foreground">{g.group}</div>
              {g.items.map((it) => (
                <button key={it.type} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-neutral-50"
                  onClick={() => add(it.type, it.label, it.dataType)}>
                  <it.icon className="size-3.5 text-neutral-500" /> {it.label}
                </button>
              ))}
            </div>
          ))}
        </div>
        {/* 中：设计画布 */}
        <div className="grid min-h-[420px] grid-cols-12 content-start gap-3 rounded-md border bg-neutral-50/50 p-3">
          {fields.length === 0 && <div className="col-span-12 py-10 text-center text-xs text-neutral-400">从左侧添加字段，实时预览表单</div>}
          {fields.map((f, i) => (
            <div key={f.id} style={{ gridColumn: `span ${f.layout?.span ?? 12} / span ${f.layout?.span ?? 12}` }}
              className={`relative rounded-md border bg-white p-2 ${sel === f.id ? "ring-1 ring-blue-500" : ""}`}
              onClick={() => setSel(f.id!)}>
              {f.dataType !== "none" && (
                <div className="flex items-center gap-1 pb-1 text-xs">
                  {(() => { const I = itemOf(f.type)?.icon ?? Type; return <I className="size-3 text-neutral-400" /> })()}
                  <span className="flex-1 font-medium">{f.label}</span>
                  <button title="上移" onClick={(e) => { e.stopPropagation(); move(i, -1) }}><ArrowUp className="size-3 text-neutral-400" /></button>
                  <button title="下移" onClick={(e) => { e.stopPropagation(); move(i, 1) }}><ArrowDown className="size-3 text-neutral-400" /></button>
                  <button title="删除" onClick={(e) => { e.stopPropagation(); commit(fields.filter((x) => x.id !== f.id)); setSel(null) }}>
                    <Trash2 className="size-3 text-neutral-400 hover:text-red-500" />
                  </button>
                </div>
              )}
              <div className={f.display?.disabled ? "pointer-events-none opacity-50" : ""}><DesignControl f={f} /></div>
              <div className="pt-1 font-mono text-[10px] text-neutral-400">{f.key}</div>
            </div>
          ))}
        </div>
        {/* 右：属性面板（Accordion 分组，类型感知） */}
        <div className="h-fit rounded-md border bg-white p-2">
          <div className="pb-1 text-xs text-muted-foreground">字段属性</div>
          {!cur && <div className="py-6 text-center text-xs text-neutral-400">预览区点选字段</div>}
          {cur && (
            <Accordion type="multiple" defaultValue={["basic", "data", "validation"]}>
              <AccordionItem value="basic">
                <AccordionTrigger className="py-2 text-xs">Basic</AccordionTrigger>
                <AccordionContent className="space-y-1.5">
                  <Input className="h-7 text-xs" value={cur.label} placeholder="字段名称" onChange={(e) => patch(cur.id!, { label: e.target.value })} />
                  <Input className="h-7 font-mono text-xs" value={cur.key} title="Field Key 保存后不可改" onChange={(e) => patch(cur.id!, { key: e.target.value })} />
                  <Input className="h-7 text-xs" value={cur.placeholder ?? ""} placeholder="Placeholder" onChange={(e) => patch(cur.id!, { placeholder: e.target.value })} />
                  <Input className="h-7 text-xs" value={cur.description ?? ""} placeholder="描述" onChange={(e) => patch(cur.id!, { description: e.target.value })} />
                </AccordionContent>
              </AccordionItem>
              {!isLayout && (
              <AccordionItem value="data">
                <AccordionTrigger className="py-2 text-xs">Data</AccordionTrigger>
                <AccordionContent className="space-y-1.5">
                  <div className="text-[10px] text-neutral-500">字段类型（数据类型随类型自动派生）</div>
                  <Select value={cur.type} onValueChange={(v) => {
                    const dt = itemOf(v)?.dataType ?? cur.dataType
                    patch(cur.id!, { type: v, dataType: dt })
                  }}>
                    <SelectTrigger className="h-7 w-full text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(COMPAT[cur.type] ?? [cur.type]).map((t) => (
                        <SelectItem key={t} value={t}>{itemOf(t)?.label ?? t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="rounded bg-neutral-50 px-2 py-1 font-mono text-[10px] text-neutral-500">dataType = {cur.dataType}</div>
                  {cur.type === "switch" ? (
                    <Select value={cur.default || "false"} onValueChange={(v) => patch(cur.id!, { default: v })}>
                      <SelectTrigger className="h-7 w-full text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="true">true</SelectItem><SelectItem value="false">false</SelectItem></SelectContent>
                    </Select>
                  ) : (
                    <>
                      <Input className="h-7 text-xs" value={cur.default ?? ""} placeholder="默认值" onChange={(e) => patch(cur.id!, { default: e.target.value })} />
                      <label className="mt-1 flex items-center justify-between text-xs"><span>只读（运行时不可改）</span>
                        <Checkbox checked={!!cur.readOnly} onCheckedChange={(v) => patch(cur.id!, { readOnly: !!v })} /></label>
                      <div className="pt-1 text-[10px] text-neutral-500">可见角色（不选=全部可见，HAR visibleRole）</div>
                      <div className="flex flex-wrap gap-2">
                        {ROLES.map((r) => (
                          <label key={r.value} className="flex items-center gap-1 text-[10px]">
                            <Checkbox checked={(cur.visibleRoles ?? []).includes(r.value)}
                              onCheckedChange={(v) => patch(cur.id!, { visibleRoles: v ? [...(cur.visibleRoles ?? []), r.value] : (cur.visibleRoles ?? []).filter((x) => x !== r.value) })} />
                            {r.label}
                          </label>
                        ))}
                      </div>
                    </>
                  )}
                  {CHOICE_TYPES.includes(cur.type) && (
                    /* 开发方案 §24：选项右侧直接行编辑（label+value），不用弹窗/textarea */
                    <div className="space-y-1">
                      <div className="grid grid-cols-2 gap-1 text-[10px] text-neutral-500"><span>label</span><span>value</span></div>
                      {(cur.options ?? []).map((o, oi) => (
                        <div key={oi} className="flex items-center gap-1">
                          <Input className="h-7 flex-1 text-xs" placeholder="合格" value={o.label}
                            onChange={(e) => patch(cur.id!, { options: (cur.options ?? []).map((x, xi) => (xi === oi ? { ...x, label: e.target.value } : x)) })} />
                          <Input className="h-7 flex-1 font-mono text-xs" placeholder="pass" value={o.value}
                            onChange={(e) => patch(cur.id!, { options: (cur.options ?? []).map((x, xi) => (xi === oi ? { ...x, value: e.target.value } : x)) })} />
                          <button title="删除选项" onClick={() => patch(cur.id!, { options: (cur.options ?? []).filter((_, xi) => xi !== oi) })}>
                            <Trash2 className="size-3 text-neutral-400 hover:text-red-500" />
                          </button>
                        </div>
                      ))}
                      <Button variant="outline" size="sm" className="h-6 text-[10px]"
                        onClick={() => patch(cur.id!, {
                          options: [...(cur.options ?? []), { label: `选项${(cur.options ?? []).length + 1}`, value: `opt_${(cur.options ?? []).length + 1}` }],
                        })}>
                        <Plus className="size-3" /> 添加选项
                      </Button>
                      <div className="flex items-center gap-1 pt-1 text-[10px] text-neutral-500">
                        选项来源
                        <Select value={cur.optionsSource?.type ?? "custom"} onValueChange={(v) => patch(cur.id!, { optionsSource: { type: v as "custom" | "field", field: cur.optionsSource?.field } })}>
                          <SelectTrigger className="h-6 w-24 text-[10px]"><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value="custom">自定义</SelectItem><SelectItem value="field">联动字段</SelectItem></SelectContent>
                        </Select>
                        {cur.optionsSource?.type === "field" && (
                          <Select value={cur.optionsSource?.field ?? ""} onValueChange={(v) => patch(cur.id!, { optionsSource: { type: "field", field: v } })}>
                            <SelectTrigger className="h-6 w-28 text-[10px]"><SelectValue placeholder="字段" /></SelectTrigger>
                            <SelectContent>{fields.filter((x) => x.id !== cur.id).map((x) => <SelectItem key={x.key} value={x.key}>{x.key}</SelectItem>)}</SelectContent>
                          </Select>
                        )}
                      </div>
                    </div>
                  )}
                </AccordionContent>
              </AccordionItem>
              )}
              {!isLayout && (
              <AccordionItem value="validation">
                <AccordionTrigger className="py-2 text-xs">Validation</AccordionTrigger>
                <AccordionContent className="space-y-1.5">
                  {(VALIDATION_REGISTRY[cur.dataType] ?? []).map((vk) =>
                    vk === "required" ? (
                      <label key={vk} className="flex items-center justify-between text-xs"><span>必填</span>
                        <Checkbox checked={!!val.required} onCheckedChange={(v) => setVal({ required: !!v })} /></label>
                    ) : (
                      <div key={vk} className="grid grid-cols-2 items-center gap-1">
                        <span className="text-[10px] text-neutral-500">{VAL_LABEL[vk]}</span>
                        <Input className="h-7 text-xs" type={vk === "pattern" ? "text" : "number"} placeholder={VAL_LABEL[vk]}
                          value={((val as Record<string, unknown>)[vk] as string | number | undefined) ?? ""}
                          onChange={(e) => setVal({ [vk]: e.target.value === "" ? undefined : (vk === "pattern" ? e.target.value : Number(e.target.value)) } as Record<string, unknown>)} />
                      </div>
                    )
                  )}
                  {["text", "textarea", "number"].includes(cur.type) && (
                    <label className="flex items-center justify-between text-xs"><span>唯一约束（HAR uniqueKey）</span>
                      <Checkbox checked={!!val.unique} onCheckedChange={(v) => setVal({ unique: !!v })} /></label>
                  )}
                </AccordionContent>
              </AccordionItem>
              )}
              <AccordionItem value="display">
                <AccordionTrigger className="py-2 text-xs">Display</AccordionTrigger>
                <AccordionContent className="space-y-1.5">
                  <label className="flex items-center justify-between text-xs"><span>禁用（HAR disabled）</span>
                    <Checkbox checked={!!cur.display?.disabled} onCheckedChange={(v) => patch(cur.id!, { display: { ...cur.display, disabled: !!v } })} /></label>
                  <Select value={String(cur.layout?.span ?? 12)} onValueChange={(v) => patch(cur.id!, { layout: { span: Number(v) } })}>
                    <SelectTrigger className="h-7 w-full text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>{SPANS.map((s) => <SelectItem key={s} value={String(s)}>{s} / 12 列</SelectItem>)}</SelectContent>
                  </Select>
                </AccordionContent>
              </AccordionItem>
              {!isLayout && (
              <AccordionItem value="binding">
                <AccordionTrigger className="py-2 text-xs">Binding</AccordionTrigger>
                <AccordionContent className="space-y-1.5">
                  <Select value={cur.binding?.type ?? "manual"} onValueChange={(v) => patch(cur.id!, { binding: { type: v } })}>
                    <SelectTrigger className="h-7 w-full text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>{BIND_TYPES.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
                  </Select>
                  {(cur.binding?.type === "workflow_output" || cur.binding?.type === "constant") && (
                    <Input className="h-7 font-mono text-xs" placeholder={cur.binding?.type === "workflow_output" ? "result.path" : "常量值"}
                      value={cur.binding?.path ?? ""} onChange={(e) => patch(cur.id!, { binding: { type: cur.binding?.type ?? "manual", path: e.target.value } })} />
                  )}
                  {cur.binding?.type === "data_source" && (
                    <div className="grid grid-cols-2 gap-1">
                      <Input className="h-7 text-xs" placeholder="sourceId" value={cur.binding?.sourceId ?? ""} onChange={(e) => patch(cur.id!, { binding: { type: cur.binding?.type ?? "manual", sourceId: e.target.value } })} />
                      <Input className="h-7 text-xs" placeholder="sourceField" value={cur.binding?.sourceField ?? ""} onChange={(e) => patch(cur.id!, { binding: { type: cur.binding?.type ?? "manual", sourceField: e.target.value } })} />
                    </div>
                  )}
                  {cur.binding?.type === "expression" && (
                    <Input className="h-7 font-mono text-xs" placeholder="score > 80 ? 'pass' : 'fail'"
                      value={cur.binding?.expression ?? ""} onChange={(e) => patch(cur.id!, { binding: { type: cur.binding?.type ?? "manual", expression: e.target.value } })} />
                  )}
                </AccordionContent>
              </AccordionItem>
              )}
              <AccordionItem value="condition">
                <AccordionTrigger className="py-2 text-xs">Condition</AccordionTrigger>
                <AccordionContent className="space-y-1.5">
                  <div className="grid grid-cols-[1fr_90px] gap-1">
                    <Select value={cur.condition?.visibleWhen?.field ?? ""} onValueChange={(v) => patch(cur.id!, { condition: { visibleWhen: { field: v, operator: cur.condition?.visibleWhen?.operator ?? "eq", value: cur.condition?.visibleWhen?.value } } })}>
                      <SelectTrigger className="h-7 w-full text-xs"><SelectValue placeholder="Visible When" /></SelectTrigger>
                      <SelectContent>{fields.filter((x) => x.id !== cur.id && x.dataType !== "none").map((x) => <SelectItem key={x.key} value={x.key}>{x.key}</SelectItem>)}</SelectContent>
                    </Select>
                    <Select value={cur.condition?.visibleWhen?.operator ?? "eq"} onValueChange={(v) => patch(cur.id!, { condition: { visibleWhen: { field: cur.condition?.visibleWhen?.field ?? "", operator: v, value: cur.condition?.visibleWhen?.value } } })}>
                      <SelectTrigger className="h-7 w-full text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>{COND_OPS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <Input className="h-7 text-xs" placeholder="值" value={String(cur.condition?.visibleWhen?.value ?? "")}
                    onChange={(e) => patch(cur.id!, { condition: { visibleWhen: { field: cur.condition?.visibleWhen?.field ?? "", operator: cur.condition?.visibleWhen?.operator ?? "eq", value: e.target.value } } })} />
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          )}
        </div>
      </div>
    </div>
  )
}

export function WfFormEditorPage() {
  const { formId } = useParams()
  const navigate = useNavigate()
  const [name, setName] = useState("")
  const [key, setKey] = useState("")
  const [desc, setDesc] = useState("")
  const [fields, setFields] = useState<FormField[]>([])
  const [loaded, setLoaded] = useState(!formId)

  useEffect(() => {
    if (!formId) return
    formsApi.get(formId)
      .then((d) => { setName(d.name); setKey(d.key ?? ""); setDesc(d.description ?? ""); setFields((d.fields ?? []).map((x) => ({ ...x }))) })
      .catch(() => toast.error("表单不存在"))
      .finally(() => setLoaded(true))
  }, [formId])

  const save = async () => {
    if (!name.trim()) { toast.error("名称必填"); return }
    try {
      if (formId) {
        await formsApi.update(formId, { name: name.trim(), description: desc, fields })
        toast.success("已保存")
      } else {
        const r = await formsApi.create({ name: name.trim(), key: key.trim() || undefined, description: desc, fields })
        toast.success("已创建")
        navigate(`/config/forms/${r.id}`, { replace: true })
      }
    } catch (e) { toast.error((e as Error).message) }
  }

  if (!loaded) return <PageContainer><div className="py-10 text-center text-xs text-muted-foreground">加载中…</div></PageContainer>
  return (
    <PageContainer wide className="space-y-3">
      <PageHeader
        title={formId ? `编辑表单 · ${name}` : "新建表单"}
        description="Form=业务 Schema：输入契约+结果结构；字段 Key 稳定、创建后不可改"
        actions={
          <span className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate("/config/forms")}><ArrowLeft className="size-4" /> 返回</Button>
            <Button size="sm" onClick={save}><Save className="size-4" /> 保存</Button>
          </span>
        }
      />
      <div className="grid grid-cols-3 gap-2">
        <Input value={name} placeholder="表单名称 *" onChange={(e) => setName(e.target.value)} />
        <Input value={key} placeholder="标识 Key（^[a-z][a-z0-9_]*$，不可改）" disabled={!!formId} onChange={(e) => setKey(e.target.value)} />
        <Input value={desc} placeholder="描述" onChange={(e) => setDesc(e.target.value)} />
      </div>
      <FormBuilder fields={fields} onChange={setFields} />
    </PageContainer>
  )
}

export default function WfFormsPage() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<FormDef[]>([])
  const [loading, setLoading] = useState(true)

  const load = () => {
    setLoading(true)
    formsApi.list().then((r) => setRows(r.items)).catch(() => setRows([])).finally(() => setLoading(false))
  }
  useEffect(load, [])

  const badge = (s?: string) =>
    s === "published" ? <span className="rounded bg-green-50 px-1.5 py-0.5 text-[10px] text-green-600">已发布</span>
      : s === "disabled" ? <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-600">已停用</span>
        : <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500">草稿</span>

  return (
    <PageContainer wide className="space-y-3">
      <PageHeader
        title="表单"
        description="工作流输入契约+业务结果结构：字段 Key 稳定、版本化、Binding 一级能力"
        actions={<Button size="sm" onClick={() => navigate("/config/forms/new")}><Plus className="size-4" /> 新建表单</Button>}
      />
      {loading ? (
        <div className="py-10 text-center text-xs text-muted-foreground">加载中…</div>
      ) : rows.length === 0 ? (
        <EmptyState title="暂无表单" action={<Button size="sm" onClick={() => navigate("/config/forms/new")}><Plus className="size-4" /> 新建表单</Button>} />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((f) => (
            <div key={f.id} className="rounded-lg border bg-white p-3 shadow-sm">
              <div className="flex items-center gap-2">
                <button className="flex-1 truncate text-left text-sm font-medium hover:underline" onClick={() => navigate(`/config/forms/${f.id}`)}>{f.name}</button>
                {badge(f.status)}
                {/* 08-26 用户反馈：行操作统一为同尺寸同色图标按钮+tooltip */}
                <span className="flex items-center">
                  <button title="编辑" className="rounded p-1 hover:bg-neutral-100" onClick={() => navigate(`/config/forms/${f.id}`)}>
                    <Pencil className="size-3.5 text-neutral-500" />
                  </button>
                  <button title="发布" className="rounded p-1 hover:bg-neutral-100" onClick={async () => {
                    try { const r = await formsApi.publish(f.id); toast.success(`已发布 v${r.versionNo}`); load() }
                    catch (e) { toast.error((e as Error).message) }
                  }}>
                    <Send className="size-3.5 text-neutral-500" />
                  </button>
                  <button title="停用" className="rounded p-1 hover:bg-neutral-100" onClick={async () => { await formsApi.disable(f.id); load() }}>
                    <Ban className="size-3.5 text-neutral-500" />
                  </button>
                  <button title="复制" className="rounded p-1 hover:bg-neutral-100" onClick={async () => { await formsApi.duplicate(f.id); load() }}>
                    <Copy className="size-3.5 text-neutral-500" />
                  </button>
                  <button title="删除" className="rounded p-1 hover:bg-neutral-100" onClick={async () => {
                    try { await formsApi.remove(f.id); toast.success("已删除"); load() }
                    catch (e) { toast.error((e as Error).message) }
                  }}>
                    <Trash2 className="size-3.5 text-neutral-500 hover:text-red-500" />
                  </button>
                </span>
              </div>
              <div className="pt-1 font-mono text-[10px] text-neutral-400">{f.key}</div>
              <div className="pt-1 text-xs text-muted-foreground">{f.description || "—"}</div>
              <div className="flex flex-wrap gap-1 pt-2">
                {(f.fields ?? []).slice(0, 6).map((fd) => (
                  <span key={fd.key} className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-600">
                    {fd.key}{fd.validation?.required ? " *" : ""}
                  </span>
                ))}
                {(f.fieldCount ?? 0) > 6 && <span className="text-[10px] text-neutral-400">+{(f.fieldCount ?? 0) - 6}</span>}
              </div>
              <div className="pt-2 text-[10px] text-neutral-400">
                {f.fieldCount ?? 0} 字段 · 被 {f.usage ?? 0} 个工作流引用 · v{f.revision ?? 1}
              </div>
            </div>
          ))}
        </div>
      )}
    </PageContainer>
  )
}
