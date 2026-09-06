/** EvalPanel：工作流级效果评测（期望答案 + rule/model Judge + 人评覆盖）。
 *  Agent 级评测走 components/agent-ops-panels 的 AgentEvalPanel（入口按 agentMeta 分流）。 */
import { useCallback, useEffect, useState } from "react"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { C } from "@/components/wf/controls"
import { evalApi } from "@/services/wf-api"
import { toast } from "../toast"

interface EvalRunRow {
  sampleId: string; name: string; runId?: string; status: string
  durationMs?: number | null; output?: string; error?: string | null
  judge?: { kind: string; score: number } | null
}

export function EvalPanel({ workflowId, onClose }: { workflowId: string; onClose: () => void }) {
  const [samples, setSamples] = useState<{ id: string; name: string; input: Record<string, unknown>; expected?: { text?: string } | null }[]>([])
  const [summary, setSummary] = useState<{ total?: number; succeeded?: number; failed?: number; successRate?: number } | null>(null)
  const [results, setResults] = useState<EvalRunRow[] | null>(null)
  const [name, setName] = useState("")
  const [inputJson, setInputJson] = useState('{ "userQuery": "你好" }')
  const [expectedText, setExpectedText] = useState("")
  const [judge, setJudge] = useState<"none" | "rule" | "model">("rule")
  const [running, setRunning] = useState(false)
  const load = useCallback(() => {
    evalApi.samples(workflowId).then((r) => setSamples(r.items)).catch(() => undefined)
    evalApi.summary(workflowId).then(setSummary).catch(() => undefined)
  }, [workflowId])
  useEffect(() => { load() }, [load])
  const humanScore = async (sampleId: string, score: number) => {
    try {
      const r = await evalApi.humanScore(sampleId, score)
      setResults((rs) => rs?.map((x) => (x.sampleId === sampleId ? { ...x, judge: r.judge } : x)) ?? rs)
      toast.success(`已人评 ${score} 分`)
    } catch (e) { toast.error((e as Error).message) }
  }
  return (
    <div className="absolute inset-y-0 right-0 z-20 flex w-[420px] max-w-[92vw] flex-col border-l bg-surface" style={{ borderColor: C.cardBorder }}>
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-[15px] font-semibold" style={{ color: C.ink }}>效果评测</span>
        <button onClick={onClose} title="关闭效果评测"><X className="size-4 text-muted-foreground" /></button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-4">
        {summary && (
          <div className="grid grid-cols-4 gap-2 text-center">
            {[["总数", summary.total], ["成功", summary.succeeded], ["失败", summary.failed], ["成功率", `${Math.round((summary.successRate ?? 0) * 100)}%`]].map(([l, v]) => (
              <div key={l as string} className="rounded-lg border px-2 py-2" style={{ borderColor: C.cardBorder }}>
                <div className="text-[11px]" style={{ color: C.ink3 }}>{l}</div>
                <div className="text-sm font-semibold" style={{ color: C.ink }}>{v}</div>
              </div>
            ))}
          </div>
        )}
        <div className="space-y-2">
          <div className="text-[13px] font-medium" style={{ color: C.ink }}>| 评测集（样本 = 固定输入 + 可选期望答案）</div>
          {samples.map((sp) => (
            <div key={sp.id} className="flex items-center gap-2 rounded border px-2 py-1 text-xs" style={{ borderColor: C.cardBorder }}>
              <span className="flex-1 truncate" style={{ color: C.ink }}>{sp.name}</span>
              {sp.expected?.text && <span className="truncate rounded px-1 text-[10px]" style={{ background: "var(--status-success-soft)", color: "var(--status-success)" }}>期望：{sp.expected.text.slice(0, 16)}</span>}
              <button className="text-muted-foreground" onClick={async () => { await evalApi.delSample(sp.id); load() }}><X className="size-3" /></button>
            </div>
          ))}
          <Input className="h-7 text-xs" placeholder="样本名称" value={name} onChange={(e) => setName(e.target.value)} />
          <Textarea className="min-h-16 text-xs" value={inputJson} onChange={(e) => setInputJson(e.target.value)} />
          <Input className="h-7 text-xs" placeholder="期望答案（可选；供规则/模型 Judge 对照）" value={expectedText} onChange={(e) => setExpectedText(e.target.value)} />
          <div className="flex items-center gap-2">
            <Select value={judge} onValueChange={(v) => setJudge(v as typeof judge)}>
              <SelectTrigger className="h-7 flex-1 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="rule">规则 Judge（期望包含匹配）</SelectItem>
                <SelectItem value="model">模型 Judge（LLM 打 1-5 分）</SelectItem>
                <SelectItem value="none">不 Judge（只看运行成败）</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" onClick={async () => {
              try {
                await evalApi.addSample(workflowId, name || "样本", JSON.parse(inputJson || "{}"), expectedText)
                setName(""); setExpectedText(""); load()
              } catch { toast.error("输入 JSON 非法") }
            }}>添加样本</Button>
            <Button size="sm" className="bg-primary text-primary-foreground hover:bg-brand-hover" disabled={running || samples.length === 0}
              onClick={async () => {
                setRunning(true)
                try {
                  const r = await evalApi.run(workflowId, judge)
                  setResults(r.results); load()
                } catch (e) { toast.error((e as Error).message) }
                finally { setRunning(false) }
              }}>{running ? "评测中…" : "运行评测"}</Button>
          </div>
        </div>
        {results && (
          <div className="space-y-1">
            <div className="text-[13px] font-medium" style={{ color: C.ink }}>| 评测结果（可人评覆盖）</div>
            {results.map((r) => (
              <div key={r.sampleId} className="flex items-center gap-2 rounded border px-2 py-1 text-xs" style={{ borderColor: C.cardBorder }}>
                <span className="size-2 shrink-0 rounded-full" style={{ background: r.status === "succeeded" ? "var(--status-success)" : "var(--status-danger)" }} />
                <span className="w-20 truncate" style={{ color: C.ink }}>{r.name}</span>
                <span className="flex-1 truncate" style={{ color: C.ink2 }}>{r.error ?? r.output ?? "-"}</span>
                {r.judge && (
                  <span className="shrink-0 rounded px-1 py-0.5 text-[10px]"
                    style={r.judge.score >= 3
                      ? { background: "var(--status-success-soft)", color: "var(--status-success)" }
                      : { background: "var(--status-danger-soft)", color: "var(--status-danger)" }}>
                    {r.judge.kind === "human" ? "人评" : r.judge.kind === "model" ? "模型" : "规则"} {r.judge.score}
                  </span>
                )}
                <span className="flex shrink-0 items-center gap-1">
                  <button className="rounded border px-1 text-[10px]" style={{ borderColor: C.cardBorder }} title="人评 5 分" onClick={() => humanScore(r.sampleId, 5)}>👍</button>
                  <button className="rounded border px-1 text-[10px]" style={{ borderColor: C.cardBorder }} title="人评 1 分" onClick={() => humanScore(r.sampleId, 1)}>👎</button>
                </span>
                <span style={{ color: C.ink3 }}>{r.durationMs != null ? `${r.durationMs}ms` : ""}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
