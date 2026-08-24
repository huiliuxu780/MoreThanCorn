import { ArrowLeft, MoreHorizontal, Pencil, FlaskConical } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom"
import { toast } from "sonner"

import { PageContainer } from "@/components/app/page"
import { TYPE_ICON, TYPE_LABEL, ResourceStatusBadge } from "@/components/resources/resource-card"
import {
  ConfirmDeleteDialog, DeleteBlockedDialog, ResourceTestDialog,
} from "@/components/resources/resource-dialogs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { resApi, type RefInfo, type ResourceDTO } from "@/services/resource-api"

function Kv({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_1fr] text-sm">
      <div className="border-b border-r border-border/60 bg-muted/40 px-3.5 py-2 text-muted-foreground">{k}</div>
      <div className="border-b border-border/60 px-3.5 py-2">{v}</div>
    </div>
  )
}

export default function ResDetailPage() {
  const { type = "", id = "" } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [sp] = useSearchParams()
  const [dto, setDto] = useState<ResourceDTO | null>(null)
  const [refs, setRefs] = useState<RefInfo[]>([])
  const [versions, setVersions] = useState<{ version: number; status: string }[]>([])
  const [testOpen, setTestOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(sp.get("edit") === "1")
  const [delOpen, setDelOpen] = useState(false)
  const [blocked, setBlocked] = useState<{ refs: RefInfo[] } | null>(null)
  const [editForm, setEditForm] = useState<Record<string, any>>({})

  const domain = ["model", "tool", "mcp", "knowledge"].includes(type) ? "ai" : "data"
  const listPath = `/config/${domain}-resources`

  const load = useCallback(() => {
    resApi.get(type, id).then((d) => { setDto(d); setEditForm({ name: d.name, description: d.description }) }).catch(() => setDto(null))
    resApi.usage(type, id).then((r) => setRefs(r.refs)).catch(() => setRefs([]))
    if (type === "tool") resApi.toolVersions(id).then(setVersions).catch(() => undefined)
  }, [type, id])
  useEffect(() => { load() }, [load])

  if (!dto) return <PageContainer className="text-sm text-muted-foreground">加载中…</PageContainer>

  const Icon = TYPE_ICON[dto.type as keyof typeof TYPE_ICON]
  const versioned = type === "tool" || type === "model"

  const saveEdit = async () => {
    try {
      await resApi.update(type, id, editForm)
      toast.success("已保存")
      setEditOpen(false)
      const from = (location.state as { from?: string } | null)?.from
      if (from === "list") navigate(`${listPath}?tab=${type}`)
      else load()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const doDelete = async () => {
    try {
      await resApi.remove(type, id)
      toast.success(`已删除「${dto.name}」`)
      navigate(`${listPath}?tab=${type}`)
    } catch (e) {
      const err = e as Error & { refs?: RefInfo[] }
      setDelOpen(false)
      if (err.refs) setBlocked({ refs: err.refs })
      else toast.error(err.message)
    }
  }

  return (
    <PageContainer className="space-y-4">
      <Button variant="ghost" size="sm" className="gap-1 px-2" onClick={() => navigate(`${listPath}?tab=${type}`)}>
        <ArrowLeft className="size-4" /> {domain === "ai" ? "AI Resources" : "Data Resources"}
      </Button>

      {/* Resource Header */}
      <div className="flex flex-wrap items-start gap-3.5">
        <div className="flex size-11 items-center justify-center rounded-xl bg-muted"><Icon className="size-5" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold">{dto.name}</h1>
            <ResourceStatusBadge dto={dto} />
            {dto.health !== "healthy" && dto.status === "enabled" && <Badge variant="neutral">Healthy</Badge>}
          </div>
          <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span>{TYPE_LABEL[type]}{dto.metadata.kind ? ` · ${dto.metadata.kind}` : ""}{dto.metadata.transport ? ` · ${dto.metadata.transport}` : ""}</span>
            {dto.metadata.version ? <span>v{String(dto.metadata.version)}{type === "tool" ? "（Latest Published）" : ""}</span> : null}
            <span>更新于 {dto.updatedAt?.replace("T", " ").slice(0, 16)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setTestOpen(true)}><FlaskConical className="size-3.5" /> 测试</Button>
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}><Pencil className="size-3.5" /> 编辑</Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="size-8"><MoreHorizontal className="size-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={async () => {
                await resApi.toggle(type, id, dto.status === "disabled")
                toast.success(dto.status === "disabled" ? "已启用" : "已停用")
                load()
              }}>{dto.status === "disabled" ? "启用" : "停用"}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive" onClick={() => setDelOpen(true)}>删除</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="config">Configuration</TabsTrigger>
          <TabsTrigger value="usage">Usage（{refs.length}）</TabsTrigger>
          <TabsTrigger value="versions">{versioned ? "Versions" : "变更记录"}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4 pt-4">
          <p className="max-w-3xl text-sm text-muted-foreground">{dto.description || "暂无描述"}</p>
          <div className="max-w-3xl overflow-hidden rounded-lg border">
            <Kv k="类型" v={`${TYPE_LABEL[type]}${dto.metadata.dsType ? ` · ${dto.metadata.dsType}` : ""}`} />
            {dto.metadata.provider ? <Kv k="Provider" v={String(dto.metadata.provider)} /> : null}
            {dto.metadata.modelKey ? <Kv k="Model Key" v={<span className="font-mono text-xs">{String(dto.metadata.modelKey)}</span>} /> : null}
            {dto.metadata.location ? <Kv k="位置" v={<span className="font-mono text-xs">{String(dto.metadata.location)}</span>} /> : null}
            {dto.metadata.connection ? <Kv k="Connection" v={String(dto.metadata.connection)} /> : null}
            {dto.metadata.recordMeaning ? <Kv k="一条数据代表" v={String(dto.metadata.recordMeaning)} /> : null}
            {dto.metadata.timeField ? <Kv k="时间字段" v={<span className="font-mono text-xs">{String(dto.metadata.timeField)}</span>} /> : null}
            <Kv k="引用 / 调用" v={`被 ${dto.usage.refCount} 处引用 · 7 日 ${dto.usage.calls7d.toLocaleString()} 次`} />
            <Kv k="健康度" v={<ResourceStatusBadge dto={dto} />} />
          </div>
        </TabsContent>

        <TabsContent value="config" className="space-y-3 pt-4">
          {versioned && <p className="text-xs text-muted-foreground">配置只读展示；修改将产生新的{type === "tool" ? "草稿版本（ToolVersion）" : "修订（Model Version）"}。</p>}
          <pre className="max-w-3xl overflow-x-auto rounded-lg border bg-muted/40 p-4 font-mono text-xs leading-5">
            {JSON.stringify(dto.config ?? {}, null, 2)}
          </pre>
        </TabsContent>

        <TabsContent value="usage" className="space-y-3 pt-4">
          {refs.length > 0 && (
            <div className="flex max-w-3xl items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
              该资源正被 {refs.length} 处引用，不可删除。引用链：Agent → Workflow → Version → Node Config → Resource。
            </div>
          )}
          <div className="max-w-3xl overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-3.5 py-2 font-medium">引用方</th><th className="px-3.5 py-2 font-medium">位置</th><th className="px-3.5 py-2 font-medium">类型</th>
              </tr></thead>
              <tbody>
                {refs.length === 0 && <tr><td colSpan={3} className="px-3.5 py-6 text-center text-xs text-muted-foreground">暂无引用</td></tr>}
                {refs.map((r, i) => (
                  <tr key={i} className="cursor-pointer border-b last:border-0 hover:bg-muted/40"
                    onClick={() => r.workflowId && navigate(`/config/workflows/${r.workflowId}`)}>
                    <td className="px-3.5 py-2 font-medium">{r.workflowName ?? r.label ?? "-"}</td>
                    <td className="px-3.5 py-2 text-xs text-muted-foreground">{r.version ? `${r.version} · ` : ""}{r.nodeName ?? r.kind}</td>
                    <td className="px-3.5 py-2 text-xs text-muted-foreground">{r.kind}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="versions" className="space-y-3 pt-4">
          {type === "tool" && (
            <>
              <div className="space-y-3 border-l pl-5" style={{ marginLeft: 6 }}>
                {versions.map((v, i) => (
                  <div key={v.version} className="relative">
                    <span className={`absolute -left-[26px] top-1 size-2.5 rounded-full border-2 ${i === 0 ? "border-foreground bg-foreground" : "border-border bg-white"}`} />
                    <div className="flex items-center gap-2 text-sm font-medium">
                      v{v.version}
                      {i === 0 ? <Badge variant="success">Published</Badge> : <Badge variant="neutral">Deprecated</Badge>}
                      {i === 0 && <Badge variant="secondary">Latest</Badge>}
                    </div>
                  </div>
                ))}
              </div>
              <Button variant="outline" size="sm" onClick={async () => { await resApi.newToolVersion(id); toast.success("已创建新草稿版本"); load() }}>
                基于当前版本创建新草稿
              </Button>
            </>
          )}
          <div className="max-w-3xl overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-3.5 py-2 font-medium">时间</th><th className="px-3.5 py-2 font-medium">操作人</th><th className="px-3.5 py-2 font-medium">变更</th>
              </tr></thead>
              <tbody>
                {(dto.changeLog ?? []).length === 0 && <tr><td colSpan={3} className="px-3.5 py-6 text-center text-xs text-muted-foreground">暂无变更记录</td></tr>}
                {(dto.changeLog ?? []).map((c, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="px-3.5 py-2 text-xs tabular-nums text-muted-foreground">{c.at.replace("T", " ").slice(0, 16)}</td>
                    <td className="px-3.5 py-2 text-xs">{c.actor}</td>
                    <td className="px-3.5 py-2 text-xs">{c.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>

      <ResourceTestDialog open={testOpen} title={dto.name} desc="使用样例输入执行一次真实调用。"
        onRun={(input) => resApi.test(type, id, input)} onClose={() => { setTestOpen(false); load() }} />

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>编辑 {dto.name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">名称</Label><Input value={editForm.name ?? ""} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></div>
            <div><Label className="text-xs">描述</Label><Textarea value={editForm.description ?? ""} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>取消</Button>
            <Button onClick={saveEdit}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog open={delOpen} name={dto.name} onConfirm={doDelete} onClose={() => setDelOpen(false)} />
      <DeleteBlockedDialog open={!!blocked} name={dto.name} refs={blocked?.refs ?? []} onClose={() => setBlocked(null)}
        onViewRefs={(r) => r.workflowId && navigate(`/config/workflows/${r.workflowId}`)} />
    </PageContainer>
  )
}
