/** Connections — 真 API + 卡片网格。路由 /settings/connections。
 * 用户报告修复：补编辑入口（PUT），创建/编辑表单支持多种鉴权（API Key/Bearer/Basic Auth）、
 * 协议与端点；统一走 connApi 服务层（SDD D-3）。 */
import { KeyRound, Plus, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"
import { useListQuery } from "@/hooks/use-list-query"
import { Pagination } from "@/components/app/pagination"
import { pagedApi } from "@/services/wf-api"
import { connApi } from "@/services/resource-api"
import { toast } from "sonner"

import { FilterBar, SearchField } from "@/components/app/filters"
import { CardGridSkeleton, EmptyState } from "@/components/app/list-state"
import { PageContainer, PageHeader } from "@/components/app/page"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

interface ConnRow {
  id: string; name: string; kind: string; protocol: string; status: string;
  endpoint: Record<string, string>; providerHint: string; secretConfigured: boolean
}

const KINDS = [
  { value: "api_key", label: "API Key" },
  { value: "bearer", label: "Bearer Token" },
  { value: "basic", label: "Basic Auth" },
]
const KIND_LABEL: Record<string, string> = Object.fromEntries(KINDS.map((k) => [k.value, k.label]))
const kindLabel = (k: string) => KIND_LABEL[k] ?? KIND_LABEL[k.toLowerCase().replace(/\s+/g, "_")] ?? k

const PROTOCOLS = [
  { value: "http-api", label: "HTTP API" },
  { value: "llm", label: "LLM" },
  { value: "mcp-http", label: "MCP" },
  { value: "mysql", label: "MySQL" },
  { value: "postgresql", label: "PostgreSQL" },
  { value: "oss", label: "OSS" },
]
const protocolLabel = (p: string) => PROTOCOLS.find((x) => x.value === p)?.label ?? p
const isDb = (p: string) => p === "mysql" || p === "postgresql"
const isOss = (p: string) => p === "oss"

interface FormState {
  id: string | null; name: string; kind: string; protocol: string;
  baseUrl: string; host: string; port: string; bucket: string; region: string;
  providerHint: string; secret: string
}
const EMPTY_FORM: FormState = {
  id: null, name: "", kind: "api_key", protocol: "http-api",
  baseUrl: "", host: "", port: "", bucket: "", region: "", providerHint: "", secret: "",
}

function endpointOf(f: FormState): Record<string, string> {
  if (isDb(f.protocol)) return { host: f.host, port: f.port }
  if (isOss(f.protocol)) return { bucket: f.bucket, region: f.region }
  return { base_url: f.baseUrl }
}

export default function WfConnectionsPage() {
  const [rows, setRows] = useState<ConnRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }))

  const { params, update } = useListQuery(12)
  const [total, setTotal] = useState(0)
  const load = () => {
    setLoading(true)
    pagedApi.connections({ page: params.page, pageSize: params.pageSize, search: params.search ?? "" }).then((r) => {
      setRows(r.items as unknown as ConnRow[]); setTotal(r.total); setLoading(false)
    }).catch(() => setLoading(false))
  }
  useEffect(() => { load() }, [params.page, params.pageSize, params.search])

  const filtered = rows.filter((c) => !search || c.name.toLowerCase().includes(search.toLowerCase()))

  const openCreate = () => { setForm(EMPTY_FORM); setOpen(true) }
  const openEdit = (c: ConnRow) => {
    setForm({
      id: c.id, name: c.name, kind: KIND_LABEL[c.kind] ? c.kind : "api_key",
      protocol: c.protocol || "http-api",
      baseUrl: c.endpoint?.base_url ?? "", host: c.endpoint?.host ?? "", port: c.endpoint?.port ?? "",
      bucket: c.endpoint?.bucket ?? "", region: c.endpoint?.region ?? "",
      providerHint: c.providerHint ?? "", secret: "",
    })
    setOpen(true)
  }

  const submit = async () => {
    const body = {
      name: form.name.trim(), kind: form.kind, protocol: form.protocol,
      endpoint: endpointOf(form), providerHint: form.providerHint.trim(),
      ...(form.secret ? { secret: form.secret } : {}),
    }
    try {
      if (form.id) {
        await connApi.update(form.id, body)
        toast.success("连接已更新")
      } else {
        if (!form.secret.trim()) { toast.error("创建连接需要填写 Secret"); return }
        await connApi.create(body)
        toast.success("连接已创建")
      }
      setOpen(false); load()
    } catch (e) { toast.error((e as Error).message) }
  }

  const del = async (id: string) => {
    try { await connApi.remove(id); load() }
    catch (e) { toast.error((e as Error).message) }
  }
  const test = async (id: string) => {
    try { const r = await connApi.test(id); r.ok ? toast.success("连接测试通过") : toast.error(`测试失败：${r.error ?? "未知错误"}`); load() }
    catch (e) { toast.error((e as Error).message) }
  }

  return (
    <PageContainer wide className="space-y-3">
      <PageHeader
        title="Connections"
        description="凭证与外部系统连接（加密存储，Secret 不回显）"
        actions={<Button className="bg-black text-white hover:bg-neutral-800" onClick={openCreate}><Plus className="size-4" /> 创建连接</Button>}
      />
      <FilterBar>
        <SearchField value={search} onChange={setSearch} placeholder="搜索 Connection..." />
      </FilterBar>

      {loading ? (
        <CardGridSkeleton count={4} />
      ) : filtered.length === 0 ? (
        <EmptyState title="暂无连接" description="创建第一个连接，安全托管凭证" />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((c) => (
            <div key={c.id} className="group flex h-32 flex-col rounded-lg border bg-card p-3.5 hover:border-muted-foreground/40">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#1F2329]">
                    <KeyRound className="size-4 text-white" />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{c.name}</div>
                    <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {kindLabel(c.kind)} · {protocolLabel(c.protocol)}{c.providerHint ? ` · ${c.providerHint}` : ""} · {c.secretConfigured ? "••••••" : "未配置密钥"}
                    </div>
                  </div>
                </div>
                <Badge variant="secondary" className={`shrink-0 text-[10px] ${c.status === "active" ? "text-emerald-600" : "text-red-500"}`}>{c.status}</Badge>
              </div>
              <div className="mt-auto flex items-center justify-end gap-2 pt-2 text-[11px]">
                <button className="rounded border px-1.5 py-0.5 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100" onClick={() => openEdit(c)}>编辑</button>
                <button className="rounded border px-1.5 py-0.5 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100" onClick={() => test(c.id)}>测试</button>
                <button className="rounded border px-1.5 py-0.5 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100" onClick={() => del(c.id)}>
                  <Trash2 className="size-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Pagination page={params.page ?? 1} pageSize={params.pageSize ?? 12} total={total}
        pageSizeOptions={[12, 24, 48]} onPageChange={(pg) => update({ page: pg })} onPageSizeChange={(n) => update({ pageSize: n }, true)} />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{form.id ? "编辑连接" : "创建连接"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">名称</Label><Input value={form.name} onChange={(e) => set({ name: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">鉴权方式</Label>
                <Select value={form.kind} onValueChange={(v) => set({ kind: v })}>
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
            {isDb(form.protocol) ? (
              <div className="grid grid-cols-[1fr_100px] gap-3">
                <div><Label className="text-xs">Host</Label><Input value={form.host} onChange={(e) => set({ host: e.target.value })} placeholder="db.internal" /></div>
                <div><Label className="text-xs">Port</Label><Input value={form.port} onChange={(e) => set({ port: e.target.value })} placeholder={form.protocol === "mysql" ? "3306" : "5432"} /></div>
              </div>
            ) : isOss(form.protocol) ? (
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-xs">Bucket</Label><Input value={form.bucket} onChange={(e) => set({ bucket: e.target.value })} /></div>
                <div><Label className="text-xs">Region</Label><Input value={form.region} onChange={(e) => set({ region: e.target.value })} placeholder="oss-cn-hangzhou" /></div>
              </div>
            ) : (
              <div><Label className="text-xs">Base URL</Label><Input value={form.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1" /></div>
            )}
            <div><Label className="text-xs">提供方（可选）</Label><Input value={form.providerHint} onChange={(e) => set({ providerHint: e.target.value })} placeholder="如 阿里云百炼 / MySQL / MinIO" /></div>
            <div>
              <Label className="text-xs">Secret（加密存储{form.id ? "，留空=保留原密钥" : ""}）</Label>
              <Input type="password" value={form.secret} onChange={(e) => set({ secret: e.target.value })} placeholder={form.id ? "••••••（已配置则留空）" : ""} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button className="bg-black text-white hover:bg-neutral-800" disabled={!form.name.trim() || (!form.id && !form.secret.trim())} onClick={submit}>
              {form.id ? "保存" : "创建"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
