import { Plug, Plus } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
import { FilterBar, SearchField } from "@/components/app/filters"
import { FormField } from "@/components/app/form-field"
import { EmptyState, ErrorState, FilteredEmptyState, TableSkeleton } from "@/components/app/list-state"
import { PageContainer, PageHeader } from "@/components/app/page"
import { Pagination } from "@/components/app/pagination"
import { StatusBadge } from "@/components/app/status-badge"
import { TableFrame } from "@/components/app/table-frame"
import { useAsyncData } from "@/hooks/use-async-data"
import { useListQuery } from "@/hooks/use-list-query"
import { formatDateTime } from "@/lib/time"
import { parseListFilters, serializeListFilters } from "@/lib/list-filters"
import { listConnections } from "@/services/mock-service"
import type { Connection } from "@/domain/types"
import { rbac } from "@/services/rbac"

const emptyForm = {
  name: "",
  endpoint: "",
  authType: "API Key" as Connection["authType"],
  secret: "",
  headers: "",
}

export default function ConnectionsPage() {
  const { params, update } = useListQuery(20)
  const filters = parseListFilters(params.filters)
  const { data, loading, error, retry } = useAsyncData(() => listConnections(params), [
    params.search,
    params.page,
    params.pageSize,
    params.filters,
  ])

  const [searchInput, setSearchInput] = useState(params.search ?? "")
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput !== (params.search ?? "")) update({ search: searchInput }, true)
    }, 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput])

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Connection | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [testingId, setTestingId] = useState<string | null>(null)

  const canManage = rbac.can("connection.manage")

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm)
    setFormOpen(true)
  }
  const openEdit = (connection: Connection) => {
    setEditing(connection)
    setForm({ name: connection.name, endpoint: connection.endpoint, authType: connection.authType, secret: "", headers: (connection.requiredHeaders ?? []).join(", ") })
    setFormOpen(true)
  }

  const testConnection = (connection: Connection) => {
    setTestingId(connection.id)
    setTimeout(() => {
      setTestingId(null)
      if (connection.status === "Failed") {
        toast.error("Authentication failed：凭证校验未通过")
      } else {
        toast.success("Connected")
      }
    }, 900)
  }

  return (
    <PageContainer wide className="space-y-3">
      <PageHeader
        title="Connections"
        description="管理 API Tool 依赖的外部系统连接与凭证（endpoint + auth）"
        actions={
          canManage ? (
            <Button onClick={openCreate}><Plus className="size-4" /> 新建 Connection</Button>
          ) : null
        }
      />

      <FilterBar>
        <SearchField value={searchInput} onChange={setSearchInput} placeholder="搜索 Connection..." />
        <Select
          value={filters.status ?? "__all__"}
          onValueChange={(v) => {
            const next = { ...filters }
            if (v === "__all__") delete next.status
            else next.status = v
            update({ filters: serializeListFilters(next) }, true)
          }}
        >
          <SelectTrigger className="h-9 w-32"><SelectValue placeholder="状态" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">全部状态</SelectItem>
            <SelectItem value="Connected">Connected</SelectItem>
            <SelectItem value="Failed">Failed</SelectItem>
            <SelectItem value="Not Tested">Not Tested</SelectItem>
          </SelectContent>
        </Select>
      </FilterBar>

      {error ? (
        <ErrorState title="Connections 加载失败" onRetry={retry} />
      ) : loading ? (
        <TableFrame><TableSkeleton rows={5} columns={5} /></TableFrame>
      ) : !data || data.items.length === 0 ? (
        filters.status || params.search ? (
          <FilteredEmptyState onClear={() => { setSearchInput(""); update({ filters: "", search: "" }, true) }} />
        ) : (
          <EmptyState title="暂无 Connection" description="创建第一个 Connection，供 API Tool 引用" />
        )
      ) : (
        <>
          <TableFrame>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>Endpoint / Host</TableHead>
                  <TableHead>Authentication</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>最近更新</TableHead>
                  {canManage ? <TableHead className="w-40" /> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((connection) => (
                  <TableRow key={connection.id}>
                    <TableCell className="text-sm font-medium">{connection.name}</TableCell>
                    <TableCell className="font-mono text-xs">{connection.endpoint}</TableCell>
                    <TableCell>
                      <div className="text-sm">{connection.authType}</div>
                      <div className="text-xs text-muted-foreground">
                        {connection.secretConfigured ? "•••••••• 已配置" : "未配置"}
                      </div>
                    </TableCell>
                    <TableCell><StatusBadge status={connection.status} /></TableCell>
                    <TableCell className="text-sm tabular-nums">{formatDateTime(connection.updatedAt)}</TableCell>
                    {canManage ? (
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button variant="outline" size="sm" className="h-7 text-xs" disabled={testingId === connection.id} onClick={() => testConnection(connection)}>
                            <Plug className="size-3" /> {testingId === connection.id ? "Testing..." : "Test"}
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => openEdit(connection)}>编辑</Button>
                        </div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableFrame>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={(page) => update({ page })} onPageSizeChange={(pageSize) => update({ pageSize })} />
        </>
      )}

      {/* Create / Edit Sheet：轻量二级交互 */}
      <Sheet open={formOpen} onOpenChange={setFormOpen}>
        <SheetContent className="w-[420px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editing ? `编辑 ${editing.name}` : "新建 Connection"}</SheetTitle>
            <SheetDescription>Credential / Secret 保存后不回显明文</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-4">
            <FormField label="名称" required>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="例如：CRM 系统" />
            </FormField>
            <FormField label="Base URL / Endpoint" required>
              <Input className="font-mono text-xs" value={form.endpoint} onChange={(e) => setForm((f) => ({ ...f, endpoint: e.target.value }))} placeholder="https://..." />
            </FormField>
            <FormField label="Authentication Type">
              <Select value={form.authType} onValueChange={(v) => setForm((f) => ({ ...f, authType: v as Connection["authType"] }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="None">None</SelectItem>
                  <SelectItem value="API Key">API Key</SelectItem>
                  <SelectItem value="Bearer Token">Bearer Token</SelectItem>
                  <SelectItem value="Basic Auth">Basic Auth</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Credential / Secret" description={editing?.secretConfigured ? "已配置 ••••••••；更新时重新输入新值" : "仅在创建 / 更新时录入"}>
              <Input type="password" value={form.secret} onChange={(e) => setForm((f) => ({ ...f, secret: e.target.value }))} placeholder={editing?.secretConfigured ? "" : "输入 Secret"} />
            </FormField>
            <FormField label="Required Headers" description="逗号分隔">
              <Input value={form.headers} onChange={(e) => setForm((f) => ({ ...f, headers: e.target.value }))} placeholder="X-App-Id" />
            </FormField>
          </div>
          <SheetFooter className="mt-6">
            <Button variant="outline" onClick={() => setFormOpen(false)}>取消</Button>
            <Button
              disabled={!form.name.trim() || !form.endpoint.trim()}
              onClick={() => {
                setFormOpen(false)
                toast.success(editing ? "Connection 已更新" : "Connection 已创建（Not Tested）")
              }}
            >
              保存
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </PageContainer>
  )
}
