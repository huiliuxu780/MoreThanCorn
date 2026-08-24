import { Bookmark, ChevronDown, MoreHorizontal } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ActiveFilters, FilterBar, SearchField } from "@/components/app/filters"
import { ErrorState, FilteredEmptyState, TableSkeleton } from "@/components/app/list-state"
import { PageContainer, PageHeader } from "@/components/app/page"
import { Pagination } from "@/components/app/pagination"
import { ReviewBadge, RiskBadge } from "@/components/app/status-badge"
import { FormField } from "@/components/app/form-field"
import { TableFrame } from "@/components/app/table-frame"
import { useAsyncData } from "@/hooks/use-async-data"
import { useListQuery } from "@/hooks/use-list-query"
import { formatCallDuration, formatCompactDateTime } from "@/lib/time"
import { parseListFilters, serializeListFilters } from "@/lib/list-filters"
import { getQualityResultCounts, listQualityResults } from "@/services/mock-service"
import { realQualityResultCounts, realQualityResults, wfEnabled } from "@/services/wf-api"
import { BRANDS, CRITERIA_CATALOG, ISSUES, PRODUCT_CATEGORIES, REQUEST_TYPES, SERVICE_TYPES, TEAMS, DEPARTMENTS, SERVICERS } from "@/mocks/catalog"

