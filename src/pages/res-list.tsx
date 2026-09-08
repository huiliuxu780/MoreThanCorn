import { Plus } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { toast } from "sonner"

import { FilterBar, SearchField } from "@/components/app/filters"
import { CardGridSkeleton, EmptyState, FilteredEmptyState } from "@/components/app/list-state"
import { Pagination } from "@/components/app/pagination"
import { Button } from "@/components/ui/button"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  ResourceCard, type ResourceAction,
} from "@/components/resources/resource-card"
import {
  ConfirmDeleteDialog, DeleteBlockedDialog, ResourceTestDialog,
} from "@/components/resources/resource-dialogs"
import { resApi, type RefInfo, type ResourceDTO } from "@/services/resource-api"

/** 资源类型 → 详情路由段（MTC-006 canonical 保持：ai/data 两域）。 */
const DETAIL_SCOPE: Record<string, "ai" | "data"> = {
  model: "ai", tool: "ai", mcp: "ai", knowledge: "ai", skill: "ai",
  datasource: "data", asset: "data",
}

const LABELS: Record<string, string> = {
  model: "Models", tool: "Tools", mcp: "MCP Servers", knowledge: "Knowledge Sources",
  datasource: "Datasources", asset: "Data Assets",
}

const DS_TYPES = ["mysql", "postgresql", "oss", "http"]

/**
 * docs/v2-design/10 §3/§4：壳内分类列表内容（无 PageHeader；由 ResourcesShell 提供壳 chrome）。
 * types 多于一个时渲染子 tab；筛选/分页/测试/删除 Dialog 与原 res-list 操作集一致。
 */
