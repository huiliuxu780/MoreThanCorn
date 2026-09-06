/** 对话工作区（09-07，原站 /wakers/{id}/profile 同构 MVP）：左会话历史 + 右聊天流 + composer。
 * 度量来源：台账 §6（面板 w240/207、欢迎 24/500、建议卡 r6 h48、composer shell r8 pad 12 12 0、toolbar h44）。
 * 流式：streamRunEvents(runId) 消费 llm_delta；失败降 800ms 轮询消息。
 * 语义=角色对话 MVP：不触发 Module 结构化执行（局限 UI 注明）。 */
import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { ArrowLeft, Paperclip, Send } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { FilePicker } from "@/components/ui/file-picker"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { avatarFor } from "@/lib/agent-avatar"
import { agentApi, streamRunEvents, wfApi, type AgentInfo } from "@/services/wf-api"

interface Session { id: string; title: string; createdAt: string; updatedAt: string }
interface Attachment { id: string; name: string; size: number; mime: string }
interface Message {
  id: string; role: "user" | "assistant"; content: string; attachments: Attachment[];
  modelId: string; runId: string | null; status: string; createdAt: string;
}

const SUGGESTIONS = [
  "介绍一下你的职责与边界",
  "你安装了哪些 Skill 与记忆？",
  "最近一次任务完成了什么？",
]

