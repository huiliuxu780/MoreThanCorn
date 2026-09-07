import { useEffect, useState } from "react"
import { Pencil, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { ResCategoryList } from "@/pages/res-list"
import { FilterBar } from "@/components/app/filters"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ConnectionPicker } from "@/components/resources/connection-picker"
import { pagedApi, providerApi } from "@/services/wf-api"

/** docs/v2-design/10 §4.3–4.5：壳内分类页（工具与 MCP / 知识库 / 数据资产）。 */
export function ResToolsPage() {
  return <ResCategoryList types={["tool", "mcp"]} createTo="/resources/ai/new" />
}

export function ResKnowledgePage() {
  return <ResCategoryList types={["knowledge"]} createTo="/resources/ai/new" />
}

export function ResDataPage() {
  return <ResCategoryList types={["datasource", "asset"]} createTo="/resources/data/new" />
}

interface ProviderRow { id: string; name: string; baseUrl: string; connectionId: string | null }

/** docs/v2-design/10 §4.2：模型接入 = 接入渠道（ModelProvider CRUD）+ 模型目录。 */
export function ResModelsPage() {
  const [tab, setTab] = useState("channels")
  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList>
        <TabsTrigger value="channels">接入渠道</TabsTrigger>
        <TabsTrigger value="catalog">模型目录</TabsTrigger>
      </TabsList>
      <TabsContent value="channels"><ProvidersPanel /></TabsContent>
      <TabsContent value="catalog">
        <ResCategoryList types={["model"]} createTo="/resources/ai/new" />
      </TabsContent>
    </Tabs>
  )
}

function ProvidersPanel() {
  const [rows, setRows] = useState<ProviderRow[]>([])
  const [conns, setConns] = useState<Record<string, string>>({})
  const [edit, setEdit] = useState<ProviderRow | "new" | null>(null)
  const [del, setDel] = useState<ProviderRow | null>(null)

  const load = () => {
    pagedApi.providers({ page: 1, pageSize: 100 })
      .then((r) => setRows(r.items as unknown as ProviderRow[]))
      .catch(() => setRows([]))
    pagedApi.connections({ page: 1, pageSize: 100 })
      .then((r) => {
        const m: Record<string, string> = {}
        for (const c of r.items as { id: string; name: string }[]) m[c.id] = c.name
        setConns(m)
      })
      .catch(() => undefined)
  }
  useEffect(() => { load() }, [])

  const remove = async () => {
    if (!del) return
    try {
      await providerApi.remove(del.id)
      toast.success(`已删除渠道「${del.name}」`)
      setDel(null)
      load()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <div className="space-y-3">
      <FilterBar>
        <span className="ml-auto" />
        <Button onClick={() => setEdit("new")}><Plus className="size-4" /> 新建接入渠道</Button>
      </FilterBar>
      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-surface-muted text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">名称</th>
              <th className="px-3 py-2 font-medium">baseUrl</th>
              <th className="px-3 py-2 font-medium">凭据 Connection</th>
              <th className="px-3 py-2 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-8 text-center text-xs text-muted-foreground">暂无接入渠道</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-b last:border-0">
                <td className="px-3 py-2 font-medium">{r.name}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.baseUrl || "—"}</td>
                <td className="px-3 py-2 text-xs">{r.connectionId ? conns[r.connectionId] ?? r.connectionId : "—"}</td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" className="size-7" title="编辑" aria-label={`编辑 ${r.name}`} onClick={() => setEdit(r)}>
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="size-7" title="删除" aria-label={`删除 ${r.name}`} onClick={() => setDel(r)}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        门禁：生产环境禁止注册/保留 mock:// 渠道（P0-01）。凭据仅引用 Connection，渠道本身不落密钥。
      </p>
      {edit && <ProviderDialog initial={edit === "new" ? null : edit}
        onClose={() => setEdit(null)} onSaved={load} />}
      {del && (
        <Dialog open onOpenChange={(o) => !o && setDel(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>删除接入渠道</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">
              确认删除「{del.name}」？其下模型将失去渠道引用。
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDel(null)}>取消</Button>
              <Button variant="destructive" onClick={remove}>删除</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

function ProviderDialog({ initial, onClose, onSaved }: {
  initial: ProviderRow | null
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(initial?.name ?? "")
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? "")
  const [connId, setConnId] = useState(initial?.connectionId ?? "")

  const save = async () => {
    if (!name.trim()) { toast.error("名称必填"); return }
    try {
      if (initial) {
        await providerApi.update(initial.id, { name: name.trim(), baseUrl, connectionId: connId || null })
      } else {
        await providerApi.create({ name: name.trim(), baseUrl, connectionId: connId || null })
      }
      toast.success(initial ? "已保存渠道" : "已创建渠道")
      onClose()
      onSaved()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{initial ? "编辑接入渠道" : "新建接入渠道"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="pv-name">名称</Label>
            <Input id="pv-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="DashScope 渠道" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pv-url">baseUrl</Label>
            <Input id="pv-url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1" className="font-mono text-xs" />
          </div>
          <div className="space-y-1">
            <Label>凭据 Connection（llm 协议）</Label>
            <ConnectionPicker value={connId} onChange={setConnId} protocols={["llm"]} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={save}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