export function ResCategoryList({ types, createTo }: { types: string[]; createTo?: string }) {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab = params.get("tab") && types.includes(params.get("tab")!) ? params.get("tab")! : types[0]
  const highlight = params.get("new") ?? ""

  const [searchInput, setSearchInput] = useState(params.get("search") ?? "")
  const [status, setStatus] = useState("")
  const [health, setHealth] = useState("")
  const [dsType, setDsType] = useState("")
  const [page, setPage] = useState(1)
  const [data, setData] = useState<ResourceDTO[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  const [testTarget, setTestTarget] = useState<ResourceDTO | null>(null)
  const [delTarget, setDelTarget] = useState<ResourceDTO | null>(null)
  const [blocked, setBlocked] = useState<{ name: string; refs: RefInfo[] } | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    const search = params.get("search") ?? ""
    resApi.list(tab, { page, pageSize: 12, search, status, health, type: tab === "datasource" ? dsType : "" })
      .then((r) => { setData(r.items); setTotal(r.total) })
      .catch(() => setData([]))
      .finally(() => setLoading(false))
  }, [tab, page, params, status, health, dsType])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const t = setTimeout(() => {
      const cur = params.get("search") ?? ""
      if (searchInput !== cur) {
        setParams((p) => {
          if (searchInput) p.set("search", searchInput); else p.delete("search")
          p.delete("new")
          return p
        }, { replace: true })
        setPage(1)
      }
    }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput])

  const setTab = (t: string) => {
    setParams((p) => { p.set("tab", t); p.delete("new"); return p }, { replace: true })
    setPage(1)
    setDsType("")
  }

  const onAction = (dto: ResourceDTO, action: ResourceAction) => {
    const scope = DETAIL_SCOPE[dto.type] ?? "ai"
    if (action === "test") setTestTarget(dto)
    else if (action === "edit") navigate(`/resources/${scope}/${dto.type}/${dto.id}?edit=1`, { state: { from: "list", tab } })
    else if (action === "toggle") {
      const enabled = dto.status === "disabled"
      resApi.toggle(dto.type, dto.id, enabled)
        .then(() => { toast.success(enabled ? `已启用「${dto.name}」` : `已停用「${dto.name}」，不可再被新节点选择`); load() })
        .catch((e) => toast.error((e as Error).message))
    } else if (action === "delete") setDelTarget(dto)
  }

  const confirmDelete = async () => {
    if (!delTarget) return
    try {
      await resApi.remove(delTarget.type, delTarget.id)
      toast.success(`已删除「${delTarget.name}」`)
      setDelTarget(null)
      load()
    } catch (e) {
      const err = e as Error & { refs?: RefInfo[] }
      setDelTarget(null)
      if (err.refs) setBlocked({ name: delTarget.name, refs: err.refs })
      else toast.error(err.message)
    }
  }

  const filtered = searchInput || status || health || (tab === "datasource" && dsType)

  return (
    <div className="space-y-3">
      <FilterBar>
        <SearchField value={searchInput} onChange={setSearchInput} placeholder="搜索资源名称..." />
        {tab === "datasource" && (
          <Select value={dsType || "__all__"} onValueChange={(v) => { setDsType(v === "__all__" ? "" : v); setPage(1) }}>
            <SelectTrigger className="h-9 w-36"><SelectValue placeholder="全部类型" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">全部类型</SelectItem>
              {DS_TYPES.map((t) => <SelectItem key={t} value={t}>{t === "oss" ? "对象存储 OSS" : t === "http" ? "HTTP API" : t}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Select value={status || "__all__"} onValueChange={(v) => { setStatus(v === "__all__" ? "" : v); setPage(1) }}>
          <SelectTrigger className="h-9 w-32"><SelectValue placeholder="全部状态" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">全部状态</SelectItem>
            <SelectItem value="enabled">Enabled</SelectItem>
            <SelectItem value="disabled">Disabled</SelectItem>
          </SelectContent>
        </Select>
        <Select value={health || "__all__"} onValueChange={(v) => { setHealth(v === "__all__" ? "" : v); setPage(1) }}>
          <SelectTrigger className="h-9 w-32"><SelectValue placeholder="全部健康度" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">全部健康度</SelectItem>
            <SelectItem value="untested">Untested</SelectItem>
            <SelectItem value="healthy">Healthy</SelectItem>
            <SelectItem value="degraded">Degraded</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="stale">Stale</SelectItem>
          </SelectContent>
        </Select>
        <span className="ml-auto text-xs text-muted-foreground">共 {total} 个资源</span>
        {createTo && (
          <Button onClick={() => navigate(createTo)}>
            <Plus className="size-4" /> 创建资源
          </Button>
        )}
      </FilterBar>

      {types.length > 1 ? (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            {types.map((t) => (
              <TabsTrigger key={t} value={t}>{LABELS[t] ?? t}</TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value={tab}>{grid()}</TabsContent>
        </Tabs>
      ) : grid()}

      <Pagination page={page} pageSize={12} total={total} onPageChange={setPage} onPageSizeChange={() => undefined} />

      <ResourceTestDialog open={!!testTarget} title={testTarget?.name ?? ""}
        desc="使用样例输入执行一次真实调用，验证连通性与响应。"
        onRun={(input) => resApi.test(testTarget!.type, testTarget!.id, input)}
        onClose={() => { setTestTarget(null); load() }} />

      <ConfirmDeleteDialog open={!!delTarget} name={delTarget?.name ?? ""} onConfirm={confirmDelete} onClose={() => setDelTarget(null)} />

      <DeleteBlockedDialog open={!!blocked} name={blocked?.name ?? ""} refs={blocked?.refs ?? []}
        onClose={() => setBlocked(null)}
        onViewRefs={(r) => { if (r.workflowId) { setBlocked(null); navigate(`/workflows/${r.workflowId}`) } }} />
    </div>
  )

  function grid() {
    return loading ? (
      <CardGridSkeleton count={8} />
    ) : data.length === 0 ? (
      filtered ? <FilteredEmptyState onClear={() => { setSearchInput(""); setStatus(""); setHealth(""); setDsType("") }} />
        : <EmptyState title={`暂无${LABELS[tab] ?? ""}`} description={createTo ? "点击右上角「创建资源」开始" : "暂无资源"} />
    ) : (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {data.map((dto) => (
          <ResourceCard key={dto.id} dto={dto} highlighted={dto.id === highlight}
            onOpen={() => navigate(`/resources/${DETAIL_SCOPE[dto.type] ?? "ai"}/${dto.type}/${dto.id}`)}
            onAction={(a) => onAction(dto, a)} />
        ))}
      </div>
    )
  }
}
