import { ArrowLeft, Sparkles, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"

import { PageContainer, PageHeader } from "@/components/app/page"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { defApi, type DefinitionDTO } from "@/services/resource-api"

const FIELD_TYPES = ["String", "Number", "Boolean", "DateTime", "Object", "Array"]

/** 数据定义编辑器：字段 schema + eligibility + 推断 + 发布。 */
export default function DataDefinitionEditorPage() {
  const { defId = "" } = useParams()
  const navigate = useNavigate()
  const [def, setDef] = useState<DefinitionDTO | null>(null)
  const [name, setName] = useState("")
  const [schema, setSchema] = useState<NonNullable<DefinitionDTO["fieldSchema"]>>([])
  const [eligibility, setEligibility] = useState("")

  useEffect(() => {
    defApi.get(defId).then((d) => {
      setDef(d)
      setName(d.name)
      setSchema(d.fieldSchema ?? [])
      setEligibility((d.eligibility ?? []).join("\n"))
    }).catch(() => toast.error("数据定义不存在"))
  }, [defId])

  if (!def) return <PageContainer className="text-sm text-muted-foreground">加载中…</PageContainer>

  const save = async (publish = false) => {
    try {
      await defApi.update(defId, { name, fieldSchema: schema, eligibility: eligibility.split("\n").map((s) => s.trim()).filter(Boolean) })
      if (publish) await defApi.publish(defId)
      toast.success(publish ? "已发布（Revision +1）" : "已保存")
      const fresh = await defApi.get(defId)
      setDef(fresh)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <PageContainer className="max-w-4xl space-y-4">
      <Button variant="ghost" size="sm" className="gap-1 px-2" onClick={() => navigate("/config/data-assets")}>
        <ArrowLeft className="size-4" /> 数据定义
      </Button>
      <PageHeader
        title={<span className="flex items-center gap-2">{def.name}
          <Badge variant={def.lifecycle === "Ready" ? "success" : def.lifecycle === "Draft" ? "info" : "neutral"}>{def.lifecycle}</Badge>
          <Badge variant="secondary">R{def.revision}</Badge></span>}
        description={`所属 Data Asset：${def.assetName}`}
        actions={
          <>
            <Button variant="outline" onClick={() => save(false)}>保存</Button>
            <Button onClick={() => save(true)} disabled={schema.length === 0}>发布 Ready</Button>
          </>
        }
      />

      <div className="space-y-4 rounded-lg border bg-card p-5">
        <div className="grid grid-cols-2 gap-3">
          <div><Label className="text-xs">名称</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="flex items-end">
            <Button variant="outline" size="sm" onClick={async () => {
              try {
                const r = await defApi.infer(defId)
                setSchema(r.fieldSchema ?? [])
                toast.success(`已从 Data Asset 推断 ${r.fieldSchema?.length ?? 0} 个字段`)
              } catch (e) { toast.error((e as Error).message) }
            }}><Sparkles className="size-3.5" /> 从 Data Asset 推断字段</Button>
          </div>
        </div>

        <div>
          <Label className="text-xs">字段 Schema</Label>
          <div className="space-y-2">
            {schema.map((f, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_120px_auto_auto] items-center gap-2">
                <Input className="h-8 font-mono text-xs" value={f.key} placeholder="key"
                  onChange={(e) => setSchema(schema.map((x, j) => j === i ? { ...x, key: e.target.value } : x))} />
                <Input className="h-8 text-xs" value={f.displayName} placeholder="显示名"
                  onChange={(e) => setSchema(schema.map((x, j) => j === i ? { ...x, displayName: e.target.value } : x))} />
                <Select value={f.type} onValueChange={(v) => setSchema(schema.map((x, j) => j === i ? { ...x, type: v } : x))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{FIELD_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
                <label className="flex items-center gap-1 text-xs text-muted-foreground">
                  <input type="checkbox" checked={f.required}
                    onChange={(e) => setSchema(schema.map((x, j) => j === i ? { ...x, required: e.target.checked } : x))} />
                  必填
                </label>
                <Button variant="ghost" size="icon" className="size-7" onClick={() => setSchema(schema.filter((_, j) => j !== i))}>
                  <Trash2 className="size-3.5 text-muted-foreground" />
                </Button>
              </div>
            ))}
          </div>
          <Button variant="outline" size="sm" className="mt-2"
            onClick={() => setSchema([...schema, { key: "", displayName: "", type: "String", required: false }])}>
            添加字段
          </Button>
        </div>

        <div>
          <Label className="text-xs">Eligibility（每行一条）</Label>
          <Textarea className="min-h-20 font-mono text-xs" value={eligibility} onChange={(e) => setEligibility(e.target.value)}
            placeholder={"status = 'closed'\nduration_sec > 0"} />
        </div>
      </div>
    </PageContainer>
  )
}
