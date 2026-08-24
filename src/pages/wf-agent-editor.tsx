/** Agent 编辑器路由：三型分发（quickservice 同款）。
 *  dialogue → flow 编辑器 + Agent 配置抽屉；autonomous → 角色表单+挂载+预览调试；expert-group → 成员池。
 *  Phase A（SDD 01）：A-02 删除路由规则死配置（路由在画布 Agent选择节点）；A-03 运行异步轮询；
 *  A-08 保存带 expectedRevision；A-10 删除门面控件；A-11 挂载/成员改真选择器；A-16 统一 agentApi。 */
import { ArrowLeft, Bot, Send } from "lucide-react"
import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { resApi } from "@/services/resource-api"
import { agentApi, wfApi, type AgentInfo } from "@/services/wf-api"
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

/** A-11：注册表多选器——候选来自真实资源注册表，存 id，杜绝自由文本假绑定。 */
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

/** 运行历史（05 设计：运行观测）。 */
function RunsHistory({ agentId }: { agentId: string }) {
  const [runs, setRuns] = useState<{ runId: string; status: string; trigger: string; startedAt: string | null }[]>([])
  useEffect(() => {
    agentApi.runs(agentId).then((r) => setRuns(r.items)).catch(() => undefined)
  }, [agentId])
  if (runs.length === 0) return null
  return (
    <div className="space-y-1">
      <div className="text-xs" style={{ color: INK2 }}>运行历史</div>
      {runs.slice(0, 5).map((r) => (
        <div key={r.runId} className="flex items-center gap-2 text-[11px]" style={{ color: INK2 }}>
          <span className="rounded px-1" style={{ background: r.status === "succeeded" ? "#E8F7EE" : "#FDECEC", color: r.status === "succeeded" ? "#188F00" : "#F56C6C" }}>{r.status}</span>
          <span>{r.trigger}</span>
          <span className="flex-1 truncate">{r.startedAt ? r.startedAt.replace("T", " ").slice(0, 16) : "-"}</span>
        </div>
      ))}
    </div>
  )
}

/** A-03：真运行（异步入队 + 轮询终态），渲染工具调用与终答。 */
async function runAgentOnce(agentId: string, query: string): Promise<string> {
  const d = await agentApi.runOnce(agentId, { userQuery: query })
  const steps = d.events
    .filter((e) => e.type === "tool_call" || e.type === "workflow_started" || e.type === "agent_started")
    .map((e) => (e.type === "tool_call" ? `🔧 ${e.payload.name ?? ""}` : `▸ ${e.type}`))
  if (d.status !== "succeeded") return [...steps, `❌ ${d.error?.message ?? d.status}`].join("\n")
  return [...steps, d.output?.content ?? ""].filter(Boolean).join("\n")
}

