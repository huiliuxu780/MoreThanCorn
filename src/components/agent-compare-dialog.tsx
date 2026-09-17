/** 09-16 对比弹窗（用户参考图同构 + 二次指认「是对话不是 JSON」修正）。
 *  每栏=独立 chat Session（对话路径，非结构化 run）：左=当前 active prod Release；
 *  右=版本对比（release 绑定）或模型对比（compare=true + modelOverride 闸门）。
 *  对话渲染与 agent-chat 同组件：Message/MessageBubble/StreamingResponse+Markdown。
 *  底部输入+发送双栏并行 turn；轮询 messages+status 直至有 assistant 回复且非 running。 */
import { useEffect, useState } from "react"
import { Copy, RefreshCw, Send } from "lucide-react"
import { toast } from "sonner"

import { Message } from "@/components/beui/agents/message"
import { MessageBubble } from "@/components/beui/agents/message-bubble"
import { StreamingResponse } from "@/components/beui/agents/streaming-response"
import { Markdown } from "@/components/chat/markdown"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { agentApi, wfApi, type AgentInfo } from "@/services/wf-api"
import { asApi } from "@/services/as-api"

interface ReleaseOpt { releaseId: string; environment: string; status: string; canaryPercent: number; versionNo: number | null }
interface Msg { role: string; text: string }
interface PaneState { sessionId?: string; msgs: Msg[]; running: boolean; lastInput?: string }

function textOf(m: Record<string, unknown>): string {
  const blocks = Array.isArray(m.content) ? m.content : []
  return blocks
    .map((b) => (b && typeof b === "object" && (b as { type?: string }).type === "text"
      ? String((b as { text?: string }).text ?? "")
      : ""))
    .join("")
}

function Pane({ title, right, state }: {
  title: string
  right?: React.ReactNode
  state: PaneState
}) {
  const copyText = state.msgs.filter((m) => m.role === "assistant").map((m) => m.text).join("\n\n")
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-lg border bg-(--surface-muted)"
         style={{ borderColor: "var(--border)" }}>
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2"
           style={{ borderColor: "var(--border)" }}>
        <span className="text-[13px] font-semibold">{title}</span>
        {right}
        <Button variant="ghost" size="sm" className="ml-auto h-7 px-2"
          aria-label="复制回复" disabled={!copyText}
          onClick={() => { void navigator.clipboard.writeText(copyText); toast.success("已复制回复") }}>
          <Copy className="size-3.5" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {state.msgs.length === 0 && !state.running && (
          <p className="text-xs text-(--text-tertiary)">底部输入问题后双栏并行对话。</p>
        )}
        {state.msgs.map((m, i) => m.role === "user" ? (
          <Message key={i} from="user">
            <MessageBubble align="end">
              <span className="text-sm">{m.text}</span>
            </MessageBubble>
          </Message>
        ) : (
          <Message key={i} from="assistant">
            <StreamingResponse status="complete" copyText={m.text}>
              <Markdown content={m.text} />
            </StreamingResponse>
          </Message>
        ))}
        {state.running && <p className="text-xs text-(--text-tertiary)">回复中…</p>}
      </div>
    </div>
  )
}

