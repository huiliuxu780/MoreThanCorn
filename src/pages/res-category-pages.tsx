import { useEffect, useState } from "react"
import { WfConnectionsContent } from "@/pages/wf-connections"
import { Pencil, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Link } from "react-router-dom"
import { IA_BOUNDARY } from "@/config/ui-terms"
import { ResCategoryList } from "@/pages/res-list"
import { FilterBar } from "@/components/app/filters"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ConnectionPicker } from "@/components/resources/connection-picker"
import { pagedApi, providerApi } from "@/services/wf-api"
import { connApi, resApi } from "@/services/resource-api"
import { asApi } from "@/services/as-api"

/** docs/v2-design/10 §4.3–4.5：壳内分类页（工具与 MCP / 知识库 / 数据资产）。 */
export function ResToolsPage() {
  return <ResCategoryList types={["tool", "mcp"]} createTo="/resources/ai/new" />
}

export function ResKnowledgePage() {
  const [kbStatus, setKbStatus] = useState<{
    status: string
    reasons: string[]
  } | null>(null)
  useEffect(() => {
    // 09-13 审计修复：原生 fetch 收口到服务层
    let alive = true
    asApi.kbConfigStatus()
      .then((d) => {
        if (alive && d)
          setKbStatus({ status: String(d.status ?? ""),
                        reasons: (d.reasons as string[] | undefined) ?? [] })
      })
      .catch(() => undefined)
    return () => { alive = false }
  }, [])
  return (
    <div className="space-y-3">
      {kbStatus && (
        <div
          className={`rounded-md border px-3 py-2 text-xs ${
            kbStatus.status === "NOT_CONFIGURED"
              ? "border-amber-400/60 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100"
              : "border-emerald-400/60 bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
          }`}
          data-testid="knowledge-status"
        >
          <span className="font-medium">
            Knowledge 状态：{kbStatus.status === "NOT_CONFIGURED" ? "NOT_CONFIGURED（未配置火山引擎/embedding 鉴权）" : "READY"}
          </span>
          {kbStatus.reasons.length > 0 && (
            <span className="ml-2 text-muted-foreground">{kbStatus.reasons.join("；")}</span>
          )}
          <span className="ml-2">发布链同口径 fail-closed：不可用时阻止发布，不伪造 KB。</span>
        </div>
      )}
      <ResCategoryList types={["knowledge"]} createTo="/resources/ai/new" />
    </div>
  )
}

/** 09-14 终版 IA：连接唯一归属=能力与资源→连接（凭据/多环境/轮换/健康）。 */
export function ResConnectionsPage() {
  return <WfConnectionsContent embedded />
}