/* ---------- 自主规划 ---------- */
function AutonomousEditor({ agent, onSaved }: { agent: AgentInfo; onSaved: (a: AgentInfo) => void }) {
  const [cfg, setCfg] = useState(agent.config ?? {})
  const [revision, setRevision] = useState(agent.configRevision ?? 1)
  const [models, setModels] = useState<{ modelKey: string }[]>([])
  const [chat, setChat] = useState<{ role: "user" | "ai"; text: string }[]>([])
  const [q, setQ] = useState("")
  const [running, setRunning] = useState(false)
  const [invalid, setInvalid] = useState<string[]>([])
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
  const sendChat = async () => {
    if (!q.trim() || running) return
    const query = q
    setChat((c) => [...c, { role: "user", text: query }])
    setQ(""); setRunning(true)
    try {
      const text = await runAgentOnce(agent.id, query)
      setChat((c) => [...c, { role: "ai", text }])
    } catch (e) {
      setChat((c) => [...c, { role: "ai", text: `❌ ${(e as Error).message}` }])
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
          <Textarea className="min-h-56 text-xs" value={cfg.rolePrompt ?? ""} onChange={(e) => setCfg({ ...cfg, rolePrompt: e.target.value })} />
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
          {/* A-10：技能是注入提示词的文本，明示非资源绑定 */}
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
          {/* A-11：插件/工作流/知识来自真实注册表（A-10：记忆自由文本已删除，结构化表单见 Phase B） */}
          <RegistryPicker title="插件" ids={cfg.tools ?? []} invalid={invalid}
            onChange={(v) => setCfg({ ...cfg, tools: v })}
            load={() => resApi.registry("tool").then((r) => r.items)} />
          <RegistryPicker title="工作流" ids={cfg.workflows ?? []} invalid={invalid}
            onChange={(v) => setCfg({ ...cfg, workflows: v })}
            load={() => wfApi.list({ pageSize: 100 }).then((r) => r.items)} />
          <RegistryPicker title="知识" ids={cfg.knowledges ?? []} invalid={invalid}
            onChange={(v) => setCfg({ ...cfg, knowledges: v })}
            load={() => resApi.registry("knowledge").then((r) => r.items)} />
          <RunsHistory agentId={agent.id} />
        </div>
        <Button size="sm" className="bg-black text-white hover:bg-neutral-800" onClick={save}>保存</Button>
      </div>
      <div className="flex w-[360px] max-w-[92vw] flex-col border-l bg-white" style={{ borderColor: CARD }}>
        <div className="px-4 py-3 text-[15px] font-semibold" style={{ color: INK }}>预览调试</div>
        <div className="flex-1 space-y-2 overflow-y-auto px-4">
          {chat.map((c, i) => (
            <div key={i} className={`max-w-[85%] rounded-md px-2 py-1 text-xs ${c.role === "user" ? "ml-auto bg-neutral-900 text-white" : "bg-neutral-100"}`}>{c.text}</div>
          ))}
        </div>
        <div className="flex gap-1 p-3">
          <Input className="h-8 text-xs" value={q} onChange={(e) => setQ(e.target.value)} placeholder="说出你的问题吧"
            onKeyDown={(e) => e.key === "Enter" && sendChat()} />
          <Button size="sm" className="h-8" style={{ background: "#3D6BFF" }} disabled={running} onClick={sendChat}>
            <Send className="size-3" />{running ? "运行中" : ""}
          </Button>
        </div>
      </div>
    </div>
  )
}

/* ---------- 编排 Agent 专家组（A-02：路由在画布 Agent选择节点；此处只管成员池） ---------- */
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
      setResult(await runAgentOnce(agent.id, "试运行：请处理该会话"))
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
      <div className="flex items-center gap-2">
        <Button size="sm" className="bg-black text-white hover:bg-neutral-800" onClick={save}>保存</Button>
        <Button size="sm" variant="outline" onClick={() => navigate(`/config/workflows/${agent.workflowId}`)}>打开画布编排</Button>
        <Button size="sm" variant="outline" disabled={running} onClick={trialRun}>{running ? "运行中…" : "试运行"}</Button>
      </div>
      {result && <pre className="whitespace-pre-wrap rounded border p-2 text-[11px]" style={{ borderColor: CARD, color: INK2 }}>{result}</pre>}
      <RunsHistory agentId={agent.id} />
    </div>
  )
}

/* ---------- 路由分发 ---------- */
export default function WfAgentEditorPage() {
  const { agentId = "" } = useParams()
  const navigate = useNavigate()
  const [agent, setAgent] = useState<AgentInfo | null>(null)
  const [legacy, setLegacy] = useState(false)
  useEffect(() => {
    agentApi.get(agentId).then(setAgent).catch((e) => { if (String((e as Error).message).startsWith("404")) setLegacy(true) })
  }, [agentId])
  if (legacy) return <WfDesignerPage workflowId={agentId} />
  if (!agent) return <div className="p-8 text-sm" style={{ color: INK2 }}>加载中…</div>
  if (agent.type === "dialogue") {
    const avatar = avatarFor(agent.id, agent.avatar)
    return <div className="h-[calc(100dvh-3.5rem)] min-h-0"><WfDesignerPage workflowId={agent.workflowId ?? agentId} agentId={agent.id} agentMeta={{ name: agent.name, typeLabel: agent.typeLabel }} avatar={avatar} /></div>
  }
  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b bg-white px-4" style={{ borderColor: CARD }}>
        <button onClick={() => navigate("/config/agents")}><ArrowLeft className="size-4" style={{ color: INK2 }} /></button>
        <span className="flex size-6 items-center justify-center rounded-md bg-[#1F2329]"><Bot className="size-3.5 text-white" /></span>
        <span className="text-[15px] font-semibold" style={{ color: INK }}>{agent.name}</span>
        <span className="rounded px-1.5 py-0.5 text-[11px]" style={{ background: "#FFF4EA", color: "#F97E2B" }}>{agent.typeLabel}</span>
      </div>
      <div className="min-h-0 flex-1">
        {agent.type === "autonomous" && <AutonomousEditor agent={agent} onSaved={setAgent} />}
        {agent.type === "expert-group" && <ExpertGroupEditor agent={agent} onSaved={setAgent} />}
      </div>
    </div>
  )
}
