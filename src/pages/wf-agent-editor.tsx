/** Agent 编辑器路由：三型分发（quickservice 同款）。
 *  dialogue → flow 编辑器 + Agent 配置抽屉；autonomous → 角色表单+挂载+预览调试；expert-group → 成员+路由。 */
import { ArrowLeft, Bot, Send } from "lucide-react"
import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { WF_BASE } from "@/services/wf-api"
import WfDesignerPage from "./wf-designer"
import { AVATARS } from "./wf-agents-list"

interface AgentInfo {
  id: string; name: string; type: string; typeLabel: string; status: string;
  workflowId: string | null; config: Record<string, any>; description: string; avatar?: string | null
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${WF_BASE}${path}`, { headers: { "Content-Type": "application/json" }, ...init })
  if (r.status === 404) throw Object.assign(new Error("not found"), { code: 404 })
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`)
  return r.json() as Promise<T>
}

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

function MountList({ title, items, onChange }: { title: string; items: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="space-y-1">
      <div className="text-xs" style={{ color: INK2 }}>{title}</div>
      {items.map((v, i) => (
        <div key={i} className="flex items-center gap-1 text-xs">
          <span className="flex-1 truncate rounded border px-1 py-0.5" style={{ borderColor: CARD }}>{v}</span>
          <button onClick={() => onChange(items.filter((_, j) => j !== i))}><span className="text-neutral-400">×</span></button>
        </div>
      ))}
      <AddInline onAdd={(v) => onChange([...items, v])} />
    </div>
  )
}

/* ---------- 自主规划 ---------- */
function AutonomousEditor({ agent, onSaved }: { agent: AgentInfo; onSaved: (a: AgentInfo) => void }) {
  const [cfg, setCfg] = useState(agent.config ?? {})
  const [models, setModels] = useState<{ modelKey: string }[]>([])
  const [chat, setChat] = useState<{ role: "user" | "ai"; text: string }[]>([])
  const [q, setQ] = useState("")
  useEffect(() => { api<{ modelKey: string }[]>("/api/registry/models").then(setModels).catch(() => undefined) }, [])
  const save = async () => {
    const r = await api<AgentInfo>(`/api/agents/${agent.id}`, { method: "PUT", body: JSON.stringify({ config: cfg }) })
    toast.success("Agent 配置已保存"); onSaved({ ...agent, config: r.config })
  }
  const sendChat = () => {
    if (!q.trim()) return
    setChat((c) => [...c, { role: "user", text: q }, { role: "ai", text: `[mock:${cfg.modelRef?.modelId || "model"}] 已收到：${q}` }])
    setQ("")
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
          <MountList title="技能" items={cfg.skills ?? []} onChange={(v) => setCfg({ ...cfg, skills: v })} />
          <MountList title="插件" items={cfg.tools ?? []} onChange={(v) => setCfg({ ...cfg, tools: v })} />
          <MountList title="工作流" items={cfg.workflows ?? []} onChange={(v) => setCfg({ ...cfg, workflows: v })} />
          <MountList title="知识" items={cfg.knowledges ?? []} onChange={(v) => setCfg({ ...cfg, knowledges: v })} />
          <MountList title="记忆变量" items={cfg.memories ?? []} onChange={(v) => setCfg({ ...cfg, memories: v })} />
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
          <Button size="sm" className="h-8" style={{ background: "#3D6BFF" }} onClick={sendChat}><Send className="size-3" /></Button>
        </div>
      </div>
    </div>
  )
}

/* ---------- 编排 Agent 专家组 ---------- */
function ExpertGroupEditor({ agent, onSaved }: { agent: AgentInfo; onSaved: (a: AgentInfo) => void }) {
  const [cfg, setCfg] = useState(agent.config ?? {})
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([])
  useEffect(() => { api<{ id: string; name: string }[]>("/api/agents").then((l) => setAgents(l.filter((a) => a.id !== agent.id))).catch(() => undefined) }, [agent.id])
  const save = async () => {
    const r = await api<AgentInfo>(`/api/agents/${agent.id}`, { method: "PUT", body: JSON.stringify({ config: cfg }) })
    toast.success("专家组配置已保存"); onSaved({ ...agent, config: r.config })
  }
  return (
    <div className="space-y-4 overflow-y-auto p-6">
      <div className="text-sm" style={{ color: INK2 }}>Agent 专家组根据人工编排的流程进行协作，适用于稳定且复杂的业务流程</div>
      <MountList title="成员 Agent" items={cfg.members ?? []} onChange={(v) => setCfg({ ...cfg, members: v })} />
      <div className="space-y-1">
        <div className="text-xs" style={{ color: INK2 }}>路由规则（成员 → 条件）</div>
        {(cfg.routing ?? []).map((r: { member: string; when: string }, i: number) => (
          <div key={i} className="flex items-center gap-1 text-xs">
            <span className="w-32 truncate rounded border px-1 py-0.5" style={{ borderColor: CARD }}>{r.member}</span>
            <Input className="h-6 flex-1 text-xs" value={r.when}
              onChange={(e) => setCfg({ ...cfg, routing: (cfg.routing ?? []).map((x: any, j: number) => (j === i ? { ...x, when: e.target.value } : x)) })} placeholder="路由条件" />
            <button onClick={() => setCfg({ ...cfg, routing: (cfg.routing ?? []).filter((_: any, j: number) => j !== i) })}><span className="text-neutral-400">×</span></button>
          </div>
        ))}
        <AddInline placeholder="成员名称" onAdd={(m) => setCfg({ ...cfg, routing: [...(cfg.routing ?? []), { member: m, when: "" }] })} />
      </div>
      <div className="text-[11px]" style={{ color: INK3 }}>可选成员：{agents.map((a) => a.name).join("、") || "—"}</div>
      <Button size="sm" className="bg-black text-white hover:bg-neutral-800" onClick={save}>保存</Button>
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
    api<AgentInfo>(`/api/agents/${agentId}`).then(setAgent).catch((e) => { if (e.code === 404) setLegacy(true) })
  }, [agentId])
  if (legacy) return <WfDesignerPage workflowId={agentId} />
  if (!agent) return <div className="p-8 text-sm" style={{ color: INK2 }}>加载中…</div>
  if (agent.type === "dialogue") {
    const avatar = agent.avatar ?? AVATARS[agent.id.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % 20]
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