/** 09-14 终版 IA：目录挂载唯一入口=数据资产页（连接选→目录选→挂载）。 */
function CatalogMountDialog({ open, onOpenChange, onMounted }: {
  open: boolean; onOpenChange: (v: boolean) => void; onMounted: () => void
}) {
  const [conns, setConns] = useState<{ id: string; name: string; protocol: string }[]>([])
  const [connId, setConnId] = useState("")
  const [items, setItems] = useState<{ name: string; kind: string; partitioned?: boolean; comment?: string; schema?: string }[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [mounting, setMounting] = useState<string | null>(null)
  useEffect(() => {
    if (open) connApi.list({}).then((r) => setConns(r.items)).catch(() => setConns([]))
  }, [open])
  const loadCatalog = async (cid: string) => {
    setItems(null); setErr(null)
    try {
      const r = await connApi.catalog(cid)
      setItems(r.items)
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  const mount = async (item: { name: string; partitioned?: boolean; comment?: string; schema?: string }) => {
    setMounting(item.name)
    try {
      const conn = conns.find((c) => c.id === connId)
      const cep = ((conn as unknown as { endpoint?: Record<string, unknown> })?.endpoint ?? {})
      const loc = String(cep.project ?? cep.database ?? "")
      const existing = (await resApi.list("datasource", { pageSize: 100 })).items
        .find((d) => (d as unknown as { connection_id?: string }).connection_id === connId)
      const dsId = existing ? existing.id
        : (await resApi.create("datasource", {
            name: `${conn?.protocol ?? ""}·${loc || (conn?.name ?? "")}`,
            type: conn?.protocol ?? "postgresql", connection_id: connId, location: loc,
          })).id
      await resApi.create("asset", {
        name: item.name, source: "catalog", datasource_id: dsId, location: item.name,
        record_meaning: "一行记录", record_id_field: "id", time_field: "gmt_create",
        config: { partitioned: !!item.partitioned, comment: item.comment ?? "", schema: item.schema ?? "" },
      })
      toast.success(`已挂载为数据资产：${item.name}`)
      onMounted()
    } catch (e) {
      toast.error(`挂载失败：${(e as Error).message}`)
    } finally {
      setMounting(null)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>从连接目录挂载表 / 日志库</DialogTitle>
        </DialogHeader>
        <div className="grid gap-1">
          <Label id="mount-conn-label">Connection</Label>
          <select className="h-9 rounded-md border bg-transparent px-2 text-sm"
                  aria-labelledby="mount-conn-label"
                  value={connId}
                  onChange={(e) => { setConnId(e.target.value); void loadCatalog(e.target.value) }}>
            <option value="">选择连接…</option>
            {conns.map((c) => <option key={c.id} value={c.id}>{c.name}（{c.protocol}）</option>)}
          </select>
        </div>
        {err ? (
          <div className="rounded-md border px-3 py-2 text-sm" style={{ color: "var(--status-danger-text)" }}>
            目录发现失败：{err}
          </div>
        ) : items === null ? (
          <p className="text-sm text-muted-foreground">{connId ? "发现中…" : "选择连接后展示其表/日志库目录"}</p>
        ) : (
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b text-left text-[11px] text-muted-foreground">
                <th className="px-2 py-1.5 font-medium">名称</th>
                <th className="px-2 py-1.5 font-medium">类型</th>
                <th className="px-2 py-1.5 font-medium">分区</th>
                <th className="px-2 py-1.5 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.name} className="border-b last:border-b-0">
                  <td className="px-2 py-1.5" title={it.comment}>{it.name}</td>
                  <td className="px-2 py-1.5">{it.kind}</td>
                  <td className="px-2 py-1.5">{it.partitioned ? "是" : "—"}</td>
                  <td className="px-2 py-1.5 text-right">
                    <button className="rounded border px-1.5 py-0.5 hover:bg-muted"
                            disabled={mounting === it.name}
                            onClick={() => void mount(it)}>
                      {mounting === it.name ? "挂载中…" : "挂载"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function ResDataPage() {
  const [mountOpen, setMountOpen] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  return (
    <div className="flex flex-col gap-3">
      {/* 09-14 D4 拍板：双「数据源」边界说明条（文案取自 ui-terms 单一事实源） */}
      <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-xs"
           style={{ borderColor: "var(--brand-subtle)", background: "var(--brand-soft)",
                    color: "var(--text-secondary)" }}>
        <span>ℹ︎ {IA_BOUNDARY.assets.text}</span>
        <Link to={IA_BOUNDARY.assets.to} className="font-medium"
              style={{ color: "var(--brand-primary)" }}>{IA_BOUNDARY.assets.linkText}</Link>
        <span className="ml-auto">
          <Button size="sm" variant="outline" onClick={() => setMountOpen(true)}>从连接目录挂载</Button>
        </span>
      </div>
      <ResCategoryList key={reloadKey} types={["datasource", "asset"]} createTo="/resources/data/new" />
      <CatalogMountDialog open={mountOpen} onOpenChange={setMountOpen}
                          onMounted={() => setReloadKey((k) => k + 1)} />
    </div>
  )
}

interface ProviderRow { id: string; name: string; baseUrl: string; connectionId: string | null }

/** docs/v2-design/10 §4.2：模型接入 = 接入渠道（ModelProvider CRUD）+ 模型目录。 */
export function ResModelsPage() {
  const [tab, setTab] = useState("channels")
  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList>
        <TabsTrigger value="channels">接入渠道</TabsTrigger>
        <TabsTrigger value="catalog">模型目录</TabsTrigger>
      </TabsList>
      <TabsContent value="channels"><ProvidersPanel /></TabsContent>
      <TabsContent value="catalog">
        <ResCategoryList types={["model"]} createTo="/resources/ai/new" />
      </TabsContent>
    </Tabs>
  )
}

function ProvidersPanel() {
  const [rows, setRows] = useState<ProviderRow[]>([])
  const [conns, setConns] = useState<Record<string, string>>({})
  const [edit, setEdit] = useState<ProviderRow | "new" | null>(null)
  const [del, setDel] = useState<ProviderRow | null>(null)

  const load = () => {
    pagedApi.providers({ page: 1, pageSize: 100 })
      .then((r) => setRows(r.items as unknown as ProviderRow[]))
      .catch(() => setRows([]))
    pagedApi.connections({ page: 1, pageSize: 100 })
      .then((r) => {
        const m: Record<string, string> = {}
        for (const c of r.items as { id: string; name: string }[]) m[c.id] = c.name
        setConns(m)
      })
      .catch(() => undefined)
  }
  useEffect(() => { load() }, [])

  const remove = async () => {
    if (!del) return
    try {
      await providerApi.remove(del.id)
      toast.success(`已删除渠道「${del.name}」`)
      setDel(null)
      load()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <div className="space-y-3">
      <FilterBar>
        <span className="ml-auto" />
        <Button onClick={() => setEdit("new")}><Plus className="size-4" /> 新建接入渠道</Button>
      </FilterBar>
      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-surface-muted text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">名称</th>
              <th className="px-3 py-2 font-medium">baseUrl</th>
              <th className="px-3 py-2 font-medium">凭据 Connection</th>
              <th className="px-3 py-2 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-8 text-center text-xs text-muted-foreground">暂无接入渠道</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-b last:border-0">
                <td className="px-3 py-2 font-medium">{r.name}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.baseUrl || "—"}</td>
                <td className="px-3 py-2 text-xs">{r.connectionId ? conns[r.connectionId] ?? r.connectionId : "—"}</td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" className="size-7" title="编辑" aria-label={`编辑 ${r.name}`} onClick={() => setEdit(r)}>
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="size-7" title="删除" aria-label={`删除 ${r.name}`} onClick={() => setDel(r)}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        门禁：生产环境禁止注册/保留 mock:// 渠道（P0-01）。凭据仅引用 Connection，渠道本身不落密钥。
      </p>
      {edit && <ProviderDialog initial={edit === "new" ? null : edit}
        onClose={() => setEdit(null)} onSaved={load} />}
      {del && (
        <Dialog open onOpenChange={(o) => !o && setDel(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>删除接入渠道</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">
              确认删除「{del.name}」？其下模型将失去渠道引用。
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDel(null)}>取消</Button>
              <Button variant="destructive" onClick={remove}>删除</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

function ProviderDialog({ initial, onClose, onSaved }: {
  initial: ProviderRow | null
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(initial?.name ?? "")
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? "")
  const [connId, setConnId] = useState(initial?.connectionId ?? "")

  const save = async () => {
    if (!name.trim()) { toast.error("名称必填"); return }
    try {
      if (initial) {
        await providerApi.update(initial.id, { name: name.trim(), baseUrl, connectionId: connId || null })
      } else {
        await providerApi.create({ name: name.trim(), baseUrl, connectionId: connId || null })
      }
      toast.success(initial ? "已保存渠道" : "已创建渠道")
      onClose()
      onSaved()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{initial ? "编辑接入渠道" : "新建接入渠道"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="pv-name">名称</Label>
            <Input id="pv-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="DashScope 渠道" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pv-url">baseUrl</Label>
            <Input id="pv-url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1" className="font-mono text-xs" />
          </div>
          <div className="space-y-1">
            <Label>凭据 Connection（llm 协议）</Label>
            <ConnectionPicker value={connId} onChange={setConnId} protocols={["llm"]} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={save}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
