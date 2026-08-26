/** 07-SDD（08-26 决策）：集中表单管理——列表页 + 独立新建/编辑页（三栏构建器）。 */
import { ArrowDown, ArrowLeft, ArrowUp, Copy, Pencil, Plus, Save, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"

import { EmptyState } from "@/components/app/list-state"
import { PageContainer, PageHeader } from "@/components/app/page"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { formsApi, type FormDef, type FormField } from "@/services/wf-api"

const TYPES = ["string", "number", "boolean", "array", "object", "datetime"]
const CONTROLS = ["text", "textarea", "number", "select", "switch", "date"]
const CONTROL_LABEL: Record<string, string> = {
  text: "单行文本", textarea: "多行文本", number: "数字", select: "下拉选择", switch: "开关", date: "日期",
}
const CONTROL_TYPE: Record<string, string> = {
  text: "string", textarea: "string", number: "number", select: "string", switch: "boolean", date: "datetime",
}

function PreviewControl({ f }: { f: FormField }) {
  const ctl = f.control ?? "text"
  if (ctl === "textarea") return <Textarea className="min-h-14 text-xs" placeholder={f.description || f.name} />
  if (ctl === "number") return <Input type="number" className="h-8 text-xs" placeholder={f.default || "0"} />
  if (ctl === "switch") return <div className="flex h-8 items-center"><Checkbox checked={f.default === "true"} /></div>
  if (ctl === "date") return <Input type="date" className="h-8 text-xs" />
  if (ctl === "select") {
    return (
      <Select>
        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="请选择" /></SelectTrigger>
        <SelectContent>{(f.options ?? []).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
      </Select>
    )
  }
  return <Input className="h-8 text-xs" placeholder={f.default || f.description || f.name} />
}

/* 三栏构建器（参考 shadcn-builder UX 自写）：字段面板｜实时预览｜属性面板 */
function FormBuilder({ fields, onChange }: { fields: FormField[]; onChange: (f: FormField[]) => void }) {
  const [sel, setSel] = useState<number | null>(fields.length ? 0 : null)
  const patch = (i: number, p: Partial<FormField>) =>
    onChange(fields.map((f, j) => (j === i ? { ...f, ...p } : f)))
  const add = (ctl: string) => {
    const next = [...fields, {
      name: `field_${fields.length + 1}`, type: CONTROL_TYPE[ctl] ?? "string", control: ctl,
      required: false, default: "", description: "", options: ctl === "select" ? ["选项1", "选项2"] : [],
    }]
    onChange(next)
    setSel(next.length - 1)
  }
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= fields.length) return
    const next = [...fields]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
    setSel(j)
  }
  const cur = sel != null ? fields[sel] : null
  return (
    <div className="grid grid-cols-[170px_1fr_260px] gap-3">
      <div className="h-fit space-y-1 rounded-md border bg-white p-2">
        <div className="pb-1 text-xs text-muted-foreground">字段类型</div>
        {CONTROLS.map((c) => (
          <button key={c} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-neutral-50"
            onClick={() => add(c)}>
            <Plus className="size-3 text-neutral-400" /> {CONTROL_LABEL[c]}
          </button>
        ))}
        <p className="pt-1 text-[10px] text-neutral-400">点击添加；预览区点选字段后右侧编辑属性。</p>
      </div>
      <div className="min-h-[420px] space-y-3 rounded-md border bg-neutral-50/50 p-3">
        {fields.length === 0 && <div className="py-10 text-center text-xs text-neutral-400">从左侧添加字段，实时预览表单</div>}
        {fields.map((f, i) => (
          <div key={i}
            className={`relative rounded-md border bg-white p-2 ${sel === i ? "ring-1 ring-blue-500" : ""}`}
            style={{ borderColor: sel === i ? "#3D6BFF" : "#EDF0F4" }}
            onClick={() => setSel(i)}>
            <div className="flex items-center gap-1 pb-1 text-xs">
              <span className="flex-1 font-medium">{f.description || f.name}{f.required && <span className="text-red-500"> *</span>}</span>
              <button title="上移" onClick={(e) => { e.stopPropagation(); move(i, -1) }}><ArrowUp className="size-3 text-neutral-400" /></button>
              <button title="下移" onClick={(e) => { e.stopPropagation(); move(i, 1) }}><ArrowDown className="size-3 text-neutral-400" /></button>
              <button title="删除" onClick={(e) => { e.stopPropagation(); onChange(fields.filter((_, j) => j !== i)); setSel(null) }}>
                <Trash2 className="size-3 text-neutral-400 hover:text-red-500" />
              </button>
            </div>
            <PreviewControl f={f} />
          </div>
        ))}
      </div>
      <div className="h-fit space-y-2 rounded-md border bg-white p-2">
        <div className="pb-1 text-xs text-muted-foreground">字段属性</div>
        {!cur && <div className="py-6 text-center text-xs text-neutral-400">预览区点选字段</div>}
        {cur && sel != null && (
          <>
            <div><div className="pb-1 text-[10px] text-neutral-500">字段名</div>
              <Input className="h-7 text-xs" value={cur.name} onChange={(e) => patch(sel, { name: e.target.value })} /></div>
            <div><div className="pb-1 text-[10px] text-neutral-500">描述</div>
              <Input className="h-7 text-xs" value={cur.description ?? ""} onChange={(e) => patch(sel, { description: e.target.value })} /></div>
            <div><div className="pb-1 text-[10px] text-neutral-500">类型</div>
              <Select value={cur.type} onValueChange={(v) => patch(sel, { type: v })}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select></div>
            <div><div className="pb-1 text-[10px] text-neutral-500">控件</div>
              <Select value={cur.control ?? "text"} onValueChange={(v) => patch(sel, { control: v })}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{CONTROLS.map((t) => <SelectItem key={t} value={t}>{CONTROL_LABEL[t]}</SelectItem>)}</SelectContent>
              </Select></div>
            <label className="flex items-center justify-between text-xs">
              <span>必填</span><Checkbox checked={!!cur.required} onCheckedChange={(v) => patch(sel, { required: !!v })} />
            </label>
            <div><div className="pb-1 text-[10px] text-neutral-500">默认值</div>
              <Input className="h-7 text-xs" value={cur.default ?? ""} onChange={(e) => patch(sel, { default: e.target.value })} /></div>
            {cur.control === "select" && (
              <div><div className="pb-1 text-[10px] text-neutral-500">选项（逗号分隔）</div>
                <Input className="h-7 text-xs" value={(cur.options ?? []).join(",")}
                  onChange={(e) => patch(sel, { options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} /></div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/* 独立新建/编辑页（08-26 决策：新建/编辑走页面，与 tasks/ai-resources 约定一致） */
export function WfFormEditorPage() {
  const { formId } = useParams()
  const navigate = useNavigate()
  const [name, setName] = useState("")
  const [desc, setDesc] = useState("")
  const [fields, setFields] = useState<FormField[]>([])
  const [loaded, setLoaded] = useState(!formId)

  useEffect(() => {
    if (!formId) return
    formsApi.get(formId)
      .then((d) => { setName(d.name); setDesc(d.description ?? ""); setFields((d.fields ?? []).map((x) => ({ ...x }))) })
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
        const r = await formsApi.create({ name: name.trim(), description: desc, fields })
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
        description="字段即工作流输入契约：开始节点引用后成为全局固定输入变量"
        actions={
          <span className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate("/config/forms")}><ArrowLeft className="size-4" /> 返回</Button>
            <Button size="sm" onClick={save}><Save className="size-4" /> 保存</Button>
          </span>
        }
      />
      <div className="grid grid-cols-2 gap-2">
        <Input value={name} placeholder="表单名称" onChange={(e) => setName(e.target.value)} />
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

  return (
    <PageContainer wide className="space-y-3">
      <PageHeader
        title="表单"
        description="工作流输入契约：开始节点引用表单，字段即全局固定输入变量"
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
                <button title="编辑" onClick={() => navigate(`/config/forms/${f.id}`)}><Pencil className="size-3.5 text-neutral-500" /></button>
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
    </PageContainer>
  )
}
