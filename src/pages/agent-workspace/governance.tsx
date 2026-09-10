/** 发布治理子页：版本创建/发布（全类型 Agent）+ 效果评测 + Golden Set 主动评测。
 *  2026-09-10 P0-E/B4：发布入口从 module 配置页提升到治理页（custom Agent 同权）；
 *  Golden Set 随 openai-agents/deepseek-harness 退役改为 AgentScope 单引擎（Provider 可选）。 */
import { useState } from "react"
import { toast } from "sonner"
import { AgentEvalPanel, AgentVersionsPanel } from "@/components/agent-ops-panels"
import { Button } from "@/components/ui/button"
import { ModulePublishDialog } from "@/components/module-publish-dialog"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { agentApi } from "@/services/wf-api"

type GoldenResult = Awaited<ReturnType<typeof agentApi.goldenEval>>

export function AgentGovernanceSection({ agentId , archived }: { agentId: string; archived?: boolean }) {
  const [goldenLimit, setGoldenLimit] = useState(3)
  const [goldenRunning, setGoldenRunning] = useState(false)
  const [goldenResults, setGoldenResults] = useState<GoldenResult[]>([])
  const [publishOpen, setPublishOpen] = useState(false)
  const [versionsTick, setVersionsTick] = useState(0)

  const runGolden = async () => {
    setGoldenRunning(true); setGoldenResults([])
    // B4 收尾：旧双 Provider 对比退役（runtime-providers 端点已下线），单引擎真跑
    const out: GoldenResult[] = []
    try { out.push(await agentApi.goldenEval(agentId, "", goldenLimit)) }
    catch (e) { toast.error((e as Error).message) }
    setGoldenResults(out); setGoldenRunning(false)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-[28px] font-semibold leading-[38px]">发布治理</h2>
        {!archived && (
          <Button size="sm" className="ml-auto" onClick={() => setPublishOpen(true)}>
            发布新版本
          </Button>
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <AgentEvalPanel agentId={agentId} archived={archived} />
        <AgentVersionsPanel key={versionsTick} agentId={agentId} />
      </div>
      <ModulePublishDialog
        agentId={agentId}
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        onPublished={() => setVersionsTick((t) => t + 1)}
      />
      <section className="space-y-3 rounded-md border bg-surface p-4">
        <h3 className="text-base font-medium leading-6">Golden Set 主动评测（AgentScope 单引擎真跑）</h3>
        <div className="flex flex-wrap items-center gap-3">
          <Select value={String(goldenLimit)} onValueChange={(v) => setGoldenLimit(Number(v))}>
            <SelectTrigger className="h-8 w-24"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[1, 3, 5, 10].map((n) => <SelectItem key={n} value={String(n)}>{n} 样本</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" disabled={goldenRunning} onClick={() => void runGolden()}>
            {goldenRunning ? "评测中…" : "运行评测"}
          </Button>
          <span className="text-[11px] text-(--text-tertiary)">同步真跑；结果不持久化，Run 以 trigger=eval 入运行历史；仅 quality-analysis Module Agent 支持</span>
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
