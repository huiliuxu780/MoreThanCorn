import { Plus } from "lucide-react"
import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { SearchField } from "@/components/app/filters"
import { EmptyState, ErrorState, FilteredEmptyState, TableSkeleton } from "@/components/app/list-state"
import { PageContainer, PageHeader } from "@/components/app/page"
import { Pagination } from "@/components/app/pagination"
import { TableFrame } from "@/components/app/table-frame"
import { FormField } from "@/components/app/form-field"
import { useAsyncData } from "@/hooks/use-async-data"
import { useListQuery } from "@/hooks/use-list-query"
import { formatDateTime } from "@/lib/time"
import { listResultRules } from "@/services/mock-service"
import { bizApi, wfEnabled } from "@/services/wf-api"
import { agents } from "@/mocks/data"
import { rbac } from "@/services/rbac"

export default function ResultRulesPage() {
  const navigate = useNavigate()
  const { params, update } = useListQuery(20)
  const { data, loading, error, retry } = useAsyncData(() => (wfEnabled() ? bizApi.rules().then((items) => ({ items, total: items.length, page: 1, pageSize: 50 })) : listResultRules(params)), [params.search, params.page, params.pageSize])

  const [searchInput, setSearchInput] = useState(params.search ?? "")
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput !== (params.search ?? "")) update({ search: searchInput }, true)
    }, 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput])

  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [agentId, setAgentId] = useState("")
  const [creating, setCreating] = useState(false)

  const canManage = rbac.can("rules.manage")

  return (
    <PageContainer wide className="space-y-3">
      <PageHeader
        title="结果规则"
        description="定义质量结果的评分、风险和业务解释规则"
        actions={
          canManage ? (
            <Button onClick={() => setCreateOpen(true)}><Plus className="size-4" /> 新建结果规则</Button>
          ) : null
        }
      />

      <SearchField value={searchInput} onChange={setSearchInput} placeholder="搜索结果规则..." className="max-w-sm" />

      {error ? (
        <ErrorState title="结果规则加载失败" onRetry={retry} />
      ) : loading ? (
        <TableFrame><TableSkeleton rows={4} columns={5} /></TableFrame>
      ) : !data || data.items.length === 0 ? (
        params.search ? (
          <FilteredEmptyState onClear={() => { setSearchInput(""); update({ search: "" }, true) }} />
        ) : (
          <EmptyState title="暂无结果规则" description="创建第一套 Result Rules，定义 Effective Result 的派生计算" />
        )
      ) : (
        <>
          <TableFrame>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>当前版本</TableHead>
                  <TableHead>Evaluation Priority</TableHead>
                  <TableHead>最近更新</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((rule) => (
                  <TableRow key={rule.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/config/result-rules/${rule.id}`)}>
                    <TableCell>
                      <div className="text-sm font-medium">{rule.name}</div>
                      <div className="line-clamp-1 max-w-md text-xs text-muted-foreground">{rule.description}</div>
                    </TableCell>
                    <TableCell className="text-sm">{rule.agentName}</TableCell>
                    <TableCell className="text-sm">{rule.currentVersion}</TableCell>
                    <TableCell className="text-xs">{rule.evaluationPriority === "Most Recent Completed" ? "最新完成的评价" : "首次完成的评价"}</TableCell>
                    <TableCell className="text-sm tabular-nums">{formatDateTime(rule.updatedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableFrame>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={(page) => update({ page })} onPageSizeChange={(pageSize) => update({ pageSize })} />
        </>
      )}

      {/* Create：Dialog，只创建最小身份信息 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建结果规则</DialogTitle>
            <DialogDescription>Result Rules 是独立质量业务配置资产，不属于 Agent</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <FormField label="名称" required>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：服务质量结果规则" />
            </FormField>
            <FormField label="描述">
              <Textarea className="min-h-16" value={description} onChange={(e) => setDescription(e.target.value)} />
            </FormField>
            <FormField label="Agent" description="作为 Evaluation Selection 的评价来源" required>
              <Select value={agentId || undefined} onValueChange={setAgentId}>
                <SelectTrigger><SelectValue placeholder="选择 Agent" /></SelectTrigger>
                <SelectContent>
                  {agents.map((a) => (<SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>))}
                </SelectContent>
              </Select>
            </FormField>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
            <Button disabled={!name.trim() || !agentId || creating} onClick={async () => {
              // R2 修复：真创建规则（此前只 toast + 硬编码 RR-01）
              setCreating(true)
              try {
                const r = await bizApi.createRule({ name: name.trim(), description, rules: { scoreRules: [], issueRules: [] } })
                setCreateOpen(false)
                toast.success("已创建 Draft")
                navigate(`/config/result-rules/${r.id}`)
              } catch (e) {
                toast.error(`创建失败：${(e as Error).message}`)
              } finally {
                setCreating(false)
              }
            }}>
              {creating ? "创建中…" : "创建并编辑"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
