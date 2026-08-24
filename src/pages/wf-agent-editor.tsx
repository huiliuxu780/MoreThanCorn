/** Agent 编辑器路由：三型分发。
 *  dialogue → flow 编辑器 + Agent 配置抽屉；autonomous → 角色表单+挂载+流式预览；expert-group → 成员池。
 *  Phase B（SDD 02）：Agent 级版本徽标 + 发布对话框 + 流式预览/步骤面板 + 结构化记忆表单 + 对话体验。 */
import { ArrowLeft, Bot, ChevronDown, Send } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"

import { AgentPublishDialog, useAgentVersionState } from "@/components/agent-publish-dialog"
import { ConversationPanel, MemorySchemaForm } from "@/components/agent-common-config"
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
function RegistryPicker({ title, load, ids, onChange, invalid = [] }: {
  title: string
  load: () => Promise<{ id: string; name: string }[]>
  ids: string[]
  onChange: (v: string[]) => void
  invalid?: string[]
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

/* ---------- 流式预览消息 ---------- */
interface ChatMsg { role: "user" | "ai"; text: string; steps: string[]; followUps?: string[]; fallback?: string; done: boolean }

/* ---------- 自主规划 ---------- */
function AutonomousEditor({ agent, onSaved }: { agent: AgentInfo; onSaved: (a: AgentInfo) => void }) {
  const [cfg, setCfg] = useState(agent.config ?? {})
  const [revision, setRevision] = useState(agent.configRevision ?? 1)
  const [models, setModels] = useState<{ modelKey: string }[]>([])
  const [chat, setChat] = useState<ChatMsg[]>([])
  const [q, setQ] = useState("")
  const [running, setRunning] = useState(false)
  const [invalid, setInvalid] = useState<string[]>([])
  const [stepsOpen, setStepsOpen] = useState<Record<number, boolean>>({})
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
      // 终态兜底：事件流结束后确保 done
      setChat((c) => c.map((m, i) => (i === aiIdx ? { ...m, done: true } : m)))
    } catch (e) {
      patchAi((m) => ({ done: true, text: m.text || `❌ ${(e as Error).message}` }))
    } finally {
      setRunning(false)
    }
  }
  const tpl = (t: string) => setCfg({ ...cfg, rolePrompt: `${cfg.rolePrompt ?? ""}\n${t}` })
  return (
    <div className="flex h-full min-h-0">
      <div className="flex-1 space-y-4 overflow-y-auto p-6">
        <div className="space-y-1">
          <Label className="text-xs">角色能力描述</Label>
          <Textarea className="min-h-40 text-xs" value={cfg.rolePrompt ?? ""} onChange={(e) => setCfg({ ...cfg, rolePrompt: e.target.value })} />
          <div className="flex gap-1 pt-1">
            {["# 角色：", "## 目标：", "## 技能：", "## 限制："].map((t) => (
              <Button key={t} variant="outline" size="sm" className="h-6 text-[11px]" onClick={() => tpl(t)}>{t}</Button>
            ))}
          </div>
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
          <RegistryPicker title="知识" ids={cfg.knowledges ?? []} invalid={invalid}
            onChange={(v) => setCfg({ ...cfg, knowledges: v })}
            load={() => resApi.registry("knowledge").then((r) => r.items)} />
          <MemorySchemaForm memories={cfg.memoriesSchema ?? []} onChange={(v) => setCfg({ ...cfg, memoriesSchema: v })} />
          <ConversationPanel cfg={cfg} setCfg={setCfg} />
        </div>
        <Button size="sm" className="bg-black text-white hover:bg-neutral-800" onClick={save}>保存</Button>
      </div>
      <div className="flex w-[360px] max-w-[92vw] flex-col border-l bg-white" style={{ borderColor: CARD }}>
        <div className="px-4 py-3 text-[15px] font-semibold" style={{ color: INK }}>预览调试（流式）</div>
        <div className="flex-1 space-y-2 overflow-y-auto px-4">
          {chat.map((c, i) => (
            <div key={i} className={c.role === "user" ? "ml-auto w-fit max-w-[85%]" : "w-full max-w-[92%]"}>
              <div className={`rounded-md px-2 py-1 text-xs ${c.role === "user" ? "bg-neutral-900 text-white" : "bg-neutral-100"}`}>
                {c.text || (!c.done ? "…" : "")}
                {c.fallback === "chitchat" && <span className="ml-1 rounded bg-white px-1 text-[10px]" style={{ color: INK3 }}>闲聊兜底</span>}
              </div>
              {c.role === "ai" && c.steps.length > 0 && (
                <div className="pt-0.5">
                  <button className="text-[10px]" style={{ color: "#3D6BFF" }} onClick={() => setStepsOpen((s) => ({ ...s, [i]: !s[i] }))}>
                    {stepsOpen[i] ? "收起" : `查看 ${c.steps.length} 个步骤`} <ChevronDown className="inline size-3" />
                  </button>
                  {stepsOpen[i] && (
                    <div className="mt-0.5 space-y-0.5 rounded border bg-white p-1" style={{ borderColor: CARD }}>
                      {c.steps.map((s, k) => <div key={k} className="break-all text-[10px]" style={{ color: INK2 }}>{s}</div>)}
                    </div>
                  )}
                </div>
              )}
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

/* ---------- 编排 Agent 专家组（成员池；路由在画布 Agent选择节点） ---------- */
function ExpertGroupEditor({ agent, onSaved }: { agent: AgentInfo; onSaved: (a: AgentInfo) => void }) {
  const navigate = useNavigate()
  const [cfg, setCfg] = useState(agent.config ?? {})
  const [revision, setRevision] = useState(agent.configRevision ?? 1)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState("")
  const save = async () => {
    try {
      const r = await agentApi.update(agent.id, { config: cfg }, revision)
      setRevision(r.configRevision)
      toast.success("专家组配置已保存"); onSaved({ ...agent, config: r.config, configRevision: r.configRevision })
    } catch (e) {
      if (String((e as Error).message).startsWith("409")) {
        toast.error("配置已被更新，请刷新后重试")
        agentApi.get(agent.id).then((a) => { setCfg(a.config); setRevision(a.configRevision); onSaved(a) })
      } else toast.error((e as Error).message)
    }
  }
  const trialRun = async () => {
    setRunning(true); setResult("")
    try {
      const d = await agentApi.runOnce(agent.id, { userQuery: "试运行：请处理该会话" })
      const steps = d.events.filter((e) => ["tool_call", "workflow_started", "agent_started"].includes(e.type))
        .map((e) => (e.type === "tool_call" ? `🔧 ${e.payload.name ?? ""}` : `▸ ${e.type}`))
      setResult(d.status === "succeeded"
        ? [...steps, d.output?.content ?? ""].filter(Boolean).join("\n")
        : [...steps, `❌ ${d.error?.message ?? d.status}`].join("\n"))
    } catch (e) {
      setResult(`❌ ${(e as Error).message}`)
    } finally {
      setRunning(false)
    }
  }
  return (
    <div className="space-y-4 overflow-y-auto p-6">
      <div className="text-sm" style={{ color: INK2 }}>
        Agent 专家组根据人工编排的流程进行协作。路由逻辑在画布的「Agent选择」节点中配置（主要/兜底成员 + 语义判定）。
      </div>
      <RegistryPicker title="成员 Agent" ids={cfg.members ?? []}
        onChange={(v) => setCfg({ ...cfg, members: v })}
        load={() => agentApi.list({ pageSize: 100 }).then((r) => r.items.filter((a) => a.id !== agent.id))} />
      <ConversationPanel cfg={cfg} setCfg={setCfg} />
      <div className="flex items-center gap-2">
        <Button size="sm" className="bg-black text-white hover:bg-neutral-800" onClick={save}>保存</Button>
        <Button size="sm" variant="outline" onClick={() => navigate(`/config/workflows/${agent.workflowId}`)}>打开画布编排</Button>
        <Button size="sm" variant="outline" disabled={running} onClick={trialRun}>{running ? "运行中…" : "试运行"}</Button>
      </div>
      {result && <pre className="whitespace-pre-wrap rounded border p-2 text-[11px]" style={{ borderColor: CARD, color: INK2 }}>{result}</pre>}
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
  const vs = useAgentVersionState(agent && agent.type !== "dialogue" ? agent.id : undefined)
  useEffect(() => {
    agentApi.get(agentId).then(setAgent).catch((e) => { if (String((e as Error).message).startsWith("404")) setLegacy(true) })
  }, [agentId])
  if (legacy) return <WfDesignerPage workflowId={agentId} />
  if (!agent) return <div className="p-8 text-sm" style={{ color: INK2 }}>加载中…</div>
  if (agent.type === "dialogue") {
    const avatar = avatarFor(agent.id, agent.avatar)
    return <div className="h-[calc(100dvh-3.5rem)] min-h-0"><WfDesignerPage workflowId={agent.workflowId ?? agentId} agentId={agent.id} agentMeta={{ name: agent.name, typeLabel: agent.typeLabel, agentType: agent.type }} avatar={avatar} /></div>
  }
  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b bg-white px-4" style={{ borderColor: CARD }}>
        <button onClick={() => navigate("/config/agents")}><ArrowLeft className="size-4" style={{ color: INK2 }} /></button>
        <span className="flex size-6 items-center justify-center rounded-md bg-[#1F2329]"><Bot className="size-3.5 text-white" /></span>
        <span className="text-[15px] font-semibold" style={{ color: INK }}>{agent.name}</span>
        <span className="rounded px-1.5 py-0.5 text-[11px]" style={{ background: "#FFF4EA", color: "#F97E2B" }}>{agent.typeLabel}</span>
        {/* SDD B：版本徽标 + 环境部署状态 */}
        <span className="rounded border px-1.5 py-0.5 text-[11px]" style={{ borderColor: CARD, color: INK2 }}>
          {vs.latest ? `V${vs.latest.versionNo}` : "草稿"}
        </span>
        {vs.envs.sandbox && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-600">沙箱 V{vs.envs.sandbox}</span>}
        {vs.envs.prod && <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-600">线上 V{vs.envs.prod}</span>}
        <div className="ml-auto">
          <Button size="sm" className="h-8 rounded-md bg-black text-white hover:bg-neutral-800" onClick={() => setPublishOpen(true)}>发布</Button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {agent.type === "autonomous" && <AutonomousEditor agent={agent} onSaved={setAgent} />}
        {agent.type === "expert-group" && <ExpertGroupEditor agent={agent} onSaved={setAgent} />}
      </div>
      <AgentPublishDialog agentId={agent.id} open={publishOpen} onClose={() => setPublishOpen(false)} onPublished={vs.refresh} />
    </div>
  )
}
