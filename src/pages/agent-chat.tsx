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
  Check,
  ChevronDown,
  Copy,
  FolderOpen,
  MoreHorizontal,
  PanelRight,
  Plus,
  RotateCw,
  Send,
  Square,
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
import { Textarea } from "@/components/ui/textarea"
import { agentApi, wfApi, type AgentInfo } from "@/services/wf-api"
import { asApi, openRuntimeStream, type SessionRow } from "@/services/as-api"
import {
  applyStreamEvent,
  initialStreamState,
  maskSecrets,
  type ChatStreamState,
} from "@/services/chat-stream"

const SUBAGENT_TOOLS = new Set(["AgentCreate", "AgentInvite", "TeamCreate", "TeamDelete", "TeamSay"])
const PLATFORM_TOOLS = new Set(["run_workflow", "run_agent_flow"])
function toolBadge(name: string): { label: string; variant: "default" | "secondary" | "outline" } {
  if (name === "Skill") return { label: "Skill", variant: "default" }
  if (name === "search_knowledge") return { label: "Knowledge", variant: "default" }
  if (name.startsWith("mcp__")) return { label: `MCP·${name.split("__")[1] ?? ""}`, variant: "default" }
  if (SUBAGENT_TOOLS.has(name)) return { label: "子Agent", variant: "default" }
  if (PLATFORM_TOOLS.has(name)) return { label: "平台", variant: "secondary" }
  return { label: "Tool", variant: "outline" }
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
  const [autoScroll, setAutoScroll] = React.useState(true)
  const [rightOpen, setRightOpen] = React.useState(true)
  const [sessionTitles, setSessionTitles] = React.useState<Record<string, string>>({})
  const [runtimeView, setRuntimeView] = React.useState<{ published: unknown; running: unknown } | null>(null)
  const [models, setModels] = React.useState<{ modelKey: string }[]>([])
  const [modelOpen, setModelOpen] = React.useState(false)
  const [delTarget, setDelTarget] = React.useState<string | null>(null)
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
                const delay = Math.min(1000 * 2 ** (reconnectRef.current - 1), 8000)
                window.setTimeout(() => {
                  if (ctrl.signal.aborted) return
                  loadMessages(sessionId)
                  attachStreamInner(sessionId, ctrl)
                  reconcileAfterReattach(sessionId)
                }, delay)
              } else {
                streamAliveRef.current = false
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
    if (sid || sessions.length === 0) return
    const chat = sessions.filter((s) => ["chat", "manual"].includes(s.trigger_kind))
    const pick = chat[0] ?? sessions[0]
    if (pick) setParams({ session: pick.session_id }, { replace: true })
  }, [sid, sessions, setParams])

  React.useEffect(() => {
    if (!sid) return
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
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [stream.live, stream.tools, messages, autoScroll])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 48)
  }

  const published = !!runtimeView?.published
  const newSession = async () => {
    if (!published) {
      toast.error("该 Agent 尚未发布生产版本：请先在「发布治理」创建版本并发布到线上，再开始对话")
      return
    }
    try {
      const r = await asApi.openSession(agentId)
      setParams({ session: r.session_id })
      loadSessions()
    } catch (e) {
      toast.error(`创建会话失败：${(e as Error).message}`)
    }
  }

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
        window.setTimeout(() => reconcileAfterReattach(sessionId), 4000)
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
  const sessionTitle = sid ? (sessionTitles[sid] ?? `${currentSession?.trigger_kind ?? "对话任务"}`) : ""
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
              // 原站：无任务时「新建」直接开一个对话任务
              if (!sid) void newSession()
              else setParams({}, { replace: true })
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
                  onClick={() => setParams({ session: s.session_id })}
                >
                  <div className="truncate font-medium">
                    {sessionTitles[s.session_id] ?? s.trigger_kind}
                  </div>
                  <div className="text-muted-foreground">{fmtTime(s.created_at)}</div>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 shrink-0 opacity-0 group-hover:opacity-100"
                      aria-label={`更多操作 ${sessionTitles[s.session_id] ?? s.trigger_kind}`}
                    >
                      <MoreHorizontal className="size-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setParams({ session: s.session_id })}>
                      打开对话任务
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
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-11 shrink-0 items-center gap-2 border-b px-4">
          <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">
            {sessionTitle || agent?.name || "对话"}
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

        <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[720px] space-y-4 px-4 py-4">
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
              if (role === "user") {
                return (
                  <div key={String(m.id ?? i)} className="flex justify-end">
                    <div className="max-w-[80%]">
                      <div className="rounded-md bg-muted px-3 py-2 text-sm">{text}</div>
                      <div className="mt-1 flex items-center justify-end gap-2 text-[11px] text-muted-foreground">
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
                  </div>
                )
              }
              return (
                <div key={String(m.id ?? i)} className="space-y-1">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <img src={avatarFor(agentId, agent?.avatar)} alt="avatar" className="size-5 rounded-full" />
                    <span className="font-medium text-foreground">{agent?.name ?? "Agent"}</span>
                    <span>{fmtTime(String(m.created_at ?? ""))}</span>
                  </div>
                  {[...thinkingById.entries()].map(([id, ttext]) => (
                    <details key={`th-${id}`} className="rounded-md border bg-muted/30 px-2 py-1 text-xs">
                      <summary className="cursor-pointer text-muted-foreground">深度思考</summary>
                      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs">
                        {maskSecrets(ttext.slice(0, 4000))}
                      </pre>
                    </details>
                  ))}
                  {text && <div className="whitespace-pre-wrap break-words text-sm">{text}</div>}
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
                      <div key={`tu-${String(tu.id)}`} className="rounded-md border px-2 py-1.5 text-xs">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={badge.variant}>{badge.label}</Badge>
                          <span className="font-medium">{name}</span>
                          <Badge variant={tr ? "secondary" : "outline"}>{tr ? "已完成" : "无结果块"}</Badge>
                        </div>
                        <details className="mt-1">
                          <summary className="cursor-pointer text-muted-foreground">参数 / 响应</summary>
                          <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words">
                            {maskSecrets(JSON.stringify(tu.input ?? {}).slice(0, 800))}
                          </pre>
                          {tr && (
                            <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words">
                              {maskSecrets(JSON.stringify(tr.output ?? tr.content ?? "").slice(0, 1200))}
                            </pre>
                          )}
                        </details>
                      </div>
                    )
                  })}
                  {so && (
                    <details className="rounded-md border bg-muted/40 px-2 py-1.5 text-xs">
                      <summary className="cursor-pointer font-medium">结构化结果</summary>
                      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words">
                        {maskSecrets(JSON.stringify(so, null, 2))}
                      </pre>
                    </details>
                  )}
                </div>
              )
            })}

            {/* 流式 live 区 */}
            {stream.tools.map((t) => {
              const badge = toolBadge(t.name)
              return (
                <div key={t.id} data-testid="live-tool-card" className="rounded-md border px-2 py-1.5 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                    <span className="font-medium">{t.name}</span>
                    <Badge
                      variant={
                        t.state === "success"
                          ? "secondary"
                          : t.state === "error" || t.state === "denied"
                            ? "destructive"
                            : "outline"
                      }
                    >
                      {t.state === "running" ? "调用中" : t.state === "called" ? "等待结果" : t.state}
                    </Badge>
                  </div>
                  {t.args && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-muted-foreground">参数</summary>
                      <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words">{maskSecrets(t.args.slice(0, 800))}</pre>
                    </details>
                  )}
                  {t.result && (
                    <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words">{maskSecrets(t.result.slice(0, 1200))}</pre>
                  )}
                </div>
              )
            })}
            {stream.live
              .filter(
                // 运行时内部脚手架 hint（system-reminder）不入消息流；执行过程台账仍计数
                (b) => !(b.kind === "hint" && b.text.trimStart().startsWith("<system-reminder")),
              )
              .map((b) =>
              b.kind === "text" ? (
                <div
                  key={b.id}
                  data-testid="live-text"
                  className="whitespace-pre-wrap break-words text-sm"
                >
                  {b.text}
                </div>
              ) : b.kind === "thinking" ? (
                <details key={b.id} open={!b.finished} className="rounded-md border bg-muted/30 px-2 py-1 text-xs">
                  <summary className="cursor-pointer text-muted-foreground">深度思考（流式）</summary>
                  <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words">{maskSecrets(b.text.slice(0, 4000))}</pre>
                </details>
              ) : (
                <div key={b.id} className="rounded-md border px-2 py-1 text-xs text-muted-foreground">
                  {b.kind === "hint" ? "提示：" : b.kind === "data" ? "数据：" : ""}
                  {maskSecrets(b.text.slice(0, 600))}
                </div>
              ),
            )}
            {stream.status === "hitl" && (
              <div className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-xs dark:bg-amber-950">
                <p className="font-medium">
                  {stream.statusDetail}
                  {stream.statusDetail === "等待用户确认工具调用"
                    ? `（HITL：${stream.hitlToolCalls.length} 个工具调用等待确认）`
                    : "（HITL）"}
                </p>
                <ul className="mt-1 space-y-0.5 text-muted-foreground">
                  {stream.hitlToolCalls.slice(0, 5).map((t, i) => (
                    <li key={i}>
                      {String((t as Record<string, unknown>).name ?? `tool-${i}`)}
                    </li>
                  ))}
                </ul>
                {stream.statusDetail === "等待用户确认工具调用" && (
                  <div className="mt-2 flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => {
                        if (!sid) return
                        asApi.confirm(agentId, sid, true)
                          .then(() => {
                            statusRef.current = "running"
                            lastEventRef.current = Date.now()
                            setStream((s) => ({ ...s, status: "running", statusDetail: "" }))
                          })
                          .catch((e) => toast.error(`确认失败：${(e as Error).message}`))
                      }}
                    >
                      批准执行
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        if (!sid) return
                        asApi.confirm(agentId, sid, false)
                          .then(() => {
                            statusRef.current = "running"
                            lastEventRef.current = Date.now()
                            setStream((s) => ({ ...s, status: "running", statusDetail: "" }))
                          })
                          .catch((e) => toast.error(`拒绝失败：${(e as Error).message}`))
                      }}
                    >
                      拒绝
                    </Button>
                  </div>
                )}
              </div>
            )}
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
          <div className="mx-auto max-w-[720px] rounded-lg border bg-surface p-2">
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
            <Textarea
              rows={2}
              className="border-0 shadow-none focus-visible:ring-0"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="输入消息，@ 选择当前工作区上下文"
              disabled={!published}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  void sendText(draft)
                }
              }}
            />
            <div className="flex items-center gap-1 px-1 pb-1">
              <Button
                variant="ghost"
                size="sm"
                disabled={!published}
                title="选择工作目录"
                aria-label="选择工作目录"
                onClick={() => toast.info("工作目录：AgentScope Workspace（当前会话工作区）")}
              >
                <FolderOpen className="size-3.5" /> 选择工作目录
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                disabled={!published}
                title="添加文件或图片"
                aria-label="添加文件或图片"
                onClick={() => toast.info("附件上传待接入（当前不伪造入口）")}
              >
                <Plus className="size-4" />
              </Button>
              <DropdownMenu open={modelOpen} onOpenChange={setModelOpen}>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-1" disabled={!published} aria-label="选择模型">
                    {String(
                      (agent?.config?.modelRef as Record<string, unknown> | undefined)?.modelId ??
                        (agent?.config?.modelRef as Record<string, unknown> | undefined)?.model ??
                        "Auto",
                    )}
                    <ChevronDown className="size-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="top" className="max-h-72 overflow-y-auto">
                  {models.length === 0 && (
                    <DropdownMenuItem disabled>无可用模型</DropdownMenuItem>
                  )}
                  {models.map((m) => (
                    <DropdownMenuItem key={m.modelKey} onSelect={() => setModelOpen(false)}>
                      {m.modelKey}
                      {m.modelKey ===
                        ((agent?.config?.modelRef as Record<string, unknown> | undefined)?.modelId as string) && (
                        <Check className="ml-auto size-3.5" />
                      )}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuItem className="text-xs text-muted-foreground" disabled>
                    模型绑定来自已发布版本快照（发布治理中修改）
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <label className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
                自动滚动
              </label>
              {stream.status === "running" ? (
                <Button variant="outline" size="icon" onClick={() => void interrupt()} aria-label="停止">
                  <Square className="size-4" />
                </Button>
              ) : (
                <Button
                  size="icon"
                  onClick={() => void sendText(draft)}
                  disabled={!draft.trim() || !published}
                  aria-label="发送"
                >
                  <Send className="size-4" />
                </Button>
              )}
            </div>
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

      {/* 右：当前任务 + 产物（240，可 toggle） */}
      {rightOpen && (
        <aside className="hidden w-60 shrink-0 flex-col overflow-y-auto border-l lg:flex">
          <div className="border-b px-3 py-2 text-sm font-semibold">产物</div>
          <div className="space-y-3 p-3 text-xs">
            <section>
              <h3 className="mb-1 font-medium text-muted-foreground">当前任务</h3>
              <p className="truncate font-medium">{sessionTitle || "—"}</p>
              <p className="text-muted-foreground">
                状态：{stream.status}
                {currentSession ? ` · ${fmtTime(currentSession.created_at)}` : ""}
              </p>
              <p className="text-muted-foreground">
                触发：{currentSession?.trigger_kind ?? "—"}
                {currentSession?.automation_id ? "（自动任务）" : ""}
              </p>
            </section>
            <section>
              <h3 className="mb-1 font-medium text-muted-foreground">
                执行过程（{stream.modelCalls.length} 次模型调用 / {stream.tools.length} 个工具）
              </h3>
              {stream.unsupported.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-muted-foreground">
                    未识别事件 {stream.unsupported.length} 条（可观测台账）
                  </summary>
                  <ul className="mt-1 max-h-24 space-y-0.5 overflow-auto text-muted-foreground">
                    {stream.unsupported.map((u, i) => (
                      <li key={i}>{u.type}</li>
                    ))}
                  </ul>
                </details>
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
