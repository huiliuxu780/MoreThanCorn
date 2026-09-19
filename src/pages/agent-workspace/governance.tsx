/** 发布治理子页：版本创建/发布（全类型 Agent）+ 效果评测 + Golden Set 主动评测。
 *  2026-09-10 P0-E/B4：发布入口从 module 配置页提升到治理页（custom Agent 同权）；
 *  Golden Set 随 openai-agents/deepseek-harness 退役改为 AgentScope 单引擎（Provider 可选）。
 *  09-16 配置页退役：对比（模型/版本）入口并入本页页头。 */
import { useState } from "react"
import { toast } from "sonner"
import { AgentCompareDialog } from "@/components/agent-compare-dialog"
import { AgentEvalPanel, AgentVersionsPanel } from "@/components/agent-ops-panels"
import { Button } from "@/components/ui/button"
import { ModulePublishDialog } from "@/components/module-publish-dialog"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { agentApi, type AgentInfo } from "@/services/wf-api"

type GoldenResult = Awaited<ReturnType<typeof agentApi.goldenEval>>

export function AgentGovernanceSection({ agent, archived }: { agent: AgentInfo; archived?: boolean }) {
  const agentId = agent.id
  const [goldenLimit, setGoldenLimit] = useState(3)
  const [goldenRunning, setGoldenRunning] = useState(false)
  const [goldenResults, setGoldenResults] = useState<GoldenResult[]>([])
  const [publishOpen, setPublishOpen] = useState(false)
  const [compareOpen, setCompareOpen] = useState(false)
  const [compareVersion, setCompareVersion] = useState<number | undefined>(undefined)
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
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => { setCompareVersion(undefined); setCompareOpen(true) }}>
              对比
            </Button>
            <Button size="sm" onClick={() => setPublishOpen(true)}>
              发布新版本
            </Button>
          </div>
        )}
      </div>
      {/* 09-18 重设计（用户拍板行流单列）：与 Skill/连接器/工具子页同行规格，
          去掉双列滚动区；版本→评测集→Golden Set 单列顺排 */}
      <div className="space-y-6">
        <AgentVersionsPanel key={versionsTick} agentId={agentId}
          onCompare={(vno) => { setCompareVersion(vno); setCompareOpen(true) }} />
        <AgentEvalPanel agentId={agentId} archived={archived} />
      </div>
      <ModulePublishDialog
        agentId={agentId}
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        onPublished={() => setVersionsTick((t) => t + 1)}
      />
      <AgentCompareDialog agent={agent} open={compareOpen}
        initialVersionNo={compareVersion} onClose={() => setCompareOpen(false)} />
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Golden Set 主动评测</h3>
          <div className="flex items-center gap-2">
            <Select value={String(goldenLimit)} onValueChange={(v) => setGoldenLimit(Number(v))}>
              <SelectTrigger size="sm" className="w-24" aria-label="评测样本数">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 3, 5, 10].map((n) => <SelectItem key={n} value={String(n)}>{n} 样本</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" disabled={goldenRunning} onClick={() => void runGolden()}>
              {goldenRunning ? "评测中…" : "运行评测"}
            </Button>
          </div>
        </div>
        <p className="text-xs text-(--text-tertiary)">
          AgentScope 单引擎同步真跑；结果不持久化，Run 以 trigger=eval 入运行历史。
        </p>
        <div className="max-w-3xl">
          {goldenResults.length === 0 && (
            <p className="py-4 text-center text-xs text-(--text-tertiary)">尚未运行评测。</p>
          )}
          {goldenResults.map((g) => (
            <div key={g.providerId}>
              <div className="flex min-h-[40px] items-center gap-3 border-b px-1 text-sm">
                <span className="font-medium">{g.providerKind}</span>
                <span className="text-xs text-(--text-tertiary)">
                  通过率 {Math.round(g.passRate * 100)}%（{g.passed}/{g.samples}）
                </span>
              </div>
              {g.results.map((r) => (
                <div key={r.sampleId} className="flex min-h-[44px] flex-wrap items-center gap-2 border-b px-1 py-2 text-xs">
                  <span className={r.passed ? "text-(--status-success)" : "text-(--status-danger)"}>
                    {r.passed ? "✓" : "✗"}
                  </span>
                  <span className="font-mono text-(--text-tertiary)">{r.sampleId.slice(0, 8)}</span>
                  <span className="text-(--text-tertiary)">{r.runStatus}</span>
                  {typeof r.durationMs === "number" && (
                    <span className="text-(--text-tertiary)">{(r.durationMs / 1000).toFixed(1)}s</span>
                  )}
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
        </div>
      </section>
    </div>
  )
}
