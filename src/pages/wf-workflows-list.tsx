/** Workflow 资源页：独立资源对象，配置后供 Agent 引用（quickservice 资源-工作流同款）。 */
import { Plus, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { useNavigate } from "react-router-dom"

import { FilterBar, SearchField } from "@/components/app/filters"
import { CardGridSkeleton, EmptyState } from "@/components/app/list-state"
import { PageContainer, PageHeader } from "@/components/app/page"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { WF_BASE, wfApi } from "@/services/wf-api"

const INK3 = "#B9C2CF"; const ORANGE = "#F97E2B"

interface WfRow { id: string; name: string; status: string; updatedAt: string }

export default function WfWorkflowsPage() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<WfRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")

  const load = () => {
    setLoading(true)
    wfApi.list({ pageSize: 100 }).then((r) => { setRows(r.items as WfRow[]); setLoading(false) }).catch(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const filtered = rows.filter((r) => !search || r.name.toLowerCase().includes(search.toLowerCase()))

  const create = async () => {
    if (!name.trim()) return
    const wf = await wfApi.create(name.trim(), "")
    setOpen(false)
    navigate(`/config/workflows/${wf.id}`)
  }

  return (
    <PageContainer wide className="space-y-3">
      <PageHeader
        title="工作流"
        description="可复用的流程资源，配置后供 Agent 编排引用"
        actions={<Button className="bg-black text-white hover:bg-neutral-800" onClick={() => setOpen(true)}><Plus className="size-4" /> 创建工作流</Button>}
      />
      <FilterBar>
        <SearchField value={search} onChange={setSearch} placeholder="搜索工作流..." />
      </FilterBar>
      {loading ? <CardGridSkeleton count={4} /> : filtered.length === 0 ? (
        <EmptyState title="暂无工作流" description="创建第一个流程资源" />
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
          {filtered.map((w) => (
            <div key={w.id} role="button" tabIndex={0} className="group rounded-lg border bg-white p-4 text-left shadow-sm transition-shadow hover:shadow-md" style={{ borderColor: "#EDF0F4" }}
              onClick={() => navigate(`/config/workflows/${w.id}`)}>
              <div className="flex items-center gap-2">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-[#1F2329] text-[11px] font-bold text-white">{w.name.slice(0, 1)}</span>
                <span className="truncate text-sm font-medium" style={{ color: "#1F2329" }}>{w.name}</span>
              </div>
              <div className="pt-2 text-xs" style={{ color: w.status === "published" ? INK3 : ORANGE }}>
                {w.status === "published" ? "已发布" : "# 未发布"}
              </div>
              <div className="flex items-center justify-between pt-1 text-[11px]">
                <span style={{ color: INK3 }}>更新时间：{new Date(w.updatedAt).toLocaleDateString()}</span>
                <button
                  className="rounded p-1 opacity-0 transition-opacity hover:bg-neutral-100 group-hover:opacity-100"
                  onClick={async (e) => {
                    e.stopPropagation()
                    if (!window.confirm(`删除工作流「${w.name}」？`)) return
                    const r = await fetch(`${WF_BASE}/api/workflows/${w.id}`, { method: "DELETE" })
                    if (r.ok) { toast.success("已删除"); load() }
                    else { const b = await r.json().catch(() => null); toast.error(JSON.stringify(b?.detail ?? "被引用，无法删除")) }
                  }}
                ><Trash2 className="size-3.5 text-neutral-400" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>创建工作流</DialogTitle></DialogHeader>
          <Input placeholder="名称（必填）" value={name} onChange={(e) => setName(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button className="bg-black text-white hover:bg-neutral-800" disabled={!name.trim()} onClick={create}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <span className="hidden">{WF_BASE}</span>
    </PageContainer>
  )
}
