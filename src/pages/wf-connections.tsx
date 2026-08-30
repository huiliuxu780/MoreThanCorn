/** Connections — 真 API + 卡片网格。路由 /settings/connections。
 * R4：鉴权双层（内置算法 none/api_key/bearer/basic/aksk + 自定义脚本沙箱）、
 * 多环境域名（预设四槽+自定义，按环境凭据覆盖）、空跑鉴权、按环境测试。 */
import { Eye, EyeOff, KeyRound, Play, Plus, Trash2 } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { useListQuery } from "@/hooks/use-list-query"
import { Pagination } from "@/components/app/pagination"
import { pagedApi } from "@/services/wf-api"
import { connApi, type ConnSecret, type ConnectionDTO } from "@/services/resource-api"
import { AKSK_TEMPLATE, ENV_PRESETS, KINDS, PROTOCOLS, isDb, isOss, kindLabel, protocolLabel } from "@/services/connection-auth"
import { toast } from "sonner"

import { FilterBar, SearchField } from "@/components/app/filters"
import { CardGridSkeleton, EmptyState } from "@/components/app/list-state"
import { PageContainer, PageHeader } from "@/components/app/page"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

interface EpFields { baseUrl: string; host: string; port: string; user: string; database: string; bucket: string; region: string }
interface EnvForm extends EpFields { code: string; label: string; hasSecret: boolean; secret: ConnSecret | "" }
interface FormState extends EpFields {
  id: string | null; name: string; kind: string; protocol: string;
  providerHint: string; secret: ConnSecret | ""; authScript: string;
  environments: EnvForm[]; defaultEnv: string;
}
const EMPTY_EP: EpFields = { baseUrl: "", host: "", port: "", user: "", database: "", bucket: "", region: "" }
const EMPTY_FORM: FormState = {
  id: null, name: "", kind: "api_key", protocol: "http-api", ...EMPTY_EP,
  providerHint: "", secret: "", authScript: "", environments: [], defaultEnv: "",
}

function endpointOf(protocol: string, f: EpFields): Record<string, string> {
  if (isDb(protocol)) return { host: f.host, port: f.port, user: f.user, database: f.database }
  if (isOss(protocol)) return { bucket: f.bucket, region: f.region }
  return { base_url: f.baseUrl }
}

/** 按 kind 渲染密钥输入；script 为动态 KV 行（脚本 env 变量来源） */
function SecretFields({ kind, value, onChange }: {
  kind: string; value: ConnSecret | ""; onChange: (v: ConnSecret | "") => void
}) {
  if (kind === "none") return null
  const rec = (typeof value === "object" ? value : {}) as Record<string, string>
  const setRec = (k: string, v: string) => onChange({ ...rec, [k]: v })
  if (kind === "basic") {
    return (
      <div className="grid grid-cols-2 gap-3">
        <div><Label className="text-xs">用户名</Label><Input value={rec.username ?? ""} onChange={(e) => setRec("username", e.target.value)} /></div>
        <div><Label className="text-xs">密码</Label><Input type="password" value={rec.password ?? ""} onChange={(e) => setRec("password", e.target.value)} /></div>
      </div>
    )
  }
  if (kind === "aksk") {
    return (
      <div className="grid grid-cols-1 gap-3">
        <div><Label className="text-xs">AccessKey</Label><Input className="font-mono text-xs" value={rec.access_key ?? ""} onChange={(e) => setRec("access_key", e.target.value)} /></div>
        <div><Label className="text-xs">SecretKey</Label><Input type="password" className="font-mono text-xs" value={rec.secret_key ?? ""} onChange={(e) => setRec("secret_key", e.target.value)} /></div>
      </div>
    )
  }
  if (kind === "script") {
    const rows = Object.entries(rec)
    return (
      <div className="space-y-2">
        <Label className="text-xs">脚本环境变量（pm.environment.get 可读；加密存储）</Label>
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[1fr_1fr_28px] gap-2">
            <Input className="font-mono text-xs" value={k} readOnly />
            <Input className="font-mono text-xs" type="password" value={v}
              onChange={(e) => setRec(k, e.target.value)} />
            <button type="button" className="text-neutral-400 hover:text-red-500"
              onClick={() => { const n = { ...rec }; delete n[k]; onChange(n) }} title="删除"><Trash2 className="size-3.5" /></button>
          </div>
        ))}
        <div className="grid grid-cols-[1fr_1fr_28px] gap-2">
          <Input className="font-mono text-xs" placeholder="变量名，如 accesskey"
            onKeyDown={(e) => {
              if (e.key !== "Enter") return
              const k = (e.target as HTMLInputElement).value.trim()
              if (k) { onChange({ ...rec, [k]: "" }); (e.target as HTMLInputElement).value = "" }
            }} />
          <div className="text-xs leading-9 text-muted-foreground">回车添加变量</div>
          <div />
        </div>
      </div>
    )
  }
  // api_key / bearer：单串
  return <Input type="password" value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} placeholder="加密存储，不回显" />
}

