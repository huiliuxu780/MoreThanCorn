/** Connections — 真 API + 卡片网格设计。路由 /settings/connections（env 门控）。 */
import { KeyRound, Plus, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import { FilterBar, SearchField } from "@/components/app/filters"
import { CardGridSkeleton, EmptyState } from "@/components/app/list-state"
import { PageContainer, PageHeader } from "@/components/app/page"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { WF_BASE } from "@/services/wf-api"

interface ConnRow { id: string; name: string; kind: string; status: string; providerHint: string }

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${WF_BASE}${path}`, { headers: { "Content-Type": "application/json" }, ...init })
  if (!r.ok) {
    const body = await r.json().catch(() => null)
    throw new Error(`${r.status}: ${JSON.stringify(body?.detail ?? body)}`)
  }
  return r.json() as Promise<T>
}

export default function WfConnectionsPage() {
  const [rows, setRows] = useState<ConnRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [secret, setSecret] = useState("")

  const load = () => {
    setLoading(true)
    api<ConnRow[]>("/api/connections").then((r) => { setRows(r); setLoading(false) }).catch(() => setLoading(false))
  }
  useEffect(load, [])

  const filtered = rows.filter((c) => !search || c.name.toLowerCase().includes(search.toLowerCase()))

  const create = async () => {
    try {
      await api("/api/connections", { method: "POST", body: JSON.stringify({ name, secret }) })
      setOpen(false); setName(""); setSecret(""); load()
    } catch (e) { toast.error((e as Error).message) }
  }
  const del = async (id: string) => {
    try { await api(`/api/connections/${id}`, { method: "DELETE" }); load() }
    catch (e) { toast.error((e as Error).message) }
  }
  const test = async (id: string) => {
    try { await api(`/api/connections/${id}/test`, { method: "POST" }); toast.success("连接测试通过"); load() }
    catch (e) { toast.error((e as Error).message) }
  }

  return (
    <PageContainer wide className="space-y-3">
      <PageHeader
        title="Connections"
        description="凭证与外部系统连接（加密存储）"
        actions={<Button className="bg-black text-white hover:bg-neutral-800" onClick={() => setOpen(true)}><Plus className="size-4" /> 创建连接</Button>}
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
                    <div className="mt-0.5 text-[11px] text-muted-foreground">{c.kind} · {c.providerHint || "自定义"} · ••••••</div>
                  </div>
                </div>
                <Badge variant="secondary" className="shrink-0 text-[10px] text-emerald-600">{c.status}</Badge>
              </div>
              <div className="mt-auto flex items-center justify-end gap-2 pt-2 text-[11px]">
                <button className="rounded border px-1.5 py-0.5 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100" onClick={() => test(c.id)}>测试</button>
                <button className="rounded border px-1.5 py-0.5 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100" onClick={() => del(c.id)}>
                  <Trash2 className="size-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>创建连接</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">名称</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div><Label className="text-xs">Secret（加密存储）</Label>
              <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button className="bg-black text-white hover:bg-neutral-800" disabled={!name.trim()} onClick={create}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
