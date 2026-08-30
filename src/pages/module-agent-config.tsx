/** Module Agent 配置页（SDD 10 R4 对位参考图 v3；R8-UI 增强 11 §7-⑤）。
 *  三 Tab（概览/运行观测/版本）保持 R4 验收 IA；概览=编号分区卡+右侧测试面板。
 *  R8-UI：头部 Draft/Last-published 对照卡+对比；模型可选；资源 2×2 冻结；
 *  测试面板环境=Release 绑定（草稿须显式 Provider）；运行结果可跳 Run 详情。
 *  Module 资产（criteria/工具/主数据/Schema）只读；实例仅编辑名称/描述/业务定位/模型。 */
import { ArrowLeft } from "lucide-react"
import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { AgentRunsPanel, AgentVersionsPanel } from "@/components/agent-ops-panels"
import { AgentVersionDiffDialog } from "@/components/agent-version-diff"
import { ModulePublishDialog } from "@/components/module-publish-dialog"
import { useAgentVersionState } from "@/components/agent-publish-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { agentApi, wfApi, type AgentInfo, type AgentVersionInfo } from "@/services/wf-api"
import { avatarFor } from "./wf-agents-list"

const INK = "#1F2329"; const INK2 = "#5A6472"; const INK3 = "#9AA3B2"; const CARD = "#E5E8EE"

interface ModuleMeta { key: string; version: string; displayName: string; description: string; riskClass: string; providers: string[]; logicalTools: string[]; criteria: string[]; inputSchema?: { required?: string[]; properties?: Record<string, unknown> }; outputSchema?: Record<string, unknown> }
interface ProviderOpt { id: string; name: string; kind: string; status: string; healthStatus: string | null }
interface ReleaseOpt { releaseId: string; environment: string; status: string; canaryPercent: number; versionNo: number | null; createdAt: string }
interface RunResult { status: string; output?: Record<string, unknown>; usage?: Record<string, unknown>; calls?: { kind: string; targetType?: string; targetId?: string }[] }

function Card({ no, title, children, right }: { no: number; title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-white p-4" style={{ borderColor: CARD }}>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex size-5 items-center justify-center rounded-full border text-[10px]" style={{ borderColor: CARD, color: INK2 }}>{no}</span>
          <span className="text-[13px] font-semibold" style={{ color: INK }}>{title}</span>
        </div>
        {right}
      </div>
      {children}
    </div>
  )
}

