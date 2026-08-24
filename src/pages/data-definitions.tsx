import { Plus } from "lucide-react"
import { useEffect, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { FilterBar, SearchField } from "@/components/app/filters"
import { EmptyState, TableSkeleton } from "@/components/app/list-state"
import { PageContainer, PageHeader } from "@/components/app/page"
import { Pagination } from "@/components/app/pagination"
import { StatusBadge } from "@/components/app/status-badge"
import { TableFrame } from "@/components/app/table-frame"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { defApi, resApi, type DefinitionDTO } from "@/services/resource-api"

/** 数据定义（Data Definition）管理：挂在 Data Asset 下的字段语义层。 */
export default function DataDefinitionsPage() {
  const navigate = useNavigate()
  const [items, setItems] = useState<DefinitionDTO[]>([])
  const [assets, setAssets] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [assetFilter, setAssetFilter] = useState("")
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState({ name: "", assetId: "" })

  const load = () => {
    setLoading(true)
    defApi.list({ assetId: assetFilter, search, page, pageSize: 20 })
      .then((r) => { setItems(r.items); setTotal(r.total) })
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [assetFilter, search, page])
  useEffect(() => { setPage(1) }, [search, assetFilter])
  useEffect(() => {
    resApi.list("asset", { pageSize: 50 }).then((r) => setAssets(r.items.map((a) => ({ id: a.id, name: a.name })))).catch(() => undefined)
  }, [])

  return (
    <PageContainer wide className="space-y-3">
      <PageHeader title="数据定义" description="定义什么数据可以被分析，以及数据字段的含义。链路：Datasource → Data Asset → Data Definition → Analysis Task。"
        actions={<Button onClick={() => setCreateOpen(true)}><Plus className="size-4" /> 创建数据定义</Button>} />

      <FilterBar>
        <SearchField value={search} onChange={setSearch} placeholder="搜索数据定义..." />
        <Select value={assetFilter || "__all__"} onValueChange={(v) => setAssetFilter(v === "__all__" ? "" : v)}>
          <SelectTrigger className="h-9 w-44"><SelectValue placeholder="全部 Data Asset" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">全部 Data Asset</SelectItem>
            {assets.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </FilterBar>

      {loading ? (
        <TableFrame><TableSkeleton rows={5} columns={6} /></TableFrame>
      ) : items.length === 0 ? (
        <EmptyState title="暂无数据定义" description="基于 Data Asset 创建字段语义定义，供分析任务选择" />
      ) : (
        <TableFrame>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead><TableHead>所属 Data Asset</TableHead><TableHead>字段数</TableHead>
                <TableHead>Lifecycle</TableHead><TableHead>Revision</TableHead><TableHead>被任务引用</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((d) => (
                <TableRow key={d.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/config/data-assets/${d.id}`)}>
                  <TableCell className="text-sm font-medium">{d.name}</TableCell>
                  <TableCell className="text-sm">{d.assetName}</TableCell>
                  <TableCell className="tabular-nums text-sm">{d.fieldCount}</TableCell>
                  <TableCell><StatusBadge status={d.lifecycle === "Ready" ? "Ready" : d.lifecycle === "Draft" ? "Draft" : "Deprecated"} /></TableCell>
                  <TableCell className="tabular-nums text-sm">R{d.revision}</TableCell>
                  <TableCell className="tabular-nums text-sm">{d.taskCount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableFrame>
      )}

      <Pagination page={page} pageSize={20} total={total} onPageChange={setPage} onPageSizeChange={() => undefined} />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>创建数据定义</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">名称 *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label className="text-xs">所属 Data Asset *</Label>
              <Select value={form.assetId || undefined} onValueChange={(v) => setForm({ ...form, assetId: v })}>
                <SelectTrigger><SelectValue placeholder="选择 Data Asset" /></SelectTrigger>
                <SelectContent>{assets.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">没有 Data Asset？先到 <Link className="underline" to="/config/data-resources?tab=assets">Data Resources</Link> 创建。</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
            <Button disabled={!form.name.trim() || !form.assetId} onClick={async () => {
              try {
                const r = await defApi.create({ name: form.name, assetId: form.assetId })
                setCreateOpen(false)
                navigate(`/config/data-assets/${r.id}`)
              } catch (e) { toast.error((e as Error).message) }
            }}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
