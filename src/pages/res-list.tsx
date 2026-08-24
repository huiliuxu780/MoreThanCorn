import { Plus } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { toast } from "sonner"

import { FilterBar, SearchField } from "@/components/app/filters"
import { CardGridSkeleton, EmptyState, FilteredEmptyState } from "@/components/app/list-state"
import { PageContainer, PageHeader } from "@/components/app/page"
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

const TABS = {
  ai: [
    { type: "model", label: "Models" },
    { type: "tool", label: "Tools" },
    { type: "mcp", label: "MCP Servers" },
    { type: "knowledge", label: "Knowledge Sources" },
  ],
  data: [
    { type: "datasource", label: "Datasources" },
    { type: "asset", label: "Data Assets" },
  ],
} as const

const DS_TYPES = ["mysql", "postgresql", "oss", "http"]

export function ResListPage({ domain }: { domain: "ai" | "data" }) {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tabs = TABS[domain]
  const tab = params.get("tab") && tabs.some((t) => t.type === params.get("tab")) ? params.get("tab")! : tabs[0].type
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
    if (action === "test") setTestTarget(dto)
    else if (action === "edit") navigate(`/config/${domain === "ai" ? "ai" : "data"}-resources/${dto.type}/${dto.id}?edit=1`, { state: { from: "list", tab } })
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
    <PageContainer wide className="space-y-3">
      <PageHeader
        title={domain === "ai" ? "AI Resources" : "Data Resources"}
        description={domain === "ai"
          ? "管理 Agent 执行过程中使用的 AI 能力资源。引用链：Agent → Workflow → Version → Node Config → Resource。"
          : "管理分析任务与 Evaluation Agent 使用的数据资源。数据链：Datasource → Data Asset → Data Definition → Analysis Task。"}
        actions={
          <Button onClick={() => navigate(domain === "ai" ? "/config/ai-resources/new" : "/config/data-resources/new")}>
            <Plus className="size-4" /> 创建资源
          </Button>
        }
      />

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
            <SelectItem value="healthy">Healthy</SelectItem>
            <SelectItem value="degraded">Degraded</SelectItem>
            <SelectItem value="error">Error</SelectItem>
          </SelectContent>
        </Select>
        <span className="ml-auto text-xs text-muted-foreground">共 {total} 个资源</span>
      </FilterBar>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          {tabs.map((t) => (
            <TabsTrigger key={t.type} value={t.type}>{t.label}</TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={tab}>
          {loading ? (
            <CardGridSkeleton count={8} />
          ) : data.length === 0 ? (
            filtered ? <FilteredEmptyState onClear={() => { setSearchInput(""); setStatus(""); setHealth(""); setDsType("") }} />
              : <EmptyState title={`暂无${tabs.find((t) => t.type === tab)?.label ?? ""}`} description="点击右上角「创建资源」开始" />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {data.map((dto) => (
                <ResourceCard key={dto.id} dto={dto} highlighted={dto.id === highlight}
                  onOpen={() => navigate(`/config/${domain === "ai" ? "ai" : "data"}-resources/${dto.type}/${dto.id}`)}
                  onAction={(a) => onAction(dto, a)} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Pagination page={page} pageSize={12} total={total} onPageChange={setPage} onPageSizeChange={() => undefined} />

      <ResourceTestDialog open={!!testTarget} title={testTarget?.name ?? ""}
        desc="使用样例输入执行一次真实调用，验证连通性与响应。"
        onRun={(input) => resApi.test(testTarget!.type, testTarget!.id, input)}
        onClose={() => { setTestTarget(null); load() }} />

      <ConfirmDeleteDialog open={!!delTarget} name={delTarget?.name ?? ""} onConfirm={confirmDelete} onClose={() => setDelTarget(null)} />

      <DeleteBlockedDialog open={!!blocked} name={blocked?.name ?? ""} refs={blocked?.refs ?? []}
        onClose={() => setBlocked(null)}
        onViewRefs={(r) => { if (r.workflowId) { setBlocked(null); navigate(`/config/workflows/${r.workflowId}`) } }} />
    </PageContainer>
  )
}

export default function ResAiResourcesPage() {
  return <ResListPage domain="ai" />
}

export function ResDataResourcesPage() {
  return <ResListPage domain="data" />
}
