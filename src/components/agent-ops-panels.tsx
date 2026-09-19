/** Agent 级运行观测 / 效果评测 / 版本指标面板（SDD D-1）。
 *  R-Archive（SDD 10）：旧 Agent 封存后本组面板全部只读——
 *  移除添加样本/运行评测/人评/进化候选生成与应用等写入口，保留历史查看。 */
import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"

import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { agentApi, runEventsList } from "@/services/wf-api"

const INK = "var(--text-primary)"; const INK2 = "var(--text-secondary)"; const INK3 = "color-mix(in srgb, var(--text-secondary) 62%, transparent)"; const CARD = "var(--border)"

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
            <div key={String(l)} className="rounded-lg border bg-surface p-3" style={{ borderColor: CARD }}>
              <div className="text-[11px]" style={{ color: INK3 }}>{l}</div>
              <div className="pt-1 text-lg font-semibold" style={{ color: INK }}>{String(v)}</div>
            </div>
          ))}
        </div>
      )}
      <div className="rounded-lg border bg-surface" style={{ borderColor: CARD }}>
        <div className="flex items-center justify-between border-b px-4 py-2 text-[13px] font-medium" style={{ borderColor: CARD, color: INK }}>
          <span>运行记录</span>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={load}>刷新</Button>
        </div>
        {runs.length === 0 && <div className="p-6 text-center text-xs" style={{ color: INK3 }}>暂无运行记录</div>}
        {runs.slice(0, 30).map((r) => (
          <button key={r.runId}
            className={`flex w-full items-center gap-2 border-b px-4 py-2 text-left text-xs hover:bg-accent ${selected === r.runId ? "bg-accent" : ""}`}
            style={{ borderColor: CARD }} onClick={() => setSelected(r.runId)}>
            <span className={`size-2 rounded-full ${r.status === "succeeded" ? "bg-status-success" : r.status === "failed" ? "bg-status-danger" : "bg-status-warning"}`} />
            <span className="font-mono" style={{ color: INK3 }}>{r.runId.slice(0, 8)}</span>
            <span className="rounded bg-muted px-1" style={{ color: INK2 }}>{r.trigger}</span>
            <span className="flex-1 truncate" style={{ color: INK2 }}>{r.error?.message ?? ""}</span>
            <span style={{ color: INK3 }}>{r.durationMs != null ? `${r.durationMs}ms` : ""}</span>
            <span style={{ color: INK3 }}>{r.startedAt ? r.startedAt.replace("T", " ").slice(0, 16) : ""}</span>
          </button>
        ))}
      </div>
      {selected && (
        <div className="rounded-lg border bg-surface p-4" style={{ borderColor: CARD }}>
          <div className="flex items-center justify-between pb-2">
            <span className="text-[13px] font-medium" style={{ color: INK }}>事件时间线（span 按 run 聚合）</span>
            {/* R8-UI：跳转 agent 视角 Run Detail（三卡/阶段/CallRecord/质检卡） */}
            <Button variant="outline" size="sm" className="h-7 text-xs"
              onClick={() => navigate(`/agents/${agentId}/runs/${selected}`)}>Run 详情 ↗</Button>
          </div>
          <div className="space-y-1">
            {events.map((e, i) => (
              <div key={i} className="flex items-start gap-2 text-[11px]">
                <span className="rounded bg-muted px-1 font-mono" style={{ color: INK2 }}>{e.type}</span>
                <span className={`mt-0.5 rounded px-1 text-[10px] ${e.payload && (e.type === "llm_delta" || e.type === "reply_sent") ? "bg-status-running-soft text-status-running" : "bg-muted text-muted-foreground"}`}>
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
export function AgentEvalPanel({ agentId, archived }: { agentId: string; archived?: boolean }) {
  const [samples, setSamples] = useState<{ id: string; name: string; input: Record<string, unknown>; expected?: { text?: string } | null }[]>([])
  const [addOpen, setAddOpen] = useState(false)
  const [form, setForm] = useState({ name: "", input: "{}", expected: "" })
  const load = () => agentApi.evalSamples(agentId).then((r) => setSamples(r.items as typeof samples)).catch(() => undefined)
  useEffect(() => { load() }, [agentId])
  const submit = async () => {
    if (!form.name.trim()) { toast.error("请填写样本名称"); return }
    let input: Record<string, unknown>
    try { input = JSON.parse(form.input) as Record<string, unknown> } catch { toast.error("输入 JSON 解析失败"); return }
    try {
      await agentApi.addEvalSample(agentId, {
        name: form.name.trim(), input,
        expected: form.expected.trim() ? { text: form.expected.trim() } : null,
      })
      toast.success("样本已添加")
      setAddOpen(false)
      setForm({ name: "", input: "{}", expected: "" })
      load()
    } catch (e) { toast.error((e as Error).message) }
  }
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold" style={{ color: INK }}>
          评测集 <span className="text-xs font-normal" style={{ color: INK3 }}>样本 = 固定输入 + 可选期望答案</span>
        </h3>
        {!archived && (
          <Button variant="outline" size="sm" className="shrink-0" onClick={() => setAddOpen(true)}>添加样本</Button>
        )}
      </div>
      <div className="max-w-3xl">
        {samples.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-xs text-muted-foreground">
            <p>暂无样本记录</p>
            {!archived && <p className="mt-1">添加固定输入样本后，可运行 Golden Set 主动评测。</p>}
          </div>
        ) : samples.map((s) => (
          <div key={s.id} className="flex min-h-[67px] items-center gap-3 border-b px-1 py-2 text-sm" style={{ borderColor: CARD }}>
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium" style={{ color: INK }}>{s.name}</div>
              <div className="truncate font-mono text-xs" style={{ color: INK3 }}>{JSON.stringify(s.input).slice(0, 80)}</div>
            </div>
            {s.expected?.text && (
              <span className="shrink-0 rounded bg-status-success-soft px-1.5 py-0.5 text-[10px] text-status-success">
                期望：{s.expected.text.slice(0, 24)}
              </span>
            )}
          </div>
        ))}
        {archived && (
          <p className="pt-2 text-xs text-amber-600">该旧版 Agent 已封存：样本维护与评测运行入口不再开放。</p>
        )}
      </div>
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>添加评测样本</DialogTitle>
            <DialogDescription>固定输入 + 可选期望答案；期望用于 Golden Set 逐 criterion 对比。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>样本名称</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如：冰箱不制冷故障咨询" />
            </div>
            <div className="space-y-1">
              <Label>输入 JSON</Label>
              <Textarea className="min-h-[96px] font-mono text-xs" value={form.input}
                onChange={(e) => setForm({ ...form, input: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>期望答案（可选）</Label>
              <Input value={form.expected} onChange={(e) => setForm({ ...form, expected: e.target.value })} placeholder="如：fault-consultation" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setAddOpen(false)}>取消</Button>
            <Button size="sm" onClick={() => void submit()}>添加</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
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
      <div className="rounded-lg border bg-surface p-4" style={{ borderColor: CARD }}>
        <div className="pb-2 text-[13px] font-medium" style={{ color: INK }}>补丁历史</div>
        {patches.length === 0 && <p className="text-xs" style={{ color: INK3 }}>暂无补丁记录</p>}
        {patches.map((p) => (
          <div key={p.id} className="flex items-center gap-2 border-b py-1.5 text-xs" style={{ borderColor: CARD }}>
            <span className="rounded bg-muted px-1 text-[10px]" style={{ color: INK2 }}>{p.attribution}</span>
            <span className="flex-1 truncate" style={{ color: INK2 }}>{p.reason}</span>
            <span className={`rounded px-1 py-0.5 text-[10px] ${p.status === "applied" ? "bg-status-success-soft text-status-success" : p.status === "rejected" ? "bg-muted text-muted-foreground" : "bg-status-running-soft text-status-running"}`}>
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
export function AgentVersionsPanel({ agentId, onCompare }: {
  agentId: string
  onCompare?: (versionNo: number) => void
}) {
  const [versions, setVersions] = useState<{ versionId: string; versionNo: number; note: string; artifactHash: string; createdAt: string; frozenMembers: { ref: string; version: string | null }[] }[]>([])
  const [releases, setReleases] = useState<{ releaseId?: string; environment: string; status: string; versionNo: number | null; frozenModelParams?: Record<string, unknown>; frozenToolPolicy?: Record<string, boolean>; frozenPermissionPolicy?: Record<string, unknown> }[]>([])
  useEffect(() => {
    agentApi.versionsWithMembers(agentId).then(setVersions).catch(() => undefined)
    agentApi.releases(agentId).then(setReleases).catch(() => undefined)
  }, [agentId])
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold" style={{ color: INK }}>版本</h3>
      <div className="max-w-3xl">
        {versions.length === 0 && (
          <div className="rounded-lg border border-dashed p-8 text-center text-xs text-muted-foreground">暂无历史版本</div>
        )}
        {versions.map((v) => {
          const rels = releases.filter((r) => r.status === "active" && r.versionNo === v.versionNo)
          const rolled = releases.some((r) => r.status === "rolled_back" && r.versionNo === v.versionNo)
          const thinkingParams = rels.map((r) => r.frozenModelParams ?? {}).find((p) => p.thinking_enable)
          const pol = rels.map((r) => r.frozenToolPolicy ?? {}).find((p) => p && Object.values(p).some((x) => x === false))
          const off = pol ? Object.entries(pol).filter(([, x]) => x === false).map(([k]) => k) : []
          return (
            <div key={v.versionId} className="flex min-h-[67px] items-center gap-3 border-b px-1 py-2 text-sm" style={{ borderColor: CARD }}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium" style={{ color: INK }}>V{v.versionNo}</span>
                  {rels.map((r) => (
                    <span key={r.environment} className={`rounded px-1.5 py-0.5 text-[10px] ${r.environment === "prod" ? "bg-status-running-soft text-status-running" : "bg-status-success-soft text-status-success"}`}>
                      {r.environment === "prod" ? "线上生效" : "沙箱生效"}
                    </span>
                  ))}
                  {rels.length === 0 && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {rolled ? "已回滚" : "未发布"}
                    </span>
                  )}
                  {off.length > 0 && (
                    <span className="rounded bg-(--segment-bg) px-1.5 py-0.5 text-[10px]" style={{ color: INK2 }}>
                      权限收紧：{off.join("、")}
                    </span>
                  )}
                  {thinkingParams && (
                    <span className="rounded bg-(--segment-bg) px-1.5 py-0.5 text-[10px]" style={{ color: INK2 }}>
                      深度思考：开{typeof thinkingParams.thinking_budget === "number" ? `（预算 ${thinkingParams.thinking_budget}）` : ""}
                    </span>
                  )}
                  <span className="ml-auto shrink-0 text-[11px]" style={{ color: INK3 }}>
                    {new Date(v.createdAt).toLocaleString()}
                  </span>
                </div>
                <div className="truncate text-xs" style={{ color: INK3 }}>
                  <span className="font-mono">sha256:{v.artifactHash.slice(0, 16)}…</span>
                  {v.note ? ` · ${v.note}` : ""}
                  {v.frozenMembers.length > 0 && ` · 冻结成员 ${v.frozenMembers.length}`}
                </div>
              </div>
              {onCompare && (
                <Button variant="outline" size="sm" className="shrink-0"
                  onClick={() => onCompare(v.versionNo)}>对比当前</Button>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
