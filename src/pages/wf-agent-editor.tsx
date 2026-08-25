/** Agent 编辑器路由：三型分发。
 *  dialogue / expert-group → flow 画布（agentMeta 传类型，目录按 editorKinds 收敛）+ 配置抽屉；
 *  autonomous → 四 Tab 壳层（搭建/运行观测/效果评测/版本指标，SDD D-1）。 */
import { ArrowLeft, ChevronDown, Send, Sparkles } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"

import { AgentEvalPanel, AgentEvolutionPanel, AgentRunsPanel, AgentVersionsPanel } from "@/components/agent-ops-panels"
import { ConversationPanel, MemorySchemaForm } from "@/components/agent-common-config"
import { AgentPublishDialog, useAgentVersionState } from "@/components/agent-publish-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { resApi } from "@/services/resource-api"
import { agentApi, lockApi, streamRunEvents, wfApi, type AgentInfo } from "@/services/wf-api"
import { rbac } from "@/services/rbac"
import WfDesignerPage from "./wf-designer"
import { avatarFor, AVATARS } from "./wf-agents-list"

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
              <Checkbox checked={ids.includes(it.id)}
                onCheckedChange={(v) => onChange(v ? [...ids, it.id] : ids.filter((x) => x !== it.id))} />
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
        <Input type="number" min={1} max={20} className="h-6 w-14 text-[11px]"
          value={value.topK ?? 3} onChange={(e) => onChange({ ...value, topK: Number(e.target.value) })} />
        <span className="pl-1">匹配分</span>
        <Input type="number" min={0} max={1} step={0.05} className="h-6 w-16 text-[11px]"
          value={value.scoreThreshold ?? 0.5} onChange={(e) => onChange({ ...value, scoreThreshold: Number(e.target.value) })} />
      </div>
      <div className="flex items-center gap-1 text-[11px]" style={{ color: INK2 }}>
        <span>检索模式</span>
        <Select value={value.mode ?? "HYBRID"} onValueChange={(v) => onChange({ ...value, mode: v })}>
          <SelectTrigger className="h-6 w-24 text-[11px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="HYBRID">混合</SelectItem>
            <SelectItem value="SEMANTIC">语义</SelectItem>
            <SelectItem value="TEXT">全文</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

/* ---------- 流式预览消息 ---------- */
interface ChatMsg { role: "user" | "ai"; text: string; steps: string[]; followUps?: string[]; fallback?: string; done: boolean }

