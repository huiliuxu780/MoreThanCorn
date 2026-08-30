/** Agent 级运行观测 / 效果评测 / 版本指标面板（SDD D-1）。
 *  R-Archive（SDD 10）：旧 Agent 封存后本组面板全部只读——
 *  移除添加样本/运行评测/人评/进化候选生成与应用等写入口，保留历史查看。 */
import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { agentApi, runEventsList } from "@/services/wf-api"

const INK = "#1F2329"; const INK2 = "#5A6472"; const INK3 = "#B9C2CF"; const CARD = "#EDF0F4"

/* ---------- 运行观测 ---------- */
export function AgentRunsPanel({ agentId }: { agentId: string }) {
  const navigate = useNavigate()
  const [metrics, setMetrics] = useState<{ total: number; succeeded: number; failed: number; successRate: number; avgDurationMs: number; maxDurationMs: number; totalTokens?: number; firstToken?: { avgMs: number | null; p50Ms: number | null; samples: number } } | null>(null)
  const [runs, setRuns] = useState<{ runId: string; status: string; trigger: string; startedAt: string | null; durationMs: number | null; error?: { message?: string } | null }[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [events, setEvents] = useState<{ type: string; payload: Record<string, unknown>; at: string }[]>([])
  const load = () => {
    agentApi.metrics(agentId).then(setMetrics).catch(() => undefined)
    agentApi.runs(agentId).then((r) => setRuns(r.items)).catch(() => undefined)
  }
  useEffect(() => { load() }, [agentId])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!selected) { setEvents([]); return }
    runEventsList(selected).then((j) => setEvents((j.items ?? []) as unknown as typeof events)).catch(() => undefined)
  }, [selected])
  return (
    <div className="h-full space-y-4 overflow-y-auto p-6">
      {metrics && (
        <div className="grid grid-cols-4 gap-3">
          {[["总运行", metrics.total], ["成功", metrics.succeeded], ["失败", metrics.failed],
            ["成功率", `${Math.round(metrics.successRate * 100)}%`],
            ["错误率", `${Math.round((1 - metrics.successRate) * 100)}%`],
            ["Token 消耗", metrics.totalTokens != null ? metrics.totalTokens.toLocaleString("zh-CN") : "—"],
            ["平均时长", metrics.avgDurationMs ? `${metrics.avgDurationMs}ms` : "—"],
            ["最长时长", metrics.maxDurationMs ? `${metrics.maxDurationMs}ms` : "—"],
            /* E-3.4：首 token 耗时（首个流式增量 − 运行开始；无流式数据为 —） */
            ["首Token·平均", metrics.firstToken?.avgMs != null ? `${metrics.firstToken.avgMs}ms` : "—"],
            ["首Token·P50", metrics.firstToken?.p50Ms != null ? `${metrics.firstToken.p50Ms}ms` : "—"]].map(([l, v]) => (
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
          <div className="flex items-center justify-between pb-2">
            <span className="text-[13px] font-medium" style={{ color: INK }}>事件时间线（span 按 run 聚合）</span>
            {/* R8-UI：跳转 agent 视角 Run Detail（三卡/阶段/CallRecord/质检卡） */}
            <Button variant="outline" size="sm" className="h-7 text-xs"
              onClick={() => navigate(`/config/agents/${agentId}/runs/${selected}`)}>Run 详情 ↗</Button>
          </div>
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

/* ---------- 效果评测（只读：历史样本与 Judge 结果查看） ---------- */
export function AgentEvalPanel({ agentId }: { agentId: string }) {
  const [samples, setSamples] = useState<{ id: string; name: string; input: Record<string, unknown>; expected?: { text?: string } | null }[]>([])
  useEffect(() => {
    agentApi.evalSamples(agentId).then((r) => setSamples(r.items as typeof samples)).catch(() => undefined)
  }, [agentId])
  return (
    <div className="h-full space-y-4 overflow-y-auto p-6">
      <div className="rounded-lg border bg-white p-4" style={{ borderColor: CARD }}>
        <div className="pb-2 text-[13px] font-medium" style={{ color: INK }}>评测集（样本 = 固定输入 + 可选期望答案）</div>
        {samples.length === 0 && <div className="py-4 text-center text-xs" style={{ color: INK3 }}>暂无样本记录</div>}
        {samples.map((s) => (
          <div key={s.id} className="flex items-center gap-2 border-b py-1.5 text-xs" style={{ borderColor: CARD }}>
            <span className="flex-1 truncate" style={{ color: INK2 }}>{s.name}</span>
            <span className="truncate font-mono" style={{ color: INK3 }}>{JSON.stringify(s.input).slice(0, 40)}</span>
            {s.expected?.text && <span className="truncate rounded bg-emerald-50 px-1 text-[10px] text-emerald-600">期望：{s.expected.text.slice(0, 16)}</span>}
          </div>
        ))}
        <div className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-600">
          该旧版 Agent 已封存：样本维护与评测运行入口不再开放。
        </div>
      </div>
    </div>
  )
}

/* ---------- 进化（只读：历史补丁记录查看） ---------- */
export function AgentEvolutionPanel({ agentId }: { agentId: string }) {
  const [patches, setPatches] = useState<{ id: string; attribution: string; reason: string; status: string; createdAt: string }[]>([])
  useEffect(() => {
    agentApi.evolutionList(agentId).then(setPatches).catch(() => undefined)
  }, [agentId])
  return (
    <div className="h-full space-y-4 overflow-y-auto p-6">
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
      {versions.length === 0 && <div className="py-20 text-center text-xs" style={{ color: INK3 }}>暂无历史版本</div>}
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