/** 端点字段（主表单与环境行共用） */
function EndpointFields({ protocol, v, onChange }: {
  protocol: string; v: EpFields; onChange: (p: Partial<EpFields>) => void
}) {
  if (isDb(protocol)) {
    return (
      <div className="space-y-2">
        <div className="grid grid-cols-[1fr_90px] gap-2">
          <Input value={v.host} onChange={(e) => onChange({ host: e.target.value })} placeholder="db.internal" />
          <Input value={v.port} onChange={(e) => onChange({ port: e.target.value })} placeholder={protocol === "mysql" ? "3306" : "5432"} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input value={v.user} onChange={(e) => onChange({ user: e.target.value })} placeholder="用户名" />
          <Input value={v.database} onChange={(e) => onChange({ database: e.target.value })} placeholder="数据库" />
        </div>
      </div>
    )
  }
  if (isOss(protocol)) {
    return (
      <div className="grid grid-cols-2 gap-2">
        <Input value={v.bucket} onChange={(e) => onChange({ bucket: e.target.value })} placeholder="Bucket" />
        <Input value={v.region} onChange={(e) => onChange({ region: e.target.value })} placeholder="Region" />
      </div>
    )
  }
  return <Input value={v.baseUrl} onChange={(e) => onChange({ baseUrl: e.target.value })} placeholder="https://网关域名" />
}

