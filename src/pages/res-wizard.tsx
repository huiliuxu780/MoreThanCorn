import { ArrowLeft, ArrowRight, BookOpen, Check, Cpu, Database, Layers, Server, Wrench } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { PageContainer, PageHeader } from "@/components/app/page"
import { ConnectionPicker } from "@/components/resources/connection-picker"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { pagedApi } from "@/services/wf-api"
import { resApi } from "@/services/resource-api"
import { cn } from "@/lib/utils"

const TYPES = {
  ai: [
    { type: "model", label: "Model", icon: Cpu, desc: "LLM / Embedding 模型，支持 Model Version", versioned: true },
    { type: "tool", label: "Tool", icon: Wrench, desc: "可复用能力资产（builtin / http），支持 ToolVersion", versioned: true },
    { type: "mcp", label: "MCP Server", icon: Server, desc: "stdio / http 接入的 MCP 服务", versioned: false },
    { type: "knowledge", label: "Knowledge Source", icon: BookOpen, desc: "向量库 / 文档库", versioned: false },
  ],
  data: [
    { type: "datasource", label: "Datasource", icon: Database, desc: "数据连接（数据库 / 对象存储 / HTTP）", versioned: false },
    { type: "asset", label: "Data Asset", icon: Layers, desc: "一份可分析的数据集", versioned: false },
  ],
} as const

const STEPS = ["选择类型", "填写配置", "测试", "完成"]

const emptyForm = {
  name: "", description: "", providerId: "", modelKey: "", capabilities: ["text"],
  kind: "http", spec: '{ "kind": "echo" }', connectionId: "", transport: "stdio", command: "",
  ksKind: "vector", embeddingModelId: "", sourceUrl: "", dsType: "mysql", location: "",
  datasourceId: "", recordMeaning: "", timeField: "", recordIdField: "",
}

