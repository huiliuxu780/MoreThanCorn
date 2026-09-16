/** Group 群聊页（Spec group-capability v1.1 §5.4，台账 §4 逐值）。
 * 四栏：全局侧栏(壳) | 任务面板240 | 聊天列(内容560居中) | 产物面板240。
 * 09-16 统一切片：消息/流式/审批/输入区与单 Agent 聊天同组件同体验——
 * beUI Message/MessageBubble/StreamingResponse/ToolResult/ApprovalCard/PromptInput +
 * chat-stream applyStreamEvent（per-source 流式状态，聚合 SSE envelope 喂入）；
 * 历史消息仍按 session 拉取终态渲染（与流式 live 区拼接，REPLY_END 后回捞归并）。
 * 路由：/conversations/groups/:gid/:sid（sid 带 conv_ 前缀照抄原站）；
 * /groups/:gid → 重定向最新 active 会话（无则开聊）。 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { Copy, FolderOpen, Info, Loader2, Plus, RotateCw, Star, X } from "lucide-react"
import { toast } from "sonner"
import { Markdown } from "@/components/chat/markdown"
import { ThinkingCollapse } from "@/components/chat/deep-thinking"
import { Message } from "@/components/beui/agents/message"
import { MessageBubble } from "@/components/beui/agents/message-bubble"
import { StreamingResponse } from "@/components/beui/agents/streaming-response"
import { ToolResult } from "@/components/beui/agents/tool-result"
import { ApprovalCard } from "@/components/beui/agents/approval-card"
import { PromptInput } from "@/components/beui/agents/prompt-input"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { avatarFor } from "@/lib/agent-avatar"
import { resApi } from "@/services/resource-api"
import {
  applyStreamEvent, initialStreamState, maskSecrets,
  type ChatStreamState,
} from "@/services/chat-stream"
import {
  groupsApi, openGroupStream, asApi,
  type GroupSessionView, type GroupView,
} from "@/services/as-api"
import { GroupAvatarCluster } from "@/features/groups/group-avatar"

interface RawMsg {
  id?: string
  role?: string
  name?: string
  content?: unknown
  created_at?: string
}

function textOf(m: RawMsg): string {
  const blocks = Array.isArray(m.content) ? m.content : []
  return blocks
    .map((b) => (b && typeof b === "object" && (b as { type?: string }).type === "text"
      ? String((b as { text?: string }).text ?? "")
      : ""))
    .join("")
}

interface FlatMsg {
  key: string
  sessionId: string
  agentId: string
  agentName: string
  role: "leader" | "member"
  isUser: boolean
  text: string
  at: number
}

interface SourceMeta { agentId: string; name: string; role: "leader" | "member" }

const fmtTime = (v: string) => (v
  ? new Date(v).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
  : "")

export function GroupRedirect() {
  const { gid = "" } = useParams()
  const nav = useNavigate()
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const r = await groupsApi.sessions(gid)
        const active = r.items.find((s) => s.status === "active")
        const target = active ?? await groupsApi.open(gid)
        if (alive) nav(`/conversations/groups/${gid}/conv_${target.id}`, { replace: true })
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "打开群组失败")
        if (alive) nav("/agents", { replace: true })
      }
    })()
    return () => { alive = false }
  }, [gid, nav])
  return null
}

export default function GroupChatPage() {
  const { gid = "", sid = "" } = useParams()
  const gsid = sid.startsWith("conv_") ? sid.slice(5) : sid
  const nav = useNavigate()
  const [group, setGroup] = useState<GroupView | null>(null)
  const [sessions, setSessions] = useState<GroupSessionView[]>([])
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof groupsApi.sessionDetail>> | null>(null)
  const [msgs, setMsgs] = useState<FlatMsg[]>([])
  const [streams, setStreams] = useState<Record<string, ChatStreamState>>({})
  const [panelTab, setPanelTab] = useState<"tasks" | "settings">("tasks")
  const [panelOpen, setPanelOpen] = useState(true)
  const [draft, setDraft] = useState("")
  // g063：群技能 + 成员协作 SOP
  const [groupSkills, setGroupSkills] = useState<
    { id: string; skillId: string; name: string; description: string }[]>([])
  const [skillDialog, setSkillDialog] = useState(false)
  const [skillCandidates, setSkillCandidates] = useState<{ id: string; name: string }[]>([])
  const [skillPick, setSkillPick] = useState<string[]>([])
  const [sops, setSops] = useState<{
    boundSopId: string | null
    items: { id: string; name: string; revision: number; status: string; content: string }[]
  }>({ boundSopId: null, items: [] })
  const [sopDialog, setSopDialog] = useState(false)
  const [sopName, setSopName] = useState("")
  const [sopContent, setSopContent] = useState("")
  // @ 提及弹层
  const [mention, setMention] = useState<{ open: boolean; query: string }>({ open: false, query: "" })
  const [mentionIdx, setMentionIdx] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const loadStatic = useCallback(() => {
    groupsApi.get(gid).then(setGroup).catch(() => setGroup(null))
    groupsApi.sessions(gid).then((r) => setSessions(r.items)).catch(() => undefined)
    groupsApi.sessionDetail(gid, gsid).then(setDetail).catch(() => setDetail(null))
  }, [gid, gsid])

  const loadGov = useCallback(() => {
    groupsApi.skills(gid).then((r) => setGroupSkills(r.items)).catch(() => undefined)
    groupsApi.sops(gid).then(setSops).catch(() => undefined)
  }, [gid])

  const sourceMeta = useMemo(() => {
    const map: Record<string, SourceMeta> = {}
    detail?.members.forEach((m) => {
      map[m.sessionId] = {
        agentId: m.agentId,
        name: group?.members.find((g) => g.agentId === m.agentId)?.agentName ?? m.agentId,
        role: m.role,
      }
    })
    return map
  }, [detail, group])

  const loadMessages = useCallback(async () => {
    if (!detail) return
    const flat: FlatMsg[] = []
    await Promise.all(detail.members.map(async (m) => {
      try {
        const r = await asApi.messages(m.agentId, m.sessionId)
        for (const raw of r.messages as RawMsg[]) {
          const t = textOf(raw)
          if (!t.trim()) continue
          flat.push({
            key: `${m.sessionId}:${raw.id ?? flat.length}`,
            sessionId: m.sessionId,
            agentId: m.agentId,
            agentName: raw.name || m.agentId,
            role: m.role,
            isUser: raw.role === "user",
            text: t,
            at: raw.created_at ? Date.parse(raw.created_at) : 0,
          })
        }
      } catch {
        /* 单成员失败不拖垮全流 */
      }
    }))
    flat.sort((a, b) => a.at - b.at)
    const el = listRef.current
    const stick = el ? el.scrollHeight - el.scrollTop - el.clientHeight < 120 : true
    setMsgs(flat)
    window.setTimeout(() => {
      const node = listRef.current
      if (node && stick) node.scrollTop = node.scrollHeight
    }, 0)
  }, [detail])

  useEffect(() => { loadStatic() }, [loadStatic])
  useEffect(() => { loadGov() }, [loadGov])
  useEffect(() => { void loadMessages() }, [loadMessages])

  // 聚合 SSE → per-source applyStreamEvent（与单 Agent 聊天同 reducer）；
  // REPLY_END 后回捞该 session 历史并清 live（归并进终态消息）
  useEffect(() => {
    if (!detail) return undefined
    const ctrl = openGroupStream(gid, gsid, (env) => {
      const sessionId = env.source?.sessionId
      if (!sessionId) return
      let ev: Record<string, unknown>
      try {
        ev = JSON.parse(env.payload) as Record<string, unknown>
      } catch {
        return
      }
      setStreams((prev) => {
        const cur = prev[sessionId] ?? initialStreamState()
        const next = applyStreamEvent(cur, ev)
        return { ...prev, [sessionId]: next }
      })
      if (String(ev.type ?? "") === "REPLY_END") {
        window.setTimeout(() => {
          void loadMessages()
          setStreams((prev) => ({
            ...prev,
            [sessionId]: { ...initialStreamState(), seenEventIds: prev[sessionId]?.seenEventIds ?? [] },
          }))
        }, 400)
      }
    })
    return () => ctrl.abort()
  }, [gid, gsid, detail, loadMessages])

  const anyRunning = Object.values(streams).some((s) => s.status === "running")
  const anyThinking = Object.values(streams).some((s) => s.live.some((b) => b.kind === "thinking" && !b.finished))

  const send = async (text: string) => {
    const t = text.trim()
    if (!t) return
    try {
      await groupsApi.turn(gid, gsid, t)
      setDraft("")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "发送失败")
    }
  }

  const confirmHitl = (sessionId: string, ok: boolean) => {
    const meta = sourceMeta[sessionId]
    if (!meta) return
    groupsApi.confirm(gid, gsid, meta.agentId, ok)
      .then(() => setStreams((prev) => ({
        ...prev,
        [sessionId]: { ...prev[sessionId], status: "running", statusDetail: "" },
      })))
      .catch((e) => toast.error(`${ok ? "确认" : "拒绝"}失败：${(e as Error).message}`))
  }

  const mentionCandidates = useMemo(() => {
    const q = mention.query.toLowerCase()
    return (group?.members ?? [])
      .map((m) => ({ id: m.agentId, name: m.agentName, role: m.role }))
      .filter((m) => m.name.toLowerCase().includes(q))
  }, [group, mention.query])

  const onDraftChange = (v: string) => {
    setDraft(v)
    const m = /@([\u4e00-\u9fa5A-Za-z0-9_-]*)$/.exec(v)
    setMention(m ? { open: true, query: m[1] } : { open: false, query: "" })
    setMentionIdx(0)
  }

  const applyMention = (name: string) => {
    setDraft((d) => d.replace(/@([\u4e00-\u9fa5A-Za-z0-9_-]*)$/, `@${name} `))
    setMention({ open: false, query: "" })
  }

  const newSession = async () => {
    try {
      const s = await groupsApi.open(gid)
      nav(`/conversations/groups/${gid}/conv_${s.id}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "新建会话失败")
    }
  }

  const liveEntries = Object.entries(streams).filter(([, s]) =>
    s.live.length > 0 || s.tools.length > 0 || s.status === "hitl"
    || s.status === "failed" || s.status === "interrupted" || s.status === "exceeded")

  return (
    <div className="flex min-h-0 flex-1">
      {/* ---- 任务面板 240（当前任务钮收折） ---- */}
      {panelOpen && (
      <aside className="flex w-60 shrink-0 flex-col border-r border-(--border)">
        <div className="flex items-center gap-2 px-4 pb-3 pt-4">
          <GroupAvatarCluster memberIds={group?.members.map((m) => m.agentId) ?? []} />
          <span className="truncate text-[14px] font-medium">{group?.name ?? "…"}</span>
        </div>
        <div className="mx-4 flex h-9 items-center gap-2.5 rounded-[6px] bg-(--segment-bg) p-1" role="tablist" aria-label="群组导航">
          {(["tasks", "settings"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={panelTab === t}
              onClick={() => setPanelTab(t)}
              className={`h-7 flex-1 rounded-[4px] text-xs font-medium transition-colors ${
                panelTab === t ? "bg-(--segment-active) text-(--text-primary)" : "text-(--text-tertiary)"
              }`}
            >
              {t === "tasks" ? "任务" : "群设置"}
            </button>
          ))}
        </div>
        {panelTab === "tasks" ? (
          <>
            <div className="flex items-center justify-between px-4 pb-2 pt-4">
              <span className="text-xs text-(--text-tertiary)">{sessions.length} 个任务</span>
              <button
                onClick={() => void newSession()}
                className="inline-flex h-5 items-center gap-1 rounded-[4px] px-1.5 text-xs font-medium text-(--text-secondary) hover:bg-(--surface-muted)"
              >
                <Plus size={12} /> 新建
              </button>
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto px-4">
              {sessions.map((s) => (
                <li key={s.id}>
                  <button
                    onClick={() => nav(`/conversations/groups/${gid}/conv_${s.id}`)}
                    className={`flex w-full flex-col gap-0.5 rounded-[6px] py-2.5 pl-1.5 pr-1 text-left transition-colors ${
                      s.id === gsid ? "bg-(--surface-muted)" : "hover:bg-(--surface-muted)"
                    }`}
                  >
                    {s.status === "closed" && (
                      <span className="text-xs text-(--text-tertiary)">已关聊·只读</span>
                    )}
                    <span className="text-[13px] font-medium">{s.title ?? "任务"}</span>
                    <span className="text-xs text-(--text-tertiary)">{fmtTime(s.createdAt ?? "")}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <section className="px-4 pt-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">群成员</span>
                <button
                  disabled
                  title="成员花名册建组时确定；active 会话冻结（ROSTER_FROZEN）"
                  className="inline-flex h-5 items-center gap-1 rounded-[4px] px-1.5 text-xs font-medium text-(--text-tertiary) opacity-60"
                >
                  <Plus size={12} /> 添加
                </button>
              </div>
              <div className="mt-3 flex gap-4">
                {group?.members.map((m) => (
                  <span key={m.agentId} className="flex w-11 flex-col items-center gap-1">
                    <span className="relative">
                      <img src={avatarFor(m.agentId)} alt="" className="h-8 w-8 rounded-full" />
                      {m.role === "leader" && (
                        <span
                          className="absolute -bottom-1 left-0 flex h-[11px] items-center rounded-full border border-(--background) px-1 text-[9px] font-medium leading-none text-(--text-secondary)"
                          style={{ background: "var(--surface-muted)" }}
                        >
                          Leader
                        </span>
                      )}
                    </span>
                    <span className="w-11 truncate text-center text-xs">
                      {group.members.find((x) => x.agentId === m.agentId)?.agentName ?? m.agentId}
                    </span>
                  </span>
                ))}
              </div>
            </section>
            <section className="px-4 pt-5">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1 text-xs font-medium">
                  群技能 <Info size={12} className="text-(--text-tertiary)" />
                </span>
                <button
                  onClick={() => {
                    setSkillPick([])
                    resApi.list("skill", { pageSize: 50 })
                      .then((r: { items?: { id: string; name: string }[] }) => {
                        const mounted = new Set(groupSkills.map((g) => g.skillId))
                        setSkillCandidates((r.items ?? []).filter((x) => !mounted.has(x.id)))
                      })
                      .catch(() => setSkillCandidates([]))
                    setSkillDialog(true)
                  }}
                  className="inline-flex h-5 items-center gap-1 rounded-[4px] px-1.5 text-xs font-medium text-(--text-secondary) hover:bg-(--surface-muted)"
                >
                  <Plus size={12} /> 添加
                </button>
              </div>
              {groupSkills.length === 0 ? (
                <p className="py-1 pt-2 text-xs text-(--text-tertiary)">暂未配置</p>
              ) : (
                <ul className="pt-2">
                  {groupSkills.map((sk) => (
                    <li key={sk.id} className="flex h-7 items-center justify-between gap-2">
                      <span className="truncate text-[13px]">{sk.name}</span>
                      <button
                        aria-label={`卸载 ${sk.name}`}
                        onClick={() => {
                          groupsApi.unmountSkill(gid, sk.skillId)
                            .then(loadGov).catch((e) => toast.error(String(e)))
                        }}
                        className="rounded p-0.5 text-(--text-tertiary) hover:bg-(--surface-muted)"
                      >
                        <X size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="px-4 pt-4">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1 text-xs font-medium">
                  成员协作 SOP <Info size={12} className="text-(--text-tertiary)" />
                </span>
                <button
                  onClick={() => { setSopName(""); setSopContent(""); setSopDialog(true) }}
                  className="inline-flex h-5 items-center gap-1 rounded-[4px] px-1.5 text-xs font-medium text-(--text-secondary) hover:bg-(--surface-muted)"
                >
                  <Plus size={12} /> 添加
                </button>
              </div>
              {sops.items.length === 0 ? (
                <p className="py-1 pt-2 text-xs text-(--text-tertiary)">暂未配置</p>
              ) : (
                <ul className="pt-2">
                  {sops.items.map((sp) => (
                    <li key={sp.id} className="flex h-7 items-center gap-2 text-[13px]">
                      {sp.status === "published" ? (
                        <input
                          type="radio"
                          name="bound-sop"
                          checked={sops.boundSopId === sp.id}
                          onChange={() => groupsApi.bindSop(gid, sp.id)
                            .then(loadGov).catch((e) => toast.error(String(e)))}
                        />
                      ) : (
                        <Star size={13} className="text-(--text-tertiary)" />
                      )}
                      <span className="min-w-0 flex-1 truncate">{sp.name}</span>
                      <span className="shrink-0 rounded px-1 text-[10px] font-medium"
                        style={{
                          background: sp.status === "published"
                            ? "var(--group-primary-bg)" : "var(--surface-muted)",
                          color: sp.status === "published"
                            ? "var(--text-secondary)" : "var(--text-tertiary)",
                        }}
                      >
                        {sp.status === "published" ? `已发布 v${sp.revision}` : "草稿"}
                      </span>
                      {sp.status === "draft" && (
                        <button
                          className="shrink-0 rounded px-1 text-[11px] text-(--text-secondary) hover:bg-(--surface-muted)"
                          onClick={() => groupsApi.publishSop(gid, sp.id)
                            .then(loadGov).catch((e) => toast.error(String(e)))}
                        >
                          发布
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </aside>
      )}

      {/* ---- 聊天列 ---- */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-11 shrink-0 items-center justify-between px-8">
          <span className="text-[14px] font-medium">
            {sessions.find((s) => s.id === gsid)?.title ?? "任务"}
          </span>
          <button
            aria-pressed={panelOpen}
            title={panelOpen ? "收起任务面板" : "展开任务面板"}
            onClick={() => setPanelOpen((v) => !v)}
            className="inline-flex h-[30px] items-center gap-1.5 rounded-[4px] border border-(--border) bg-(--surface-muted) px-3 text-[13px] font-medium"
          >
            <FolderOpen size={13} /> 当前任务
          </button>
        </div>
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[624px] px-8 pb-4 pt-3">
            {/* 历史终态消息（与单 Agent 聊天同组件） */}
            {msgs.map((m) => m.isUser ? (
              <Message key={m.key} from="user" animateIn>
                <div className="flex w-full flex-col items-end gap-1">
                  <MessageBubble align="end">
                    <span className="text-sm">{m.text}</span>
                  </MessageBubble>
                  <div className="flex w-full items-center justify-end gap-2 text-[11px] text-muted-foreground">
                    <span>{fmtTime(new Date(m.at).toISOString())}</span>
                    <button type="button" className="rounded p-0.5 hover:bg-muted" aria-label="复制"
                      onClick={() => void navigator.clipboard.writeText(m.text)}>
                      <Copy className="size-3" />
                    </button>
                    <button type="button" className="rounded p-0.5 hover:bg-muted" aria-label="重试"
                      title="重试＝重新发送该条用户输入"
                      onClick={() => void send(m.text)}>
                      <RotateCw className="size-3" />
                    </button>
                  </div>
                </div>
              </Message>
            ) : (
              <Message key={m.key} from="assistant" animateIn>
                <div className="w-full space-y-1">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <img src={avatarFor(m.agentId)} alt="" className="size-5 rounded-full" />
                    <span className="font-medium text-foreground">
                      {sourceMeta[m.sessionId]?.name ?? m.agentName}
                    </span>
                    {m.role === "leader" && (
                      <span className="rounded-full px-1.5 text-[10px] font-medium"
                        style={{ background: "var(--group-primary-bg)", color: "var(--text-secondary)" }}>
                        Leader
                      </span>
                    )}
                    <span>{fmtTime(new Date(m.at).toISOString())}</span>
                  </div>
                  <div className="pl-7">
                    <StreamingResponse status="complete" copyText={m.text}>
                      <Markdown content={m.text} />
                    </StreamingResponse>
                  </div>
                </div>
              </Message>
            ))}
            {/* per-source 流式 live 区（thinking/文本/工具卡/HITL/终态） */}
            {liveEntries.map(([sessionId, s]) => {
              const meta = sourceMeta[sessionId]
              if (!meta) return null
              const thinkings = s.live.filter((b) => b.kind === "thinking")
              const texts = s.live.filter((b) => b.kind === "text")
              const liveText = texts.map((b) => b.text).join("")
              return (
                <Message key={`live-${sessionId}`} from="assistant" animateIn>
                  <div className="w-full space-y-1">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <img src={avatarFor(meta.agentId)} alt="" className="size-5 rounded-full" />
                      <span className="font-medium text-foreground">{meta.name}</span>
                      {meta.role === "leader" && (
                        <span className="rounded-full px-1.5 text-[10px] font-medium"
                          style={{ background: "var(--group-primary-bg)", color: "var(--text-secondary)" }}>
                          Leader
                        </span>
                      )}
                      <span className="animate-pulse">…</span>
                    </div>
                    <div className="space-y-1 pl-7">
                      {thinkings.map((t) => (
                        <ThinkingCollapse key={t.id} content={maskSecrets(t.text.slice(0, 4000))} defaultOpen={false} />
                      ))}
                      {liveText && (
                        <StreamingResponse status={s.status === "running" ? "streaming" : "complete"} copyText={liveText}>
                          <Markdown content={liveText} />
                        </StreamingResponse>
                      )}
                      {s.tools.map((t) => (
                        <ToolResult
                          key={t.id}
                          tool={<span className="text-xs">{t.name || "tool"}</span>}
                          title={t.name || "tool"}
                          status={t.state === "running" ? "running" : t.state === "success" ? "success" : "error"}
                          defaultOpen={false}
                          maxHeight={280}
                          copyText={maskSecrets(t.result || t.args)}
                        >
                          <pre className="whitespace-pre-wrap break-words">{maskSecrets(t.args.slice(0, 800))}</pre>
                          {t.result && (
                            <pre className="mt-1 whitespace-pre-wrap break-words">{maskSecrets(t.result.slice(0, 1200))}</pre>
                          )}
                        </ToolResult>
                      ))}
                      {s.status === "hitl" && (
                        <ApprovalCard
                          title={s.statusDetail || "等待确认"}
                          description={`${s.hitlToolCalls.length} 个工具调用等待确认：${s.hitlToolCalls
                            .slice(0, 5)
                            .map((t) => String((t as Record<string, unknown>).name ?? "tool"))
                            .join("、")}`}
                          status="pending"
                          approveLabel="批准执行"
                          onApprove={() => confirmHitl(sessionId, true)}
                          onReject={() => confirmHitl(sessionId, false)}
                        />
                      )}
                      {(s.status === "failed" || s.status === "interrupted" || s.status === "exceeded") && (
                        <div className="rounded-md border px-3 py-2 text-xs text-destructive">
                          {s.status === "failed" ? "执行失败" : s.status === "interrupted" ? "已取消" : "超过最大迭代"}
                          {s.statusDetail ? `：${s.statusDetail}` : ""}
                        </div>
                      )}
                    </div>
                  </div>
                </Message>
              )
            })}
          </div>
        </div>
        <footer className="shrink-0 px-8 pb-3">
          <div className="relative mx-auto w-full max-w-[560px]">
            {mention.open && mentionCandidates.length > 0 && (
              <ul
                role="listbox"
                aria-label="提及 Agent"
                className="absolute bottom-full left-0 z-20 mb-1 max-h-48 w-64 overflow-y-auto rounded-[6px] border border-(--border) bg-(--surface-raised) py-1 shadow-md"
              >
                {mentionCandidates.map((c, i) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={i === mentionIdx}
                      onClick={() => applyMention(c.name)}
                      onMouseEnter={() => setMentionIdx(i)}
                      className={`flex h-8 w-full items-center gap-2 px-2 text-left text-[13px] ${
                        i === mentionIdx ? "bg-(--surface-muted)" : ""
                      }`}
                    >
                      <img src={avatarFor(c.id)} alt="" className="h-5 w-5 rounded-full" />
                      <span className="truncate">{c.name}</span>
                      {c.role === "leader" && (
                        <span className="ml-auto shrink-0 text-[10px] text-(--text-tertiary)">Leader</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {(anyRunning) && (
              <div className="mb-1 flex h-9 items-center gap-2 rounded-xl bg-(--status-success-soft) px-3 text-xs">
                <Loader2 className="size-3.5 animate-spin text-(--status-success)" aria-hidden />
                <span className="font-medium text-(--status-success)">
                  {anyThinking ? "深度思考" : "生成中"}
                </span>
                <span className="animate-pulse text-(--status-success)">…</span>
              </div>
            )}
            <PromptInput
              value={draft}
              onValueChange={onDraftChange}
              minRows={2}
              maxRows={6}
              placeholder="输入消息… 输入 @ 提及 Agent，Enter 发送，Shift+Enter 换行"
              loading={anyRunning}
              onStop={() => { void groupsApi.interrupt(gid, gsid, "all") }}
              onSubmit={(v) => void send(v)}
              onKeyDown={(e) => {
                if (mention.open && mentionCandidates.length > 0) {
                  if (e.key === "ArrowDown") {
                    e.preventDefault()
                    setMentionIdx((i) => (i + 1) % mentionCandidates.length)
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault()
                    setMentionIdx((i) => (i - 1 + mentionCandidates.length) % mentionCandidates.length)
                  } else if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault()
                    applyMention(mentionCandidates[mentionIdx].name)
                  } else if (e.key === "Escape") {
                    e.preventDefault()
                    setMention({ open: false, query: "" })
                  }
                }
              }}
              actions={[
                { value: "attach", label: "添加文件或图片", icon: <Plus className="size-3.5" /> },
              ]}
              onAction={() => toast.info("附件上传为规划能力，落地后启用")}
            />
          </div>
        </footer>
      </section>

      {/* ---- 产物面板 240 ---- */}
      <aside className="w-60 shrink-0 border-l border-(--border) px-4 pt-4">
        <h3 className="text-[14px] font-medium">产物</h3>
        <p className="mt-4 text-xs font-medium">共享目录</p>
        <p className="mt-2 text-xs text-(--text-tertiary)">暂无产物</p>
      </aside>

      {/* ---- 群技能挂载弹窗 ---- */}
      <Dialog open={skillDialog} onOpenChange={setSkillDialog}>
        <DialogContent style={{ width: 420, maxWidth: 420, borderRadius: 12 }}>
          <DialogTitle className="text-[14px] font-medium">挂载群技能</DialogTitle>
          <p className="text-xs text-(--text-tertiary)">
            挂载后对新开群会话生效；active 会话立即补挂。成员各自发布冻结的技能不受影响。
          </p>
          <ul className="max-h-64 overflow-y-auto">
            {skillCandidates.map((c) => (
              <li key={c.id}>
                <label className="flex h-9 items-center gap-2 rounded-[6px] px-2 hover:bg-(--surface-muted)">
                  <input
                    type="checkbox"
                    checked={skillPick.includes(c.id)}
                    onChange={(e) => setSkillPick((prev) => (e.target.checked
                      ? [...prev, c.id]
                      : prev.filter((x) => x !== c.id)))}
                  />
                  <span className="truncate text-[13px]">{c.name}</span>
                </label>
              </li>
            ))}
            {skillCandidates.length === 0 && (
              <li className="px-2 py-3 text-center text-xs text-(--text-tertiary)">
                无可挂载技能（均已挂载或技能市场为空）
              </li>
            )}
          </ul>
          <div className="flex justify-end gap-2">
            <Button variant="outline" className="h-8" onClick={() => setSkillDialog(false)}>
              取消
            </Button>
            <Button
              className="h-8 disabled:opacity-50"
              disabled={skillPick.length === 0}
              onClick={() => {
                Promise.all(skillPick.map((id) => groupsApi.mountSkill(gid, id)))
                  .then(() => { setSkillDialog(false); loadGov() })
                  .catch((e) => toast.error(e instanceof Error ? e.message : "挂载失败"))
              }}
            >
              挂载
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ---- 成员协作 SOP 新建弹窗 ---- */}
      <Dialog open={sopDialog} onOpenChange={setSopDialog}>
        <DialogContent style={{ width: 520, maxWidth: 520, borderRadius: 12 }}>
          <DialogTitle className="text-[14px] font-medium">新建成员协作 SOP</DialogTitle>
          <p className="text-xs text-(--text-tertiary)">
            创建为草稿；发布后不可改（修订请新建草稿），绑定后新开群会话注入全员系统上下文。
          </p>
          <input
            value={sopName}
            onChange={(e) => setSopName(e.target.value)}
            placeholder="SOP 名称（1-64 字）"
            className="h-8 w-full rounded-[6px] border border-(--border) px-2 text-[13px] outline-none"
          />
          <textarea
            value={sopContent}
            onChange={(e) => setSopContent(e.target.value)}
            placeholder="协作规则 Markdown：角色分工 / 交接机制 / 审批流程 / 完成标准…"
            className="mt-2 h-40 w-full resize-none rounded-[6px] border border-(--border) p-2 text-[13px] outline-none"
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" className="h-8" onClick={() => setSopDialog(false)}>
              取消
            </Button>
            <Button
              className="h-8 disabled:opacity-50"
              disabled={!sopName.trim()}
              onClick={() => groupsApi.createSop(gid, sopName.trim(), sopContent)
                .then(() => { setSopDialog(false); loadGov() })
                .catch((e) => toast.error(e instanceof Error ? e.message : "创建失败"))}
            >
              创建草稿
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
