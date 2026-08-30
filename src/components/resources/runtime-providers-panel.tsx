/** R8-UI：Runtime Providers 管理面板（资源中心新 Tab，11 §7-② / 原型 v1-②）。
 *  健康列=真探测值+相对时间；凭据仅引用 Connection（不接收明文 Secret）；
 *  config 禁 API Key/Secret/Token（前端提示+服务端 422 兜底）；停用=admin+审计。 */
import { Ban, Pencil, Plus, Power } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"

import { EmptyState, TableSkeleton } from "@/components/app/list-state"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { currentRole } from "@/services/rbac"
import { pagedApi, runtimeProviderApi, type RuntimeProviderDTO } from "@/services/wf-api"

const KINDS = ["agentscope", "deepseek-harness", "external"] as const

function relTime(iso: string | null): string {
  if (!iso) return ""
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return ""
  const m = Math.floor(ms / 60000)
  if (m < 1) return "刚刚"
  if (m < 60) return `${m}m 前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h 前`
  return `${Math.floor(h / 24)}d 前`
}

const HEALTH_STYLE: Record<string, string> = {
  ok: "bg-emerald-50 text-emerald-600",
  degraded: "bg-amber-50 text-amber-600",
  error: "bg-red-50 text-red-600",
}

interface FormState {
  id?: string
  name: string
  kind: string
  baseUrl: string
  connectionId: string
  contractVersion: string
  configText: string
}
const EMPTY_FORM: FormState = { name: "", kind: "agentscope", baseUrl: "", connectionId: "", contractVersion: "1.0", configText: "{}" }

