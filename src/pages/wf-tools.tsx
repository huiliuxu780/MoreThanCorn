/** Tools — 真 API + 原版 4 列紧凑卡片设计（Design Spec §15.2）。路由 /config/tools（env 门控）。 */
import { Play, Plus, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"
import { useListQuery } from "@/hooks/use-list-query"
import { pagedApi } from "@/services/wf-api"
import { toast } from "sonner"

import { FilterBar, SearchField } from "@/components/app/filters"
import { CardGridSkeleton, EmptyState, FilteredEmptyState } from "@/components/app/list-state"
import { PageContainer, PageHeader } from "@/components/app/page"
import { Pagination } from "@/components/app/pagination"
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
import { Textarea } from "@/components/ui/textarea"
import { WF_BASE } from "@/services/wf-api"

interface ToolRow {
  id: string
  name: string
  kind: string
  status: string
  description: string
  updatedAt: string
  versions: { version: number; status: string }[]
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${WF_BASE}${path}`, { headers: { "Content-Type": "application/json" }, ...init })
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`)
  return r.json() as Promise<T>
}

export default function WfToolsPage() {
  const [all, setAll] = useState<ToolRow[]>([])
  const [loading, setLoading] = useState(true)
    const [kind, setKind] = useState("")
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [nkind, setNkind] = useState("builtin")
  const [spec, setSpec] = useState('{ "kind": "echo" }')

  const { params, update } = useListQuery(12)
  const search = params.search ?? ""
  const [total, setTotal] = useState(0)
  const load = () => {
    setLoading(true)
    pagedApi.tools({ page: params.page, pageSize: params.pageSize, search: params.search ?? "" }).then((r) => {
      setAll(r.items as ToolRow[]); setTotal(r.total); setLoading(false)
    }).catch(() => setLoading(false))
  }
  useEffect(() => { load() }, [params.page, params.pageSize, params.search])

  const filtered = all
    .filter((t) => !search || t.name.toLowerCase().includes(search.toLowerCase()))
    .filter((t) => !kind || t.kind === kind)

  const create = async () => {
    try {
      await api("/api/tools", { method: "POST", body: JSON.stringify({ name, kind: nkind, spec: JSON.parse(spec) }) })
      setOpen(false); setName(""); load()
    } catch (e) { toast.error((e as Error).message) }
  }
  const test = async (id: string) => {
    try {
      const r = await api<{ ok: boolean; output?: unknown; error?: string }>(`/api/tools/${id}/test`, { method: "POST", body: JSON.stringify({ input: "ping" }) })
      if (r.ok) toast.success(`测试成功：${JSON.stringify(r.output).slice(0, 80)}`)
      else toast.error(`测试失败：${r.error}`)
    } catch (e) { toast.error((e as Error).message) }
  }

  return (
    <PageContainer wide className="space-y-3">
      <PageHeader
        title="Tools"
        description="Agent 可消费的可复用能力资产"
        actions={<Button className="bg-black text-white hover:bg-neutral-800" onClick={() => setOpen(true)}><Plus className="size-4" /> 创建 Tool</Button>}
      />
      <FilterBar>
        <SearchField value={search} onChange={(v) => update({ search: v || undefined }, true)} placeholder="搜索 Tool..." />
        <select className="h-9 rounded-md border bg-transparent px-2 text-sm" value={kind} onChange={(e) => { setKind(e.target.value); update({ page: 1 }) }}>
          <option value="">全部类型</option>
          <option value="builtin">builtin</option>
          <option value="http">http</option>
        </select>
      </FilterBar>

      {loading ? (
        <CardGridSkeleton count={8} />
      ) : filtered.length === 0 ? (
        search || kind ? <FilteredEmptyState onClear={() => { update({ search: undefined, page: 1 }, true); setKind("") }} />
          : <EmptyState title="暂无 Tool" description="创建第一个 API Tool，连接企业能力" />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((tool) => (
              <div key={tool.id} className="group flex h-40 flex-col rounded-lg border bg-card p-3.5 hover:border-muted-foreground/40">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{tool.name}</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {tool.kind === "builtin" ? "Built-in" : "API"} · {tool.kind === "builtin" ? "平台内置" : "外部连接"}
                    </div>
                  </div>
                  <Badge variant="outline" className="shrink-0 font-mono text-[10px]">{tool.kind === "builtin" ? "READ" : "ACTION"}</Badge>
                </div>
                <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{tool.description || "可复用能力资产，供 Agent 工作流消费"}</p>
                <div className="mt-auto flex items-center justify-between pt-2 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <Badge variant="secondary" className={tool.status === "ready" ? "text-emerald-600" : "text-neutral-500"}>{tool.status === "ready" ? "Enabled" : tool.status}</Badge>
                    <span>v{tool.versions[0]?.version ?? 1}{tool.versions[0]?.status === "draft" ? " · Draft" : ""}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span>{new Date(tool.updatedAt).toLocaleDateString("zh-CN")}</span>
                    <button
                      className="rounded p-1 opacity-0 transition-opacity hover:bg-neutral-100 group-hover:opacity-100"
                      onClick={async (e) => {
                        e.stopPropagation()
                        if (!window.confirm(`删除工具「${tool.name}」？`)) return
                        const r = await fetch(`${WF_BASE}/api/tools/${tool.id}`, { method: "DELETE" })
                        if (r.ok) { toast.success("已删除"); load() }
                        else { const b = await r.json().catch(() => null); toast.error(typeof b?.detail === "string" ? b.detail : "删除失败") }
                      }}
                    ><Trash2 className="size-3.5 text-neutral-400" /></button>
                  </span>
                  <button
                    className="flex items-center gap-1 rounded border px-1.5 py-0.5 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
                    onClick={() => test(tool.id)}
                  >
                    <Play className="size-3" /> 测试
                  </button>
                </div>
              </div>
            ))}
          </div>
          <Pagination page={params.page ?? 1} pageSize={params.pageSize ?? 12} total={total}
            pageSizeOptions={[12, 24, 48]} onPageChange={(pg) => update({ page: pg })} onPageSizeChange={(n) => update({ pageSize: n }, true)} />
        </>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>创建 Tool</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">名称</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div><Label className="text-xs">类型</Label>
              <select className="w-full rounded-md border p-2 text-sm" value={nkind} onChange={(e) => setNkind(e.target.value)}>
                <option value="builtin">builtin</option><option value="http">http</option>
              </select></div>
            <div><Label className="text-xs">spec（request 配方）</Label>
              <Textarea value={spec} onChange={(e) => setSpec(e.target.value)} /></div>
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
