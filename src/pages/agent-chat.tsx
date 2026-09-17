// Agent 对话页（2026-09-10 P0-D 重建，QoderWake /conversations 同构三栏）。
//
// 桌面结构（实地观察 research/morethancorn/11-p0-rework-20260910/qoderwake-live-observations.md §2）：
// - 左 240：当前 Agent 的对话任务/自动任务历史（身份+双 tab+任务列表+新建）；
// - 中：任务标题头 + 消息流（居中 ~720）+ composer（输入/附件/上下文/模型/发送停止）；
// - 右 240（可 toggle）：当前任务信息 + 产物列表与空态 + 执行过程观测。
//
// 流式（P0-C）：真实 AgentScope SSE 经平台代理；事件聚合在
// services/chat-stream.ts 的纯 reducer（含重连按事件 id 去重、未识别事件台账）。
// 用户消息乐观回显；REPLY_END 后先取持久化消息再同批清 live（不闪空）。
import * as React from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import {
  Copy,
  FolderOpen,
  Info,
  Loader2,
  MoreHorizontal,
  PanelRight,
  Pin,
  PinOff,
  Plus,
  RotateCw,
  SquarePen,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"
import { avatarFor } from "@/lib/agent-avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { PromptInput } from "@/components/beui/agents/prompt-input"
import { AgentActivity } from "@/components/beui/agents/agent-activity"
import type { AgentActivityItem } from "@/components/beui/agents/agent-activity"
import { ApprovalCard } from "@/components/beui/agents/approval-card"
import { Message } from "@/components/beui/agents/message"
import { MessageBubble } from "@/components/beui/agents/message-bubble"
import { agentApi, wfApi, type AgentInfo } from "@/services/wf-api"
import { asApi, openRuntimeStream, type SessionRow } from "@/services/as-api"
import {
  applyStreamEvent,
  initialStreamState,
  maskSecrets,
  type ChatStreamState,
} from "@/services/chat-stream"
import { Markdown } from "@/components/chat/markdown"
import { ThinkingCollapse } from "@/components/chat/deep-thinking"
import {
  ImagesSection,
  RelatedSection,
  type SourceItem,
} from "@/components/chat/answer-sections"
/* beUI 移植基线（09-11 拍板）：思考/回答/工具/来源走 beUI agent 组件 */
import { StreamingResponse } from "@/components/beui/agents/streaming-response"
import { ToolResult } from "@/components/beui/agents/tool-result"
import { AgentProgress } from "@/components/beui/agents/agent-progress"

const SUBAGENT_TOOLS = new Set(["AgentCreate", "AgentInvite", "TeamCreate", "TeamDelete", "TeamSay"])
const PLATFORM_TOOLS = new Set(["run_workflow", "run_agent_flow"])
function toolBadge(name: string): { label: string; variant: "default" | "secondary" | "outline" } {
  if (name === "Skill") return { label: "技能", variant: "default" }
  if (name === "search_knowledge") return { label: "知识", variant: "default" }
  if (name.startsWith("mcp__")) return { label: `MCP·${name.split("__")[1] ?? ""}`, variant: "default" }
  if (SUBAGENT_TOOLS.has(name)) return { label: "子Agent", variant: "default" }
  if (PLATFORM_TOOLS.has(name)) return { label: "平台", variant: "secondary" }
  return { label: "工具", variant: "outline" }
}

/** 09-11：运行时 TOOL_RESULT 文本 delta 为 JSON 字符串封装，展示前解包防双重转义。 */
function unwrapJsonString(s: string): string {
  const t = s.trim()
  if (t.startsWith('"') && t.endsWith('"')) {
    try {
      const v = JSON.parse(t)
      if (typeof v === "string") return v
    } catch {
      /* 保持原文 */
    }
  }
  return s
}

function blockText(b: unknown): string {
  if (typeof b === "string") return b
  if (b && typeof b === "object") {
    const rec = b as Record<string, unknown>
    if (typeof rec.text === "string") return rec.text
    if (typeof rec.delta === "string") return rec.delta
  }
  return ""
}

function pendingToolCalls(messages: Record<string, unknown>[]): Record<string, unknown>[] {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue
    const content = message.content.filter(
      (block): block is Record<string, unknown> => !!block && typeof block === "object",
    )
    const resultIds = new Set(
      content
        .filter((block) => block.type === "tool_result")
        .map((block) => String(block.id ?? block.tool_call_id ?? "")),
    )
    const pending = content.filter(
      (block) => block.type === "tool_call" && !resultIds.has(String(block.id ?? "")),
    )
    if (pending.length > 0) return pending
  }
  return []
}

function persistedTerminalStatus(
  messages: Record<string, unknown>[],
): ChatStreamState["status"] {
  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant")
  if (!lastAssistant) return "completed"
  if (lastAssistant.error) return "failed"
  const reason = String(lastAssistant.finished_reason ?? "completed")
  if (reason === "interrupted") return "interrupted"
  if (reason === "exceed_max_iters") return "exceeded"
  return "completed"
}

const STREAM_STATUS_LABEL: Record<string, string> = {
  idle: "空闲", running: "执行中", completed: "已完成", interrupted: "已取消",
  failed: "执行失败", hitl: "等待确认", exceeded: "超出迭代",
}
const TRIGGER_LABEL: Record<string, string> = {
  chat: "对话", manual: "手动", schedule: "定时", api: "API 触发",
  event: "事件触发", batch: "批量", eval: "评测",
}
const fmtTime = (iso?: string) =>
  iso ? new Date(iso).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""