export function RuntimeProvidersPanel() {
  const [items, setItems] = useState<RuntimeProviderDTO[] | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [probing, setProbing] = useState<string | null>(null)
  const [disableTarget, setDisableTarget] = useState<RuntimeProviderDTO | null>(null)
  const [connections, setConnections] = useState<{ id: string; name: string }[]>([])
  // R8-UI-2（11 §7-②）：Module 兼容矩阵只读展示
  const [compat, setCompat] = useState<{ key: string; version: string; implementation: unknown }[]>([])
  const isAdmin = currentRole() === "admin"

  const load = useCallback(() => {
    runtimeProviderApi.list().then((r) => setItems(r.items)).catch(() => setItems([]))
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (sheetOpen) pagedApi.connections({ pageSize: 100 }).then((r) => setConnections(r.items.map((c) => ({ id: c.id, name: c.name })))).catch(() => undefined)
  }, [sheetOpen])

  const openCreate = () => { setForm(EMPTY_FORM); setSheetOpen(true) }
  const openEdit = (p: RuntimeProviderDTO) => {
    runtimeProviderApi.get(p.id).then((d) => {
      setForm({
        id: d.id, name: d.name, kind: d.kind, baseUrl: d.baseUrl,
        connectionId: d.connectionId ?? "", contractVersion: d.contractVersion,
        configText: JSON.stringify(d.config ?? {}, null, 2),
      })
      setCompat(d.compatibleModules ?? [])
      setSheetOpen(true)
    }).catch((e) => toast.error((e as Error).message))
  }

  const submit = async () => {
    if (!form.name.trim()) { toast.error("名称必填"); return }
    if (!/^https?:\/\//.test(form.baseUrl)) { toast.error("Endpoint 必须是 http(s) URL"); return }
    let config: Record<string, unknown> = {}
    try { config = JSON.parse(form.configText || "{}") } catch { toast.error("config 不是合法 JSON"); return }
    const badKey = Object.keys(config).find((k) => /key|secret|token/i.test(k))
    if (badKey) { toast.error(`config 禁止保存密钥字段「${badKey}」——请改用 Connection 引用`); return }
    setSaving(true)
    try {
      const body = {
        name: form.name.trim(), kind: form.kind, baseUrl: form.baseUrl,
        connectionId: form.connectionId || null, contractVersion: form.contractVersion || "1.0", config,
      }
      if (form.id) await runtimeProviderApi.update(form.id, body)
      else await runtimeProviderApi.create(body)
      toast.success(form.id ? "已保存" : "已注册 Provider（draft，探测后可启用）")
      setSheetOpen(false); load()
    } catch (e) { toast.error((e as Error).message) } finally { setSaving(false) }
  }

  const probe = async (p: RuntimeProviderDTO) => {
    setProbing(p.id)
    try {
      const r = await runtimeProviderApi.probe(p.id)
      toast.success(r.ok ? `探测通过（${r.healthStatus ?? "ok"}）` : `探测完成：${r.healthStatus ?? "unknown"}`)
      load()
    } catch (e) { toast.error((e as Error).message) } finally { setProbing(null) }
  }

  const rowActionCls = "rounded border px-1.5 py-0.5 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100 disabled:opacity-40"

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Agent 执行底座（与模型供应商分离）；停用需 admin 并写审计。</p>
        <Button className="bg-black text-white hover:bg-neutral-800" onClick={openCreate}><Plus className="size-4" /> 注册 Provider</Button>
      </div>

      {items === null ? <TableSkeleton rows={4} columns={7} /> : items.length === 0 ? (
        <EmptyState title="暂无 Runtime Provider" description="点击右上角「注册 Provider」开始" />
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Endpoint</TableHead>
                <TableHead>Contract</TableHead>
                <TableHead>健康</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="w-40" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((p) => (
                <TableRow key={p.id} className="group">
                  <TableCell className="text-sm font-medium">{p.name}</TableCell>
                  <TableCell className="font-mono text-xs">{p.kind}</TableCell>
                  <TableCell className="max-w-44 truncate font-mono text-xs text-muted-foreground">{p.baseUrl}</TableCell>
                  <TableCell className="text-xs">{p.contractVersion}</TableCell>
                  <TableCell>
                    <span className={`rounded px-1.5 py-0.5 text-[11px] ${HEALTH_STYLE[p.healthStatus ?? ""] ?? "bg-muted text-muted-foreground"}`}>
                      {p.healthStatus ?? "未探测"}{p.lastHealthAt ? ` · ${relTime(p.lastHealthAt)}` : ""}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className={`rounded px-1.5 py-0.5 text-[11px] ${p.status === "enabled" ? "bg-emerald-50 text-emerald-600" : p.status === "disabled" ? "bg-amber-50 text-amber-600" : "bg-muted text-muted-foreground"}`}>
                      {p.status === "disabled" ? "已停用，历史可查" : p.status}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <button className={rowActionCls} disabled={probing === p.id} onClick={() => probe(p)}>
                        {probing === p.id ? "探测中…" : "探测"}
                      </button>
                      {p.status === "disabled" ? (
                        <button className={rowActionCls} onClick={async () => {
                          try { await runtimeProviderApi.enable(p.id); toast.success(`已启用「${p.name}」`); load() }
                          catch (e) { toast.error((e as Error).message) }
                        }}><span className="inline-flex items-center gap-1"><Power className="size-3" />启用</span></button>
                      ) : (
                        <button className={rowActionCls} disabled={!isAdmin}
                          title={isAdmin ? "停用（admin，写审计）" : "需要 admin 角色"}
                          onClick={() => setDisableTarget(p)}><span className="inline-flex items-center gap-1"><Ban className="size-3" />停用</span></button>
                      )}
                      <button className={rowActionCls} onClick={() => openEdit(p)}><span className="inline-flex items-center gap-1"><Pencil className="size-3" />编辑</span></button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* 注册/编辑抽屉 */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-[440px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{form.id ? "编辑 Provider" : "注册 Provider"}</SheetTitle>
            <SheetDescription>凭据仅引用既有 Connection；config 禁止 API Key/Secret/Token。</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">名称</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如：AgentScope 生产" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Kind</Label>
              <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v })} disabled={!!form.id}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{KINDS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Endpoint（baseUrl，出站过 Egress）</Label>
              <Input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="http://127.0.0.1:8301" className="font-mono text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">凭据（引用 Connection，不接收明文 Secret）</Label>
              <Select value={form.connectionId || "__none__"} onValueChange={(v) => setForm({ ...form, connectionId: v === "__none__" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="（无凭据）" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">（无凭据）</SelectItem>
                  {connections.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">contractVersion</Label>
              <Input value={form.contractVersion} onChange={(e) => setForm({ ...form, contractVersion: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">config（JSON；禁 API Key/Secret/Token，服务端校验拒绝）</Label>
              <Textarea value={form.configText} onChange={(e) => setForm({ ...form, configText: e.target.value })} className="min-h-24 font-mono text-xs" />
            </div>
            {form.id && (
              <div className="space-y-1.5">
                <Label className="text-xs">capabilities（probe 后只读）</Label>
                <pre className="max-h-40 overflow-auto rounded border bg-muted/40 p-2 text-[11px]">
                  {JSON.stringify(items?.find((x) => x.id === form.id)?.capabilities ?? {}, null, 1)}
                </pre>
              </div>
            )}
            {form.id && compat.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs">Module 兼容矩阵（manifest 声明，只读）</Label>
                <div className="space-y-1">
                  {compat.map((m) => (
                    <div key={`${m.key}@${m.version}`} className="flex items-center justify-between rounded border px-2 py-1 text-[11px]">
                      <span className="font-mono">{m.key}@{m.version}</span>
                      <span className="text-muted-foreground">{typeof m.implementation === "string" ? m.implementation : JSON.stringify(m.implementation)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <Button className="w-full bg-black text-white hover:bg-neutral-800" disabled={saving} onClick={submit}>
              {saving ? "保存中…" : form.id ? "保存" : "注册"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* 停用确认 */}
      <Dialog open={disableTarget !== null} onOpenChange={(o) => !o && setDisableTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>停用「{disableTarget?.name}」？</DialogTitle>
            <DialogDescription>停用只影响后续提交，不影响历史 Run（列表徽标「已停用，历史可查」）。该操作写审计日志。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisableTarget(null)}>取消</Button>
            <Button variant="destructive" onClick={async () => {
              if (!disableTarget) return
              try {
                await runtimeProviderApi.disable(disableTarget.id)
                toast.success(`已停用「${disableTarget.name}」`)
                setDisableTarget(null); load()
              } catch (e) { toast.error((e as Error).message) }
            }}>停用</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