export default function ResWizardPage({ scope }: { scope: "ai" | "data" }) {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [type, setType] = useState<string>(scope === "ai" ? "model" : "datasource")
  const [form, setForm] = useState<typeof emptyForm>({ ...emptyForm })
  const [createdId, setCreatedId] = useState("")
  const [tested, setTested] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string; latencyMs?: number } | null>(null)
  const [providers, setProviders] = useState<{ id: string; name: string }[]>([])
  const [models, setModels] = useState<{ id: string; name: string }[]>([])
  const [datasources, setDatasources] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    pagedApi.providers({}).then((r) => setProviders(r.items.map((p) => ({ id: p.id, name: p.name })))).catch(() => undefined)
    resApi.registry("model").then((r) => setModels(r.items.map((m) => ({ id: m.id, name: m.metadata.modelKey as string ?? m.name })))).catch(() => undefined)
    resApi.list("datasource", { pageSize: 50 }).then((r) => setDatasources(r.items.map((d) => ({ id: d.id, name: d.name })))).catch(() => undefined)
  }, [])

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }))

  const stepValid = useMemo(() => {
    if (step === 0) return true
    if (step === 1) {
      if (!form.name.trim()) return false
      if (type === "model") return !!form.providerId && !!form.modelKey.trim()
      if (type === "mcp") return form.transport === "stdio" ? !!form.command.trim() : !!form.connectionId
      if (type === "datasource") return !!form.connectionId && !!form.location.trim()
      if (type === "asset") return !!form.datasourceId && !!form.location.trim()
      return true
    }
    if (step === 2) return tested
    return true
  }, [step, form, type, tested])

  /** 进入测试步：先以 disabled 落库（草稿），测试通过后才可启用。 */
  const enterTest = async () => {
    try {
      let id = createdId
      const body: Record<string, unknown> = { tested: false }
      if (type === "model") Object.assign(body, { name: form.name, providerId: form.providerId, modelKey: form.modelKey, capabilities: form.capabilities, description: form.description })
      if (type === "tool") Object.assign(body, { name: form.name, kind: form.kind, spec: JSON.parse(form.spec || "{}"), connectionId: form.connectionId || null, description: form.description })
      if (type === "mcp") Object.assign(body, { name: form.name, transport: form.transport, command: form.command, connectionId: form.connectionId || null, description: form.description })
      if (type === "knowledge") Object.assign(body, { name: form.name, kind: form.ksKind, embeddingModelId: form.embeddingModelId || null, sourceConfig: { url: form.sourceUrl }, description: form.description })
      if (type === "datasource") Object.assign(body, { name: form.name, type: form.dsType, connectionId: form.connectionId, location: form.location, description: form.description })
      if (type === "asset") Object.assign(body, { name: form.name, datasourceId: form.datasourceId, location: form.location, recordMeaning: form.recordMeaning, timeField: form.timeField, description: form.description })
      if (id) await resApi.update(type, id, body)
      else {
        const r = await resApi.create(type, body)
        id = r.id
        setCreatedId(id)
      }
      setStep(2)
      setTested(false)
      setTestResult(null)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const runTest = async () => {
    if (!createdId) return
    setTesting(true)
    setTestResult(null)
    try {
      const r = await resApi.test(type, createdId, { input: "ping" })
      setTestResult(r)
      setTested(r.ok)
    } catch (e) {
      setTestResult({ ok: false, error: (e as Error).message })
      setTested(false)
    } finally {
      setTesting(false)
    }
  }

  const saveEnabled = async () => {
    await resApi.toggle(type, createdId, true)
    setStep(3)
  }

  const backToList = (withNew: boolean) => {
    const base = scope === "ai" ? "/config/ai-resources" : "/config/data-resources"
    navigate(withNew ? `${base}?tab=${type}&new=${createdId}` : `${base}?tab=${type}`)
  }

  return (
    <PageContainer className="max-w-3xl space-y-5">
      <div>
        <Button variant="ghost" size="sm" className="gap-1 px-2" onClick={() => backToList(false)}>
          <ArrowLeft className="size-4" /> {scope === "ai" ? "AI Resources" : "Data Resources"}
        </Button>
        <PageHeader className="mt-2" title="创建资源" description="统一向导：选择类型 → 填写配置 → 测试 → 保存。测试不可跳过。" />
      </div>

      <div className="flex items-center gap-2">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <button type="button" onClick={() => i < step && step < 3 && setStep(i)}
              className={cn("flex items-center gap-2 rounded-full border px-3 py-1 text-xs",
                i === step ? "border-primary bg-primary text-primary-foreground"
                  : i < step ? "border-border bg-muted text-foreground" : "border-border text-muted-foreground")}>
              <span className="flex size-4 items-center justify-center rounded-full bg-background/20 text-[10px] tabular-nums">
                {i < step ? <Check className="size-3" /> : i + 1}
              </span>
              {label}
            </button>
            {i < STEPS.length - 1 && <div className="h-px w-6 bg-border" />}
          </div>
        ))}
      </div>

      <div className="rounded-lg border bg-card p-5">
        {step === 0 && (
          <div className="grid grid-cols-2 gap-3">
            {TYPES[scope].map((t) => (
              <button key={t.type} className={cn("flex gap-3 rounded-lg border p-3 text-left transition-colors",
                type === t.type ? "border-foreground bg-muted/60 shadow-[0_0_0_1px_var(--foreground)]" : "hover:border-muted-foreground/50")}
                onClick={() => setType(t.type)}>
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted"><t.icon className="size-4" /></div>
                <div>
                  <div className="text-sm font-medium">{t.label}</div>
                  <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{t.desc}</div>
                </div>
              </button>
            ))}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">名称 <span className="text-destructive">*</span></Label>
                <Input value={form.name} onChange={(e) => set("name", e.target.value)} /></div>
              {type === "model" && (
                <div><Label className="text-xs">Provider <span className="text-destructive">*</span></Label>
                  <Select value={form.providerId || undefined} onValueChange={(v) => set("providerId", v)}>
                    <SelectTrigger><SelectValue placeholder="选择 Provider" /></SelectTrigger>
                    <SelectContent>{providers.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                  </Select></div>
              )}
              {type === "tool" && (
                <div><Label className="text-xs">类型</Label>
                  <Select value={form.kind} onValueChange={(v) => set("kind", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="builtin">builtin</SelectItem><SelectItem value="http">http</SelectItem></SelectContent>
                  </Select></div>
              )}
              {type === "mcp" && (
                <div><Label className="text-xs">Transport</Label>
                  <Select value={form.transport} onValueChange={(v) => set("transport", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="stdio">stdio</SelectItem><SelectItem value="http">http</SelectItem></SelectContent>
                  </Select></div>
              )}
              {type === "knowledge" && (
                <div><Label className="text-xs">类型</Label>
                  <Select value={form.ksKind} onValueChange={(v) => set("ksKind", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="vector">向量库</SelectItem><SelectItem value="document">文档库</SelectItem></SelectContent>
                  </Select></div>
              )}
              {type === "datasource" && (
                <div><Label className="text-xs">类型</Label>
                  <Select value={form.dsType} onValueChange={(v) => set("dsType", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="mysql">MySQL</SelectItem><SelectItem value="postgresql">PostgreSQL</SelectItem><SelectItem value="oss">对象存储 OSS</SelectItem><SelectItem value="http">HTTP API</SelectItem></SelectContent>
                  </Select></div>
              )}
              {type === "asset" && (
                <div><Label className="text-xs">所属 Datasource <span className="text-destructive">*</span></Label>
                  <Select value={form.datasourceId || undefined} onValueChange={(v) => set("datasourceId", v)}>
                    <SelectTrigger><SelectValue placeholder="选择 Datasource" /></SelectTrigger>
                    <SelectContent>{datasources.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
                  </Select></div>
              )}
            </div>
            {type === "model" && (
              <div><Label className="text-xs">Model Key <span className="text-destructive">*</span></Label>
                <Input className="font-mono text-xs" value={form.modelKey} onChange={(e) => set("modelKey", e.target.value)} placeholder="qwen-max" /></div>
            )}
            {type === "tool" && (
              <div><Label className="text-xs">请求配方 spec（JSON）</Label>
                <Textarea className="min-h-24 font-mono text-xs" value={form.spec} onChange={(e) => set("spec", e.target.value)} /></div>
            )}
            {type === "mcp" && form.transport === "stdio" && (
              <div><Label className="text-xs">启动命令 <span className="text-destructive">*</span></Label>
                <Input className="font-mono text-xs" value={form.command} onChange={(e) => set("command", e.target.value)} placeholder="npx -y @corp/mcp-server" /></div>
            )}
            {(type === "tool" && form.kind === "http") || (type === "mcp" && form.transport === "http") || type === "datasource" ? (
              <div><Label className="text-xs">Connection（endpoint + 认证）{type !== "tool" && <span className="text-destructive">*</span>}</Label>
                <ConnectionPicker value={form.connectionId} onChange={(v) => set("connectionId", v)}
                  protocols={type === "datasource" ? [form.dsType === "oss" ? "oss" : form.dsType] : undefined} /></div>
            ) : null}
            {type === "knowledge" && (
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-xs">Embedding 模型</Label>
                  <Select value={form.embeddingModelId || undefined} onValueChange={(v) => set("embeddingModelId", v)}>
                    <SelectTrigger><SelectValue placeholder="可选" /></SelectTrigger>
                    <SelectContent>{models.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
                  </Select></div>
                <div><Label className="text-xs">内容来源 URL</Label><Input value={form.sourceUrl} onChange={(e) => set("sourceUrl", e.target.value)} /></div>
              </div>
            )}
            {(type === "datasource" || type === "asset") && (
              <div><Label className="text-xs">{type === "datasource" ? "库 / Bucket / 路径" : "表 / 路径"} <span className="text-destructive">*</span></Label>
                <Input className="font-mono text-xs" value={form.location} onChange={(e) => set("location", e.target.value)} placeholder={type === "datasource" ? "db_cc" : "t_call_session"} /></div>
            )}
            {type === "asset" && (
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-xs">一条数据代表什么</Label><Input value={form.recordMeaning} onChange={(e) => set("recordMeaning", e.target.value)} placeholder="一通客服对话" /></div>
                <div><Label className="text-xs">时间字段</Label><Input className="font-mono text-xs" value={form.timeField} onChange={(e) => set("timeField", e.target.value)} placeholder="call_start_at" /></div>
              </div>
            )}
            <div><Label className="text-xs">描述</Label><Textarea value={form.description} onChange={(e) => set("description", e.target.value)} /></div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">保存前必须通过测试（不可跳过）。资源已暂存为 Disabled，测试通过后可启用。</p>
            <Button onClick={runTest} disabled={testing}>{testing ? "执行中…" : "执行测试"}</Button>
            {testResult?.ok && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">
                测试通过 · {testResult.latencyMs}ms
              </div>
            )}
            {testResult && !testResult.ok && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                测试失败：{testResult.error} —— 返回上一步修改配置后重试。
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4 py-4 text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700">
              <Check className="size-6" />
            </div>
            <div className="text-base font-semibold">资源创建成功</div>
            <p className="text-sm text-muted-foreground">已通过测试并保存为 Enabled，可立即被 Workflow 节点选择。</p>
            <div className="flex justify-center gap-2">
              <Button variant="outline" onClick={() => navigate(`/config/${scope === "ai" ? "ai" : "data"}-resources/${type}/${createdId}`)}>查看详情</Button>
              <Button onClick={() => backToList(true)}>返回资源列表</Button>
            </div>
          </div>
        )}
      </div>

      {step < 3 && (
        <div className="flex items-center justify-between">
          <Button variant="outline" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>上一步</Button>
          {step === 0 && <Button onClick={() => setStep(1)}>下一步 <ArrowRight className="size-4" /></Button>}
          {step === 1 && <Button disabled={!stepValid} onClick={enterTest}>下一步 <ArrowRight className="size-4" /></Button>}
          {step === 2 && <Button disabled={!tested} onClick={saveEnabled}>保存并启用 <Check className="size-4" /></Button>}
        </div>
      )}
    </PageContainer>
  )
}
