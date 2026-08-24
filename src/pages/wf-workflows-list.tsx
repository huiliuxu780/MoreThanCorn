/** Workflow 资源页：统一列表规范（Header+Toolbar+CardGrid+Pagination）+ ResourceCard 骨架。 */
import { Plus } from "lucide-react"
import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { FilterBar, SearchField } from "@/components/app/filters"
import { CardGridSkeleton, EmptyState, FilteredEmptyState } from "@/components/app/list-state"
import { PageContainer, PageHeader } from "@/components/app/page"
import { Pagination } from "@/components/app/pagination"
import { ResourceCard, type ResourceAction } from "@/components/resources/resource-card"
import { ConfirmDeleteDialog } from "@/components/resources/resource-dialogs"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useListQuery } from "@/hooks/use-list-query"
import { WF_BASE, wfApi } from "@/services/wf-api"

interface WfRow {
  id: string; name: string; status: string; updatedAt: string;
  versionCount?: number; nodeCount?: number; agentRefCount?: number
}

export default function WfWorkflowsPage() {
  const navigate = useNavigate()
  const { params, update } = useListQuery(12)
  const search = params.search ?? ""
  const [rows, setRows] = useState<WfRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [delTarget, setDelTarget] = useState<WfRow | null>(null)

  useEffect(() => {
    setLoading(true)
    wfApi.list({ page: params.page, pageSize: params.pageSize, search: search || undefined })
      .then((r) => { setRows(r.items as WfRow[]); setTotal(r.total) })
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [params.page, params.pageSize, search])

  const create = async () => {
    if (!name.trim()) return
    const wf = await wfApi.create(name.trim(), "")
    setOpen(false)
    navigate(`/config/workflows/${wf.id}`)
  }

  const onAction = (w: WfRow, action: ResourceAction) => {
    if (action === "edit") navigate(`/config/workflows/${w.id}`)
    else if (action === "delete") setDelTarget(w)
  }

  const confirmDelete = async () => {
    if (!delTarget) return
    try {
      const r = await fetch(`${WF_BASE}/api/workflows/${delTarget.id}`, { method: "DELETE" })
      if (r.ok) {
        toast.success(`已删除「${delTarget.name}」`)
        setDelTarget(null)
      } else {
        const b = await r.json().catch(() => null)
        setDelTarget(null)
        toast.error(typeof b?.detail === "string" ? b.detail : "删除失败")
      }
    } catch (e) {
      setDelTarget(null)
      toast.error((e as Error).message)
    }
  }

  return (
    <PageContainer wide className="space-y-3">
      <PageHeader
        title="工作流"
        description="可复用的流程资源，配置后供 Agent 编排引用。引用链：Agent → Workflow → Version → Node Config → Resource。"
        actions={<Button onClick={() => setOpen(true)}><Plus className="size-4" /> 创建工作流</Button>}
      />
      <FilterBar>
        <SearchField value={search} onChange={(v) => update({ search: v || undefined }, true)} placeholder="搜索工作流..." />
        <span className="ml-auto text-xs text-muted-foreground">共 {total} 个资源</span>
      </FilterBar>

      {loading ? (
        <CardGridSkeleton count={8} />
      ) : rows.length === 0 ? (
        search ? <FilteredEmptyState onClear={() => update({ search: undefined }, true)} />
          : <EmptyState title="暂无工作流" description="创建第一个流程资源" />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {rows.map((w) => (
            <ResourceCard
              key={w.id}
              dto={{
                id: w.id, type: "workflow", name: w.name, description: "",
                status: "enabled", health: "healthy",
                metadata: {
                  lifecycleLabel: w.status === "published" ? "已发布" : "草稿",
                  lifecycleTone: w.status === "published" ? "success" : "warning",
                  currentVersion: w.versionCount || undefined,
                  nodeCount: w.nodeCount ?? 0,
                },
                usage: { refCount: w.agentRefCount ?? 0, calls7d: 0 },
                updatedAt: w.updatedAt,
              }}
              actions={["edit", "delete"]}
              onOpen={() => navigate(`/config/workflows/${w.id}`)}
              onAction={(a) => onAction(w, a)}
            />
          ))}
        </div>
      )}

      <Pagination page={params.page ?? 1} pageSize={params.pageSize ?? 12} total={total}
        pageSizeOptions={[12, 24, 48]} onPageChange={(pg) => update({ page: pg })} onPageSizeChange={(n) => update({ pageSize: n }, true)} />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>创建工作流</DialogTitle></DialogHeader>
          <Input placeholder="名称（必填）" value={name} onChange={(e) => setName(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button disabled={!name.trim()} onClick={create}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog open={!!delTarget} name={delTarget?.name ?? ""} onConfirm={confirmDelete} onClose={() => setDelTarget(null)} />
    </PageContainer>
  )
}
