/** 连接器子页（原站 /connector 同构）：市场/已安装 两 tab；per-agent 挂载存 config.connections（乐观锁）。 */
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { agentApi, pagedApi, type AgentInfo } from "@/services/wf-api"

interface Conn { id: string; name: string; kind: string; protocol: string; status: string }

export function AgentConnectorsSection({ agent, readOnly }: { agent: AgentInfo; readOnly?: boolean }) {
  const [tab, setTab] = useState<"market" | "installed">("market")
  const [all, setAll] = useState<Conn[]>([])
  const [revision, setRevision] = useState(agent.configRevision)
  const mounted = ((agent.config as { connections?: string[] }).connections) ?? []

  const load = useCallback(() => {
    pagedApi.connections({ page: 1, pageSize: 100 }).then((r) => setAll(r.items as unknown as Conn[])).catch(() => setAll([]))
  }, [])
  useEffect(() => { load() }, [load])

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

  const Row = ({ c, right }: { c: Conn; right: React.ReactNode }) => (
    <div className="flex h-[67px] items-center gap-3 border-b px-1 text-sm" style={{ borderColor: "var(--border)" }}>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{c.name}</div>
        <div className="truncate text-xs text-(--text-tertiary)">{c.protocol} · {c.kind} · {c.status}</div>
      </div>
      {right}
    </div>
  )

  return (
    <div className="space-y-4">
      <h2 className="text-[28px] font-semibold leading-[38px]">连接器</h2>
      <div className="flex h-8 w-fit items-center gap-1 rounded-md bg-(--segment-bg) p-1">
        {([["market", "市场"], ["installed", "已安装"]] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className={`h-6 rounded px-2.5 text-xs leading-4 transition-colors ${tab === k
              ? "bg-(--segment-active) font-medium text-foreground"
              : "text-muted-foreground hover:text-foreground"}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="max-w-3xl">
        {tab === "market"
          ? (all.length === 0 ? <p className="text-xs text-(--text-tertiary)">平台暂无 Connection，去资源页创建。</p>
            : all.map((c) => (
              <Row key={c.id} c={c} right={
                mounted.includes(c.id)
                  ? <span className="shrink-0 text-xs text-(--text-tertiary)">已安装</span>
                  : !readOnly && <Button variant="outline" size="sm" className="shrink-0"
                    onClick={() => void setMounted([...mounted, c.id])}>添加</Button>
              } />
            )))
          : (mounted.length === 0 ? <p className="text-xs text-(--text-tertiary)">尚未挂载连接器。</p>
            : mounted.map((id) => {
              const c = all.find((x) => x.id === id)
              return (
                <Row key={id} c={c ?? { id, name: id, kind: "—", protocol: "—", status: "—" }} right={
                  !readOnly && <Button variant="ghost" size="sm" className="shrink-0"
                    onClick={() => void setMounted(mounted.filter((x) => x !== id))}>移除</Button>
                } />
              )
            }))}
      </div>
    </div>
  )
}
