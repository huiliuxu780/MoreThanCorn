import { ArrowLeft, History, ShieldCheck } from "lucide-react"
import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { FormField } from "@/components/app/form-field"
import { PageContainer, PageHeader, SectionHeader } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status-badge"
import { StatusIcon, StatusNotice } from "@/components/app/status-indicator"
import { useAsyncData } from "@/hooks/use-async-data"
import { getDataAsset, getDataAssetRevisions } from "@/services/mock-service"
import type { DataAssetField } from "@/domain/types"
import { rbac } from "@/services/rbac"

export default function DataAssetEditorPage() {
  const { assetId } = useParams()
  const isCreate = !assetId || assetId === "new"
  const navigate = useNavigate()
  const { data: asset } = useAsyncData(() => (isCreate ? Promise.resolve(null) : getDataAsset(assetId!)), [assetId])
  const { data: revisions } = useAsyncData(() => (isCreate ? Promise.resolve([]) : getDataAssetRevisions(assetId!)), [assetId])

  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [source, setSource] = useState("")
  const [recordMeaning, setRecordMeaning] = useState("")
  const [recordIdField, setRecordIdField] = useState("")
  const [timeField, setTimeField] = useState("")
  const [schema, setSchema] = useState<DataAssetField[]>([])
  const [eligibility, setEligibility] = useState<string[]>([])
  const [eligibilityInput, setEligibilityInput] = useState("")
  const [validateOpen, setValidateOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [loadedFor, setLoadedFor] = useState("")

  useEffect(() => {
    if (!asset || loadedFor === asset.id) return
    setLoadedFor(asset.id)
    setName(asset.name)
    setDescription(asset.description)
    setSource(asset.source)
    setRecordMeaning(asset.recordMeaning)
    setRecordIdField(asset.recordIdField)
    setTimeField(asset.timeField)
    setSchema(asset.schema)
    setEligibility(asset.eligibility)
  }, [asset, loadedFor])

  const isDraft = isCreate || asset?.lifecycle === "Draft"
  const canManage = rbac.can("asset.manage")
  const readOnly = !isDraft || !canManage

  const validateChecks = [
    { label: "Source 可访问", ok: source.trim() !== "" },
    { label: "Record ID 有效", ok: schema.some((f) => f.key === recordIdField) },
    { label: "Time Field 有效", ok: schema.some((f) => f.key === timeField) },
    { label: "Required Field 存在", ok: schema.filter((f) => f.required).length > 0 },
    { label: "Schema 有效", ok: schema.length > 0 },
    { label: "Eligibility 可执行", ok: true },
    { label: "Preview 成功", ok: schema.length > 0 },
  ]
  const validateOk = validateChecks.every((c) => c.ok)

  return (
    <PageContainer className="max-w-4xl space-y-5">
      <div>
        <Button variant="ghost" size="sm" className="gap-1 px-2" onClick={() => navigate("/config/data-assets")}>
          <ArrowLeft className="size-4" /> 数据定义
        </Button>
        <PageHeader
          className="mt-2"
          title={isCreate ? "创建数据资产" : name || asset?.name || ""}
          status={
            asset ? (
              <>
                <StatusBadge status={asset.lifecycle} />
                <StatusBadge status={asset.health} />
              </>
            ) : null
          }
          description="单页编辑器：Identity / Source Binding / Record Definition / Schema / Eligibility / Health"
          actions={
            <>
              {!isCreate ? (
                <Button variant="outline" size="sm" onClick={() => setHistoryOpen(true)}>
                  <History className="size-3.5" /> Revision History
                </Button>
              ) : null}
              <Button variant="outline" size="sm" onClick={() => setValidateOpen(true)}>
                <ShieldCheck className="size-3.5" /> Validate
              </Button>
              {asset?.lifecycle === "Ready" && canManage ? (
                <Button size="sm" onClick={() => toast.info("已创建下一 Draft Revision（原型）")}>编辑（创建下一 Draft）</Button>
              ) : null}
            </>
          }
        />
      </div>

      {asset?.health === "Error" ? (
        <StatusNotice tone="danger" title="Health: Error">
          <p className="text-sm">上游运行异常：Schema missing: transcript。Ready + Error 合法：资产定义已可用，但当前上游异常。</p>
        </StatusNotice>
      ) : asset?.health === "Degraded" ? (
        <StatusNotice tone="warning" title="Health: Degraded">
          <p className="text-sm">Freshness 超阈值：最近一次上游产出延迟 6 小时。</p>
        </StatusNotice>
      ) : null}

      <fieldset disabled={readOnly} className="space-y-5">
        <section className="space-y-3 rounded-lg border bg-card p-4">
          <SectionHeader title="基本信息" />
          <div className="grid grid-cols-2 gap-4">
            <FormField label="名称" required>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：热线通话" />
            </FormField>
            <FormField label="Source Binding" description="只引用已有 Table / View / Resource，不负责 ETL" required>
              <Input className="font-mono text-xs" value={source} onChange={(e) => setSource(e.target.value)} placeholder="数仓 · dwd_xxx_di" />
            </FormField>
          </div>
          <FormField label="描述">
            <Textarea className="min-h-16" value={description} onChange={(e) => setDescription(e.target.value)} />
          </FormField>
        </section>

        <section className="space-y-3 rounded-lg border bg-card p-4">
          <SectionHeader title="Record Definition" description="必须显式回答：一条数据代表什么？" />
          <div className="grid grid-cols-3 gap-4">
            <FormField label="一条数据代表什么" required>
              <Input value={recordMeaning} onChange={(e) => setRecordMeaning(e.target.value)} placeholder="一通电话 / 一次会话" />
            </FormField>
            <FormField label="Record ID" required>
              <Select value={recordIdField || undefined} onValueChange={setRecordIdField}>
                <SelectTrigger><SelectValue placeholder="选择字段" /></SelectTrigger>
                <SelectContent>
                  {schema.map((f) => (<SelectItem key={f.key} value={f.key}>{f.key}</SelectItem>))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Time Field" required>
              <Select value={timeField || undefined} onValueChange={setTimeField}>
                <SelectTrigger><SelectValue placeholder="选择字段" /></SelectTrigger>
                <SelectContent>
                  {schema.map((f) => (<SelectItem key={f.key} value={f.key}>{f.key}</SelectItem>))}
                </SelectContent>
              </Select>
            </FormField>
          </div>
        </section>

        <section className="space-y-3 rounded-lg border bg-card p-4">
          <SectionHeader
            title="Schema"
            description="只定义必要分析语义：Source Field / Display Name / Type / Description / Required"
            actions={
              <Button variant="outline" size="sm" onClick={() => setSchema((s) => [...s, { key: `field_${s.length + 1}`, displayName: `字段 ${s.length + 1}`, type: "String", required: false }])}>
                添加字段
              </Button>
            }
          />
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source Field</TableHead>
                  <TableHead>Display Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Required</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {schema.map((field, idx) => (
                  <TableRow key={field.key}>
                    <TableCell className="font-mono text-xs">{field.key}</TableCell>
                    <TableCell>
                      <Input className="h-7 text-xs" value={field.displayName} onChange={(e) => setSchema((s) => s.map((f, i) => (i === idx ? { ...f, displayName: e.target.value } : f)))} />
                    </TableCell>
                    <TableCell>
                      <Select value={field.type} onValueChange={(v) => setSchema((s) => s.map((f, i) => (i === idx ? { ...f, type: v as DataAssetField["type"] } : f)))}>
                        <SelectTrigger className="h-7 w-28 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {["String", "Number", "Boolean", "DateTime", "Object", "Array"].map((t) => (<SelectItem key={t} value={t}>{t}</SelectItem>))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{field.description ?? ""}</TableCell>
                    <TableCell>
                      <Switch checked={field.required} onCheckedChange={(v) => setSchema((s) => s.map((f, i) => (i === idx ? { ...f, required: v } : f)))} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>

        <section className="space-y-3 rounded-lg border bg-card p-4">
          <SectionHeader title="Eligibility" description="资产级长期业务口径，不等同于 Task Scope；不支持 SQL IDE" />
          <div className="space-y-1.5">
            {eligibility.map((rule, idx) => (
              <div key={idx} className="flex items-center justify-between rounded-md border px-3 py-1.5 font-mono text-xs">
                {rule}
                <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setEligibility((e) => e.filter((_, i) => i !== idx))}>×</button>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <Input className="h-8 font-mono text-xs" placeholder="connected = true" value={eligibilityInput} onChange={(e) => setEligibilityInput(e.target.value)} />
              <Button variant="outline" size="sm" onClick={() => { if (eligibilityInput.trim()) { setEligibility((e) => [...e, eligibilityInput.trim()]); setEligibilityInput("") } }}>
                添加
              </Button>
            </div>
          </div>
        </section>
      </fieldset>

      {isCreate ? (
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => navigate("/config/data-assets")}>取消</Button>
          <Button disabled={!name.trim()} onClick={() => { toast.success("Draft 已保存"); navigate("/config/data-assets/DA-01") }}>保存 Draft</Button>
        </div>
      ) : null}

      {/* Validate Sheet */}
      <Sheet open={validateOpen} onOpenChange={setValidateOpen}>
        <SheetContent className="w-[420px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Preview / Validate</SheetTitle>
            <SheetDescription>进入 Ready 前必须 Validate；Preview 只显示少量真实样本</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-2">
            {validateChecks.map((check) => (
              <div key={check.label} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                <StatusIcon tone={check.ok ? "success" : "danger"} />
                {check.label}
              </div>
            ))}
            <div className="rounded-md border">
              <div className="border-b px-3 py-1.5 text-xs font-medium">Preview（3 条样本）</div>
              <pre className="overflow-x-auto p-3 text-[10px] leading-4 text-muted-foreground">
{JSON.stringify([
  { call_id: "C202608180001", connected: true, duration: 768 },
  { call_id: "C202608180002", connected: true, duration: 421 },
  { call_id: "C202608180003", connected: false, duration: 0 },
], null, 1)}
              </pre>
            </div>
            {validateOk && asset?.lifecycle === "Draft" ? (
              <Button className="w-full" onClick={() => { setValidateOpen(false); toast.success("Validation passed：已设为 Ready") }}>
                设为 Ready
              </Button>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>

      {/* Revision History Sheet */}
      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent className="w-[380px]">
          <SheetHeader>
            <SheetTitle>Revision History</SheetTitle>
            <SheetDescription>历史 Ready Revision 只读，不覆盖</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-2">
            {(revisions ?? []).map((rev) => (
              <div key={rev.revision} className="rounded-md border px-3 py-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium">R{rev.revision}</span>
                  <StatusBadge status={rev.status} />
                  {rev.revision === asset?.currentRevision ? <Badge variant="outline">当前</Badge> : null}
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">{rev.note}</div>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </PageContainer>
  )
}
