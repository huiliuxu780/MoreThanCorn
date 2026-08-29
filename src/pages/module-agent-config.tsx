/** Module Agent 配置页（SDD 10 R4，对位参考图 v3）。
 *  左：编号分区卡（身份可编辑 / 模型只读 / 指令只读 / 资源冻结只读）；右：测试面板（选 Provider→运行→结构化输出+调用）。
 *  Module 资产（criteria/工具/主数据/Schema）只读；实例仅编辑名称/描述/业务定位。 */
import { ArrowLeft } from "lucide-react"
import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { AgentRunsPanel, AgentVersionsPanel } from "@/components/agent-ops-panels"
import { ModulePublishDialog } from "@/components/module-publish-dialog"
import { useAgentVersionState } from "@/components/agent-publish-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { agentApi, type AgentInfo } from "@/services/wf-api"
import { avatarFor } from "./wf-agents-list"

const INK = "#1F2329"; const INK2 = "#5A6472"; const INK3 = "#9AA3B2"; const CARD = "#E5E8EE"

interface ModuleMeta { key: string; version: string; displayName: string; description: string; riskClass: string; providers: string[]; logicalTools: string[]; criteria: string[] }
interface ProviderOpt { id: string; name: string; kind: string; status: string; healthStatus: string | null }

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
  const [tab, setTab] = useState<"overview" | "runs" | "versions">("overview")
  const [publishOpen, setPublishOpen] = useState(false)
  // 测试面板
  const [providers, setProviders] = useState<ProviderOpt[]>([])
  const [providerId, setProviderId] = useState("")
  const [sample, setSample] = useState('{"sample_id": "S1", "dialogues": []}')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<{ status: string; output?: Record<string, unknown>; usage?: Record<string, unknown>; calls?: unknown[] } | null>(null)

  useEffect(() => {
    agentApi.modules().then((r) => setMeta(r.items.find((m) => m.key === agent.moduleKey) ?? null)).catch(() => undefined)
    agentApi.providers().then((r) => {
      const en = r.items.filter((p) => p.status === "enabled")
      setProviders(en); if (!providerId && en[0]) setProviderId(en[0].id)
    }).catch(() => undefined)
  }, [agent.id, agent.moduleKey])  // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    try {
      await agentApi.update(agent.id, { name, description: desc, config: { ...(agent.config as object), spec: { purpose } } }, agent.configRevision)
      toast.success("已保存")
    } catch (e) { toast.error((e as Error).message) }
  }

  const runTest = async () => {
    if (!providerId) { toast.error("请选择 Provider"); return }
    setRunning(true); setResult(null)
    try {
      let input: Record<string, unknown> = {}
      try { input = JSON.parse(sample) } catch { /* keep {} */ }
      const { runId } = await agentApi.run(agent.id, input, "test", { providerId })
      const deadline = Date.now() + 30000
      for (; ;) {
        const d = await agentApi.runDetail(agent.id, runId)
        if (["succeeded", "failed", "cancelled"].includes(d.status)) { setResult(d as never); break }
        if (Date.now() > deadline) { setResult({ status: "timeout" } as never); break }
        await new Promise((r) => setTimeout(r, 400))
      }
    } catch (e) { toast.error((e as Error).message) } finally { setRunning(false) }
  }

  const modelRef = (agent.config as { modelRef?: { modelId?: string } })?.modelRef ?? {}
  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col">
      {/* 头部 */}
      <div className="flex h-12 shrink-0 items-center gap-3 border-b bg-white px-4" style={{ borderColor: CARD }}>
        <button onClick={() => navigate("/config/agents")}><ArrowLeft className="size-4" style={{ color: INK2 }} /></button>
        <img src={avatarFor(agent.id, agent.avatar)} alt="" className="size-6 rounded-md object-cover" />
        <span className="text-[15px] font-semibold" style={{ color: INK }}>{agent.name}</span>
        <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-600">Module</span>
        <span className="text-[11px]" style={{ color: INK3 }}>{agent.moduleKey}@{agent.moduleVersion}</span>
        <span className="rounded border px-1.5 py-0.5 text-[11px]" style={{ borderColor: CARD, color: INK2 }}>
          {vs.latest ? `V${vs.latest.versionNo}` : "草稿"}
        </span>
        {vs.envs.sandbox != null && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-600">沙箱 V{vs.envs.sandbox}</span>}
        {vs.envs.prod != null && <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-600">线上 V{vs.envs.prod}</span>}
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={save}>保存</Button>
          <Button size="sm" className="bg-black text-white hover:bg-neutral-800" onClick={() => setPublishOpen(true)}>发布 ▾</Button>
        </div>
      </div>
      {/* Tab */}
      <div className="flex gap-4 border-b bg-white px-4" style={{ borderColor: CARD }}>
        {([["overview", "概览"], ["runs", "运行观测"], ["versions", "版本"]] as const).map(([k, label]) => (
          <button key={k} className="py-2 text-[13px]"
            style={tab === k ? { color: INK, fontWeight: 600, borderBottom: "2px solid #111" } : { color: INK2 }}
            onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4" style={{ background: "#F7F8FA" }}>
        {tab === "runs" && <AgentRunsPanel agentId={agent.id} />}
        {tab === "versions" && <AgentVersionsPanel agentId={agent.id} />}
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
                <div className="text-xs" style={{ color: INK2 }}>模型：{modelRef.modelId || "（未选择）"}</div>
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
                <div className="grid grid-cols-2 gap-2 text-xs" style={{ color: INK2 }}>
                  <div>工具：{(meta?.logicalTools ?? []).join(" / ") || "—"}</div>
                  <div>Provider：{(meta?.providers ?? []).join(" / ") || "—"}</div>
                </div>
              </Card>
            </div>
            {/* 右：测试面板 */}
            <div className="w-[360px] shrink-0">
              <div className="rounded-xl border bg-white" style={{ borderColor: CARD }}>
                <div className="border-b px-3 py-2 text-[13px] font-semibold" style={{ borderColor: CARD, color: INK }}>测试 Agent</div>
                <div className="space-y-3 p-3">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs">Provider</Label>
                    <Select value={providerId} onValueChange={setProviderId}>
                      <SelectTrigger className="h-8 bg-white"><SelectValue /></SelectTrigger>
                      <SelectContent>{providers.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}（{p.kind}）</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <Textarea value={sample} onChange={(e) => setSample(e.target.value)} className="min-h-20 font-mono text-[11px]" />
                  <Button size="sm" className="w-full bg-black text-white hover:bg-neutral-800" disabled={running} onClick={runTest}>
                    {running ? "运行中…" : "运行"}
                  </Button>
                  {result && (
                    <div className="space-y-2 rounded border p-2 text-[11px]" style={{ borderColor: CARD }}>
                      <div>状态：<b>{result.status}</b></div>
                      {result.output && <pre className="max-h-40 overflow-auto text-[10px]" style={{ color: INK2 }}>{JSON.stringify(result.output, null, 1)}</pre>}
                      {result.usage && <div style={{ color: INK3 }}>usage：{JSON.stringify(result.usage)}</div>}
                      {Array.isArray(result.calls) && <div style={{ color: INK3 }}>调用数：{result.calls.length}</div>}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      <ModulePublishDialog agentId={agent.id} open={publishOpen} onClose={() => setPublishOpen(false)} onPublished={vs.refresh} />
    </div>
  )
}
