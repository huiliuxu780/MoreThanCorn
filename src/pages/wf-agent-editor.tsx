/** Agent 编辑器路由：三型分发。
 *  dialogue / expert-group → flow 画布（agentMeta 传类型，目录按 editorKinds 收敛）+ 配置抽屉；
 *  autonomous → 四 Tab 壳层（搭建/运行观测/效果评测/版本指标，SDD D-1）。 */
import { ArrowLeft, ChevronDown, Send, Sparkles } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"

import { AgentEvalPanel, AgentRunsPanel, AgentVersionsPanel } from "@/components/agent-ops-panels"
import { ConversationPanel, MemorySchemaForm } from "@/components/agent-common-config"
import { AgentPublishDialog, useAgentVersionState } from "@/components/agent-publish-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { resApi } from "@/services/resource-api"
import { agentApi, streamRunEvents, wfApi, type AgentInfo } from "@/services/wf-api"
import WfDesignerPage from "./wf-designer"
import { avatarFor } from "./wf-agents-list"

const INK = "#1F2329"; const INK2 = "#5A6472"; const INK3 = "#B9C2CF"; const CARD = "#EDF0F4"

function AddInline({ onAdd, placeholder = "名称" }: { onAdd: (v: string) => void; placeholder?: string }) {
  const [v, setV] = useState("")
  return (
    <div className="flex gap-1">
      <Input className="h-6 text-xs" value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} />
      <Button variant="outline" size="sm" className="h-6 text-[11px]" onClick={() => { if (v.trim()) { onAdd(v.trim()); setV("") } }}>添加</Button>
    </div>
  )
}

