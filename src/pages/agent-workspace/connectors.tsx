/** 连接器子页（QoderWake /wakers/<id>/connector「连接器」同构）。
 *
 * 原站事实（09-10 实地）：
 *  - h2 连接器 + 副文案「集成外部应用、日历、服务及其他系统。」；
 *  - 动作组：去市场 / 手动添加 / 自定义；
 *  - 「我的连接器」区：已挂载清单；空态文案「暂无自定义连接器——可手动添加自定义连接器或从 JSON 导入。」；
 *  - 「来自连接器市场」区：市场卡（名称+描述+动作）。
 * 我方映射：Connection 表 = 连接器；挂载 = agent.config.connections（乐观锁）。
 */
import { useCallback, useEffect, useState } from "react"
import { Plus, Upload } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { agentApi, pagedApi, type AgentInfo } from "@/services/wf-api"
import { connApi, resApi } from "@/services/resource-api"

interface Conn { id: string; name: string; kind: string; protocol: string; status: string }

export function AgentConnectorsSection({ agent, readOnly }: { agent: AgentInfo; readOnly?: boolean }) {
  const [tab, setTab] = useState<"mine" | "market">("mine")
  const [all, setAll] = useState<Conn[]>([])
  const [revision, setRevision] = useState(agent.configRevision)
  const [addOpen, setAddOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [form, setForm] = useState({ name: "", protocol: "http-api", baseUrl: "" })
  const [importText, setImportText] = useState('{"name":"","protocol":"http-api","baseUrl":""}')
  const mounted = ((agent.config as { connections?: string[] }).connections) ?? []

  const load = useCallback(() => {
    pagedApi.connections({ page: 1, pageSize: 100 }).then((r) => setAll(r.items as unknown as Conn[])).catch(() => setAll([]))
  }, [])
  useEffect(() => { load() }, [load])

  // 09-18（用户指认假空）：工具经连接真实执行，config.connections 未挂载时
  // 页面不得把"在用连接"藏成 0——只读派生块展示 连接←哪些工具
  const [toolUsage, setToolUsage] = useState<{ conn: Conn; tools: string[] }[]>([])
  const toolRefs = ((agent.config as { tools?: string[] }).tools) ?? []
  useEffect(() => {
    if (toolRefs.length === 0) { setToolUsage([]); return }
    Promise.all([
      resApi.registry("tools", false),
      pagedApi.connections({ page: 1, pageSize: 100 }),
    ]).then(([t, c]) => {
      // registry tool DTO 的连接键是 metadata.connection（名字），兼容 connectionId
      const meta = (it: { metadata?: Record<string, unknown> }) => {
        const m = it.metadata as { connectionId?: string; connection?: string } | undefined
        return m?.connectionId ?? m?.connection
      }
      const lookup = new Map<string, { name: string; cid?: string }>()
      for (const it of t.items) { lookup.set(it.id, { name: it.name, cid: meta(it) }); lookup.set(it.name, { name: it.name, cid: meta(it) }) }
      const acc = new Map<string, string[]>()
      for (const ref of toolRefs) {
        const ti = lookup.get(ref)
        if (ti?.cid) acc.set(ti.cid, [...(acc.get(ti.cid) ?? []), ti.name])
      }
      const conns = c.items as unknown as Conn[]
      setToolUsage(Array.from(acc.entries()).map(([idOrName, names]) => ({
        conn: conns.find((x) => x.id === idOrName || x.name === idOrName)
          ?? { id: idOrName, name: idOrName, kind: "—", protocol: "—", status: "—" },
        tools: names,
      })))
    }).catch(() => setToolUsage([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id, toolRefs.join(",")])

  const setMounted = async (ids: string[]) => {
    try {
      const r = await agentApi.update(agent.id, {
        config: { ...(agent.config as object), connections: ids },
      }, revision)
      setRevision(r.configRevision)
      agent.config = { ...(agent.config as object), connections: ids }
      toast.success("已更新连接器挂载")
    } catch (e) { toast.error((e as Error).message) }
  }

  // 09-13 审计修复：原生 fetch 收口到 connApi（统一基址/鉴权/超时/错误解析）
  const createConnection = (name: string, protocol: string, baseUrl: string) =>
    connApi.create({
      name, kind: "api_key", protocol,
      endpoint: baseUrl ? { base_url: baseUrl } : {},
    })

  const submitAdd = async () => {
    if (!form.name.trim()) { toast.error("请填写连接器名称"); return }
    try {
      const c = await createConnection(form.name.trim(), form.protocol, form.baseUrl.trim())
      toast.success(`已创建连接器「${c.name}」并挂载`)
      await setMounted([...mounted, c.id])
      setAddOpen(false)
      setForm({ name: "", protocol: "http-api", baseUrl: "" })
      load()
    } catch (e) { toast.error(`创建失败：${(e as Error).message}`) }
  }

  const submitImport = async () => {
    try {
      const p = JSON.parse(importText) as { name?: string; protocol?: string; baseUrl?: string }
      if (!p.name) { toast.error("JSON 缺少 name"); return }
      const c = await createConnection(p.name, p.protocol ?? "http-api", p.baseUrl ?? "")
      toast.success(`已导入连接器「${c.name}」并挂载`)
      await setMounted([...mounted, c.id])
      setImportOpen(false)
      load()
    } catch (e) { toast.error(`导入失败：${(e as Error).message}`) }
  }

  const Row = ({ c, right }: { c: Conn; right: React.ReactNode }) => (
    <div className="flex min-h-[67px] items-center gap-3 border-b px-1 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{c.name}</div>
        <div className="truncate text-xs text-(--text-tertiary)">{c.protocol} · {c.kind} · {c.status}</div>
      </div>
      {right}
    </div>
  )

  const mineRows = mounted.map((id) => all.find((x) => x.id === id) ?? { id, name: id, kind: "—", protocol: "—", status: "—" })
  const marketRows = all.filter((c) => !mounted.includes(c.id))

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[28px] font-semibold leading-[38px]">连接器</h2>
        <p className="mt-1 text-sm text-muted-foreground">集成外部应用、日历、服务及其他系统。</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setTab("market")}>去市场</Button>
        <Button variant="outline" size="sm" disabled={readOnly} onClick={() => setAddOpen(true)}>
          <Plus className="size-3.5" /> 手动添加
        </Button>
        <Button variant="outline" size="sm" disabled={readOnly} onClick={() => setImportOpen(true)}>
          <Upload className="size-3.5" /> 从 JSON 导入
        </Button>
      </div>
      <Tabs value={tab} onValueChange={(v) => setTab(v as "mine" | "market")}>
        <TabsList>
          <TabsTrigger value="mine">我的连接器（{mineRows.length}）</TabsTrigger>
          <TabsTrigger value="market">连接器市场（{marketRows.length}）</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="max-w-3xl">
        {tab === "mine" ? (
          <>
            {mineRows.length === 0 ? (
              <div className="rounded-lg border border-dashed p-8 text-center text-xs text-muted-foreground">
                <p>暂无自定义连接器</p>
                <p className="mt-1">可手动添加自定义连接器，或从 JSON 导入。</p>
              </div>
            ) : mineRows.map((c) => (
              <Row key={c.id} c={c} right={
                !readOnly && <Button variant="ghost" size="sm" className="shrink-0"
                  onClick={() => void setMounted(mounted.filter((x) => x !== c.id))}>移除</Button>
              } />
            ))}
            {toolUsage.length > 0 && (
              <div className="mt-4">
                <div className="pb-1 text-[13px] font-medium">工具在用连接（只读派生）</div>
                {toolUsage.map(({ conn, tools }) => (
                  <Row key={conn.id} c={conn} right={
                    <span className="shrink-0 text-xs text-(--text-tertiary)">被 {tools.join(" / ")} 使用</span>
                  } />
                ))}
              </div>
            )}
          </>
        ) : (marketRows.length === 0
          ? <p className="text-xs text-(--text-tertiary)">市场暂无未挂载的连接器。</p>
          : marketRows.map((c) => (
            <Row key={c.id} c={c} right={
              !readOnly && <Button variant="outline" size="sm" className="shrink-0"
                onClick={() => void setMounted([...mounted, c.id])}>添加</Button>
            } />
          )))}
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>手动添加连接器</DialogTitle>
            <DialogDescription>创建一个连接器并挂载到当前 Agent。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1">
              <Label>名称</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例如：内部订单服务" />
            </div>
            <div className="grid gap-1">
              <Label>协议</Label>
              <Input value={form.protocol} onChange={(e) => setForm({ ...form, protocol: e.target.value })} placeholder="http-api | llm | mcp-http" />
            </div>
            <div className="grid gap-1">
              <Label>Base URL（可选）</Label>
              <Input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="https://..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>取消</Button>
            <Button onClick={() => void submitAdd()}>创建并挂载</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>从 JSON 导入连接器</DialogTitle>
            <DialogDescription>支持 {`{ name, protocol, baseUrl }`} 结构。</DialogDescription>
          </DialogHeader>
          <textarea
            className="min-h-32 w-full rounded-md border bg-transparent p-2 font-mono text-xs"
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>取消</Button>
            <Button onClick={() => void submitImport()}>导入并挂载</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