export function AgentCompareDialog({ agent, open, onClose }: {
  agent: AgentInfo
  open: boolean
  onClose: () => void
}) {
  const [mode, setMode] = useState<"version" | "model">("version")
  const [releases, setReleases] = useState<ReleaseOpt[]>([])
  const [models, setModels] = useState<{ modelKey: string }[]>([])
  const [rightVersion, setRightVersion] = useState("")
  const [rightModel, setRightModel] = useState("")
  const [input, setInput] = useState("")
  const [left, setLeft] = useState<PaneState>({ msgs: [], running: false })
  const [right, setRight] = useState<PaneState>({ msgs: [], running: false })

  useEffect(() => {
    if (!open) return
    agentApi.releases(agent.id).then((rs) => setReleases(rs.filter((x) => x.status === "active"))).catch(() => undefined)
    wfApi.models().then(setModels).catch(() => undefined)
  }, [open, agent.id])

  const prodStable = releases.find((r) => r.environment === "prod" && !(r.canaryPercent > 0))

  const runPane = async (
    set: React.Dispatch<React.SetStateAction<PaneState>>,
    opts?: { releaseId?: string; modelOverride?: { model: string } },
    question?: string,
  ) => {
    const q = question ?? ""
    set({ msgs: [{ role: "user", text: q }], running: true })
    try {
      const { session_id } = await asApi.openSession(agent.id, {
        compare: true,
        releaseId: opts?.releaseId,
        modelOverride: opts?.modelOverride,
      })
      set({ sessionId: session_id, msgs: [{ role: "user", text: q }], running: true, lastInput: q })
      await asApi.turn(agent.id, session_id, q)
      const deadline = Date.now() + 90000
      for (;;) {
        await new Promise((r) => setTimeout(r, 900))
        const [mres, sres] = await Promise.all([
          asApi.messages(agent.id, session_id),
          asApi.status(agent.id, session_id).catch(() => null),
        ])
        const msgs = (mres.messages ?? [])
          .map((m) => ({ role: String(m.role ?? ""), text: textOf(m) }))
          .filter((m) => m.text.trim())
        const st = String((sres as { status?: string } | null)?.status ?? "")
        const answered = msgs.some((m) => m.role === "assistant")
        set({ sessionId: session_id, msgs, running: !answered || st === "running", lastInput: q })
        if (answered && st !== "running") return
        if (Date.now() > deadline) { set({ sessionId: session_id, msgs, running: false, lastInput: q }); return }
      }
    } catch (e) {
      toast.error((e as Error).message)
      set((p) => ({ ...p, running: false }))
    }
  }

  const runBoth = async (text: string) => {
    if (!text.trim()) { toast.error("请输入问题"); return }
    if (!prodStable) { toast.error("无 active prod Release：请先发布"); return }
    if (mode === "version" && !rightVersion) { toast.error("请选择对比版本"); return }
    if (mode === "model" && !rightModel) { toast.error("请选择对比模型"); return }
    void runPane(setLeft, undefined, text)
    void runPane(setRight, mode === "version"
      ? { releaseId: rightVersion }
      : { modelOverride: { model: rightModel } }, text)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[82vh] flex-col p-0"
        style={{ width: "min(1280px, 94vw)", maxWidth: "none" }}>
        <DialogHeader className="flex-row items-center gap-3 border-b px-4 py-3"
          style={{ borderColor: "var(--border)" }}>
          <DialogTitle className="text-[15px]">
            {mode === "version" ? "版本对比" : "模型对比"}
          </DialogTitle>
          <div className="flex rounded-md bg-(--surface-muted) p-0.5">
            {(["version", "model"] as const).map((m) => (
              <button key={m} type="button"
                className={`rounded px-2.5 py-1 text-xs font-medium ${mode === m ? "bg-surface shadow-xs" : "text-(--text-tertiary)"}`}
                onClick={() => setMode(m)}>
                {m === "version" ? "版本对比" : "模型对比"}
              </button>
            ))}
          </div>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 gap-4 p-4">
          <Pane title={`当前版本 V${prodStable?.versionNo ?? "—"}`}
            right={<Badge variant="outline">线上</Badge>}
            state={left} />
          <Pane title="对比版本"
            right={mode === "version" ? (
              <Select value={rightVersion || undefined} onValueChange={setRightVersion}>
                <SelectTrigger size="sm" className="w-36"><SelectValue placeholder="选择版本" /></SelectTrigger>
                <SelectContent>
                  {releases.filter((r) => r.releaseId !== prodStable?.releaseId).map((r) => (
                    <SelectItem key={r.releaseId} value={r.releaseId}>
                      {r.environment === "prod" ? "线上灰度" : "沙箱"} V{r.versionNo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Select value={rightModel || undefined} onValueChange={setRightModel}>
                <SelectTrigger size="sm" className="w-36"><SelectValue placeholder="选择模型" /></SelectTrigger>
                <SelectContent>
                  {models.map((m, i) => (
                    <SelectItem key={`${m.modelKey}-${i}`} value={m.modelKey}>{m.modelKey}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            state={right} />
        </div>
        <div className="flex shrink-0 items-center gap-2 border-t px-4 py-3"
             style={{ borderColor: "var(--border)" }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void runBoth(input) }}
            placeholder="请说出您的问题"
            className="h-9 min-w-0 flex-1 rounded-md border bg-transparent px-3 text-[13px] outline-none"
            style={{ borderColor: "var(--border)" }}
          />
          <Button size="sm" variant="outline" className="h-9 w-9 p-0" aria-label="重跑上一次"
            disabled={!left.lastInput}
            onClick={() => void runBoth(left.lastInput ?? input)}>
            <RefreshCw className="size-3.5" />
          </Button>
          <Button size="sm" className="h-9 w-9 p-0" aria-label="发送"
            disabled={left.running || right.running}
            onClick={() => void runBoth(input)}>
            <Send className="size-3.5" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