/** 注册表多选器（A-11）：候选来自真实资源注册表，存 id。 */
function RegistryPicker({ title, load, ids, onChange, invalid = [], extra }: {
  title: string
  load: () => Promise<{ id: string; name: string }[]>
  ids: string[]
  onChange: (v: string[]) => void
  invalid?: string[]
  extra?: (id: string) => React.ReactNode
}) {
  const [items, setItems] = useState<{ id: string; name: string }[]>([])
  const [open, setOpen] = useState(false)
  useEffect(() => { load().then(setItems).catch(() => setItems([])) }, [])  // eslint-disable-line react-hooks/exhaustive-deps
  const nameOf = (id: string) => items.find((i) => i.id === id)?.name ?? id
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs" style={{ color: INK2 }}>{title}</span>
        <button className="text-[11px]" style={{ color: "#3D6BFF" }} onClick={() => setOpen(!open)}>{open ? "收起" : "添加"}</button>
      </div>
      {ids.map((id) => (
        <div key={id} className="flex items-center gap-1 text-xs">
          <span className="flex-1 truncate rounded border px-1 py-0.5" style={{ borderColor: CARD }}>{nameOf(id)}</span>
          {invalid.includes(id) && <span className="rounded bg-neutral-100 px-1 text-[10px]" style={{ color: "#F97E2B" }}>已失效</span>}
          {extra?.(id)}
          <button onClick={() => onChange(ids.filter((x) => x !== id))}><span className="text-neutral-400">×</span></button>
        </div>
      ))}
      {open && (
        <div className="max-h-40 space-y-0.5 overflow-y-auto rounded border p-1" style={{ borderColor: CARD }}>
          {items.length === 0 && <div className="px-1 py-1 text-[11px]" style={{ color: INK3 }}>注册表暂无可用资源</div>}
          {items.map((it) => (
            <label key={it.id} className="flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-xs hover:bg-neutral-50">
              <input type="checkbox" checked={ids.includes(it.id)}
                onChange={(e) => onChange(e.target.checked ? [...ids, it.id] : ids.filter((x) => x !== it.id))} />
              <span className="truncate">{it.name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

/* ---------- Prompt 模板库（调研 03 §3 分类） ---------- */
const PROMPT_TEMPLATES = [
  { key: "通用", body: "# 角色：\n你是一个乐于助人的智能助手。\n## 目标：\n准确理解用户问题并给出清晰回答。\n## 技能：\n- 信息整理与总结\n## 限制：\n- 不编造事实，不确定时说明。" },
  { key: "客户服务", body: "# 角色：\n你是专业的客户服务代表。\n## 目标：\n解决用户售后与咨询问题，必要时升级人工。\n## 技能：\n- 工单查询与创建\n- 安抚与澄清式提问\n## 限制：\n- 仅回答与服务相关的问题。" },
  { key: "活动咨询", body: "# 角色：\n你是活动咨询顾问。\n## 目标：\n回答活动时间、规则与参与方式。\n## 技能：\n- 活动规则解读\n## 限制：\n- 以知识库内容为准，不得承诺未确认的优惠。" },
  { key: "商品导购", body: "# 角色：\n你是商品导购专家。\n## 目标：\n根据用户需求推荐合适商品。\n## 技能：\n- 需求澄清、卖点讲解、对比推荐\n## 限制：\n- 推荐必须基于在售商品。" },
  { key: "销售分析", body: "# 角色：\n你是销售数据分析师。\n## 目标：\n解读销售数据并给出可行建议。\n## 技能：\n- 趋势分析、归因、报表解读\n## 限制：\n- 结论需有数据支撑。" },
]

/* ---------- 知识高级配置（SDD D-1：TopK/匹配分/检索模式真消费） ---------- */
function KnowledgeAdvanced({ value, onChange }: {
  value: { topK?: number; scoreThreshold?: number; mode?: string }; onChange: (v: { topK?: number; scoreThreshold?: number; mode?: string }) => void
}) {
  return (
    <div className="space-y-1 rounded border p-1.5" style={{ borderColor: CARD }}>
      <div className="flex items-center gap-1 text-[11px]" style={{ color: INK2 }}>
        <span>TopK</span>
        <input type="number" min={1} max={20} className="w-12 rounded border px-1" style={{ borderColor: CARD }}
          value={value.topK ?? 3} onChange={(e) => onChange({ ...value, topK: Number(e.target.value) })} />
        <span className="pl-1">匹配分</span>
        <input type="number" min={0} max={1} step={0.05} className="w-14 rounded border px-1" style={{ borderColor: CARD }}
          value={value.scoreThreshold ?? 0.5} onChange={(e) => onChange({ ...value, scoreThreshold: Number(e.target.value) })} />
      </div>
      <div className="flex items-center gap-1 text-[11px]" style={{ color: INK2 }}>
        <span>检索模式</span>
        <select className="rounded border px-1" style={{ borderColor: CARD }} value={value.mode ?? "HYBRID"}
          onChange={(e) => onChange({ ...value, mode: e.target.value })}>
          <option value="HYBRID">混合</option><option value="SEMANTIC">语义</option><option value="TEXT">全文</option>
        </select>
      </div>
    </div>
  )
}

/* ---------- 流式预览消息 ---------- */
interface ChatMsg { role: "user" | "ai"; text: string; steps: string[]; followUps?: string[]; fallback?: string; done: boolean }

/* ---------- 自主规划搭建页 ---------- */
function AutonomousBuilder({ agent, onSaved }: { agent: AgentInfo; onSaved: (a: AgentInfo) => void }) {
  const [cfg, setCfg] = useState(agent.config ?? {})
  const [revision, setRevision] = useState(agent.configRevision ?? 1)
  const [models, setModels] = useState<{ modelKey: string }[]>([])
  const [chat, setChat] = useState<ChatMsg[]>([])
  const [q, setQ] = useState("")
  const [running, setRunning] = useState(false)
  const [invalid, setInvalid] = useState<string[]>([])
  const [generating, setGenerating] = useState(false)
  const [advOpen, setAdvOpen] = useState<string | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }) }, [chat])
  useEffect(() => {
    wfApi.models().then((r) => setModels(Array.isArray(r) ? r : [])).catch(() => undefined)
  }, [])
  useEffect(() => {
    agentApi.mountsHealth(agent.id)
      .then((r) => setInvalid(r.items.filter((i) => !i.valid).map((i) => i.name)))
      .catch(() => undefined)
  }, [agent.id, cfg])
  const save = async () => {
    try {
      const r = await agentApi.update(agent.id, { config: cfg }, revision)
      setRevision(r.configRevision)
      toast.success("Agent 配置已保存"); onSaved({ ...agent, config: r.config, configRevision: r.configRevision })
    } catch (e) {
      if (String((e as Error).message).startsWith("409")) {
        toast.error("配置已被更新，请刷新后重试")
        agentApi.get(agent.id).then((a) => { setCfg(a.config); setRevision(a.configRevision); onSaved(a) })
      } else toast.error((e as Error).message)
    }
  }
  const sendChat = async (question?: string) => {
    const query = (question ?? q).trim()
    if (!query || running) return
    setChat((c) => [...c, { role: "user", text: query, steps: [], done: true },
                     { role: "ai", text: "", steps: [], done: false }])
    setQ(""); setRunning(true)
    const aiIdx = chat.length + 1
    const patchAi = (patch: Partial<ChatMsg> | ((m: ChatMsg) => Partial<ChatMsg>)) =>
      setChat((c) => c.map((m, i) => (i === aiIdx ? { ...m, ...(typeof patch === "function" ? patch(m) : patch) } : m)))
    try {
      const { runId } = await agentApi.run(agent.id, { userQuery: query })
      await streamRunEvents(runId, (ev) => {
        if (ev.type === "llm_delta") patchAi((m) => ({ text: m.text + (ev.payload.delta ?? "") }))
        if (ev.type === "tool_call") patchAi((m) => ({ steps: [...m.steps, `🔧 调用 ${ev.payload.name}`] }))
        if (ev.type === "tool_result") patchAi((m) => ({ steps: [...m.steps, `↩ ${String(ev.payload.result ?? "").slice(0, 120)}`] }))
        if (ev.type === "agent_mounts_resolved" && (ev.payload.missing ?? []).length > 0)
          patchAi((m) => ({ steps: [...m.steps, `⚠ 失效挂载：${ev.payload.missing.map((x: any) => x.name).join("、")}`] }))
        if (ev.type === "agent_completed") patchAi({ done: true, followUps: ev.payload.followUps, fallback: ev.payload.fallback })
        if (ev.type === "agent_failed") patchAi((m) => ({ done: true, text: m.text || `❌ ${ev.payload.error ?? "运行失败"}` }))
      })
      setChat((c) => c.map((m, i) => (i === aiIdx ? { ...m, done: true } : m)))
    } catch (e) {
      patchAi((m) => ({ done: true, text: m.text || `❌ ${(e as Error).message}` }))
    } finally {
      setRunning(false)
    }
  }
  const greeting = (cfg.conversation ?? {}).greeting as string | undefined
  const adv = (cfg.knowledgeAdvanced ?? {}) as Record<string, { topK?: number; scoreThreshold?: number; mode?: string }>
  return (
    <div className="flex h-full min-h-0">
      <div className="flex-1 space-y-4 overflow-y-auto p-6">
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label className="text-xs">角色能力描述</Label>
            <div className="flex items-center gap-1">
              {PROMPT_TEMPLATES.map((t) => (
                <button key={t.key} className="rounded border px-1.5 py-0.5 text-[10px] hover:bg-neutral-50"
                  style={{ borderColor: CARD, color: INK2 }}
                  onClick={() => setCfg({ ...cfg, rolePrompt: t.body })}>{t.key}</button>
              ))}
              <button className="flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[10px] hover:bg-neutral-50"
                style={{ borderColor: CARD, color: "#3D6BFF" }} disabled={generating}
                onClick={async () => {
                  setGenerating(true)
                  try {
                    const r = await agentApi.generatePrompt(agent.name, (cfg.rolePrompt ?? "").slice(0, 100))
                    setCfg({ ...cfg, rolePrompt: r.prompt })
                  } catch (e) { toast.error(`生成失败：${(e as Error).message}`) }
                  finally { setGenerating(false) }
                }}><Sparkles className="size-3" />{generating ? "生成中…" : "AI 生成"}</button>
            </div>
          </div>
          <Textarea className="min-h-40 text-xs" value={cfg.rolePrompt ?? ""} onChange={(e) => setCfg({ ...cfg, rolePrompt: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">模型</Label>
          <select className="w-full rounded-md border p-2 text-sm" value={cfg.modelRef?.modelId ?? ""}
            onChange={(e) => setCfg({ ...cfg, modelRef: { ...cfg.modelRef, modelId: e.target.value } })}>
            <option value="">请选择模型</option>
            {models.map((m) => <option key={m.modelKey} value={m.modelKey}>{m.modelKey}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <div className="text-xs" style={{ color: INK2 }}>技能说明（注入提示词的文本）</div>
            {(cfg.skills ?? []).map((v: string, i: number) => (
              <div key={i} className="flex items-center gap-1 text-xs">
                <span className="flex-1 truncate rounded border px-1 py-0.5" style={{ borderColor: CARD }}>{v}</span>
                <button onClick={() => setCfg({ ...cfg, skills: (cfg.skills ?? []).filter((_: string, j: number) => j !== i) })}><span className="text-neutral-400">×</span></button>
              </div>
            ))}
            <AddInline onAdd={(v) => setCfg({ ...cfg, skills: [...(cfg.skills ?? []), v] })} />
          </div>
          <RegistryPicker title="插件" ids={cfg.tools ?? []} invalid={invalid}
            onChange={(v) => setCfg({ ...cfg, tools: v })}
            load={() => resApi.registry("tool").then((r) => r.items)} />
          <RegistryPicker title="工作流" ids={cfg.workflows ?? []} invalid={invalid}
            onChange={(v) => setCfg({ ...cfg, workflows: v })}
            load={() => wfApi.list({ pageSize: 100 }).then((r) => r.items)} />
          <div>
            <RegistryPicker title="知识" ids={cfg.knowledges ?? []} invalid={invalid}
              onChange={(v) => setCfg({ ...cfg, knowledges: v })}
              load={() => resApi.registry("knowledge").then((r) => r.items)}
              extra={(id) => (
                <button className="text-[10px]" style={{ color: "#3D6BFF" }}
                  onClick={() => setAdvOpen(advOpen === id ? null : id)}>高级</button>
              )} />
            {advOpen && (
              <KnowledgeAdvanced value={adv[advOpen] ?? {}}
                onChange={(v) => setCfg({ ...cfg, knowledgeAdvanced: { ...adv, [advOpen]: v } })} />
            )}
          </div>
          <MemorySchemaForm memories={cfg.memoriesSchema ?? []} onChange={(v) => setCfg({ ...cfg, memoriesSchema: v })} />
          <div className="space-y-2">
            <ConversationPanel cfg={cfg} setCfg={setCfg} />
            <div className="space-y-1">
              <span className="text-xs" style={{ color: INK2 }}>开场白（预览首条消息）</span>
              <Input className="h-7 text-xs" placeholder="你好，我是…" value={greeting ?? ""}
                onChange={(e) => setCfg({ ...cfg, conversation: { ...(cfg.conversation ?? {}), greeting: e.target.value } })} />
            </div>
          </div>
        </div>
        <Button size="sm" className="bg-black text-white hover:bg-neutral-800" onClick={save}>保存</Button>
      </div>
      <div className="flex w-[360px] max-w-[92vw] flex-col border-l bg-white" style={{ borderColor: CARD }}>
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-[15px] font-semibold" style={{ color: INK }}>预览调试（流式）</span>
          {chat.length > 0 && <button className="text-[11px]" style={{ color: INK3 }} onClick={() => setChat([])}>清空</button>}
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto px-4">
          {chat.length === 0 && greeting && (
            <div className="max-w-[92%] rounded-md bg-neutral-100 px-2 py-1 text-xs">{greeting}</div>
          )}
          {chat.map((c, i) => (
            <div key={i} className={c.role === "user" ? "ml-auto w-fit max-w-[85%]" : "w-full max-w-[92%]"}>
              <div className={`rounded-md px-2 py-1 text-xs ${c.role === "user" ? "bg-neutral-900 text-white" : "bg-neutral-100"}`}>
                {c.text || (!c.done ? "…" : "")}
                {c.fallback === "chitchat" && <span className="ml-1 rounded bg-white px-1 text-[10px]" style={{ color: INK3 }}>闲聊兜底</span>}
              </div>
              {c.role === "ai" && c.steps.length > 0 && <StepsBox msg={c} />}
              {c.role === "ai" && c.done && (c.followUps ?? []).length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {c.followUps!.map((f, k) => (
                    <button key={k} className="rounded-full border px-2 py-0.5 text-[10px] hover:bg-neutral-50"
                      style={{ borderColor: CARD, color: "#3D6BFF" }} onClick={() => sendChat(f)}>{f}</button>
                  ))}
                </div>
              )}
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>
        <div className="flex gap-1 p-3">
          <Input className="h-8 text-xs" value={q} onChange={(e) => setQ(e.target.value)} placeholder="说出你的问题吧"
            onKeyDown={(e) => e.key === "Enter" && sendChat()} />
          <Button size="sm" className="h-8" style={{ background: "#3D6BFF" }} disabled={running} onClick={() => sendChat()}>
            <Send className="size-3" />{running ? "运行中" : ""}
          </Button>
        </div>
      </div>
    </div>
  )
}

function StepsBox({ msg }: { msg: ChatMsg }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="pt-0.5">
      <button className="text-[10px]" style={{ color: "#3D6BFF" }} onClick={() => setOpen(!open)}>
        {open ? "收起" : `查看 ${msg.steps.length} 个步骤`} <ChevronDown className="inline size-3" />
      </button>
      {open && (
        <div className="mt-0.5 space-y-0.5 rounded border bg-white p-1" style={{ borderColor: CARD }}>
          {msg.steps.map((s, k) => <div key={k} className="break-all text-[10px]" style={{ color: INK2 }}>{s}</div>)}
        </div>
      )}
    </div>
  )
}

/* ---------- 路由分发 ---------- */
export default function WfAgentEditorPage() {
  const { agentId = "" } = useParams()
  const navigate = useNavigate()
  const [agent, setAgent] = useState<AgentInfo | null>(null)
  const [legacy, setLegacy] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  const [tab, setTab] = useState<"build" | "runs" | "eval" | "versions">("build")
  const vs = useAgentVersionState(agent && agent.type === "autonomous" ? agent.id : undefined)
  useEffect(() => {
    agentApi.get(agentId).then(setAgent).catch((e) => { if (String((e as Error).message).startsWith("404")) setLegacy(true) })
  }, [agentId])
  if (legacy) return <WfDesignerPage workflowId={agentId} />
  if (!agent) return <div className="p-8 text-sm" style={{ color: INK2 }}>加载中…</div>

  // 对话编排 / 专家组：画布（SDD D-1：专家组画布化，目录按 GROUP 收敛，成员在抽屉）
  if (agent.type === "dialogue" || agent.type === "expert-group") {
    const avatar = avatarFor(agent.id, agent.avatar)
    return (
      <div className="h-[calc(100dvh-3.5rem)] min-h-0">
        <WfDesignerPage workflowId={agent.workflowId ?? agentId} agentId={agent.id}
          agentMeta={{ name: agent.name, typeLabel: agent.typeLabel, agentType: agent.type }} avatar={avatar} />
      </div>
    )
  }

  // 自主规划：四 Tab 壳层（SDD D-1）
  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b bg-white px-4" style={{ borderColor: CARD }}>
        <button onClick={() => navigate("/config/agents")}><ArrowLeft className="size-4" style={{ color: INK2 }} /></button>
        <img src={avatarFor(agent.id, agent.avatar)} alt="" className="size-6 rounded-md object-cover" />
        <span className="text-[15px] font-semibold" style={{ color: INK }}>{agent.name}</span>
        <span className="rounded px-1.5 py-0.5 text-[11px]" style={{ background: "#FFF4EA", color: "#F97E2B" }}>{agent.typeLabel}</span>
        <span className="rounded border px-1.5 py-0.5 text-[11px]" style={{ borderColor: CARD, color: INK2 }}>
          {vs.latest ? `V${vs.latest.versionNo}` : "草稿"}
        </span>
        {vs.envs.sandbox != null && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-600">沙箱 V{vs.envs.sandbox}</span>}
        {vs.envs.prod != null && <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-600">线上 V{vs.envs.prod}</span>}
        <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-lg p-0.5" style={{ background: "#F1F3F7" }}>
          {([["build", "Agent搭建"], ["runs", "运行观测"], ["eval", "效果评测"], ["versions", "版本指标"]] as const).map(([k, label]) => (
            <button key={k} className="rounded-md px-3 py-1 text-[13px]"
              style={tab === k ? { background: "#fff", color: INK, boxShadow: "0 1px 3px rgba(31,35,41,.12)" } : { color: INK2 }}
              onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>
        <div className="ml-auto">
          <Button size="sm" className="h-8 rounded-md bg-black text-white hover:bg-neutral-800" onClick={() => setPublishOpen(true)}>发布</Button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {tab === "build" && <AutonomousBuilder agent={agent} onSaved={setAgent} />}
        {tab === "runs" && <AgentRunsPanel agentId={agent.id} />}
        {tab === "eval" && <AgentEvalPanel agentId={agent.id} />}
        {tab === "versions" && <AgentVersionsPanel agentId={agent.id} />}
      </div>
      <AgentPublishDialog agentId={agent.id} open={publishOpen} onClose={() => setPublishOpen(false)} onPublished={vs.refresh} />
    </div>
  )
}