export default function AgentChatPage() {
  const { agentId = "" } = useParams()
  const navigate = useNavigate()
  const [agent, setAgent] = useState<AgentInfo | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [sid, setSid] = useState("")
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState("")
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [models, setModels] = useState<{ modelKey: string }[]>([])
  const [modelSel, setModelSel] = useState("")
  const [sending, setSending] = useState(false)
  const streamBuf = useRef("")
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    agentApi.get(agentId).then((a) => {
      if (a.archived) { navigate(`/agents/${agentId}/home`, { replace: true }); return }
      setAgent(a)
    }).catch(() => navigate("/agents", { replace: true }))
    wfApi.models().then((m) => {
      const arr = Array.isArray(m) ? m : (m as { items?: { modelKey: string }[] }).items ?? []
      setModels(arr); if (arr[0]) setModelSel(arr[0].modelKey)
    }).catch(() => undefined)
  }, [agentId, navigate])

  const loadMessages = useCallback((sessionId: string) => {
    agentApi.chatMessages(agentId, sessionId).then((r) => setMessages(r.items)).catch(() => setMessages([]))
  }, [agentId])

  useEffect(() => {
    agentApi.chatSessions(agentId).then((r) => {
      setSessions(r.items)
      if (r.items[0]) { setSid(r.items[0].id); loadMessages(r.items[0].id) }
    }).catch(() => setSessions([]))
  }, [agentId, loadMessages])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }) }, [messages])

  const newSession = async () => {
    const s = await agentApi.createChatSession(agentId)
    setSessions((x) => [{ ...s, createdAt: "", updatedAt: "" }, ...x])
    setSid(s.id); setMessages([])
    return s.id
  }

  const send = async (text: string) => {
    const content = text.trim()
    if (!content || sending) return
    setSending(true); setDraft("")
    try {
      const sessionId = sid || await newSession()
      const turn = await agentApi.chatTurn(agentId, sessionId, {
        text: content, modelId: modelSel, attachments: attachments.length ? attachments : undefined,
      })
      setAttachments([])
      setMessages((m) => [
        ...m,
        { id: turn.userMessageId, role: "user", content, attachments: [], modelId: modelSel, runId: null, status: "done", createdAt: new Date().toISOString() },
        { id: turn.assistantMessageId, role: "assistant", content: "", attachments: [], modelId: modelSel, runId: turn.runId, status: "streaming", createdAt: new Date().toISOString() },
      ])
      streamBuf.current = ""
      const applyBuf = () => setMessages((m) => m.map((x) => (x.id === turn.assistantMessageId ? { ...x, content: streamBuf.current } : x)))
      try {
        await streamRunEvents(turn.runId, (ev) => {
          if (ev.type === "llm_delta") { streamBuf.current += String((ev.payload as { delta?: string }).delta ?? ""); applyBuf() }
        }, 120000)
      } catch {
        // 流式失败降级：轮询消息直至 assistant 到终态
        for (let i = 0; i < 150; i++) {
          await new Promise((r) => setTimeout(r, 800))
          const cur = await agentApi.chatMessages(agentId, sessionId).then((r) => r.items).catch(() => null)
          if (cur) {
            const asst = cur.find((x) => x.id === turn.assistantMessageId)
            if (asst && asst.status !== "streaming") { setMessages(cur); break }
          }
        }
      }
      loadMessages(sessionId)
      agentApi.chatSessions(agentId).then((r) => setSessions(r.items)).catch(() => undefined)
    } catch (e) {
      toast.error((e as Error).message)
    } finally { setSending(false) }
  }

  const upload = async (file: File) => {
    try { const a = await agentApi.chatUpload(agentId, file); setAttachments((s) => [...s, a]) }
    catch (e) { toast.error((e as Error).message) }
  }

  return (
    <div className="flex min-h-0 flex-1">
      {/* 左：会话历史（台账 §6：w240 容器 / 历史 w207 pad 20 16） */}
      <aside className="flex w-[240px] shrink-0 flex-col border-r bg-surface px-4 py-5" style={{ borderColor: "var(--border)" }}>
        {agent && (
          <button type="button" className="flex items-center gap-2 pb-4 text-left"
            onClick={() => navigate(`/agents/${agent.id}/home`)}>
            <img src={avatarFor(agent.id, agent.avatar)} alt="" className="size-8 rounded-full object-cover" />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{agent.name}</span>
            <ArrowLeft className="size-3.5 text-(--text-tertiary)" />
          </button>
        )}
        <div className="flex items-center justify-between pb-2">
          <span className="text-xs text-(--text-tertiary)">{sessions.length} 个会话</span>
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs font-medium text-muted-foreground"
            onClick={() => void newSession().catch((e) => toast.error((e as Error).message))}>新建</Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {sessions.length === 0
            ? <p className="py-6 text-[13px] text-(--text-tertiary)">暂无对话记录</p>
            : sessions.map((s) => (
              <button key={s.id} type="button" onClick={() => { setSid(s.id); loadMessages(s.id) }}
                className={`flex h-8 w-full items-center gap-2 rounded px-2 text-[13px] transition-colors ${
                  sid === s.id ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"}`}>
                <span className="min-w-0 flex-1 truncate">{s.title || "新对话"}</span>
                <span className="shrink-0 text-[10px] text-(--text-tertiary)">{s.updatedAt.slice(5, 10)}</span>
              </button>
            ))}
        </div>
      </aside>

      {/* 右：聊天主列 */}
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
          <div className="mx-auto w-full max-w-[800px] space-y-4">
            {messages.length === 0 && agent ? (
              <div className="space-y-5 pt-10 text-center">
                <img src={avatarFor(agent.id, agent.avatar)} alt="" className="mx-auto size-16 rounded-full object-cover" />
                <div className="text-2xl font-medium leading-[38px]">你好，今天我能帮你什么？</div>
                <p className="text-sm text-(--text-tertiary)">
                  我是数字员工「{agent.name}」，{agent.description || "可以回答与我职责相关的问题。"}
                </p>
                <div className="mx-auto flex max-w-[441px] flex-col gap-2 pt-2">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button"
                      className="flex h-12 items-center gap-2 rounded-md border bg-surface px-3 text-left text-[13px] transition-colors hover:border-brand/50"
                      style={{ borderColor: "var(--border)" }}
                      onClick={() => void send(s)}>
                      <Send className="size-3.5 shrink-0 text-(--text-tertiary)" /> {s}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-(--text-tertiary)">对话为角色会话（MVP）：结构化业务执行请到任务看板或配置页发起。</p>
              </div>
            ) : messages.map((m) => (
              <div key={m.id} className={`flex gap-3 ${m.role === "user" ? "justify-end" : ""}`}>
                {m.role === "assistant" && agent && (
                  <img src={avatarFor(agent.id, agent.avatar)} alt="" className="mt-1 size-7 shrink-0 rounded-full object-cover" />
                )}
                <div className={`max-w-[70%] space-y-1 rounded-md px-3 py-2 text-sm leading-6 ${
                  m.role === "user" ? "bg-brand-soft text-foreground" : "bg-(--segment-bg)"}`}>
                  <div className="whitespace-pre-wrap">{m.content}{m.status === "streaming" && !m.content ? "…" : ""}</div>
                  {m.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {m.attachments.map((a) => (
                        <span key={a.id} className="flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground"
                          style={{ borderColor: "var(--border)" }}>
                          <Paperclip className="size-3" /> {a.name}
                        </span>
                      ))}
                    </div>
                  )}
                  {m.status === "failed" && <div className="text-[11px] text-(--status-danger)">该回复生成失败</div>}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* composer（台账 §6：shell r8 pad 12 12 0 / toolbar h44 / root pad 0 32 12） */}
        <div className="shrink-0 px-8 pb-3">
          <div className="mx-auto w-full max-w-[800px] rounded-lg border bg-surface px-3 pt-3" style={{ borderColor: "var(--border)" }}>
            <Textarea value={draft} placeholder="输入消息…" className="min-h-16 border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(draft) } }} />
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-1 pb-2">
                {attachments.map((a) => (
                  <span key={a.id} className="flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground"
                    style={{ borderColor: "var(--border)" }}>
                    <Paperclip className="size-3" /> {a.name}
                    <button type="button" aria-label={`移除 ${a.name}`}
                      onClick={() => setAttachments((s) => s.filter((x) => x.id !== a.id))}>×</button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex h-11 items-center justify-between py-2">
              <div className="flex items-center gap-2">
                <FilePicker ariaLabel="添加附件" onPick={(f) => void upload(f)}>
                  <Paperclip className="size-4" />
                </FilePicker>
                <Select value={modelSel || undefined} onValueChange={setModelSel}>
                  <SelectTrigger className="h-7 w-40 text-xs"><SelectValue placeholder="模型" /></SelectTrigger>
                  <SelectContent>
                    {models.map((m, i) => <SelectItem key={`${m.modelKey}-${i}`} value={m.modelKey}>{m.modelKey}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button size="sm" disabled={sending || !draft.trim()} onClick={() => void send(draft)}>
                <Send className="size-3.5" /> 发送
              </Button>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
