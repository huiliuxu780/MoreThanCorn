/** Agent 级运行观测 / 效果评测 / 版本指标面板（SDD D-1）。
 *  用于自主规划页的四 Tab；全部真数据（/api/agents/{id}/metrics|eval-*|versions）。 */
import { useEffect, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { agentApi, WF_BASE } from "@/services/wf-api"

const INK = "#1F2329"; const INK2 = "#5A6472"; const INK3 = "#B9C2CF"; const CARD = "#EDF0F4"

/* ---------- 运行观测 ---------- */
export function AgentRunsPanel({ agentId }: { agentId: string }) {
  const [metrics, setMetrics] = useState<{ total: number; succeeded: number; failed: number; successRate: number; avgDurationMs: number; maxDurationMs: number } | null>(null)
  const [runs, setRuns] = useState<{ runId: string; status: string; trigger: string; startedAt: string | null; durationMs: number | null; error?: { message?: string } | null }[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [events, setEvents] = useState<{ type: string; payload: Record<string, any>; at: string }[]>([])
  const load = () => {
    agentApi.metrics(agentId).then(setMetrics).catch(() => undefined)
    agentApi.runs(agentId).then((r) => setRuns(r.items)).catch(() => undefined)
  }
  useEffect(() => { load() }, [agentId])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!selected) { setEvents([]); return }
    fetch(`${WF_BASE}/api/runs/${selected}/events-list`).then((r) => r.json())
      .then((j) => setEvents(j.items ?? [])).catch(() => undefined)
  }, [selected])
  return (
    <div className="h-full space-y-4 overflow-y-auto p-6">
      {metrics && (
        <div className="grid grid-cols-4 gap-3">
          {[["总运行", metrics.total], ["成功", metrics.succeeded], ["失败", metrics.failed],
            ["成功率", `${Math.round(metrics.successRate * 100)}%`],
            ["平均时长", metrics.avgDurationMs ? `${metrics.avgDurationMs}ms` : "—"],
            ["最长时长", metrics.maxDurationMs ? `${metrics.maxDurationMs}ms` : "—"]].map(([l, v]) => (
            <div key={String(l)} className="rounded-lg border bg-white p-3" style={{ borderColor: CARD }}>
              <div className="text-[11px]" style={{ color: INK3 }}>{l}</div>
              <div className="pt-1 text-lg font-semibold" style={{ color: INK }}>{String(v)}</div>
            </div>
          ))}
        </div>
      )}
      <div className="rounded-lg border bg-white" style={{ borderColor: CARD }}>
        <div className="flex items-center justify-between border-b px-4 py-2 text-[13px] font-medium" style={{ borderColor: CARD, color: INK }}>
          <span>运行记录</span>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={load}>刷新</Button>
        </div>
        {runs.length === 0 && <div className="p-6 text-center text-xs" style={{ color: INK3 }}>暂无运行记录</div>}
        {runs.slice(0, 30).map((r) => (
          <button key={r.runId}
            className={`flex w-full items-center gap-2 border-b px-4 py-2 text-left text-xs hover:bg-neutral-50 ${selected === r.runId ? "bg-neutral-50" : ""}`}
            style={{ borderColor: CARD }} onClick={() => setSelected(r.runId)}>
            <span className={`size-2 rounded-full ${r.status === "succeeded" ? "bg-emerald-400" : r.status === "failed" ? "bg-red-400" : "bg-amber-400"}`} />
            <span className="font-mono" style={{ color: INK3 }}>{r.runId.slice(0, 8)}</span>
            <span className="rounded bg-neutral-100 px-1" style={{ color: INK2 }}>{r.trigger}</span>
            <span className="flex-1 truncate" style={{ color: INK2 }}>{r.error?.message ?? ""}</span>
            <span style={{ color: INK3 }}>{r.durationMs != null ? `${r.durationMs}ms` : ""}</span>
            <span style={{ color: INK3 }}>{r.startedAt ? r.startedAt.replace("T", " ").slice(0, 16) : ""}</span>
          </button>
        ))}
      </div>
      {selected && (
        <div className="rounded-lg border bg-white p-4" style={{ borderColor: CARD }}>
          <div className="pb-2 text-[13px] font-medium" style={{ color: INK }}>事件时间线（span 按 run 聚合）</div>
          <div className="space-y-1">
            {events.map((e, i) => (
              <div key={i} className="flex items-start gap-2 text-[11px]">
                <span className="rounded bg-neutral-100 px-1 font-mono" style={{ color: INK2 }}>{e.type}</span>
                <span className={`mt-0.5 rounded px-1 text-[10px] ${e.payload && (e.type === "llm_delta" || e.type === "reply_sent") ? "bg-blue-50 text-blue-600" : "bg-neutral-100 text-neutral-500"}`}>
                  {(e.type === "llm_delta" || e.type === "reply_sent") ? "CONTENT" : "CONTROL"}
                </span>
                <span className="flex-1 break-all" style={{ color: INK2 }}>
                  {JSON.stringify(e.payload).slice(0, 160)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* ---------- 效果评测（D-3：规则/模型/人评 Judge） ---------- */
export function AgentEvalPanel({ agentId }: { agentId: string }) {
  const [samples, setSamples] = useState<{ id: string; name: string; input: Record<string, unknown>; expected?: { text?: string } | null }[]>([])
  const [name, setName] = useState("")
  const [inputJson, setInputJson] = useState('{ "userQuery": "" }')
  const [expectedText, setExpectedText] = useState("")
  const [judge, setJudge] = useState<"none" | "rule" | "model">("rule")
  const [results, setResults] = useState<{ total: number; succeeded: number; results: { sampleId: string; name: string; status: string; durationMs?: number | null; output?: string; judge?: { kind: string; score: number } | null; error?: string | null }[] } | null>(null)
  const [running, setRunning] = useState(false)
  const load = () => agentApi.evalSamples(agentId).then((r) => setSamples(r.items as typeof samples)).catch(() => undefined)
  useEffect(() => { load() }, [agentId])  // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="h-full space-y-4 overflow-y-auto p-6">
      <div className="rounded-lg border bg-white p-4" style={{ borderColor: CARD }}>
        <div className="pb-2 text-[13px] font-medium" style={{ color: INK }}>评测集（样本 = 固定输入 + 可选期望答案）</div>
        {samples.map((s) => (
          <div key={s.id} className="flex items-center gap-2 border-b py-1.5 text-xs" style={{ borderColor: CARD }}>
            <span className="flex-1 truncate" style={{ color: INK2 }}>{s.name}</span>
            <span className="truncate font-mono" style={{ color: INK3 }}>{JSON.stringify(s.input).slice(0, 40)}</span>
            {s.expected?.text && <span className="truncate rounded bg-emerald-50 px-1 text-[10px] text-emerald-600">期望：{s.expected.text.slice(0, 16)}</span>}
            <button onClick={async () => { await agentApi.delEvalSample(s.id); load() }}><span className="text-neutral-400">×</span></button>
          </div>
        ))}
        <div className="space-y-2 pt-2">
          <Input className="h-8 text-xs" placeholder="样本名称" value={name} onChange={(e) => setName(e.target.value)} />
          <Textarea className="min-h-14 text-xs" placeholder='输入 JSON，如 { "userQuery": "…" }' value={inputJson} onChange={(e) => setInputJson(e.target.value)} />
          <Input className="h-8 text-xs" placeholder="期望答案（可选；供规则/模型 Judge 对照）" value={expectedText} onChange={(e) => setExpectedText(e.target.value)} />
          <Button size="sm" variant="outline" onClick={async () => {
            try {
              await fetch(`${WF_BASE}/api/agents/${agentId}/eval-samples`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: name || "样本", input: JSON.parse(inputJson || "{}"), ...(expectedText.trim() ? { expected: { text: expectedText.trim() } } : {}) }),
              })
              setName(""); setExpectedText(""); load()
            } catch { toast.error("输入 JSON 非法") }
          }}>添加样本</Button>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Select value={judge} onValueChange={(v) => setJudge(v as typeof judge)}>
          <SelectTrigger className="h-8 w-56 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="rule">规则 Judge（期望包含匹配）</SelectItem>
            <SelectItem value="model">模型 Judge（LLM 打 1-5 分）</SelectItem>
            <SelectItem value="none">不 Judge（只看运行成败）</SelectItem>
          </SelectContent>
        </Select>
        <Button className="bg-black text-white hover:bg-neutral-800" disabled={running || samples.length === 0}
          onClick={async () => {
            setRunning(true)
            try { setResults(await agentApi.evalRun(agentId, judge)) } catch (e) { toast.error((e as Error).message) }
            finally { setRunning(false) }
          }}>{running ? "评测中…" : "运行评测"}</Button>
        {results && (
          <span className="text-xs" style={{ color: INK2 }}>
            运行成功 {results.succeeded}/{results.total}
            {results.results.some((r) => r.judge) && ` · 平均分 ${(results.results.reduce((a, r) => a + (r.judge?.score ?? 0), 0) / Math.max(1, results.results.filter((r) => r.judge).length)).toFixed(1)}/5`}
          </span>
        )}
      </div>
      {results && (
        <div className="rounded-lg border bg-white p-4" style={{ borderColor: CARD }}>
          <div className="pb-2 text-[13px] font-medium" style={{ color: INK }}>评测结果（可人评覆盖）</div>
          {results.results.map((r, i) => (
            <div key={i} className="flex items-center gap-2 border-b py-1.5 text-xs" style={{ borderColor: CARD }}>
              <span className={`size-2 shrink-0 rounded-full ${r.status === "succeeded" ? "bg-emerald-400" : "bg-red-400"}`} />
              <span style={{ color: INK }}>{r.name}</span>
              <span className="flex-1 truncate" style={{ color: INK2 }}>{r.error ?? r.output ?? ""}</span>
              {r.judge && (
                <span className={`shrink-0 rounded px-1 py-0.5 text-[10px] ${r.judge.score >= 3 ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-500"}`}>
                  {r.judge.kind === "human" ? "人评" : r.judge.kind === "model" ? "模型" : "规则"} {r.judge.score}
                </span>
              )}
              <span className="flex shrink-0 items-center gap-1">
                <button className="rounded border px-1 text-[10px]" style={{ borderColor: CARD, color: INK2 }}
                  onClick={async () => { await agentApi.humanScore(agentId, r.sampleId, 5); toast.success("已人评 5 分"); setRunning(false) }}>👍</button>
                <button className="rounded border px-1 text-[10px]" style={{ borderColor: CARD, color: INK2 }}
                  onClick={async () => { await agentApi.humanScore(agentId, r.sampleId, 1); toast.success("已人评 1 分") }}>👎</button>
              </span>
              <span style={{ color: INK3 }}>{r.durationMs != null ? `${r.durationMs}ms` : ""}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ---------- 进化（D-3：失败归因 → 候选补丁 → 审批应用） ---------- */
export function AgentEvolutionPanel({ agentId, onApplied }: { agentId: string; onApplied?: () => void }) {
  const [patches, setPatches] = useState<{ id: string; attribution: string; reason: string; status: string; createdAt: string }[]>([])
  const [candidate, setCandidate] = useState<{ id: string; attribution: string; basePrompt: string; proposedPrompt: string } | null>(null)
  const [generating, setGenerating] = useState(false)
  const load = () => agentApi.evolutionList(agentId).then(setPatches).catch(() => undefined)
  useEffect(() => { load() }, [agentId])  // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="h-full space-y-4 overflow-y-auto p-6">
      <div className="rounded-lg border bg-white p-4" style={{ borderColor: CARD }}>
        <div className="pb-1 text-[13px] font-medium" style={{ color: INK }}>生成候选补丁</div>
        <p className="pb-2 text-[11px]" style={{ color: INK3 }}>
          基于近期失败运行归因，LLM 生成改进后的角色提示词；审批后应用到草稿（不触碰已发布版本）。
        </p>
        <Button className="bg-black text-white hover:bg-neutral-800" disabled={generating} onClick={async () => {
          setGenerating(true)
          try { setCandidate(await agentApi.evolutionCandidates(agentId)) }
          catch (e) { toast.error((e as Error).message.includes("{") ? JSON.stringify((e as Error).message) : (e as Error).message) }
          finally { setGenerating(false) }
        }}>{generating ? "归因与生成中…" : "从失败运行生成候选"}</Button>
      </div>
      {candidate && (
        <div className="rounded-lg border bg-white p-4" style={{ borderColor: CARD }}>
          <div className="flex items-center gap-2 pb-2">
            <span className="text-[13px] font-medium" style={{ color: INK }}>候选补丁</span>
            <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px]" style={{ color: INK2 }}>归因：{candidate.attribution}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="pb-1 text-[11px] font-medium" style={{ color: INK3 }}>现提示词</div>
              <Textarea className="min-h-32 text-[11px]" readOnly value={candidate.basePrompt} />
            </div>
            <div>
              <div className="pb-1 text-[11px] font-medium" style={{ color: "#3D6BFF" }}>候选提示词</div>
              <Textarea className="min-h-32 text-[11px]" readOnly value={candidate.proposedPrompt} />
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <Button size="sm" className="bg-black text-white hover:bg-neutral-800" onClick={async () => {
              try {
                await agentApi.evolutionApply(agentId, candidate.id)
                toast.success("候选已应用到草稿（可继续编辑或撤销）")
                setCandidate(null); load(); onApplied?.()
              } catch (e) { toast.error((e as Error).message) }
            }}>应用到草稿</Button>
            <Button size="sm" variant="outline" onClick={async () => {
              await agentApi.evolutionReject(agentId, candidate.id)
              toast.success("已拒绝该候选")
              setCandidate(null); load()
            }}>拒绝</Button>
          </div>
        </div>
      )}
      <div className="rounded-lg border bg-white p-4" style={{ borderColor: CARD }}>
        <div className="pb-2 text-[13px] font-medium" style={{ color: INK }}>补丁历史</div>
        {patches.length === 0 && <p className="text-xs" style={{ color: INK3 }}>暂无补丁记录</p>}
        {patches.map((p) => (
          <div key={p.id} className="flex items-center gap-2 border-b py-1.5 text-xs" style={{ borderColor: CARD }}>
            <span className="rounded bg-neutral-100 px-1 text-[10px]" style={{ color: INK2 }}>{p.attribution}</span>
            <span className="flex-1 truncate" style={{ color: INK2 }}>{p.reason}</span>
            <span className={`rounded px-1 py-0.5 text-[10px] ${p.status === "applied" ? "bg-emerald-50 text-emerald-600" : p.status === "rejected" ? "bg-neutral-100 text-neutral-500" : "bg-blue-50 text-blue-600"}`}>
              {p.status === "applied" ? "已应用" : p.status === "rejected" ? "已拒绝" : "待审批"}
            </span>
            <span style={{ color: INK3 }}>{p.createdAt.slice(0, 16).replace("T", " ")}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ---------- 版本指标 ---------- */
export function AgentVersionsPanel({ agentId }: { agentId: string }) {
  const [versions, setVersions] = useState<{ versionId: string; versionNo: number; note: string; artifactHash: string; createdAt: string; frozenMembers: { ref: string; version: string | null }[] }[]>([])
  const [releases, setReleases] = useState<{ environment: string; status: string; versionNo: number | null }[]>([])
  useEffect(() => {
    agentApi.versionsWithMembers(agentId).then(setVersions).catch(() => undefined)
    agentApi.releases(agentId).then(setReleases).catch(() => undefined)
  }, [agentId])
  return (
    <div className="h-full space-y-4 overflow-y-auto p-6">
      {versions.length === 0 && <div className="py-20 text-center text-xs" style={{ color: INK3 }}>暂无版本，先在搭建页发布</div>}
      {versions.map((v) => {
        const rels = releases.filter((r) => r.status === "active" && r.versionNo === v.versionNo)
        return (
          <div key={v.versionId} className="rounded-lg border bg-white p-4" style={{ borderColor: CARD }}>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold" style={{ color: INK }}>V{v.versionNo}</span>
              {rels.map((r) => (
                <span key={r.environment} className={`rounded px-1.5 py-0.5 text-[10px] ${r.environment === "prod" ? "bg-blue-50 text-blue-600" : "bg-emerald-50 text-emerald-600"}`}>
                  {r.environment === "prod" ? "线上生效" : "沙箱生效"}
                </span>
              ))}
              <span className="flex-1" />
              <span className="text-[11px]" style={{ color: INK3 }}>{new Date(v.createdAt).toLocaleString()}</span>
            </div>
            <div className="pt-1 font-mono text-[10px]" style={{ color: INK3 }}>sha256:{v.artifactHash.slice(0, 24)}…</div>
            {v.note && <div className="pt-1 text-xs" style={{ color: INK2 }}>备注：{v.note}</div>}
            {v.frozenMembers.length > 0 && (
              <div className="pt-2">
                <div className="text-[11px] font-medium" style={{ color: INK2 }}>成员冻结版本</div>
                {v.frozenMembers.map((m, i) => (
                  <div key={i} className="flex gap-2 pt-0.5 font-mono text-[10px]" style={{ color: INK3 }}>
                    <span>{m.ref.slice(0, 8)}…</span>
                    <span>{m.version ? `→ ${m.version.slice(0, 8)}…` : "（未发布，运行时回退草稿并留痕）"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
