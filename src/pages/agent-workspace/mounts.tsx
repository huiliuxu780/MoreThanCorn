/** Wakerflow / 知识库子页：config.workflows / config.knowledges 挂载清单 + 绑定/解绑（乐观锁）。
 * 行规格 border-b h67 14px + 打开/解绑（台账 §5 知识库实测）。 */
import { useCallback, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { agentApi, wfApi, type AgentInfo } from "@/services/wf-api"
import { resApi } from "@/services/resource-api"

export function AgentMountsSection({ agent, kind, readOnly }: {
  agent: AgentInfo; kind: "workflows" | "knowledges" | "tools"; readOnly?: boolean
}) {
  const navigate = useNavigate()
  const [options, setOptions] = useState<{ id: string; name: string }[]>([])
  const [revision, setRevision] = useState(agent.configRevision)
  const [pick, setPick] = useState("")
  const mounted = ((agent.config as {
    workflows?: string[]; knowledges?: string[]; tools?: string[]
  })[kind]) ?? []

  const load = useCallback(() => {
    if (kind === "workflows") {
      wfApi.list({ pageSize: 100 }).then((r) => setOptions(r.items.map((w) => ({ id: w.id, name: w.name })))).catch(() => setOptions([]))
    } else if (kind === "tools") {
      // 09-18：工具挂载独立子页（IA 单一归属，自档案页「能力挂载」块迁入）
      resApi.registry("tools", false).then((r) => setOptions(r.items.map((t) => ({ id: t.id, name: t.name })))).catch(() => setOptions([]))
    } else {
      resApi.registry("knowledge", false).then((r) => setOptions(r.items.map((k) => ({ id: k.id, name: k.name })))).catch(() => setOptions([]))
    }
  }, [kind])
  useEffect(() => { load() }, [load])

  const nameOf = (id: string) => options.find((o) => o.id === id)?.name ?? id

  const setMounted = async (ids: string[]) => {
    try {
      const r = await agentApi.update(agent.id, {
        config: { ...(agent.config as object), [kind]: ids },
      }, revision)
      setRevision(r.configRevision)
      agent.config = { ...(agent.config as object), [kind]: ids }
      toast.success("已更新挂载")
    } catch (e) { toast.error((e as Error).message) }
  }

  const title = kind === "workflows" ? "Wakerflow" : kind === "tools" ? "工具" : "知识库"
  const unmounted = options.filter((o) => !mounted.includes(o.id))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[28px] font-semibold leading-[38px]">{title}</h2>
        {!readOnly && (
          <div className="flex items-center gap-2">
            <Select value={pick || undefined} onValueChange={setPick}>
              <SelectTrigger className="h-8 w-56"><SelectValue placeholder={`绑定${title}`} /></SelectTrigger>
              <SelectContent>
                {unmounted.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" disabled={!pick}
              onClick={() => { void setMounted([...mounted, pick]); setPick("") }}>绑定</Button>
          </div>
        )}
      </div>
      <div className="max-w-3xl">
        {mounted.length === 0 ? <p className="text-xs text-(--text-tertiary)">尚未绑定{title}。</p>
          : mounted.map((id) => (
            <div key={id} className="flex h-[67px] items-center gap-3 border-b px-1 text-sm" style={{ borderColor: "var(--border)" }}>
              <span className="min-w-0 flex-1 truncate font-medium">{nameOf(id)}</span>
              {kind === "workflows" && (
                <Button variant="outline" size="sm" className="shrink-0" onClick={() => navigate(`/workflows/${id}`)}>打开</Button>
              )}
              {!readOnly && (
                <Button variant="ghost" size="sm" className="shrink-0"
                  onClick={() => void setMounted(mounted.filter((x) => x !== id))}>解绑</Button>
              )}
            </div>
          ))}
      </div>
    </div>
  )
}