export default function WfConnectionsPage() {
  const [rows, setRows] = useState<ConnectionDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [open, setOpen] = useState(false)
  const [showSecret, setShowSecret] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [dryRun, setDryRun] = useState<{ headers: Record<string, string>; logs: string[] } | null>(null)
  const [testEnv, setTestEnv] = useState("")
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }))

  const { params, update } = useListQuery(12)
  const [total, setTotal] = useState(0)
  const load = useCallback(() => {
    setLoading(true)
    pagedApi.connections({ page: params.page, pageSize: params.pageSize, search: params.search ?? "" }).then((r) => {
      setRows(r.items as unknown as ConnectionDTO[]); setTotal(r.total); setLoading(false)
    }).catch(() => setLoading(false))
  }, [params.page, params.pageSize, params.search])
  useEffect(() => { load() }, [load])

  const openCreate = () => { setForm(EMPTY_FORM); setShowSecret(false); setDryRun(null); setOpen(true) }
  const openEdit = (c: ConnectionDTO) => {
    const ep = (c.endpoint ?? {}) as Record<string, string>
    const envs: EnvForm[] = (c.environments ?? []).map((e) => {
      const eep = (e.endpoint ?? {}) as Record<string, string>
      return { code: e.code, label: e.label ?? "", hasSecret: !!e.secretConfigured, secret: "",
               baseUrl: eep.base_url ?? "", host: eep.host ?? "", port: eep.port ?? "",
               user: eep.user ?? "", database: eep.database ?? "", bucket: eep.bucket ?? "", region: eep.region ?? "" }
    })
    setForm({
      id: c.id, name: c.name, kind: c.kind || "api_key", protocol: c.protocol || "http-api",
      baseUrl: ep.base_url ?? "", host: ep.host ?? "", port: ep.port ?? "",
      user: ep.user ?? "", database: ep.database ?? "", bucket: ep.bucket ?? "", region: ep.region ?? "",
      providerHint: c.providerHint ?? "", secret: "", authScript: c.authScript ?? "",
      environments: envs, defaultEnv: c.defaultEnv ?? "",
    })
    setShowSecret(false); setDryRun(null); setTestEnv("")
    setOpen(true)
    // SDD-12 B-01：Secret 永不回显。编辑时密钥字段留空=保留原值；
    // 需更新凭据请使用"轮换"（独立操作），不再自动加载明文。
  }

  const submit = async () => {
    const envs = form.environments.filter((e) => e.code.trim()).map((e) => ({
      code: e.code.trim(), label: e.label.trim() || e.code.trim(),
      endpoint: endpointOf(form.protocol, e),
      ...(e.hasSecret && e.secret !== "" ? { secret: e.secret } : {}),
    }))
    // SDD-12 §5.3：PUT 不接受根级 secret；根密钥变更走独立的轮换接口
    const body = {
      name: form.name.trim(), kind: form.kind, protocol: form.protocol,
      endpoint: endpointOf(form.protocol, form), providerHint: form.providerHint.trim(),
      environments: envs, default_env: form.defaultEnv || null,
      authScript: form.kind === "script" ? form.authScript : null,
    }
    try {
      if (form.id) {
        await connApi.update(form.id, body)
        if (form.secret !== "") {
          await connApi.rotateSecret(form.id, form.secret)
          toast.success("连接已更新，根凭据已轮换")
        } else {
          toast.success("连接已更新（未填写的凭据保持原值）")
        }
      } else {
        if (form.kind !== "none" && form.kind !== "script" && form.secret === "") {
          toast.error("创建连接需要填写 Secret"); return
        }
        await connApi.create({ ...body, secret: form.secret === "" ? undefined : form.secret })
        toast.success("连接已创建（草稿，测试通过后可启用）")
      }
      setOpen(false); load()
    } catch (e) { toast.error((e as Error).message) }
  }

  /** SDD-12 §5.3/B-02：轮换=新 revision 生效、旧 revision 退役 */
  const rotate = async (c: ConnectionDTO) => {
    const v = window.prompt(`轮换「${c.name}」的根凭据（旧凭据将退役，不可回显）：`)
    if (!v) return
    try {
      const r = await connApi.rotateSecret(c.id, v)
      toast.success(`凭据已轮换（版本 ${r.versionNo}），健康度转为 Stale，请重新测试`)
      load()
    } catch (e) { toast.error((e as Error).message) }
  }

  /** SDD-12 §5.3/B-03：清除需二次确认；有引用时提示并允许强制 */
  const clearSecret = async (c: ConnectionDTO) => {
    const confirmText = window.prompt(`清除「${c.name}」的根凭据？请输入 CLEAR_SECRET 确认：`)
    if (confirmText == null) return
    try {
      await connApi.clearSecret(c.id, confirmText)
      toast.success("凭据已清除"); load()
    } catch (e) {
      const err = e as Error & { refs?: { kind: string; label?: string }[] }
      if (err.refs?.length && window.confirm(
        `该连接被 ${err.refs.length} 个资源引用（${err.refs.map(r => r.label || r.kind).join("、")}），清除后其鉴权将失败。仍要强制清除吗？`)) {
        try { await connApi.clearSecret(c.id, "CLEAR_SECRET", { force: true }); toast.success("凭据已强制清除"); load() }
        catch (e2) { toast.error((e2 as Error).message) }
      } else { toast.error(err.message) }
    }
  }

  const enable = async (c: ConnectionDTO) => {
    try { await connApi.enable(c.id); toast.success("连接已启用"); load() }
    catch (e) { toast.error(`启用失败：${(e as Error).message}（需先通过连接测试）`) }
  }
  const disable = async (c: ConnectionDTO) => {
    try { await connApi.disable(c.id); toast.success("连接已停用"); load() }
    catch (e) { toast.error((e as Error).message) }
  }

  const del = async (c: ConnectionDTO) => {
    try { await connApi.remove(c.id); toast.success("连接已归档"); load() }
    catch (e) {
      const err = e as Error & { refs?: { kind: string; label?: string }[] }
      if (err.refs?.length) {
        toast.error(`该连接被引用，无法删除：${err.refs.map(r => `${r.kind}${r.label ? "·" + r.label : ""}`).join("、")}`)
      } else { toast.error(err.message) }
    }
  }
  const [searching, setSearching] = useState<string | null>(null)
  const test = async (id: string, env?: string) => {
    setSearching(id)
    try {
      const r = await connApi.test(id, env || undefined)
      if (r.ok) toast.success(env ? `连接测试通过（${env}）` : "连接测试通过")
      else toast.error(`测试失败：${r.error ?? "未知错误"}`)
      // 静默刷新该行状态，不触发整列表 loading 闪烁（修复"点测试列表会变"）
      pagedApi.connections({ page: params.page, pageSize: params.pageSize, search: params.search ?? "" })
        .then((r2) => { setRows(r2.items as unknown as ConnectionDTO[]); setTotal(r2.total) })
        .catch(() => undefined)
    } catch (e) { toast.error((e as Error).message) }
    finally { setSearching(null) }
  }

  const runDryRun = async () => {
    try {
      const r = await connApi.dryRunSign({
        kind: form.kind, script: form.authScript,
        secret: form.secret === "" ? null : form.secret,
        envVars: typeof form.secret === "object" ? form.secret : undefined,
      })
      setDryRun(r)
    } catch (e) { toast.error((e as Error).message); setDryRun(null) }
  }

  // 按协议分 tab（用户建议）
  const [protoFilter, setProtoFilter] = useState("all")
  const protoCounts = rows.reduce<Record<string, number>>((acc, c) => {
    const p = c.protocol || "http-api"
    acc[p] = (acc[p] ?? 0) + 1
    return acc
  }, {})
  const protoTabs = [{ value: "all", label: "全部" }, ...PROTOCOLS.filter((p) => protoCounts[p.value])]
  const filtered = rows
    .filter((c) => !search || c.name.toLowerCase().includes(search.toLowerCase()))
    .filter((c) => protoFilter === "all" || (c.protocol || "http-api") === protoFilter)

  const setEnv = (i: number, patch: Partial<EnvForm>) =>
    set({ environments: form.environments.map((e, j) => (j === i ? { ...e, ...patch } : e)) })

  return (
    <PageContainer wide className="space-y-3">
      <PageHeader
        title="Connections"
        description="凭证与外部系统连接（加密存储，Secret 不回显；支持多环境域名与自定义鉴权脚本）"
        actions={<Button className="bg-black text-white hover:bg-neutral-800" onClick={openCreate}><Plus className="size-4" /> 创建连接</Button>}
      />
      <FilterBar>
        <SearchField value={search} onChange={setSearch} placeholder="搜索 Connection..." />
      </FilterBar>

      {/* 按协议分 tab（用户建议：分区域/分 tab 展示） */}
      <div className="flex flex-wrap items-center gap-1 border-b pb-2" style={{ borderColor: "#EDF0F4" }}>
        {protoTabs.map((t) => (
          <button key={t.value}
            className={`rounded-md px-3 py-1 text-xs ${protoFilter === t.value ? "bg-[#1F2329] text-white" : "text-muted-foreground hover:bg-muted"}`}
            onClick={() => setProtoFilter(t.value)}>
            {t.label}{t.value !== "all" && protoCounts[t.value] ? ` (${protoCounts[t.value]})` : ""}
          </button>
        ))}
      </div>

      {loading ? (
        <CardGridSkeleton count={4} />
      ) : filtered.length === 0 ? (
        <EmptyState title="暂无连接" description="创建第一个连接，安全托管凭证" />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((c) => {
            const lifecycle = (c.lifecycle ?? c.status) as string
            const health = c.health ?? "untested"
            const lifeCls = lifecycle === "active" ? "text-emerald-600"
              : lifecycle === "archived" ? "text-neutral-400" : "text-amber-600"
            const healthCls = health === "healthy" ? "text-emerald-600"
              : health === "untested" ? "text-neutral-500"
              : health === "stale" ? "text-amber-600" : "text-red-500"
            const healthLabel = { untested: "未测试", healthy: "健康", degraded: "降级", failed: "失败", stale: "已过时" }[health] ?? health
            return (
            <div key={c.id} className="group flex min-h-32 flex-col rounded-lg border bg-card p-3.5 hover:border-muted-foreground/40">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#1F2329]">
                    <KeyRound className="size-4 text-white" />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{c.name}</div>
                    <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {kindLabel(c.kind)} · {protocolLabel(c.protocol)}
                      {(c.environments?.length ?? 0) > 0 ? ` · ${c.environments!.length} 环境` : ""}
                      {c.providerHint ? ` · ${c.providerHint}` : ""}
                    </div>
                  </div>
                </div>
                {/* SDD-12 §11：生命周期与健康度分离展示（untested 不显示为 healthy） */}
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Badge variant="secondary" className={`text-[10px] ${lifeCls}`}>{lifecycle}</Badge>
                  <Badge variant="outline" className={`text-[10px] ${healthCls}`}>{healthLabel}</Badge>
                </div>
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {c.secretConfigured
                  ? `凭据已配置 · 版本 ${c.secretRevision?.versionNo ?? 1}${c.secretRevision?.rotatedAt ? ` · 轮换于 ${c.secretRevision.rotatedAt.slice(0, 10)}` : ""}`
                  : "未配置密钥"}
              </div>
              <div className="mt-auto flex flex-wrap items-center justify-end gap-2 pt-2 text-[11px]">
                <button className="rounded border px-1.5 py-0.5 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100" onClick={() => openEdit(c)}>编辑</button>
                <button className="rounded border px-1.5 py-0.5 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100 disabled:opacity-50" disabled={searching === c.id} onClick={() => test(c.id)}>{searching === c.id ? "测试中…" : "测试"}</button>
                {lifecycle === "draft" && (
                  <button className="rounded border px-1.5 py-0.5 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100" onClick={() => enable(c)}>启用</button>
                )}
                {lifecycle === "active" && (
                  <button className="rounded border px-1.5 py-0.5 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100" onClick={() => disable(c)}>停用</button>
                )}
                <button className="rounded border px-1.5 py-0.5 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100" onClick={() => rotate(c)}>轮换凭据</button>
                {c.secretConfigured && (
                  <button className="rounded border px-1.5 py-0.5 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100" onClick={() => clearSecret(c)}>清除凭据</button>
                )}
                <button aria-label={`删除连接 ${c.name}`} className="rounded border px-1.5 py-0.5 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100" onClick={() => del(c)}>
                  <Trash2 className="size-3" />
                </button>
              </div>
            </div>
            )
          })}
        </div>
      )}

      <Pagination page={params.page ?? 1} pageSize={params.pageSize ?? 12} total={total}
        pageSizeOptions={[12, 24, 48]} onPageChange={(pg) => update({ page: pg })} onPageSizeChange={(n) => update({ pageSize: n }, true)} />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader><DialogTitle>{form.id ? "编辑连接" : "创建连接"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">名称</Label><Input value={form.name} onChange={(e) => set({ name: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">鉴权方式</Label>
                <Select value={form.kind} onValueChange={(v) => set({ kind: v, secret: "" })}>
                  <SelectTrigger className="h-9 w-full text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {KINDS.map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">协议</Label>
                <Select value={form.protocol} onValueChange={(v) => set({ protocol: v })}>
                  <SelectTrigger className="h-9 w-full text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PROTOCOLS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label className="text-xs">默认端点</Label>
              <EndpointFields protocol={form.protocol} v={form} onChange={(p) => set(p)} />
            </div>

            {/* 多环境域名（R4） */}
            <div className="space-y-2 rounded-md border p-2.5" style={{ borderColor: "#EDF0F4" }}>
              <div className="flex items-center justify-between">
                <Label className="text-xs">环境域名（可选；按环境覆盖端点/凭据）</Label>
                <Button variant="outline" size="sm" type="button"
                  onClick={() => set({ environments: [...form.environments, { ...EMPTY_EP, code: "", label: "", hasSecret: false, secret: "" }] })}>
                  <Plus className="size-3" /> 添加环境
                </Button>
              </div>
              <RadioGroup value={form.defaultEnv} onValueChange={(v) => set({ defaultEnv: v })} className="space-y-2">
              {form.environments.map((e, i) => (
                <div key={i} className="space-y-2 rounded border bg-muted/20 p-2">
                  <div className="grid grid-cols-[110px_1fr_auto_auto] gap-2">
                    <Select value={e.code ? (ENV_PRESETS.some((p) => p.code === e.code) ? e.code : "__custom") : undefined}
                      onValueChange={(v) => {
                        if (v === "__custom") { setEnv(i, { code: "" }); return }
                        const p = ENV_PRESETS.find((x) => x.code === v)!
                        setEnv(i, { code: p.code, label: p.label })
                      }}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="环境" /></SelectTrigger>
                      <SelectContent>
                        {ENV_PRESETS.map((p) => <SelectItem key={p.code} value={p.code}>{p.code} · {p.label}</SelectItem>)}
                        <SelectItem value="__custom">自定义…</SelectItem>
                      </SelectContent>
                    </Select>
                    {ENV_PRESETS.some((p) => p.code === e.code) ? (
                      <Input className="h-8" value={e.label} onChange={(ev) => setEnv(i, { label: ev.target.value })} placeholder="标签" />
                    ) : (
                      <Input className="h-8 font-mono text-xs" value={e.code} onChange={(ev) => setEnv(i, { code: ev.target.value.toLowerCase() })} placeholder="环境码，如 sandbox" />
                    )}
                    <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <RadioGroupItem value={e.code || `__empty_${i}`} disabled={!e.code} id={`default-env-${i}`} /> 默认
                    </label>
                    <button type="button" className="text-neutral-400 hover:text-red-500"
                      onClick={() => set({ environments: form.environments.filter((_, j) => j !== i), defaultEnv: form.defaultEnv === e.code ? "" : form.defaultEnv })}>
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                  <EndpointFields protocol={form.protocol} v={e} onChange={(p) => setEnv(i, p)} />
                  <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Checkbox checked={e.hasSecret} onCheckedChange={(c) => setEnv(i, { hasSecret: c === true, secret: c === true ? (e.secret || (form.kind === "api_key" || form.kind === "bearer" ? "" : {})) : "" })} />
                    该环境使用独立凭据（否则用连接级密钥）
                  </label>
                  {e.hasSecret && <SecretFields kind={form.kind} value={e.secret} onChange={(v) => setEnv(i, { secret: v })} />}
                </div>
              ))}
              </RadioGroup>
            </div>

            <div><Label className="text-xs">提供方（可选）</Label><Input value={form.providerHint} onChange={(e) => set({ providerHint: e.target.value })} placeholder="如 阿里云百炼 / MySQL / MinIO" /></div>

            {form.kind === "script" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">鉴权脚本（JS，沙箱执行；换算法改脚本不发版）</Label>
                  <Button variant="outline" size="sm" type="button" onClick={() => set({ authScript: AKSK_TEMPLATE })}>填入 AkSk 模板</Button>
                </div>
                <Textarea className="min-h-[160px] bg-muted/30 font-mono text-xs"
                  value={form.authScript} onChange={(e) => set({ authScript: e.target.value })}
                  placeholder="pm.environment.get / pm.request.headers.add / CryptoJS / btoa 可用" />
                <Button variant="outline" size="sm" type="button" onClick={runDryRun}><Play className="size-3" /> 空跑生成请求头</Button>
                {dryRun && (
                  <pre className="max-h-40 overflow-auto rounded-md bg-muted/40 p-2 text-[10px]">
                    {JSON.stringify(dryRun.headers, null, 2)}{dryRun.logs.length ? `\n-- console --\n${dryRun.logs.join("\n")}` : ""}
                  </pre>
                )}
              </div>
            )}

            {form.kind !== "none" && (
              <div>
                <Label className="text-xs">
                  连接级密钥（加密存储{form.id ? "；留空=保留原密钥，保存时填写=轮换" : ""}）
                </Label>
                {form.kind === "api_key" || form.kind === "bearer" ? (
                  <div className="relative">
                    <Input type={showSecret ? "text" : "password"} className="pr-9" autoComplete="new-password"
                      value={typeof form.secret === "string" ? form.secret : ""}
                      onChange={(e) => set({ secret: e.target.value })}
                      placeholder={form.id ? "已保存的密钥不可回显；留空保留或填写新值轮换" : ""} />
                    {/* SDD-12 B-01：仅切换本地可见性，不再从服务端回显明文 */}
                    <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
                      onClick={() => setShowSecret((v) => !v)} title={showSecret ? "隐藏" : "显示"}>
                      {showSecret ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                ) : (
                  <SecretFields kind={form.kind} value={form.secret} onChange={(v) => set({ secret: v })} />
                )}
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            {form.id && (
              <div className="mr-auto flex items-center gap-2">
                {form.environments.length > 0 && (
                  <Select value={testEnv || "__default"} onValueChange={(v) => setTestEnv(v === "__default" ? "" : v)}>
                    <SelectTrigger className="h-8 w-[110px] text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__default">默认环境</SelectItem>
                      {form.environments.filter((e) => e.code).map((e) => <SelectItem key={e.code} value={e.code}>{e.code}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
                <Button variant="outline" size="sm" disabled={searching === form.id} onClick={() => test(form.id!, testEnv || undefined)}>
                  {searching === form.id ? "测试中…" : "测试连接"}
                </Button>
              </div>
            )}
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button className="bg-black text-white hover:bg-neutral-800"
              disabled={!form.name.trim() || (!form.id && form.kind !== "none" && form.kind !== "script" && form.secret === "")}
              onClick={submit}>
              {form.id ? "保存" : "创建"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