export default function AgentChatPage() {
  const { agentId = "" } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const sid = params.get("session") ?? ""
  const [agent, setAgent] = React.useState<AgentInfo | null>(null)
  const [sessions, setSessions] = React.useState<SessionRow[]>([])
  const [messages, setMessages] = React.useState<Record<string, unknown>[]>([])
  const [stream, setStream] = React.useState<ChatStreamState>(initialStreamState)
  const [draft, setDraft] = React.useState("")
  const [histTab, setHistTab] = React.useState<"chat" | "auto">("chat")
  // 09-11 bug3：读者感知滚动——贴底时自动跟随流式；上读即停，浮标回最新（移除令人困惑的开关）
  const [atBottom, setAtBottom] = React.useState(true)
  const [rightOpen, setRightOpen] = React.useState(true)
  const [sessionTitles, setSessionTitles] = React.useState<Record<string, string>>({})
  const [runtimeView, setRuntimeView] = React.useState<{ published: unknown; running: unknown } | null>(null)
  const [models, setModels] = React.useState<{ modelKey: string }[]>([])
  const [delTarget, setDelTarget] = React.useState<string | null>(null)
  // 09-16 a：⋯菜单「打开详情 / 重命名」目标
  const [detailTarget, setDetailTarget] = React.useState<SessionRow | null>(null)
  const [renameTarget, setRenameTarget] = React.useState<SessionRow | null>(null)
  const [renameText, setRenameText] = React.useState("")
  const streamRef = React.useRef<AbortController | null>(null)
  const bottomRef = React.useRef<HTMLDivElement>(null)
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const statusRef = React.useRef("idle")
  const reconnectRef = React.useRef(0)
  /** 审计返工 P0-6：SSE 通道存活标记——停止/断线耗尽重试后通道死亡，
   *  下一次 sendText 必须重挂流，否则新一轮回复走在死通道上（UI 永久 running）。 */
  const streamAliveRef = React.useRef(false)
  /** P0-6 看门狗：最近一次 SSE 帧时间 + stream 快照（终态事件丢失时按运行时状态收尾）。 */
  const lastEventRef = React.useRef(Date.now())
  const streamSnapRef = React.useRef(stream)
  streamSnapRef.current = stream
  const mergingRef = React.useRef(false)
  // 09-11 批7：composer 生成状态条（对齐原站 qc-generation-status-bar：模型重新连接/深度思考/生成中）
  const [reconnecting, setReconnecting] = React.useState(false)
  // 09-11：显式「新对话草稿」态——否则自动选中最近会话的 effect 会把新建意图拽回旧会话
  const [draftNew, setDraftNew] = React.useState(false)
  // 09-11 bug1：setParams 走低优先级 transition，setDraftNew(false) 先提交时自动选中 effect
  // 会用旧 sessions 列表抢跑 replace；pending 新会话 id 落定前抑制自动选中。
  const pendingNewRef = React.useRef<string | null>(null)

  const loadSessions = React.useCallback(() => {
    asApi
      .listSessions(agentId)
      .then((r) => setSessions(r.items))
      .catch((e) => toast.error(`会话列表加载失败：${(e as Error).message}`))
  }, [agentId])

  const loadMessages = React.useCallback(
    (sessionId: string) => {
      asApi
        .messages(agentId, sessionId)
        .then((r) => {
          setMessages(r.messages)
          const firstUser = r.messages.find((m) => m.role === "user")
          const t = firstUser
            ? ((firstUser.content as Record<string, unknown>[]) ?? [])
                .filter((b) => (b as Record<string, unknown>).type === "text")
                .map(blockText)
                .join("")
                .slice(0, 24)
            : ""
          if (t) setSessionTitles((prev) => ({ ...prev, [sessionId]: t }))
        })
        .catch((e) => toast.error(`消息加载失败：${(e as Error).message}`))
    },
    [agentId],
  )

  /** REPLY_END 平滑合并：先取持久化消息，再同一批提交清 live（§五.8 不闪空）。 */
  const mergeAfterReplyEnd = React.useCallback(
    (sessionId: string) => {
      if (mergingRef.current) return
      mergingRef.current = true
      asApi
        .messages(agentId, sessionId)
        .then((r) => {
          setMessages(r.messages)
          setStream((s) => ({
            ...initialStreamState(),
            seenEventIds: s.seenEventIds,
            unsupported: s.unsupported,
            status: s.status,
            statusDetail: s.statusDetail,
          }))
          loadSessions()
        })
        .catch(() => undefined)
        .finally(() => {
          mergingRef.current = false
        })
    },
    [agentId, loadSessions],
  )

  /** 审计返工 P0-6：重连/重挂后状态对账——运行时不会重放挂接前已发出的状态事件；
   *  running 恢复运行态；awaiting_* 恢复对应等待态；idle 则先读持久化消息再原子收尾。
   *  未知状态不臆断完成，读取失败也保留 live 现场等待后续重试。 */
  const reconcileAfterReattach = React.useCallback(
    async (sessionId: string) => {
      try {
        const response = await asApi.status(agentId, sessionId)
        const runtimeStatus = String(
          (response as Record<string, unknown>).status ?? "unknown",
        )
        if (runtimeStatus === "running") {
          statusRef.current = "running"
          setStream((prev) =>
            prev.status === "running"
              ? prev
              : { ...prev, status: "running", statusDetail: "" },
          )
          return
        }

        if (
          runtimeStatus === "awaiting_permission" ||
          runtimeStatus === "awaiting_external_result"
        ) {
          const persisted = await asApi.messages(agentId, sessionId)
          setMessages(persisted.messages)
          statusRef.current = "hitl"
          setStream((prev) => ({
            ...prev,
            status: "hitl",
            statusDetail:
              runtimeStatus === "awaiting_permission"
                ? "等待用户确认工具调用"
                : "等待外部执行结果",
            hitlToolCalls: pendingToolCalls(persisted.messages),
          }))
          return
        }

        // AgentScope 的状态是封闭四态；未知新状态不能被臆断成完成。
        if (runtimeStatus !== "idle") return

        // 先成功读回持久化消息，再同批清 live。读取失败时保留现场，避免回复闪空/丢失。
        const persisted = await asApi.messages(agentId, sessionId)
        const terminalStatus = persistedTerminalStatus(persisted.messages)
        setMessages(persisted.messages)
        statusRef.current = terminalStatus
        setStream((prev) =>
          prev.status === "running" || prev.live.length > 0
            ? {
                ...initialStreamState(),
                seenEventIds: prev.seenEventIds,
                unsupported: prev.unsupported,
                status: terminalStatus,
              }
            : prev,
        )
        loadSessions()
      } catch {
        // 对账失败时保持现有 UI；后续流事件、重连或看门狗会再次尝试。
      }
    },
    [agentId, loadSessions],
  )

  const attachStreamInner = React.useCallback(
    (sessionId: string, ctrl: AbortController) => {
      streamAliveRef.current = true
      lastEventRef.current = Date.now()
      asApi
        .streamUrl(agentId, sessionId)
        .then(({ url }) => {
          if (ctrl.signal.aborted) return
          openRuntimeStream(
            url,
            (ev) => {
              lastEventRef.current = Date.now()
              reconnectRef.current = 0
              setReconnecting(false)
              const type = String((ev as Record<string, unknown>).type ?? "")
              setStream((s) => {
                const next = applyStreamEvent(s, ev as Record<string, unknown>)
                if (next.status !== s.status) statusRef.current = next.status
                return next
              })
              if (type === "REPLY_END") mergeAfterReplyEnd(sessionId)
            },
            () => {
              // §五.9：断线重连——reducer 按事件 id 去重；重连前回读持久化消息补齐缺口
              if (ctrl.signal.aborted) return
              if (statusRef.current === "running" && reconnectRef.current < 5) {
                reconnectRef.current += 1
                setReconnecting(true)
                const delay = Math.min(1000 * 2 ** (reconnectRef.current - 1), 8000)
                window.setTimeout(() => {
                  if (ctrl.signal.aborted) return
                  loadMessages(sessionId)
                  attachStreamInner(sessionId, ctrl)
                  reconcileAfterReattach(sessionId)
                }, delay)
              } else {
                streamAliveRef.current = false
                setReconnecting(false)
              }
            },
            ctrl,
          )
        })
        .catch((e) => {
          // 审计返工 P0-6（09-10 二轮）：断线期间 streamUrl 本身会失败；此前直接 toast 终止
          // → 流永久死掉、composer 卡在 running。改为同一退避链继续重试（与 onDone 重连同语义），
          // 重试耗尽或非 running 态才报错。
          if (ctrl.signal.aborted) return
          if (statusRef.current === "running" && reconnectRef.current < 5) {
            reconnectRef.current += 1
            setReconnecting(true)
            const delay = Math.min(1000 * 2 ** (reconnectRef.current - 1), 8000)
            window.setTimeout(() => {
              if (ctrl.signal.aborted) return
              loadMessages(sessionId)
              attachStreamInner(sessionId, ctrl)
              reconcileAfterReattach(sessionId)
            }, delay)
            return
          }
          streamAliveRef.current = false
          setReconnecting(false)
          toast.error(`流连接失败：${(e as Error).message}`)
        })
    },
    [agentId, loadMessages, mergeAfterReplyEnd, reconcileAfterReattach],
  )

  const attachStream = React.useCallback(
    (sessionId: string) => {
      const ctrl = new AbortController()
      streamRef.current?.abort()
      streamRef.current = ctrl
      reconnectRef.current = 0
      setStream(initialStreamState())
      attachStreamInner(sessionId, ctrl)
    },
    [attachStreamInner],
  )

  React.useEffect(() => {
    agentApi
      .get(agentId)
      .then(setAgent)
      .catch((e) => toast.error(`Agent 加载失败：${(e as Error).message}`))
    // 发布态：无 prod Release 时输入区给明确引导，不产生 422 死路
    asApi
      .runtimeView(agentId)
      .then((v) => setRuntimeView({ published: v.published, running: v.running }))
      .catch(() => setRuntimeView(null))
    wfApi
      .models()
      .then((r) => {
        const arr = Array.isArray(r) ? r : (r as { items?: { modelKey: string }[] }).items ?? []
        setModels(arr)
      })
      .catch(() => undefined)
    loadSessions()
  }, [agentId, loadSessions])

  // §六：有历史 Session 时自动选择最近一个对话任务（不给“还没有会话”空主区）
  React.useEffect(() => {
    if (sid) pendingNewRef.current = null
    if (sid || draftNew || pendingNewRef.current || sessions.length === 0) return
    const chat = sessions.filter((s) => ["chat", "manual"].includes(s.trigger_kind))
    const pick = chat[0] ?? sessions[0]
    if (pick) setParams({ session: pick.session_id }, { replace: true })
  }, [sid, draftNew, sessions, setParams])

  React.useEffect(() => {
    if (!sid) {
      setMessages([])
      setStream(initialStreamState())
      statusRef.current = "idle"
      return
    }
    loadMessages(sid)
    attachStream(sid)
    void reconcileAfterReattach(sid)
    return () => streamRef.current?.abort()
  }, [sid, loadMessages, attachStream, reconcileAfterReattach])

  /** 审计返工 P0-6 看门狗：客户端网络停顿可能让终止事件（REPLY_END）永久丢失而连接未断——
   *  UI 卡在 live 残片/running。每 6s：若 UI 仍在 running 或有 live 残片、且 ≥8s 无任何 SSE 帧、
   *  且运行时会话已非 running → 回读持久化消息并把流状态收尾为 completed（文本不重复：
   *  reducer 事件 id 去重 + 持久化整体替换 live）。 */
  React.useEffect(() => {
    if (!sid) return
    const t = window.setInterval(() => {
      const snap = streamSnapRef.current
      if (snap.status !== "running" && snap.live.length === 0) return
      if (Date.now() - lastEventRef.current < 8000) return
      void reconcileAfterReattach(sid)
    }, 6000)
    return () => window.clearInterval(t)
  }, [sid, reconcileAfterReattach])

  React.useEffect(() => {
    if (atBottom) bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [stream.live, stream.tools, messages, atBottom])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 48)
  }

  const published = !!runtimeView?.published
  /** §五.2：乐观回显 + §五.3：POST /turn 只触发不阻塞。无 Session 时先建。 */
  const sendText = async (text: string) => {
    const body = text.trim()
    if (!body) return
    setDraft("")
    let sessionId = sid
    try {
      if (!sessionId) {
        if (!published) {
          toast.error("该 Agent 尚未发布生产版本：请先在「发布治理」发布到线上，再开始对话")
          return
        }
        // 无对话任务时，输入消息自动产生一个新任务（Session）
        const r = await asApi.openSession(agentId)
        sessionId = r.session_id
        pendingNewRef.current = sessionId
        setDraftNew(false)
        setParams({ session: sessionId })
        loadSessions()
      }
      setMessages((m) => [
        ...m,
        {
          id: `optimistic-${Date.now()}`,
          role: "user",
          content: [{ type: "text", text: body }],
          created_at: new Date().toISOString(),
          optimistic: true,
        },
      ])
      lastEventRef.current = Date.now()
      setStream((s) => ({ ...s, status: "running" }))
      statusRef.current = "running"
      await asApi.turn(agentId, sessionId, body)
      // P0-6：上一轮若以停止/断线收尾导致 SSE 通道死亡，发送后必须重挂流（保留 running 态）；
      // 重挂流不重放已发出事件——4s 后做一次状态对账（回合已在死通道期间结束则按持久化收尾）。
      if (!streamAliveRef.current) {
        attachStream(sessionId)
        setStream((s) => ({ ...s, status: "running" }))
        statusRef.current = "running"
        const c = streamRef.current
        const t = window.setTimeout(() => {
          if (!c?.signal.aborted) void reconcileAfterReattach(sessionId)
        }, 4000)
        c?.signal.addEventListener("abort", () => window.clearTimeout(t))
      }
    } catch (e) {
      toast.error(`发送失败：${(e as Error).message}`)
      setStream((s) => ({ ...s, status: "failed", statusDetail: (e as Error).message }))
      statusRef.current = "failed"
    }
  }

  const interrupt = async () => {
    if (!sid) return
    try {
      await asApi.interrupt(agentId, sid)
      toast.success("已请求中断")
    } catch (e) {
      toast.error(`中断失败：${(e as Error).message}`)
    }
  }

  const deleteTask = async (sessionId: string) => {
    try {
      const r = await asApi.deleteSession(agentId, sessionId)
      if (r.runtime_error) toast.warning(`平台索引已删；运行时返回：${r.runtime_error}`)
      else toast.success("对话任务已删除")
      if (sessionId === sid) setParams({}, { replace: true })
      loadSessions()
    } catch (e) {
      toast.error(`删除失败：${(e as Error).message}`)
    } finally {
      setDelTarget(null)
    }
  }

  const copyText = (t: string) => {
    void navigator.clipboard?.writeText(t)
    toast.success("已复制")
  }

  const filteredSessions = sessions.filter((s) =>
    histTab === "chat"
      ? ["chat", "manual"].includes(s.trigger_kind)
      : !["chat", "manual"].includes(s.trigger_kind),
  )
  const currentSession = sessions.find((s) => s.session_id === sid)
  const sessionTitle = sid ? (currentSession?.title ?? sessionTitles[sid] ?? `${TRIGGER_LABEL[currentSession?.trigger_kind ?? ""] ?? currentSession?.trigger_kind ?? "对话任务"}`) : ""
  // 09-11 bug1：执行过程对历史会话恒 0 —— live 流状态之外，从持久化消息推导模型调用/工具/思考计数
  const histStats = React.useMemo(() => {
    let modelCalls = 0
    let tools = 0
    let thinking = 0
    for (const m of messages) {
      if (m.role !== "assistant") continue
      modelCalls += 1
      for (const b of (m.content as Record<string, unknown>[] | undefined) ?? []) {
        if (!b || typeof b !== "object") continue
        const t = (b as Record<string, unknown>).type
        if (t === "tool_call") tools += 1
        if (t === "thinking") thinking += 1
      }
    }
    return { modelCalls, tools, thinking }
  }, [messages])
  const liveActive =
    stream.status === "running" || stream.live.length > 0 || stream.tools.length > 0
  const historyItems = React.useMemo(() => {
    const items: AgentActivityItem[] = []
    let mc = 0
    for (const m of messages) {
      if (m.role !== "assistant") continue
      mc += 1
      items.push({ id: `h-mc-${String(m.id ?? mc)}`, type: "trace", kind: "message", label: `模型调用 #${mc}`, detail: "已完成" })
      for (const b of (m.content as Record<string, unknown>[] | undefined) ?? []) {
        if (!b || typeof b !== "object") continue
        const rec = b as Record<string, unknown>
        if (rec.type === "tool_call") {
          items.push({ id: `h-tl-${String(rec.id ?? items.length)}`, type: "tool", action: "run", target: String(rec.name ?? "tool") })
        } else if (rec.type === "thinking") {
          items.push({ id: `h-th-${String(rec.id ?? items.length)}`, type: "trace", kind: "thinking", label: "深度思考完成" })
        }
      }
    }
    return items
  }, [messages])
  // 09-11 批4：子智能体运行可见——从 AgentCreate/TeamSay 等工具调用的入参/结果派生状态与结果
  const subagentRows = React.useMemo(() => {
    const rows: { id: string; tool: string; target: string; state: string; result: string }[] = []
    const push = (id: string, tool: string, input: unknown, result: string, state: string) => {
      const rec = (input ?? {}) as Record<string, unknown>
      const target = String(
        rec.agent_name ?? rec.name ?? rec.team_name ?? rec.message ?? rec.to ?? tool,
      ).slice(0, 60)
      rows.push({ id, tool, target, state, result })
    }
    for (const m of messages) {
      const content = (m.content as Record<string, unknown>[] | undefined) ?? []
      const results = new Map(
        content
          .filter((b) => b && (b as Record<string, unknown>).type === "tool_result")
          .map((b) => [String((b as Record<string, unknown>).id ?? ""), b as Record<string, unknown>]),
      )
      for (const b of content) {
        if (!b || (b as Record<string, unknown>).type !== "tool_call") continue
        const rec = b as Record<string, unknown>
        const name = String(rec.name ?? "")
        if (!SUBAGENT_TOOLS.has(name)) continue
        const tr = results.get(String(rec.id ?? ""))
        push(
          String(rec.id ?? rows.length),
          name,
          rec.input,
          tr ? maskSecrets(JSON.stringify(tr.output ?? tr.content ?? "").slice(0, 600)) : "",
          tr ? "success" : "running",
        )
      }
    }
    for (const t of stream.tools) {
      if (!SUBAGENT_TOOLS.has(t.name)) continue
      if (rows.some((r) => r.id === t.id)) continue
      rows.push({ id: t.id, tool: t.name, target: t.name, state: t.state, result: maskSecrets(t.result.slice(0, 600)) })
    }
    return rows
  }, [messages, stream.tools])
  const structuredArtifacts = messages.flatMap((m, i) => {
    const so = m.structured_output as Record<string, unknown> | null | undefined
    return so ? [{ index: i, role: String(m.role), so }] : []
  })
  const suggestions = React.useMemo(() => {
    const base = ["介绍你的职责与能做的事", "列出你挂载的 Skill 与工具"]
    if (agent?.description) base.push(agent.description.slice(0, 24))
    return base.slice(0, 3)
  }, [agent])

  return (
    <div className="flex h-dvh min-w-0 flex-1 overflow-hidden">
      {/* 左：对话任务/自动任务历史（240） */}
      <aside className="hidden w-60 shrink-0 flex-col border-r md:flex">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <img src={avatarFor(agentId, agent?.avatar)} alt="avatar" className="size-8 rounded-full" />
          <button
            type="button"
            className="min-w-0 flex-1 truncate text-left text-sm font-semibold hover:underline"
            onClick={() => navigate(`/agents/${agentId}`)}
          >
            {agent?.name ?? "…"}
          </button>
          <Button variant="ghost" size="sm" onClick={() => navigate(`/agents/${agentId}`)}>
            管理
          </Button>
        </div>
        <div className="p-3 pb-0">
          <Tabs value={histTab} onValueChange={(v) => setHistTab(v as "chat" | "auto")}>
            <TabsList className="w-full">
              <TabsTrigger value="chat" className="flex-1">对话任务</TabsTrigger>
              <TabsTrigger value="auto" className="flex-1">自动任务</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <div className="flex items-center justify-between px-3 pt-2 text-xs text-muted-foreground">
          <span>{filteredSessions.length} 个任务</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              // 09-11 批5：自动任务 tab 的「新建」=自动任务新建弹窗，不再误建对话会话
              if (histTab === "auto") {
                navigate("/autonomous-tasks?new=1")
                return
              }
              // 原站：无任务时「新建」直接开一个对话任务；有任务时进入新对话草稿态
              setDraftNew(true)
              setParams({}, { replace: true })
            }}
          >
            <Plus className="size-3" /> 新建
          </Button>
        </div>
        <ul className="mt-1 flex-1 space-y-1 overflow-y-auto px-2 pb-2">
          {filteredSessions.map((s) => (
            <li key={s.session_id}>
              <div
                className={`group flex items-start gap-1 rounded-md px-2 py-1.5 text-xs hover:bg-muted/50 ${
                  s.session_id === sid ? "bg-muted" : ""
                }`}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => {
                    setDraftNew(false)
                    setParams({ session: s.session_id })
                  }}
                >
                  <div className="flex items-center gap-1 truncate font-medium">
                    {s.pinned && <Pin className="size-3 shrink-0 text-(--text-tertiary)" aria-label="已置顶" />}
                    <span className="truncate">
                      {s.title ?? sessionTitles[s.session_id] ?? TRIGGER_LABEL[s.trigger_kind] ?? s.trigger_kind}
                    </span>
                  </div>
                  <div className="text-muted-foreground">{fmtTime(s.created_at)}</div>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                      aria-label={`更多操作 ${s.title ?? sessionTitles[s.session_id] ?? TRIGGER_LABEL[s.trigger_kind] ?? s.trigger_kind}`}
                    >
                      <MoreHorizontal className="size-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  {/* 09-16 a（原站⋯同构+用户指认）：置顶/打开详情/重命名/删除 */}
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onSelect={() => void asApi.pinSession(agentId, s.session_id, !s.pinned)
                        .then(() => loadSessions())
                        .catch((e) => toast.error((e as Error).message))}
                    >
                      {s.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
                      {s.pinned ? "取消置顶" : "置顶"}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setDetailTarget(s)}>
                      <Info className="size-3.5" /> 打开详情
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => {
                        setRenameTarget(s)
                        setRenameText(s.title ?? sessionTitles[s.session_id] ?? "")
                      }}
                    >
                      <SquarePen className="size-3.5" /> 重命名
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive"
                      onSelect={() => setDelTarget(s.session_id)}
                    >
                      <Trash2 className="size-3.5" /> 删除对话任务
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </li>
          ))}
          {!filteredSessions.length && (
            <li className="py-6 text-center text-xs text-muted-foreground">暂无任务</li>
          )}
        </ul>
      </aside>

      {/* 中：消息流 + composer */}
      <main className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex h-11 shrink-0 items-center gap-2 border-b px-4">
          <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">
            {draftNew && !sid ? "新对话" : sessionTitle || agent?.name || "对话"}
          </h1>
          {currentSession?.agentflow_node_run_id && <Badge variant="secondary">AgentFlow 节点</Badge>}
          {currentSession?.automation_id && <Badge variant="outline">自动任务</Badge>}
          {/* 状态点（原站无裸英文态徽章）：圆点 + 中文态；空闲不显示 */}
          {stream.status !== "idle" && (
            <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
              <span
                aria-hidden
                className="size-[6px] rounded-full"
                style={{
                  background:
                    stream.status === "running"
                      ? "var(--status-running)"
                      : stream.status === "completed"
                        ? "var(--status-success)"
                        : stream.status === "hitl"
                          ? "var(--status-warning)"
                          : "var(--status-danger)",
                }}
              />
              {stream.status === "running"
                ? "执行中"
                : stream.status === "completed"
                  ? "已完成"
                  : stream.status === "hitl"
                    ? "等待确认"
                    : stream.status === "interrupted"
                      ? "已取消"
                      : stream.status === "exceeded"
                        ? "超出迭代"
                        : "执行失败"}
            </span>
          )}
          <Button
            variant={rightOpen ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setRightOpen((v) => !v)}
            aria-label="当前任务"
          >
            <PanelRight className="size-4" /> 当前任务
          </Button>
        </header>

        {!atBottom && (
          <button
            type="button"
            className="absolute bottom-40 right-6 z-10 flex items-center gap-1 rounded-full border bg-surface px-3 py-1.5 text-xs shadow-md hover:bg-muted"
            onClick={() => {
              setAtBottom(true)
              bottomRef.current?.scrollIntoView({ behavior: "smooth" })
            }}
          >
            回到最新
          </button>
        )}
        <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex min-h-full max-w-[720px] flex-col justify-end space-y-4 px-4 py-4">
            {messages.length === 0 && stream.live.length === 0 && (
              <div className="space-y-3 rounded-lg border border-dashed p-6 text-center">
                <img src={avatarFor(agentId, agent?.avatar)} alt="avatar" className="mx-auto size-10 rounded-full" />
                <p className="text-sm font-medium">
                  {agent?.name ? `你好，我是 ${agent.name}` : "你好"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {agent?.description || "输入第一条消息开始对话；回复流、工具调用与思考均来自 AgentScope 真实事件。"}
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  {suggestions.map((s) => (
                    <Button key={s} variant="outline" size="sm" onClick={() => void sendText(s)}>
                      {s}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => {
              const role = String(m.role)
              const content = (m.content as Record<string, unknown>[] | undefined) ?? []
              const text = content
                .filter((b) => b && (b as Record<string, unknown>).type === "text")
                .map(blockText)
                .join("")
              const toolUses = content.filter(
                (b) => b && (b as Record<string, unknown>).type === "tool_call",
              ) as Record<string, unknown>[]
              const toolResults = new Map(
                (
                  content.filter(
                    (b) => b && (b as Record<string, unknown>).type === "tool_result",
                  ) as Record<string, unknown>[]
                ).map((b) => [String(b.id ?? ""), b]),
              )
              const thinkings = content.filter(
                (b) => b && (b as Record<string, unknown>).type === "thinking",
              ) as Record<string, unknown>[]
              const thinkingById = new Map<string, string>()
              for (const t of thinkings) {
                const id = String(t.id ?? "default")
                thinkingById.set(id, (thinkingById.get(id) ?? "") + blockText(t.thinking ?? t))
              }
              const err = m.error as Record<string, unknown> | null | undefined
              const so = m.structured_output as Record<string, unknown> | null | undefined
              const fr = String(m.finished_reason ?? "")
              // 分节卡数据源（09-11 P2）：sources=知识检索工具结果；images=image 块；
              // related=结构化结果中的 related_questions（无数据整节不渲染，不伪造）
              const sources: SourceItem[] = toolUses
                .filter((tu) => String(tu.name ?? "") === "search_knowledge")
                .map((tu) => ({ tu, tr: toolResults.get(String(tu.id ?? "")) }))
                .filter((x): x is { tu: Record<string, unknown>; tr: Record<string, unknown> } => !!x.tr)
                .map((x, i) => ({
                  title: String(
                    (x.tu.input as Record<string, unknown> | undefined)?.query ??
                      (x.tu.input as Record<string, unknown> | undefined)?.keyword ??
                      `知识检索 ${i + 1}`,
                  ),
                  content: maskSecrets(JSON.stringify(x.tr.output ?? x.tr.content ?? "").slice(0, 300)),
                }))
              const images = content
                .filter((b) => b && (b as Record<string, unknown>).type === "image")
                .map((b) =>
                  String(
                    (b as Record<string, unknown>).image_url ??
                      (b as Record<string, unknown>).url ??
                      "",
                  ),
                )
                .filter(Boolean)
              const relatedRaw = so?.related_questions
              const related = Array.isArray(relatedRaw) ? relatedRaw.map(String).slice(0, 5) : []
              if (role === "user") {
                return (
                  <Message key={String(m.id ?? i)} from="user" animateIn>
                    <div className="flex w-full flex-col items-end gap-1">
                    <MessageBubble align="end">
                      <span className="text-sm">{text}</span>
                    </MessageBubble>
                    <div className="flex w-full items-center justify-end gap-2 text-[11px] text-muted-foreground">
                      <span>{fmtTime(String(m.created_at ?? ""))}</span>
                      <button type="button" className="rounded p-0.5 hover:bg-muted" aria-label="复制" onClick={() => copyText(text)}>
                        <Copy className="size-3" />
                      </button>
                      <button
                        type="button"
                        className="rounded p-0.5 hover:bg-muted"
                        title="重试＝重新发送该条用户输入"
                        aria-label="重试"
                        onClick={() => void sendText(text)}
                      >
                        <RotateCw className="size-3" />
                      </button>
                    </div>
                    </div>
                  </Message>
                )
              }
              return (
                <Message key={String(m.id ?? i)} from="assistant" animateIn>
                 <div className="w-full space-y-1">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <img src={avatarFor(agentId, agent?.avatar)} alt="avatar" className="size-5 rounded-full" />
                    <span className="font-medium text-foreground">{agent?.name ?? "Agent"}</span>
                    <span>{fmtTime(String(m.created_at ?? ""))}</span>
                  </div>
                  <div className="space-y-1 pl-7">
                  {[...thinkingById.entries()].map(([id, ttext]) => (
                    <ThinkingCollapse
                      key={`th-${id}`}
                      content={maskSecrets(ttext.slice(0, 4000))}
                      defaultOpen={false}
                    />
                  ))}
                  {text && (
                    <StreamingResponse
                      status="complete"
                      copyText={text}
                      sources={
                        sources.length
                          ? sources.map((s, i) => ({ id: `src-${i}`, title: s.title, url: s.url }))
                          : undefined
                      }
                    >
                      <Markdown content={text} />
                    </StreamingResponse>
                  )}
                  {fr && fr !== "completed" && (
                    <p className="text-xs text-muted-foreground">
                      {fr === "interrupted" ? "状态：已取消" : `状态：${fr}`}
                    </p>
                  )}
                  {err && (
                    <p className="text-xs text-destructive">
                      错误（{String(err.type ?? "unknown")}）：{maskSecrets(String(err.message ?? ""))}
                    </p>
                  )}
                  {toolUses.map((tu) => {
                    const tr = toolResults.get(String(tu.id ?? ""))
                    const name = String(tu.name ?? "")
                    const badge = toolBadge(name)
                    return (
                      <ToolResult
                        key={`tu-${String(tu.id)}`}
                        tool={
                          <span className="flex items-center gap-1">
                            {SUBAGENT_TOOLS.has(name) && (
                              <img src={avatarFor(name)} alt="" className="size-4 shrink-0 rounded-full object-cover" />
                            )}
                            <Badge variant={badge.variant}>{badge.label}</Badge>
                          </span>
                        }
                        title={name}
                        status={tr ? "success" : "running"}
                        defaultOpen={false}
                        maxHeight={280}
                        copyText={maskSecrets(JSON.stringify(tu.input ?? {}))}
                      >
                        <pre className="whitespace-pre-wrap break-words">
                          {maskSecrets(JSON.stringify(tu.input ?? {}).slice(0, 800))}
                        </pre>
                        {tr && (
                          <pre className="mt-1 whitespace-pre-wrap break-words">
                            {maskSecrets(unwrapJsonString(JSON.stringify(tr.output ?? tr.content ?? "")).slice(0, 1200))}
                          </pre>
                        )}
                      </ToolResult>
                    )
                  })}
                  <ImagesSection urls={images} />
                  <RelatedSection items={related} onPick={(q) => void sendText(q)} />
                  {so && (
                    <details className="rounded-md border bg-muted/40 px-2 py-1.5 text-xs">
                      <summary className="cursor-pointer font-medium">结构化结果</summary>
                      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words">
                        {maskSecrets(JSON.stringify(so, null, 2))}
                      </pre>
                    </details>
                  )}
                  </div>
                 </div>
                </Message>
              )
            })}

            {/* 流式 live 区（beUI 基线）：AgentActivity=执行过程态 */}
            {(liveActive
              ? stream.modelCalls.length > 0 || stream.tools.length > 0 || stream.live.some((b) => b.kind === "thinking")
              : historyItems.length > 0) && (
              <AgentActivity
                defaultOpen={stream.status === "running"}
                collapseOnComplete={false}
                status={stream.status === "running" ? "working" : "complete"}
                items={(liveActive ? [
                  ...stream.modelCalls.map((m, i): AgentActivityItem => ({
                    id: `mc-${m.id}`,
                    type: "trace",
                    kind: "message",
                    label: `模型调用 #${i + 1}`,
                    detail: m.status === "running" ? "调用中" : "已完成",
                  })),
                  ...stream.tools.map((t): AgentActivityItem => ({
                    id: `tl-${t.id}`,
                    type: "tool",
                    action: "run",
                    target: t.name || "tool",
                  })),
                  ...stream.live
                    .filter((b) => b.kind === "thinking")
                    .map((b): AgentActivityItem => ({
                      id: `th-${b.id}`,
                      type: "trace",
                      kind: "thinking",
                      label: b.finished ? "深度思考完成" : "深度思考中",
                    })),
                ] : historyItems)}
              />
            )}
            {stream.status === "running" && stream.live.length === 0 && stream.tools.length === 0 && (
              <AgentProgress label="执行中" running />
            )}
            {stream.tools.map((t) => {
              const badge = toolBadge(t.name)
              return (
                <ToolResult
                  key={t.id}
                  tool={
                    <span className="flex items-center gap-1">
                      {SUBAGENT_TOOLS.has(t.name) && (
                        <img src={avatarFor(t.name)} alt="" className="size-4 shrink-0 rounded-full object-cover" />
                      )}
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </span>
                  }
                  title={t.name}
                  status={
                    t.state === "success"
                      ? "success"
                      : t.state === "error" || t.state === "denied"
                        ? "error"
                        : t.state === "interrupted"
                          ? "cancelled"
                          : "running"
                  }
                  defaultOpen
                  maxHeight={280}
                >
                  {t.args && (
                    <pre className="whitespace-pre-wrap break-words">{maskSecrets(t.args.slice(0, 800))}</pre>
                  )}
                  {t.result && (
                    <pre className="mt-1 whitespace-pre-wrap break-words">{maskSecrets(unwrapJsonString(t.result).slice(0, 1200))}</pre>
                  )}
                </ToolResult>
              )
            })}
            {stream.live
              .filter(
                // 运行时内部脚手架 hint（system-reminder）不入消息流；执行过程台账仍计数
                (b) => !(b.kind === "hint" && b.text.trimStart().startsWith("<system-reminder")),
              )
              .map((b) =>
              b.kind === "text" ? (
                <div key={b.id} data-testid="live-text" className="text-sm">
                  <StreamingResponse status={b.finished ? "complete" : "streaming"}>
                    <Markdown content={b.text} />
                  </StreamingResponse>
                </div>
              ) : b.kind === "thinking" ? (
                <ThinkingCollapse
                  key={b.id}
                  loading={!b.finished}
                  content={maskSecrets(b.text.slice(0, 4000))}
                  defaultOpen
                />
              ) : (
                <div key={b.id} className="rounded-md border px-2 py-1 text-xs text-muted-foreground">
                  {b.kind === "hint" ? "提示：" : b.kind === "data" ? "数据：" : ""}
                  {maskSecrets(b.text.slice(0, 600))}
                </div>
              ),
            )}
            {stream.status === "hitl" && (() => {
              const isToolConfirm = stream.statusDetail === "等待用户确认工具调用"
              const confirm = (ok: boolean) => {
                if (!sid) return
                asApi
                  .confirm(agentId, sid, ok)
                  .then(() => {
                    statusRef.current = "running"
                    lastEventRef.current = Date.now()
                    setStream((s2) => ({ ...s2, status: "running", statusDetail: "" }))
                  })
                  .catch((e) => toast.error(`${ok ? "确认" : "拒绝"}失败：${(e as Error).message}`))
              }
              return (
                <ApprovalCard
                  title={stream.statusDetail}
                  description={
                    isToolConfirm
                      ? `${stream.hitlToolCalls.length} 个工具调用等待确认：${stream.hitlToolCalls
                          .slice(0, 5)
                          .map((t) => String((t as Record<string, unknown>).name ?? "tool"))
                          .join("、")}`
                      : "等待外部执行结果回填，无需人工批准"
                  }
                  status="pending"
                  approveLabel="批准执行"
                  onApprove={isToolConfirm ? () => confirm(true) : undefined}
                  onReject={isToolConfirm ? () => confirm(false) : undefined}
                />
              )
            })()}
            {(stream.status === "failed" || stream.status === "interrupted" || stream.status === "exceeded") && (
              <div className="rounded-md border px-3 py-2 text-xs text-destructive">
                {stream.status === "failed" ? "执行失败" : stream.status === "interrupted" ? "已取消" : "超过最大迭代"}
                {stream.statusDetail ? `：${stream.statusDetail}` : ""}
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        <footer className="shrink-0 border-t p-3">
          <div className="mx-auto max-w-[720px]">
            {!published && (
              <p className="mb-2 rounded-md border border-amber-400/60 bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                该 Agent 尚未发布生产版本：请先在
                <button
                  type="button"
                  className="px-1 underline"
                  onClick={() => navigate(`/agents/${agentId}/governance`)}
                >
                  发布治理
                </button>
                创建版本并发布到线上，随后即可开始对话。
              </p>
            )}
            {(stream.status === "running" || reconnecting) && (
              <div className="mb-1 flex h-9 items-center gap-2 rounded-xl bg-(--status-success-soft) px-3 text-xs">
                <Loader2 className="size-3.5 animate-spin text-(--status-success)" aria-hidden />
                <span className="font-medium text-(--status-success)">
                  {reconnecting
                    ? "模型重新连接"
                    : stream.live.some((b) => b.kind === "thinking" && !b.finished)
                      ? "深度思考"
                      : "生成中"}
                </span>
                <span className="animate-pulse text-(--status-success)">…</span>
              </div>
            )}
            <PromptInput
              value={draft}
              onValueChange={setDraft}
              minRows={2}
              maxRows={6}
              placeholder="输入消息，@ 选择当前工作区上下文"
              disabled={!published}
              loading={stream.status === "running"}
              onStop={() => void interrupt()}
              onSubmit={(v) => void sendText(v)}
              models={models.map((m) => ({ value: m.modelKey, label: m.modelKey }))}
              model={String(
                (agent?.config?.modelRef as Record<string, unknown> | undefined)?.modelId ??
                  (agent?.config?.modelRef as Record<string, unknown> | undefined)?.model ??
                  "Auto",
              )}
              onModelChange={() => toast.info("模型绑定来自已发布版本快照（发布治理中修改）")}
              actions={[
                { value: "workspace", label: "选择工作目录", icon: <FolderOpen className="size-3.5" /> },
                { value: "attach", label: "添加文件或图片", icon: <Plus className="size-3.5" /> },
              ]}
              onAction={(a) =>
                toast.info(
                  a === "workspace"
                    ? "工作目录：AgentScope Workspace（当前会话工作区）"
                    : "附件上传待接入（当前不伪造入口）",
                )
              }
            />
          </div>
        </footer>
      </main>

      {/* 删除对话任务确认 */}
      <Dialog open={!!delTarget} onOpenChange={(o) => !o && setDelTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除这个对话任务？</DialogTitle>
            <DialogDescription>
              删除后，该对话任务的运行时 Session 与消息将被永久移除，此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDelTarget(null)}>取消</Button>
            <Button
              variant="destructive"
              onClick={() => delTarget && void deleteTask(delTarget)}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 09-16 a：对话任务详情（⋯→打开详情） */}
      <Dialog open={!!detailTarget} onOpenChange={(o) => !o && setDetailTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>对话任务详情</DialogTitle>
            <DialogDescription>
              {detailTarget?.title ?? sessionTitles[detailTarget?.session_id ?? ""] ?? TRIGGER_LABEL[detailTarget?.trigger_kind ?? ""] ?? detailTarget?.trigger_kind}
            </DialogDescription>
          </DialogHeader>
          {detailTarget && (
            <dl className="space-y-2 text-sm">
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-muted-foreground">触发来源</dt>
                <dd>{TRIGGER_LABEL[detailTarget.trigger_kind] ?? detailTarget.trigger_kind}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-muted-foreground">创建时间</dt>
                <dd>{fmtTime(detailTarget.created_at)}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-muted-foreground">置顶</dt>
                <dd>{detailTarget.pinned ? "是" : "否"}</dd>
              </div>
              {detailTarget.automation_id && (
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-muted-foreground">自动任务</dt>
                  <dd className="font-mono text-xs">{detailTarget.automation_id}</dd>
                </div>
              )}
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-muted-foreground">Session</dt>
                <dd className="min-w-0 flex-1 truncate font-mono text-xs" title={detailTarget.session_id}>
                  {detailTarget.session_id}
                </dd>
                <Button variant="ghost" size="sm" className="h-6 px-1.5" aria-label="复制 Session ID"
                  onClick={() => void navigator.clipboard.writeText(detailTarget.session_id)}>
                  <Copy className="size-3" />
                </Button>
              </div>
            </dl>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailTarget(null)}>关闭</Button>
            <Button
              onClick={() => {
                if (!detailTarget) return
                setDraftNew(false)
                setParams({ session: detailTarget.session_id })
                setDetailTarget(null)
              }}
            >
              打开对话
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 09-16 a：对话任务重命名（⋯→重命名） */}
      <Dialog open={!!renameTarget} onOpenChange={(o) => !o && setRenameTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重命名对话任务</DialogTitle>
            <DialogDescription>1-40 字；列表与页头同步展示。</DialogDescription>
          </DialogHeader>
          <Input
            value={renameText}
            maxLength={40}
            autoFocus
            onChange={(e) => setRenameText(e.target.value)}
            placeholder="如：退款话术质检复核"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>取消</Button>
            <Button
              disabled={!renameText.trim()}
              onClick={() => {
                if (!renameTarget) return
                asApi.renameSession(agentId, renameTarget.session_id, renameText.trim())
                  .then(() => { setRenameTarget(null); loadSessions() })
                  .catch((e) => toast.error((e as Error).message))
              }}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 右：当前任务 + 产物（240，可 toggle） */}
      {rightOpen && (
        <aside className="hidden w-60 shrink-0 flex-col overflow-y-auto border-l lg:flex">
          <div className="border-b px-3 py-2 text-sm font-semibold">产物</div>
          <div className="space-y-3 p-3 text-xs">
            <section>
              <h3 className="mb-1 font-medium text-muted-foreground">当前任务</h3>
              <p className="truncate font-medium">{sessionTitle || "—"}</p>
              <p className="text-muted-foreground">
                状态：{STREAM_STATUS_LABEL[stream.status] ?? stream.status}
                {currentSession ? ` · ${fmtTime(currentSession.created_at)}` : ""}
              </p>
              <p className="text-muted-foreground">
                触发：{TRIGGER_LABEL[currentSession?.trigger_kind ?? ""] ?? currentSession?.trigger_kind ?? "—"}
                {currentSession?.automation_id ? "（自动任务）" : ""}
              </p>
            </section>
            <section>
              <h3 className="mb-1 font-medium text-muted-foreground">
                执行过程（{liveActive ? stream.modelCalls.length : histStats.modelCalls} 次模型调用 / {liveActive ? stream.tools.length : histStats.tools} 个工具{histStats.thinking > 0 && !liveActive ? ` / ${histStats.thinking} 段思考` : ""}）
              </h3>
              {stream.unsupported.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-muted-foreground">
                    未识别事件 {stream.unsupported.length} 条（可观测台账）
                  </summary>
                  <ul className="mt-1 max-h-24 space-y-0.5 overflow-auto text-muted-foreground">
                    {stream.unsupported.map((u, i) => (
                      <li key={`${u.type}-${u.at}-${i}`}>{u.type}</li>
                    ))}
                  </ul>
                </details>
              )}
            </section>
            <section>
              <h3 className="mb-1 font-medium text-muted-foreground">子智能体运行（{subagentRows.length}）</h3>
              {subagentRows.length === 0 ? (
                <p className="rounded-md border border-dashed p-3 text-center text-muted-foreground">
                  暂无子智能体活动（AgentCreate/TeamSay 等调用会显示在这里）
                </p>
              ) : (
                <ul className="space-y-1">
                  {subagentRows.map((r) => (
                    <li key={r.id} className="rounded-md border px-2 py-1.5">
                      <div className="flex items-center gap-2 text-xs">
                        <Badge variant="secondary">{r.tool}</Badge>
                        <span className="truncate">{r.target}</span>
                        <span
                          className="ml-auto shrink-0 text-[10px] font-medium"
                          style={{
                            color:
                              r.state === "success"
                                ? "var(--status-success)"
                                : r.state === "error" || r.state === "denied"
                                  ? "var(--status-danger)"
                                  : "var(--status-running)",
                          }}
                        >
                          {r.state === "success" ? "已完成" : r.state === "running" || r.state === "called" ? "执行中" : r.state}
                        </span>
                      </div>
                      {r.result && (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-[11px] text-muted-foreground">查看结果</summary>
                          <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words text-[11px]">{r.result}</pre>
                        </details>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h3 className="mb-1 font-medium text-muted-foreground">产物列表</h3>
              {structuredArtifacts.length === 0 ? (
                <p className="rounded-md border border-dashed p-3 text-center text-muted-foreground">
                  暂无产物（本会话尚无结构化结果）
                </p>
              ) : (
                <ul className="space-y-1">
                  {structuredArtifacts.map((a) => (
                    <li key={a.index}>
                      <details className="rounded-md border px-2 py-1">
                        <summary className="cursor-pointer truncate font-medium">
                          结构化结果 #{a.index + 1}
                        </summary>
                        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words">
                          {maskSecrets(JSON.stringify(a.so, null, 2).slice(0, 2000))}
                        </pre>
                      </details>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </aside>
      )}
    </div>
  )
}