export default function ModuleAgentConfigPage({ agent }: { agent: AgentInfo }) {
  const navigate = useNavigate()
  const vs = useAgentVersionState(agent.id)
  const [meta, setMeta] = useState<ModuleMeta | null>(null)
  const [name, setName] = useState(agent.name)
  const [desc, setDesc] = useState(agent.description ?? "")
  const [purpose, setPurpose] = useState<string>((agent.config as { spec?: { purpose?: string } })?.spec?.purpose ?? "")
  const [modelId, setModelId] = useState<string>(((agent.config as { modelRef?: { modelId?: string } })?.modelRef?.modelId) ?? "")
  const [models, setModels] = useState<{ modelKey: string }[]>([])
  const [versions, setVersions] = useState<AgentVersionInfo[]>([])
  const [releases, setReleases] = useState<ReleaseOpt[]>([])
  const [diffOpen, setDiffOpen] = useState(false)
  const [tab, setTab] = useState<"overview" | "runs" | "versions" | "eval">("overview")
  const [evalData, setEvalData] = useState<Awaited<ReturnType<typeof agentApi.evalSummary>> | null>(null)
  const [publishOpen, setPublishOpen] = useState(false)
  // 测试面板：环境=Release 绑定；草稿=Provider 必选（R3 语义）
  const [providers, setProviders] = useState<ProviderOpt[]>([])
  const [providerId, setProviderId] = useState("")
  const [envSel, setEnvSel] = useState("")
  const [sample, setSample] = useState('{"sample_id": "S1", "dialogues": []}')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<(RunResult & { runId?: string }) | null>(null)
  const [callsOpen, setCallsOpen] = useState(true)

  useEffect(() => {
    agentApi.modules().then((r) => setMeta(r.items.find((m) => m.key === agent.moduleKey) ?? null)).catch(() => undefined)
    agentApi.providers().then((r) => {
      const en = r.items.filter((p) => p.status === "enabled")
      setProviders(en); if (!providerId && en[0]) setProviderId(en[0].id)
    }).catch(() => undefined)
    agentApi.versions(agent.id).then(setVersions).catch(() => undefined)
    agentApi.releases(agent.id).then((rs) => { setReleases(rs.filter((x) => x.status === "active")); }).catch(() => undefined)
    wfApi.models().then(setModels).catch(() => undefined)
  }, [agent.id, agent.moduleKey])  // eslint-disable-line react-hooks/exhaustive-deps

  const activeReleases = releases.filter((r) => r.versionNo != null)
  const hasRelease = activeReleases.length > 0

  const save = async () => {
    try {
      await agentApi.update(agent.id, {
        name, description: desc,
        config: { ...(agent.config as object), spec: { purpose }, modelRef: { ...(agent.config as { modelRef?: object })?.modelRef, modelId } },
      }, agent.configRevision)
      toast.success("已保存")
    } catch (e) { toast.error((e as Error).message) }
  }

  const runTest = async () => {
    // 已发布：环境=Release 绑定（解析 versionId）；草稿：Provider 必选
    const extra: Record<string, unknown> = {}
    if (hasRelease) {
      const rel = activeReleases.find((r) => `${r.environment}:${r.versionNo}` === envSel)
      if (!rel) { toast.error("请选择环境（Release 绑定）"); return }
      const ver = versions.find((v) => v.versionNo === rel.versionNo)
      if (!ver) { toast.error("该 Release 的版本不存在"); return }
      extra.versionId = ver.versionId
    } else {
      if (!providerId) { toast.error("草稿预览须选择 Provider"); return }
      extra.providerId = providerId
    }
    setRunning(true); setResult(null)
    try {
      let input: Record<string, unknown> = {}
      try { input = JSON.parse(sample) } catch { /* keep {} */ }
      const { runId } = await agentApi.run(agent.id, input, "test", extra)
      const deadline = Date.now() + 30000
      for (; ;) {
        const d = await agentApi.runDetail(agent.id, runId)
        if (["succeeded", "failed", "cancelled"].includes(d.status)) {
          setResult({ status: d.status, output: (d.output as Record<string, unknown>) ?? undefined, usage: d.usage, calls: (d.calls as RunResult["calls"]) ?? [], runId })
          break
        }
        if (Date.now() > deadline) { setResult({ status: "timeout", runId }); break }
        await new Promise((r) => setTimeout(r, 400))
      }
    } catch (e) { toast.error((e as Error).message) } finally { setRunning(false) }
  }

  // R8-UI-2：效果评测懒加载
  useEffect(() => {
    if (tab === "eval" && !evalData) agentApi.evalSummary(agent.id).then(setEvalData).catch(() => setEvalData(null))
  }, [tab, agent.id, evalData])

  const inputProps = Object.keys((meta?.inputSchema?.properties ?? {}) as object)
  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col">
      {/* 头部 */}
      <div className="flex h-12 shrink-0 items-center gap-3 border-b bg-white px-4" style={{ borderColor: CARD }}>
        <button onClick={() => navigate("/config/agents")}><ArrowLeft className="size-4" style={{ color: INK2 }} /></button>
        <img src={avatarFor(agent.id, agent.avatar)} alt="" className="size-6 rounded-md object-cover" />
        <span className="text-[15px] font-semibold" style={{ color: INK }}>{agent.name}</span>
        <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-600">Module</span>
        <span className="text-[11px]" style={{ color: INK3 }}>{agent.moduleKey}@{agent.moduleVersion}</span>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={save}>保存</Button>
          <Button size="sm" className="bg-black text-white hover:bg-neutral-800" onClick={() => setPublishOpen(true)}>发布 ▾</Button>
        </div>
      </div>
      {/* R8-UI D-1：Draft vs Last-published 对照卡 */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b bg-white px-4 py-2" style={{ borderColor: CARD }}>
        <span className="truncate text-[11px]" style={{ color: INK3 }}>{desc || meta?.description || ""}</span>
        <div className="flex shrink-0 items-center gap-5 rounded-lg border px-3 py-1.5" style={{ borderColor: CARD }}>
          <div>
            <b className="flex items-center gap-1.5 text-[12px]" style={{ color: INK }}>
              <span className="inline-block size-1.5 rounded-full bg-amber-400" />草稿版本
            </b>
            <small className="block text-[10px]" style={{ color: INK3 }}>rev {agent.configRevision}</small>
          </div>
          <div>
            <b className="flex items-center gap-1.5 text-[12px]" style={{ color: INK }}>
              <span className="inline-block size-1.5 rounded-full bg-emerald-400" />最近发布
            </b>
            <small className="block text-[10px]" style={{ color: INK3 }}>
              {vs.latest ? `V${vs.latest.versionNo} · ${vs.latest.createdAt.slice(0, 10)}` : "（无）"}
            </small>
          </div>
          <Button size="sm" variant="outline" disabled={!vs.latest} onClick={() => setDiffOpen(true)}>对比</Button>
        </div>
      </div>
      {/* Tab */}
      <div className="flex gap-4 border-b bg-white px-4" style={{ borderColor: CARD }}>
        {([["overview", "概览"], ["runs", "运行观测"], ["versions", "版本"], ["eval", "效果评测"]] as const).map(([k, label]) => (
          <button key={k} className="py-2 text-[13px]"
            style={tab === k ? { color: INK, fontWeight: 600, borderBottom: "2px solid #111" } : { color: INK2 }}
            onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4" style={{ background: "#F7F8FA" }}>
        {tab === "runs" && <AgentRunsPanel agentId={agent.id} />}
        {tab === "versions" && <AgentVersionsPanel agentId={agent.id} />}
        {tab === "eval" && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Card no={1} title="Golden Set（Module Ground Truth）">
                <div className="text-[12px]" style={{ color: INK2 }}>
                  {evalData ? `${evalData.goldenSet.samples} 个样本` : "加载中…"}
                </div>
                <div className="pt-1 font-mono text-[10px]" style={{ color: INK3 }}>
                  {evalData?.goldenSet.source || "—"}
                </div>
                <div className="pt-2 text-[11px]" style={{ color: INK3 }}>
                  双 Provider 同 Ground Truth 对比以跨 Provider 历史 Run 聚合为准；insufficient_evidence/not_applicable 属业务结论而非系统错误。
                </div>
              </Card>
              <Card no={2} title="真实 Run 聚合">
                <div className="text-[12px]" style={{ color: INK2 }}>
                  {evalData ? `Run ${evalData.runCount} 个 · 产出质检结果 ${evalData.evaluatedRuns} 个` : "加载中…"}
                </div>
                <div className="pt-2 text-[11px]" style={{ color: INK3 }}>
                  逐 criterion 统计来自 QualityResult findings（规则派生评分口径一致）。
                </div>
              </Card>
            </div>
            {evalData && evalData.criteria.length === 0 && (
              <div className="rounded-xl border bg-white p-6 text-center text-[12px]" style={{ borderColor: CARD, color: INK3 }}>
                暂无评测数据（该 Agent 尚无产出质检结果的 Run）
              </div>
            )}
            {evalData && evalData.criteria.length > 0 && (
              <Card no={3} title="逐 criterion 聚合">
                <div className="space-y-2">
                  {evalData.criteria.map((c) => (
                    <div key={c.criterion} className="rounded-lg border px-3 py-2" style={{ borderColor: CARD }}>
                      <div className="flex items-center gap-3 text-[12px]">
                        <span className="font-mono font-medium" style={{ color: INK }}>{c.criterion}</span>
                        <span style={{ color: INK2 }}>核验 {c.total} 次</span>
                        {c.avgConfidence != null && <span style={{ color: INK3 }}>平均 confidence {c.avgConfidence}</span>}
                        <span className="ml-auto flex gap-2">
                          {Object.entries(c.byStatus).map(([st, n]) => (
                            <span key={st} className="rounded px-1.5 py-0.5 text-[10px]"
                              style={st === "passed" || st === "accurate" || st === "fulfilled"
                                ? { background: "#E8F7EE", color: "#16A34A" }
                                : { background: "#F1F3F7", color: INK2 }}>
                              {st} ×{n}
                            </span>
                          ))}
                        </span>
                      </div>
                      {c.byProvider.length > 0 && (
                        <div className="flex gap-4 pt-1 text-[10px]" style={{ color: INK3 }}>
                          {c.byProvider.map((p) => (
                            <span key={p.provider}>
                              {p.provider}：{p.total} 次（{Object.entries(p.byStatus).map(([s, n]) => `${s}×${n}`).join("，")}）
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        )}
        {tab === "overview" && (
          <div className="flex gap-4">
            <div className="flex min-w-0 flex-1 flex-col gap-4">
              <Card no={1} title="Agent 身份">
                <div className="space-y-2">
                  <div className="flex gap-3"><Label className="w-16 pt-2 text-xs">名称</Label>
                    <Input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} /></div>
                  <div className="flex gap-3"><Label className="w-16 pt-2 text-xs">描述</Label>
                    <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
                </div>
              </Card>
              <Card no={2} title="模型与推理（实例配置）">
                <div className="flex items-center gap-3">
                  <Label className="w-16 text-xs">模型</Label>
                  <Select value={modelId || undefined} onValueChange={setModelId}>
                    <SelectTrigger className="h-8 w-56 bg-white"><SelectValue placeholder="选择模型" /></SelectTrigger>
                    <SelectContent>
                      {models.map((m, i) => <SelectItem key={`${m.modelKey}-${i}`} value={m.modelKey}>{m.modelKey}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <span className="text-[11px]" style={{ color: INK3 }}>模型随版本冻结；凭据由平台 Connection 注入</span>
                </div>
              </Card>
              <Card no={3} title="指令（Module 资产 · 只读）"
                right={<span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-600">只读</span>}>
                <div className="mb-2 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
                  criteria/工具/主数据由 Module 版本冻结；实例仅可追加「业务定位」。
                </div>
                <pre className="max-h-40 overflow-auto rounded border p-2 text-[11px]" style={{ borderColor: CARD, color: INK2 }}>
                  {meta ? meta.criteria.map((c) => `- ${c}`).join("\n") : "（Module 未加载）"}
                </pre>
                <div className="mt-2 space-y-1">
                  <Label className="text-xs">业务定位（实例追加）</Label>
                  <Textarea value={purpose} placeholder="如：面向售后退款场景" onChange={(e) => setPurpose(e.target.value)} />
                </div>
              </Card>
              <Card no={4} title="资源（Module 冻结 · 只读）">
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { t: "工具", d: `${(meta?.logicalTools ?? []).length} 个逻辑工具` },
                    { t: "输入 Schema", d: `${inputProps.length} 字段 · ${(meta?.inputSchema?.required ?? []).length} 必填` },
                    { t: "输出 Schema", d: meta?.outputSchema ? "已冻结" : "—" },
                    { t: "Provider 实现", d: (meta?.providers ?? []).join(" / ") || "—" },
                  ].map((x) => (
                    <div key={x.t} className="flex items-center justify-between rounded-lg border px-3 py-2" style={{ borderColor: CARD }}>
                      <div><b className="block text-[12px]" style={{ color: INK }}>{x.t}</b>
                        <small className="block text-[10px]" style={{ color: INK3 }}>{x.d}</small></div>
                      <span className="text-[10px]" style={{ color: "#16A34A" }}>已冻结</span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
            {/* 右：测试面板 */}
            <div className="w-[360px] shrink-0">
              <div className="rounded-xl border bg-white" style={{ borderColor: CARD }}>
                <div className="border-b px-3 py-2 text-[13px] font-semibold" style={{ borderColor: CARD, color: INK }}>测试 Agent</div>
                <div className="space-y-3 p-3">
                  {hasRelease ? (
                    <div className="flex items-center gap-2">
                      <Label className="text-xs">环境</Label>
                      <Select value={envSel || undefined} onValueChange={setEnvSel}>
                        <SelectTrigger className="h-8 bg-white"><SelectValue placeholder="选择 Release 绑定" /></SelectTrigger>
                        <SelectContent>
                          {activeReleases.map((r) => (
                            <SelectItem key={r.releaseId} value={`${r.environment}:${r.versionNo}`}>
                              {r.environment === "prod" ? "线上" : "沙箱"} V{r.versionNo}{r.canaryPercent > 0 ? ` · 灰度 ${r.canaryPercent}%` : " · 稳定"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Label className="text-xs">Provider</Label>
                      <Select value={providerId} onValueChange={setProviderId}>
                        <SelectTrigger className="h-8 bg-white"><SelectValue placeholder="草稿预览须选择" /></SelectTrigger>
                        <SelectContent>{providers.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}（{p.kind}）</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  )}
                  <Textarea value={sample} onChange={(e) => setSample(e.target.value)} className="min-h-20 font-mono text-[11px]" />
                  <Button size="sm" className="w-full bg-black text-white hover:bg-neutral-800" disabled={running} onClick={runTest}>
                    {running ? "运行中…" : "运行"}
                  </Button>
                  {result && (
                    <div className="space-y-2 rounded border p-2 text-[11px]" style={{ borderColor: CARD }}>
                      <div className="flex items-center gap-2">状态：<b>{result.status}</b>
                        {result.runId && (
                          <Button variant="outline" size="sm" className="ml-auto h-6 text-[10px]"
                            onClick={() => navigate(`/config/agents/${agent.id}/runs/${result.runId}`)}>查看 Run 详情 ↗</Button>
                        )}
                      </div>
                      {result.output && <pre className="max-h-40 overflow-auto text-[10px]" style={{ color: INK2 }}>{JSON.stringify(result.output, null, 1)}</pre>}
                      {result.usage && (
                        <div style={{ color: INK3 }}>
                          {String((result.usage as { total?: number }).total ?? "")} tokens
                          · 模型 {String((result.usage as { modelCalls?: number }).modelCalls ?? "—")} 次
                          · 工具 {String((result.usage as { toolCalls?: number }).toolCalls ?? "—")} 次
                        </div>
                      )}
                      {(result.calls?.length ?? 0) > 0 && (
                        <div className="rounded border" style={{ borderColor: CARD }}>
                          <button className="flex w-full items-center gap-1 px-2 py-1 text-[11px]" style={{ color: INK2 }}
                            onClick={() => setCallsOpen((o) => !o)}>
                            工具调用（{result.calls!.length}）{callsOpen ? "⌃" : "⌄"}
                          </button>
                          {callsOpen && result.calls!.map((c, i) => (
                            <div key={i} className="flex items-center gap-2 border-t px-2 py-1" style={{ borderColor: CARD }}>
                              <span style={{ color: "#16A34A" }}>✓</span>
                              <span className="font-mono" style={{ color: INK2 }}>{c.targetId ?? c.kind}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      <ModulePublishDialog agentId={agent.id} open={publishOpen} onClose={() => setPublishOpen(false)} onPublished={vs.refresh} />
      <AgentVersionDiffDialog agentId={agent.id} open={diffOpen} onClose={() => setDiffOpen(false)}
        versions={versions.map((v) => ({ versionId: v.versionId, versionNo: v.versionNo }))}
        defaultLeft="draft" defaultRight={versions[0]?.versionId ?? "draft"} />
    </div>
  )
}