export default function QualityResultsPage() {
  const navigate = useNavigate()
  const { params, update, queryString: searchParamsString } = useListQuery(50)
  const filters = useMemo(() => parseListFilters(params.filters), [params.filters])

  const { data, loading, error, retry } = useAsyncData(() => (wfEnabled() ? realQualityResults(params) : listQualityResults(params)), [
    params.search,
    params.page,
    params.pageSize,
    params.sort,
    params.filters,
    params.tab,
  ])
  const { data: counts } = useAsyncData(
    () => (wfEnabled() ? realQualityResultCounts() : getQualityResultCounts()), [])

  const [searchInput, setSearchInput] = useState(params.search ?? "")
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput !== (params.search ?? "")) update({ search: searchInput }, true)
    }, 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput])

  const [moreOpen, setMoreOpen] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const openMore = () => {
    setDraft({
      department: filters.department ?? "",
      agent: filters.agent ?? "",
      brand: filters.brand ?? "",
      productCategory: filters.productCategory ?? "",
      issue: filters.issue ?? "",
      requestType: filters.requestType ?? "",
      reviewStatus: filters.reviewStatus ?? "",
      quality: filters.quality ?? "",
    })
    setMoreOpen(true)
  }

  const setFilter = (key: string, value: string) => {
    const next = { ...filters }
    if (!value || value === "__all__") delete next[key]
    else next[key] = value
    update({ filters: serializeListFilters(next) }, true)
  }

  const tab = params.tab || "all"
  const hasFilter = Object.keys(filters).length > 0 || (params.search ?? "") !== ""

  return (
    <PageContainer wide className="space-y-3">
      <PageHeader title="质量结果" description="查看每次服务交互的质检结果、问题与复核状态" />

      <Tabs value={tab} onValueChange={(v) => update({ tab: v === "all" ? "" : v }, true)}>
        <TabsList>
          <TabsTrigger value="all">全部结果{counts ? ` ${counts.all.toLocaleString("zh-CN")}` : ""}</TabsTrigger>
          <TabsTrigger value="pending">待复核{counts ? ` ${counts.pending}` : ""}</TabsTrigger>
          <TabsTrigger value="reviewed">已复核{counts ? ` ${counts.reviewed}` : ""}</TabsTrigger>
        </TabsList>
      </Tabs>

      <FilterBar>
        <SearchField
          value={searchInput}
          onChange={setSearchInput}
          placeholder="搜索 Interaction、坐席或消费者诉求"
        />
        <Select value={filters.time ?? "__all__"} onValueChange={(v) => setFilter("time", v)}>
          <SelectTrigger className="h-9 w-28"><SelectValue placeholder="时间" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">全部时间</SelectItem>
            <SelectItem value="今日">今日</SelectItem>
            <SelectItem value="近7日">近 7 日</SelectItem>
            <SelectItem value="近30日">近 30 日</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filters.criterion ?? "__all__"} onValueChange={(v) => setFilter("criterion", v)}>
          <SelectTrigger className="h-9 w-36"><SelectValue placeholder="质量问题" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">全部问题</SelectItem>
            {CRITERIA_CATALOG.map((c) => (
              <SelectItem key={c.criterion} value={c.criterion}>{c.criterion}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.risk ?? "__all__"} onValueChange={(v) => setFilter("risk", v)}>
          <SelectTrigger className="h-9 w-28"><SelectValue placeholder="风险" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">全部风险</SelectItem>
            <SelectItem value="Critical">Critical</SelectItem>
            <SelectItem value="High">High</SelectItem>
            <SelectItem value="Medium">Medium</SelectItem>
            <SelectItem value="Low">Low</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filters.team ?? "__all__"} onValueChange={(v) => setFilter("team", v)}>
          <SelectTrigger className="h-9 w-32"><SelectValue placeholder="班组" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">全部班组</SelectItem>
            {TEAMS.map((t) => (
              <SelectItem key={t.id} value={t.name}>{t.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.serviceType ?? "__all__"} onValueChange={(v) => setFilter("serviceType", v)}>
          <SelectTrigger className="h-9 w-32"><SelectValue placeholder="服务类型" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">全部服务类型</SelectItem>
            {SERVICE_TYPES.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={openMore}>更多筛选</Button>
        <div className="ml-auto flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm">
                <Bookmark className="size-3.5" /> 视图 <ChevronDown className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => { update({ filters: "", tab: "", search: "" }, true); setSearchInput("") }}>全部结果</DropdownMenuItem>
              <DropdownMenuItem onClick={() => update({ tab: "pending" }, true)}>我的待复核</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setFilter("quality", "Critical")}>Critical</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>已保存</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => update({ filters: serializeListFilters({ serviceType: "维修服务", quality: "有问题" }) }, true)}>维修问题</DropdownMenuItem>
              <DropdownMenuItem onClick={() => update({ filters: serializeListFilters({ team: "上海热线一组" }) }, true)}>上海热线一组</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Select value={params.sort || "time:desc"} onValueChange={(v) => update({ sort: v }, true)}>
            <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="time:desc">时间 · 最新优先</SelectItem>
              <SelectItem value="time:asc">时间 · 最早优先</SelectItem>
              <SelectItem value="score:desc">得分 · 从高到低</SelectItem>
              <SelectItem value="score:asc">得分 · 从低到高</SelectItem>
              <SelectItem value="risk:desc">风险 · 从高到低</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </FilterBar>

      <ActiveFilters
        filters={{ ...(params.search ? { search: params.search } : {}), ...filters }}
        labels={{
          search: (v) => `搜索: ${v}`,
          time: (v) => v,
          criterion: (v) => v,
          risk: (v) => v,
          team: (v) => v,
          serviceType: (v) => v,
          department: (v) => v,
          agent: (v) => v,
          brand: (v) => v,
          productCategory: (v) => v,
          issue: (v) => v,
          requestType: (v) => v,
          reviewStatus: (v) => v,
          quality: (v) => v,
        }}
        onRemove={(key) => {
          if (key === "search") {
            setSearchInput("")
            update({ search: "" }, true)
            return
          }
          setFilter(key, "__all__")
        }}
        onClear={() => {
          setSearchInput("")
          update({ filters: "", search: "" }, true)
        }}
      />

      {error ? (
        <ErrorState title="质量结果加载失败" onRetry={retry} />
      ) : loading ? (
        <TableFrame><TableSkeleton rows={10} columns={7} /></TableFrame>
      ) : !data || data.items.length === 0 ? (
        hasFilter ? (
          <FilteredEmptyState onClear={() => { setSearchInput(""); update({ filters: "", search: "" }, true) }} />
        ) : (
          <ErrorState title="没有找到符合条件的质量结果" description="尝试调整筛选条件" />
        )
      ) : (
        <>
          <TableFrame>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">时间</TableHead>
                  <TableHead className="w-32">坐席</TableHead>
                  <TableHead className="w-40">业务场景</TableHead>
                  <TableHead>消费者诉求</TableHead>
                  <TableHead className="w-24 text-right">质量结果</TableHead>
                  <TableHead className="w-20">风险</TableHead>
                  <TableHead className="w-20">复核</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((r) => (
                  <TableRow
                    key={r.interactionId}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => navigate(`/quality/results/${r.interactionId}?from=${encodeURIComponent(searchParamsString)}`)}
                  >
                    <TableCell>
                      <div className="text-sm tabular-nums">{formatCompactDateTime(r.interactionTime)}</div>
                      {r.durationSeconds ? (
                        <div className="text-xs text-muted-foreground">{formatCallDuration(r.durationSeconds)}</div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{r.org.agentName}</div>
                      <div className="text-xs text-muted-foreground">{r.org.teamName}</div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{r.businessContext.serviceType}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.businessContext.productCategory} · {r.businessContext.issueTopic}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="line-clamp-2 max-w-md text-sm">{r.requestSummary}</div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="text-sm font-medium tabular-nums">{r.score !== undefined ? `${r.score} 分` : "—"}</div>
                      {r.issueCount > 0 ? (
                        <div className="text-xs text-muted-foreground">{r.issueCount} 个问题</div>
                      ) : null}
                    </TableCell>
                    <TableCell><RiskBadge risk={r.risk} /></TableCell>
                    <TableCell><ReviewBadge status={r.review.status} /></TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-7">
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => navigate(`/quality/results/${r.interactionId}?from=${encodeURIComponent(searchParamsString)}`)}>查看详情</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => navigate(`/quality/results/${r.interactionId}?review=1&from=${encodeURIComponent(searchParamsString)}`)}>进入复核</DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              navigator.clipboard.writeText(r.interactionId)
                              toast.success("已复制 Interaction ID")
                            }}
                          >
                            复制 Interaction ID
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableFrame>
          <Pagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            onPageChange={(page) => update({ page })}
            onPageSizeChange={(pageSize) => update({ pageSize })}
          />
        </>
      )}

      {/* 更多筛选 Sheet */}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent className="w-[380px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>更多筛选</SheetTitle>
            <SheetDescription>当前生效条件会显示为筛选 Chips</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-4">
            <FormField label="Department">
              <Select value={draft.department || "__all__"} onValueChange={(v) => setDraft((d) => ({ ...d, department: v === "__all__" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="全部部门" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">全部部门</SelectItem>
                  {DEPARTMENTS.map((d) => (<SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="坐席">
              <Select value={draft.agent || "__all__"} onValueChange={(v) => setDraft((d) => ({ ...d, agent: v === "__all__" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="全部坐席" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">全部坐席</SelectItem>
                  {SERVICERS.map((s) => (<SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Brand">
              <Select value={draft.brand || "__all__"} onValueChange={(v) => setDraft((d) => ({ ...d, brand: v === "__all__" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="全部品牌" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">全部品牌</SelectItem>
                  {BRANDS.map((b) => (<SelectItem key={b} value={b}>{b}</SelectItem>))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Product Category">
              <Select value={draft.productCategory || "__all__"} onValueChange={(v) => setDraft((d) => ({ ...d, productCategory: v === "__all__" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="全部品类" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">全部品类</SelectItem>
                  {PRODUCT_CATEGORIES.map((b) => (<SelectItem key={b} value={b}>{b}</SelectItem>))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Issue / Topic">
              <Select value={draft.issue || "__all__"} onValueChange={(v) => setDraft((d) => ({ ...d, issue: v === "__all__" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="全部问题" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">全部问题</SelectItem>
                  {ISSUES.map((b) => (<SelectItem key={b} value={b}>{b}</SelectItem>))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Request Type">
              <Select value={draft.requestType || "__all__"} onValueChange={(v) => setDraft((d) => ({ ...d, requestType: v === "__all__" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="全部诉求类型" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">全部诉求类型</SelectItem>
                  {REQUEST_TYPES.map((b) => (<SelectItem key={b} value={b}>{b}</SelectItem>))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="运营状态">
              <Select value={draft.reviewStatus || "__all__"} onValueChange={(v) => setDraft((d) => ({ ...d, reviewStatus: v === "__all__" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="全部" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">全部</SelectItem>
                  <SelectItem value="待复核">待复核</SelectItem>
                  <SelectItem value="已复核">已复核</SelectItem>
                  <SelectItem value="AI/人工不一致">AI / 人工不一致</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="质量">
              <Select value={draft.quality || "__all__"} onValueChange={(v) => setDraft((d) => ({ ...d, quality: v === "__all__" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="全部" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">全部</SelectItem>
                  <SelectItem value="有问题">有问题</SelectItem>
                  <SelectItem value="Critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
          </div>
          <SheetFooter className="mt-6">
            <Button variant="outline" onClick={() => setDraft({})}>重置</Button>
            <Button
              onClick={() => {
                const next = { ...filters }
                for (const key of ["department", "agent", "brand", "productCategory", "issue", "requestType", "reviewStatus", "quality"]) {
                  if (draft[key]) next[key] = draft[key]
                  else delete next[key]
                }
                update({ filters: serializeListFilters(next) }, true)
                setMoreOpen(false)
              }}
            >
              应用
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </PageContainer>
  )
}