/* ---------- 自主规划搭建页 ---------- */
function AutonomousBuilder({ agent, onSaved }: { agent: AgentInfo; onSaved: (a: AgentInfo) => void }) {
  const [cfg, setCfg] = useState(agent.config ?? {})
  const [name, setName] = useState(agent.name)
  const [description, setDescription] = useState(agent.description ?? "")
  const [avatar, setAvatar] = useState(agent.avatar ?? null)
  const [avatarOpen, setAvatarOpen] = useState(false)
  const [revision, setRevision] = useState(agent.configRevision ?? 1)
  const [models, setModels] = useState<{ modelKey: string }[]>([])
  const [chat, setChat] = useState<ChatMsg[]>([])
  // D-2：模型对比——第二个模型与其独立会话流（会话级配置，不进版本）
  const [compareModel, setCompareModel] = useState<string | null>(null)
  const [chat2, setChat2] = useState<ChatMsg[]>([])
  const [speechOn, setSpeechOn] = useState(false)
  const [q, setQ] = useState("")
  const [running, setRunning] = useState(false)
  const [invalid, setInvalid] = useState<string[]>([])
  const [generating, setGenerating] = useState(false)
  const [advOpen, setAdvOpen] = useState<string | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }) }, [chat])
  useEffect(() => {
    wfApi.models().then((r) => {
      const list = Array.isArray(r) ? r : ((r as unknown as { items?: { modelKey: string }[] }).items ?? [])
      setModels(list)
    }).catch(() => setModels([]))
  }, [])
  useEffect(() => {
    agentApi.mountsHealth(agent.id)
      .then((r) => setInvalid(r.items.filter((i) => !i.valid).map((i) => i.name)))
      .catch(() => undefined)
  }, [agent.id, cfg])
  const save = async () => {
    try {
      // 用户报告修复：基础信息（名称/描述/头像）与配置一并保存
      const r = await agentApi.update(agent.id, { config: cfg, name, description, avatar }, revision)
      setRevision(r.configRevision)
      toast.success("Agent 配置已保存")
      onSaved({ ...agent, config: r.config, configRevision: r.configRevision, name, description, avatar })
    } catch (e) {
      if (String((e as Error).message).startsWith("409")) {
        toast.error("配置已被更新，请刷新后重试")
        agentApi.get(agent.id).then((a) => { setCfg(a.config); setRevision(a.configRevision); setName(a.name); setDescription(a.description ?? ""); onSaved(a) })
      } else toast.error((e as Error).message)
    }
  }
  const sendChat = async (question?: string) => {
    const query = (question ?? q).trim()
    if (!query || running) return
    // D-2：历史轮次——把已有对话整理为 turns 传给后端（按 historyTurns 裁剪）
    const turns: { user: string; ai: string }[] = []
    for (let i = 0; i < chat.length; i++) {
      if (chat[i].role === "user" && chat[i + 1]?.role === "ai") {
        turns.push({ user: chat[i].text, ai: chat[i + 1].text })
      }
    }
    setChat((c) => [...c, { role: "user", text: query, steps: [], done: true },
                     { role: "ai", text: "", steps: [], done: false }])
    if (compareModel) {
      setChat2((c) => [...c, { role: "user", text: query, steps: [], done: true },
                       { role: "ai", text: "", steps: [], done: false }])
    }
    setQ(""); setRunning(true)
    const aiIdx = chat.length + 1
    const patchAi = (patch: Partial<ChatMsg> | ((m: ChatMsg) => Partial<ChatMsg>)) =>
      setChat((c) => c.map((m, i) => (i === aiIdx ? { ...m, ...(typeof patch === "function" ? patch(m) : patch) } : m)))
    const runOne = async (overrideModel: string | null, patch: typeof patchAi) => {
      const { runId } = await agentApi.run(agent.id, {
        userQuery: query, chatHistory: turns,
        ...(overrideModel ? { __modelOverride: overrideModel } : {}),
      })
      await streamRunEvents(runId, (ev) => {
        if (ev.type === "llm_delta") patch((m) => ({ text: m.text + (ev.payload.delta ?? "") }))
        if (ev.type === "tool_call") patch((m) => ({ steps: [...m.steps, `🔧 调用 ${ev.payload.name}`] }))
        if (ev.type === "tool_result") patch((m) => ({ steps: [...m.steps, `↩ ${String(ev.payload.result ?? "").slice(0, 120)}`] }))
        if (ev.type === "agent_mounts_resolved" && (ev.payload.missing ?? []).length > 0)
          patch((m) => ({ steps: [...m.steps, `⚠ 失效挂载：${ev.payload.missing.map((x: any) => x.name).join("、")}`] }))
        if (ev.type === "agent_completed") patch({ done: true, followUps: ev.payload.followUps, fallback: ev.payload.fallback })
        if (ev.type === "agent_failed") patch((m) => ({ done: true, text: m.text || `❌ ${ev.payload.error ?? "运行失败"}` }))
      })
      patch(() => ({ done: true }))
    }
    try {
      const aiIdx2 = chat2.length + 1
      const patchAi2 = (patch: Partial<ChatMsg> | ((m: ChatMsg) => Partial<ChatMsg>)) =>
        setChat2((c) => c.map((m, i) => (i === aiIdx2 ? { ...m, ...(typeof patch === "function" ? patch(m) : patch) } : m)))
      if (compareModel) {
        await Promise.all([runOne(null, patchAi), runOne(compareModel, patchAi2)])
      } else {
        await runOne(null, patchAi)
      }
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
        {/* 用户报告修复：基础信息可编辑（名称/描述/头像） */}
        <div className="space-y-2">
          <Label className="text-xs">基本信息</Label>
          <div className="flex items-start gap-3">
            <div className="flex-1 space-y-2">
              <div className="relative">
                <Input value={name} maxLength={20} placeholder="Agent 名称" className="pr-12" onChange={(e) => setName(e.target.value)} />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px]" style={{ color: INK3 }}>{name.length}/20</span>
              </div>
              <div className="relative">
                <Textarea value={description} maxLength={20000} placeholder="描述介绍（仅在管理平台展示）" className="min-h-16 pb-5 text-xs" onChange={(e) => setDescription(e.target.value)} />
                <span className="absolute bottom-2 right-2 text-[11px]" style={{ color: INK3 }}>{description.length}/20000</span>
              </div>
            </div>
            <button className="shrink-0 overflow-hidden rounded-lg border bg-white p-1" style={{ borderColor: CARD }} title="选择头像" onClick={() => setAvatarOpen(true)}>
              <img src={avatarFor(agent.id, avatar)} alt="agent头像" className="size-20 rounded-md object-cover" />
            </button>
          </div>
          <Dialog open={avatarOpen} onOpenChange={setAvatarOpen}>
            <DialogContent className="max-w-2xl">
              <DialogHeader><DialogTitle>选择头像</DialogTitle></DialogHeader>
              <div className="grid grid-cols-6 gap-3">
                {AVATARS.map((src) => (
                  <button key={src} className={`overflow-hidden rounded-lg ${(avatar ?? avatarFor(agent.id)) === src ? "ring-2 ring-primary" : ""}`}
                    onClick={() => { setAvatar(src); setAvatarOpen(false) }}>
                    <img src={src} alt="" className="size-full object-cover" />
                  </button>
                ))}
              </div>
            </DialogContent>
          </Dialog>
        </div>
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
          <Select value={cfg.modelRef?.modelId || undefined} onValueChange={(v) => setCfg({ ...cfg, modelRef: { ...cfg.modelRef, modelId: v } })}>
            <SelectTrigger className="h-9 w-full text-sm"><SelectValue placeholder="请选择模型" /></SelectTrigger>
            <SelectContent>
              {models.map((m) => <SelectItem key={m.modelKey} value={m.modelKey}>{m.modelKey}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {/* D-2：模型语义参数（多样性→temperature、历史轮次、工具调用辅助模型，后端真消费） */}
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1">
            <Label className="text-[11px]">生成多样性</Label>
            <Select value={cfg.modelRef?.diversity ?? "balanced"} onValueChange={(v) => setCfg({ ...cfg, modelRef: { ...cfg.modelRef, diversity: v } })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="rigorous">严谨</SelectItem>
                <SelectItem value="balanced">平衡</SelectItem>
                <SelectItem value="creative">创意</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">历史轮次</Label>
            <Select value={String(cfg.modelRef?.historyTurns ?? 5)} onValueChange={(v) => setCfg({ ...cfg, modelRef: { ...cfg.modelRef, historyTurns: Number(v) } })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">较少（1）</SelectItem>
                <SelectItem value="5">适中（5）</SelectItem>
                <SelectItem value="15">较多（15）</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">工具调用辅助模型</Label>
            <Select value={cfg.modelRef?.toolCallModelId || undefined} onValueChange={(v) => setCfg({ ...cfg, modelRef: { ...cfg.modelRef, toolCallModelId: v } })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="默认同主模型" /></SelectTrigger>
              <SelectContent>
                {models.map((m) => <SelectItem key={m.modelKey} value={m.modelKey}>{m.modelKey}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
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
          </div>
        </div>
        <Button size="sm" className="bg-black text-white hover:bg-neutral-800" onClick={save}>保存</Button>
      </div>
      <div className={`flex ${compareModel ? "w-[560px]" : "w-[360px]"} max-w-[92vw] flex-col border-l bg-white`} style={{ borderColor: CARD }}>
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <span className="text-[15px] font-semibold" style={{ color: INK }}>预览调试（流式）</span>
          <div className="flex items-center gap-2">
            {/* D-2：模型对比（会话级，不进版本；调研 02 §3 / 07 §2） */}
            <Select value={compareModel ?? undefined} onValueChange={(v) => { setCompareModel(v); setChat2([]) }}>
              <SelectTrigger className="h-7 w-40 text-[11px]"><SelectValue placeholder="添加对比模型" /></SelectTrigger>
              <SelectContent>
                {models.filter((m) => m.modelKey !== cfg.modelRef?.modelId).map((m) => (
                  <SelectItem key={m.modelKey} value={m.modelKey}>{m.modelKey}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {compareModel && <button className="text-[11px]" style={{ color: INK3 }} onClick={() => { setCompareModel(null); setChat2([]) }}>移除对比</button>}
            <button className="text-[11px]" style={{ color: speechOn ? "#3D6BFF" : INK3 }} onClick={() => setSpeechOn(!speechOn)} title="语音播报（浏览器合成）">🔊{speechOn ? "开" : "关"}</button>
            {(chat.length > 0) && <button className="text-[11px]" style={{ color: INK3 }} onClick={() => { setChat([]); setChat2([]) }}>清空</button>}
          </div>
        </div>
        <div className={`grid min-h-0 flex-1 ${compareModel ? "grid-cols-2" : "grid-cols-1"}`}>
          <ChatColumn label={compareModel ? `主模型 ${cfg.modelRef?.modelId ?? ""}` : undefined}
            chat={chat} greeting={greeting} speechOn={speechOn} sendChat={sendChat} chatEndRef={chatEndRef} />
          {compareModel && (
            <div className="border-l" style={{ borderColor: CARD }}>
              <ChatColumn label={`对比 ${compareModel}`} chat={chat2} greeting={greeting} speechOn={false} sendChat={sendChat} />
            </div>
          )}
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

/** D-2：单列会话渲染（主模型与对比模型共用；语音播报仅主列）。 */
function ChatColumn({ label, chat, greeting, speechOn, sendChat, chatEndRef }: {
  label?: string; chat: ChatMsg[]; greeting?: string; speechOn: boolean;
  sendChat: (q?: string) => void; chatEndRef?: React.RefObject<HTMLDivElement | null>
}) {
  const prevDone = useRef(0)
  useEffect(() => {
    if (!speechOn || typeof speechSynthesis === "undefined") return
    const done = chat.filter((c) => c.role === "ai" && c.done && c.text)
    if (done.length > prevDone.current) {
      const newest = done[done.length - 1]
      if (newest.text && !newest.text.startsWith("❌")) {
        try { speechSynthesis.speak(new SpeechSynthesisUtterance(newest.text.slice(0, 500))) } catch { /* 无可用语音引擎时忽略 */ }
      }
    }
    prevDone.current = done.length
  }, [chat, speechOn])
  return (
    <div className="flex min-h-0 flex-col">
      {label && <div className="border-b px-3 py-1.5 text-[11px] font-medium" style={{ borderColor: CARD, color: INK2 }}>{label}</div>}
      <div className="flex-1 space-y-2 overflow-y-auto px-3 py-2">
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
        {chatEndRef && <div ref={chatEndRef} />}
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
  const canPublish = rbac.can("agent.publish")  // D-4：发布门禁（需 Publisher 及以上）
  const [tab, setTab] = useState<"build" | "runs" | "eval" | "versions">("build")
  /* E-2.4：Agent 编辑锁（resourceId=agent:{id}；进入 acquire、离开 release；占用者头部可见；admin 强解锁） */
  const lockWsId = useRef(Math.random().toString(36).slice(2, 8)).current
  const [lockInfo, setLockInfo] = useState<{ user: string; byOther: boolean } | null>(null)
  useEffect(() => {
    if (!agentId) return
    const rid = `agent:${agentId}`
    lockApi.acquire(rid, lockWsId, "质量管理员")
      .then((r) => setLockInfo({ user: r.user ?? "", byOther: !!r.lockedByOther }))
      .catch(() => undefined)
    return () => { lockApi.release(rid, lockWsId).catch(() => undefined) }
  }, [agentId, lockWsId])
  const forceUnlock = async () => {
    await lockApi.forceRelease(`agent:${agentId}`).catch(() => undefined)
    const r = await lockApi.acquire(`agent:${agentId}`, lockWsId, "质量管理员").catch(() => null)
    setLockInfo(r ? { user: r.user ?? "", byOther: !!r.lockedByOther } : null)
    toast.success("已强制解锁")
  }
  /* E-2.3：头部「灰度 N%」徽标（存在进行中的灰度发布时） */
  const [canary, setCanary] = useState<{ env: string; percent: number; releaseId: string } | null>(null)
  useEffect(() => {
    if (!agentId) return
    agentApi.releases(agentId).then((rels) => {
      const c = rels.find((r) => r.status === "active" && r.canaryPercent > 0)
      setCanary(c ? { env: c.environment, percent: c.canaryPercent, releaseId: c.releaseId } : null)
    }).catch(() => undefined)
  }, [agentId])
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
        {canary && (
          <span className="flex items-center gap-1 rounded bg-purple-50 px-1.5 py-0.5 text-[11px] text-purple-600">
            {canary.env === "prod" ? "线上" : "沙箱"} · 灰度 {canary.percent}%
            <button className="underline" onClick={async () => {
              await agentApi.stopCanary(agent.id, canary.releaseId)
              setCanary(null)
              toast.success("已停止灰度，流量回到稳定版本")
            }}>停止</button>
          </span>
        )}
        {lockInfo?.user && (
          <span className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ${lockInfo.byOther ? "bg-amber-50 text-amber-600" : "text-emerald-600"}`}>
            {lockInfo.byOther ? `${lockInfo.user} 编辑中` : "编辑锁持有"}
            {lockInfo.byOther && rbac.can("admin.force-unlock") && (
              <button className="underline" onClick={forceUnlock}>强制解锁</button>
            )}
          </span>
        )}
        <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-lg p-0.5" style={{ background: "#F1F3F7" }}>
          {([["build", "Agent搭建"], ["runs", "运行观测"], ["eval", "效果评测"], ["versions", "版本指标"]] as const).map(([k, label]) => (
            <button key={k} className="rounded-md px-3 py-1 text-[13px]"
              style={tab === k ? { background: "#fff", color: INK, boxShadow: "0 1px 3px rgba(31,35,41,.12)" } : { color: INK2 }}
              onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>
        <div className="ml-auto">
          <Button size="sm" className="h-8 rounded-md bg-black text-white hover:bg-neutral-800"
            disabled={!canPublish} title={canPublish ? "" : "当前角色无发布权限（需 Publisher 及以上）"}
            onClick={() => setPublishOpen(true)}>发布</Button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {tab === "build" && <AutonomousBuilder agent={agent} onSaved={setAgent} />}
        {tab === "runs" && <AgentRunsPanel agentId={agent.id} />}
        {tab === "eval" && <AgentEvalPanel agentId={agent.id} />}
        {tab === "versions" && (
          <div className="grid h-full grid-cols-2 divide-x" style={{ borderColor: CARD }}>
            <AgentVersionsPanel agentId={agent.id} />
            <AgentEvolutionPanel agentId={agent.id} onApplied={() => agentApi.get(agent.id).then(setAgent).catch(() => undefined)} />
          </div>
        )}
      </div>
      <AgentPublishDialog agentId={agent.id} open={publishOpen} onClose={() => setPublishOpen(false)} onPublished={vs.refresh} />
    </div>
  )
}
