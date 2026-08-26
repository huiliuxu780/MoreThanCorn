/** 07-SDD（08-26 决策）：集中表单管理页——工作流输入契约实体 CRUD。 */
import { Copy, Pencil, Plus, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import { EmptyState } from "@/components/app/list-state"
import { PageContainer, PageHeader } from "@/components/app/page"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { formsApi, type FormDef, type FormField } from "@/services/wf-api"

const TYPES = ["string", "number", "boolean", "array", "object", "datetime"]
const CONTROLS = ["text", "textarea", "number", "select", "switch", "date"]

function FieldEditor({ fields, onChange }: { fields: FormField[]; onChange: (f: FormField[]) => void }) {
  const patch = (i: number, p: Partial<FormField>) =>
    onChange(fields.map((f, j) => (j === i ? { ...f, ...p } : f)))
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[1fr_90px_90px_60px] gap-2 text-xs text-muted-foreground">
        <span>字段名</span><span>类型</span><span>控件</span><span>必填</span>
      </div>
      {fields.map((f, i) => (
        <div key={i} className="space-y-1 rounded-md border p-2">
          <div className="grid grid-cols-[1fr_90px_90px_60px_auto] items-center gap-2">
            <Input className="h-7 text-xs" value={f.name} placeholder="name"
              onChange={(e) => patch(i, { name: e.target.value })} />
            <Select value={f.type} onValueChange={(v) => patch(i, { type: v })}>
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={f.control ?? "text"} onValueChange={(v) => patch(i, { control: v })}>
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{CONTROLS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
            <Checkbox checked={!!f.required} onCheckedChange={(v) => patch(i, { required: !!v })} />
            <button onClick={() => onChange(fields.filter((_, j) => j !== i))}>
              <Trash2 className="size-3.5 text-neutral-400 hover:text-red-500" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input className="h-7 text-xs" value={f.default ?? ""} placeholder="默认值"
              onChange={(e) => patch(i, { default: e.target.value })} />
            <Input className="h-7 text-xs" value={f.description ?? ""} placeholder="描述"
              onChange={(e) => patch(i, { description: e.target.value })} />
          </div>
          {f.control === "select" && (
            <Input className="h-7 text-xs" value={(f.options ?? []).join(",")}
              placeholder="选项（逗号分隔）"
              onChange={(e) => patch(i, { options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
          )}
        </div>
      ))}
      <Button variant="outline" size="sm"
        onClick={() => onChange([...fields, { name: `field_${fields.length + 1}`, type: "string", control: "text", required: false, default: "", description: "" }])}>
        <Plus className="size-3.5" /> 添加字段
      </Button>
    </div>
  )
}

export default function WfFormsPage() {
  const [rows, setRows] = useState<FormDef[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<FormDef | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [name, setName] = useState("")
  const [desc, setDesc] = useState("")
  const [fields, setFields] = useState<FormField[]>([])

  const load = () => {
    setLoading(true)
    formsApi.list().then((r) => setRows(r.items)).catch(() => setRows([])).finally(() => setLoading(false))
  }
  useEffect(load, [])

  const openNew = () => {
    setEditing(null); setIsNew(true); setName(""); setDesc(""); setFields([])
  }
  const openEdit = async (f: FormDef) => {
    const d = await formsApi.get(f.id)
    setEditing(d); setIsNew(false); setName(d.name); setDesc(d.description ?? "")
    setFields((d.fields ?? []).map((x) => ({ ...x })))
  }
  const save = async () => {
    if (!name.trim()) { toast.error("名称必填"); return }
    try {
      if (isNew) await formsApi.create({ name: name.trim(), description: desc, fields })
      else await formsApi.update(editing!.id, { name: name.trim(), description: desc, fields })
      toast.success("已保存")
      setEditing(null); setIsNew(false)
      load()
    } catch (e) { toast.error((e as Error).message) }
  }

  return (
    <PageContainer wide className="space-y-3">
      <PageHeader
        title="表单"
        description="工作流输入契约：开始节点引用表单，字段即全局固定输入变量"
        actions={<Button size="sm" onClick={openNew}><Plus className="size-4" /> 新建表单</Button>}
      />
      {loading ? (
        <div className="py-10 text-center text-xs text-muted-foreground">加载中…</div>
      ) : rows.length === 0 ? (
        <EmptyState title="暂无表单" action={<Button size="sm" onClick={openNew}><Plus className="size-4" /> 新建表单</Button>} />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((f) => (
            <div key={f.id} className="rounded-lg border bg-white p-3 shadow-sm">
              <div className="flex items-center gap-2">
                <span className="flex-1 truncate text-sm font-medium">{f.name}</span>
                <button title="编辑" onClick={() => openEdit(f)}><Pencil className="size-3.5 text-neutral-500" /></button>
                <button title="创建副本" onClick={async () => { await formsApi.duplicate(f.id); load() }}>
                  <Copy className="size-3.5 text-neutral-500" />
                </button>
                <button title="删除" onClick={async () => {
                  try { await formsApi.remove(f.id); toast.success("已删除"); load() }
                  catch (e) { toast.error((e as Error).message) }
                }}><Trash2 className="size-3.5 text-neutral-400 hover:text-red-500" /></button>
              </div>
              <div className="pt-1 text-xs text-muted-foreground">{f.description || "—"}</div>
              <div className="flex flex-wrap gap-1 pt-2">
                {(f.fields ?? []).slice(0, 6).map((fd) => (
                  <span key={fd.name} className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-600">
                    {fd.name}{fd.required ? " *" : ""}
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

      <Dialog open={isNew || !!editing} onOpenChange={(o) => { if (!o) { setEditing(null); setIsNew(false) } }}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle>{isNew ? "新建表单" : `编辑表单 · ${editing?.name}`}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Input value={name} placeholder="表单名称" onChange={(e) => setName(e.target.value)} />
              <Input value={desc} placeholder="描述" onChange={(e) => setDesc(e.target.value)} />
            </div>
            <FieldEditor fields={fields} onChange={setFields} />
            <Textarea className="min-h-16 text-xs" readOnly
              value={"预置模板：对话六件套 = userQuery*(textarea)/chatHistory/userId/conversationId/chatId/reference"} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditing(null); setIsNew(false) }}>取消</Button>
            <Button onClick={save}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
