/** 记忆子页（原站 /memory 同构）：全部记忆/记忆时间线 两 tab + 版本管理 dialog。
 * 度量：子页 h2 28/650；行 border-b（台账 §5）。保存即版本快照（后端 PUT /memory）。 */
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { agentApi } from "@/services/wf-api"

interface Revision { id: string; version: number; content: string; note: string; createdBy: string; createdAt: string }
interface TimelineEvent { type: string; note: string; at: string; name?: string; version?: number }

export function AgentMemorySection({ agentId, readOnly }: { agentId: string; readOnly?: boolean }) {
  const [tab, setTab] = useState<"all" | "timeline">("all")
  const [content, setContent] = useState("")
  const [version, setVersion] = useState(1)
  const [note, setNote] = useState("")
  const [revisions, setRevisions] = useState<Revision[]>([])
  const [timeline, setTimeline] = useState<TimelineEvent[]>([])
  const [revOpen, setRevOpen] = useState(false)
  const [viewRev, setViewRev] = useState<Revision | null>(null)

  const load = useCallback(() => {
    agentApi.memory(agentId).then((m) => { setContent(m.content); setVersion(m.version) }).catch(() => undefined)
    agentApi.memoryRevisions(agentId).then((r) => setRevisions(r.items)).catch(() => setRevisions([]))
    agentApi.memoryTimeline(agentId).then((r) => setTimeline(r.items)).catch(() => setTimeline([]))
  }, [agentId])
  useEffect(() => { load() }, [load])

  const save = async () => {
    try {
      const r = await agentApi.saveMemory(agentId, content, note)
      setVersion(r.version); setNote("")
      toast.success(`记忆已保存为 V${r.version}`)
      load()
    } catch (e) { toast.error((e as Error).message) }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-[28px] font-semibold leading-[38px]">记忆</h2>
      <div className="flex h-8 w-fit items-center gap-1 rounded-md bg-(--segment-bg) p-1">
        {([["all", "全部记忆"], ["timeline", "记忆时间线"]] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className={`h-6 rounded px-2.5 text-xs leading-4 transition-colors ${tab === k
              ? "bg-(--segment-active) font-medium text-foreground"
              : "text-muted-foreground hover:text-foreground"}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "all" ? (
        <div className="max-w-3xl space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">全局记忆 · V{version}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setRevOpen(true)}>版本管理</Button>
              {!readOnly && <Button size="sm" onClick={() => void save()}>保存</Button>}
            </div>
          </div>
          <Textarea value={content} disabled={readOnly} placeholder="对该 Agent 所有任务生效的全局记忆（保存即生成版本快照）"
            className="min-h-64 font-mono text-xs" onChange={(e) => setContent(e.target.value)} />
          {!readOnly && (
            <Input value={note} placeholder="本次修改说明（可选，入版本记录）" onChange={(e) => setNote(e.target.value)} />
          )}
        </div>
      ) : (
        <div className="max-w-3xl">
          {timeline.length === 0 ? <p className="text-xs text-(--text-tertiary)">暂无事件。</p> : timeline.map((e, i) => (
            <div key={i} className="flex items-center gap-3 border-b py-3 text-xs" style={{ borderColor: "var(--border)" }}>
              <span className="size-2 shrink-0 rounded-full bg-brand" />
              <span className="shrink-0 text-(--text-tertiary)">{e.type === "skill_installed" ? "学到新技能" : "记忆更新"}</span>
              <span className="truncate">{e.note}</span>
              <span className="ml-auto shrink-0 text-(--text-tertiary)">{e.at.slice(0, 16).replace("T", " ")}</span>
            </div>
          ))}
        </div>
      )}

      <Dialog open={revOpen} onOpenChange={setRevOpen}>
        <DialogContent className="max-h-[70vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle>版本管理</DialogTitle></DialogHeader>
          {revisions.length === 0 ? <p className="text-xs text-(--text-tertiary)">暂无版本快照。</p>
            : revisions.map((r) => (
              <div key={r.id} className="flex items-center gap-3 border-b py-2 text-xs" style={{ borderColor: "var(--border)" }}>
                <span className="font-mono font-medium">V{r.version}</span>
                <span className="truncate text-muted-foreground">{r.note || "（无说明）"}</span>
                <span className="ml-auto shrink-0 text-(--text-tertiary)">{r.createdAt.slice(0, 16).replace("T", " ")}</span>
                <Button variant="outline" size="sm" className="h-6 shrink-0 text-[10px]" onClick={() => setViewRev(r)}>查看</Button>
              </div>
            ))}
          {viewRev && (
            <pre className="max-h-64 overflow-auto rounded border p-2 text-[11px]" style={{ borderColor: "var(--border)" }}>
              {viewRev.content}
            </pre>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
