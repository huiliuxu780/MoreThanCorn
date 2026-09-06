/** 发布治理子页：效果评测 + 版本面板 + Golden Set 双 Provider 主动对比（R8-UI-4 功能保留，自配置页迁入）。 */
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { AgentEvalPanel, AgentVersionsPanel } from "@/components/agent-ops-panels"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { agentApi } from "@/services/wf-api"

interface ProviderOpt { id: string; name: string; kind: string; status: string }
type GoldenResult = Awaited<ReturnType<typeof agentApi.goldenEval>>

export function AgentGovernanceSection({ agentId }: { agentId: string }) {
  const [providers, setProviders] = useState<ProviderOpt[]>([])
  const [goldenSel, setGoldenSel] = useState<string[]>([])
  const [goldenLimit, setGoldenLimit] = useState(3)
  const [goldenRunning, setGoldenRunning] = useState(false)
  const [goldenResults, setGoldenResults] = useState<GoldenResult[]>([])

  useEffect(() => {
    agentApi.providers().then((r) => setProviders(r.items.filter((p) => p.status === "enabled"))).catch(() => undefined)
  }, [])

  const runGolden = async () => {
    if (goldenSel.length === 0) { toast.error("至少选择一个 Provider"); return }
    setGoldenRunning(true); setGoldenResults([])
    const out: GoldenResult[] = []
    for (const pid of goldenSel) {
      try { out.push(await agentApi.goldenEval(agentId, pid, goldenLimit)) }
      catch (e) { toast.error((e as Error).message) }
    }
    setGoldenResults(out); setGoldenRunning(false)
  }

  return (
    <div className="space-y-4">
      <h2 className="text-[28px] font-semibold leading-[38px]">发布治理</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        <AgentEvalPanel agentId={agentId} />
        <AgentVersionsPanel agentId={agentId} />
      </div>
      <section className="space-y-3 rounded-md border bg-surface p-4">
        <h3 className="text-base font-medium leading-6">Golden Set 主动评测（双 Provider 同 Ground Truth 对比）</h3>
        <div className="flex flex-wrap items-center gap-3">
          {providers.map((p) => (
            <label key={p.id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Checkbox checked={goldenSel.includes(p.id)}
                onCheckedChange={(c) => setGoldenSel((s) => (c === true ? [...s, p.id] : s.filter((x) => x !== p.id)))} />
              {p.name}（{p.kind}）
            </label>
          ))}
          <Select value={String(goldenLimit)} onValueChange={(v) => setGoldenLimit(Number(v))}>
            <SelectTrigger className="h-8 w-24"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[1, 3, 5, 10].map((n) => <SelectItem key={n} value={String(n)}>{n} 样本</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" disabled={goldenRunning} onClick={() => void runGolden()}>
            {goldenRunning ? "评测中…" : "运行对比"}
          </Button>
          <span className="text-[11px] text-(--text-tertiary)">同步真跑；结果不持久化，Run 以 trigger=eval 入运行历史</span>
        </div>
        {goldenResults.map((g) => (
          <div key={g.providerId} className="space-y-1 rounded-md border px-3 py-2">
            <div className="flex items-center gap-3 text-xs">
              <span className="font-medium">{g.providerKind}</span>
              <span className="text-muted-foreground">通过率 {Math.round(g.passRate * 100)}%（{g.passed}/{g.samples}）</span>
            </div>
            {g.results.map((r) => (
              <div key={r.sampleId} className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <span className="font-mono">{r.sampleId}</span>
                <span className={r.passed ? "text-(--status-success)" : "text-(--status-danger)"}>
                  {r.passed ? "passed" : "mismatch"}
                </span>
                {r.error && <span className="text-(--status-danger)">{r.error}</span>}
                {(r.forbiddenViolations?.length ?? 0) > 0 && (
                  <span className="text-(--status-danger)">违禁工具：{r.forbiddenViolations!.join("、")}</span>
                )}
                {r.detail.filter((d) => d.actual !== d.expected).map((d) => (
                  <span key={d.criterion} className="rounded bg-(--segment-bg) px-1 py-0.5 text-[10px]">
                    {d.criterion}：期望 {d.expected} → 实际 {d.actual ?? "—"}
                  </span>
                ))}
              </div>
            ))}
          </div>
        ))}
      </section>
    </div>
  )
}
