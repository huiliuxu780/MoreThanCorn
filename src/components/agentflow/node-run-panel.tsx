/** AgentFlow 节点执行过程面板（09-11 治理轮 P3，拍板路线 a）：
 *  复用节点 node_run.session_id 走现有 session stream 代理——零新后端接口。
 *  持久化消息整体回放（thinking/文本/工具），节点仍在跑时挂 SSE 续流
 *  （chat-stream reducer 按事件 id 去重），REPLY_END 后回读持久化收尾。 */
import * as React from "react"
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet"
import { Badge } from "@/components/ui/badge"
import { asApi, openRuntimeStream } from "@/services/as-api"

const NODE_STATUS_LABEL: Record<string, string> = {
  succeeded: "已完成", success: "已完成", failed: "失败",
  running: "执行中", pending: "未执行", cancelled: "已终止", stopped: "已终止",
}
import {
  applyStreamEvent,
  initialStreamState,
  maskSecrets,
  type ChatStreamState,
} from "@/services/chat-stream"
import { Markdown } from "@/components/chat/markdown"
import { ThinkingCollapse } from "@/components/chat/deep-thinking"
import { StreamingResponse } from "@/components/beui/agents/streaming-response"
import { ToolResult } from "@/components/beui/agents/tool-result"

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

export interface NodeRunPanelTarget {
  nodeId: string
  agentId: string
  sessionId: string
  status: string
  attempt: number
}

export function NodeRunPanel({
  target,
  onClose,
}: {
  target: NodeRunPanelTarget | null
  onClose: () => void
}) {
  const [messages, setMessages] = React.useState<Record<string, unknown>[]>([])
  const [stream, setStream] = React.useState<ChatStreamState>(initialStreamState)
  const [loadErr, setLoadErr] = React.useState("")

  React.useEffect(() => {
    if (!target) return
    setMessages([])
    setStream(initialStreamState())
    setLoadErr("")
    const ctrl = new AbortController()
    asApi
      .messages(target.agentId, target.sessionId)
      .then((r) => setMessages(r.messages))
      .catch((e) => setLoadErr((e as Error).message))
    if (target.status === "running" || target.status === "pending") {
      asApi
        .streamUrl(target.agentId, target.sessionId)
        .then(({ url }) => {
          if (ctrl.signal.aborted) return
          openRuntimeStream(
            url,
            (ev) => {
              const type = String((ev as Record<string, unknown>).type ?? "")
              setStream((s) => applyStreamEvent(s, ev as Record<string, unknown>))
              if (type === "REPLY_END") {
                asApi
                  .messages(target.agentId, target.sessionId)
                  .then((r) => {
                    setMessages(r.messages)
                    setStream(initialStreamState())
                  })
                  .catch(() => undefined)
              }
            },
            () => undefined,
            ctrl,
          )
        })
        .catch(() => undefined)
    }
    return () => ctrl.abort()
  }, [target])

  const liveThinking = stream.live.filter((b) => b.kind === "thinking")
  const liveText = stream.live.filter((b) => b.kind === "text")

  return (
    <Sheet open={!!target} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-[480px] overflow-y-auto sm:max-w-[480px]">
        <SheetHeader>
          <SheetTitle className="text-sm">
            节点执行过程 · {target?.nodeId ?? ""}
            {target ? `（attempt ${target.attempt}）` : ""}
          </SheetTitle>
        </SheetHeader>
        {!target ? null : (
          <div className="space-y-3 pt-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge variant={target.status === "succeeded" || target.status === "success" ? "secondary" : target.status === "failed" ? "destructive" : "outline"}>
                {NODE_STATUS_LABEL[target.status] ?? target.status}
              </Badge>
              <span className="truncate font-mono text-[10px]">会话 {target.sessionId.slice(0, 12)}…</span>
            </div>
            {loadErr && <p className="text-xs text-destructive">消息加载失败：{loadErr}</p>}
            {messages.length === 0 && !loadErr && stream.live.length === 0 && (
              <p className="py-10 text-center text-xs text-muted-foreground">该节点会话暂无消息</p>
            )}
            {messages.map((m, i) => {
              const role = String(m.role)
              const content = (m.content as Record<string, unknown>[] | undefined) ?? []
              const text = content
                .filter((b) => b && (b as Record<string, unknown>).type === "text")
                .map(blockText)
                .join("")
              const thinkings = content.filter(
                (b) => b && (b as Record<string, unknown>).type === "thinking",
              ) as Record<string, unknown>[]
              const thinkingText = thinkings.map((t) => blockText(t.thinking ?? t)).join("")
              const toolUses = content.filter(
                (b) => b && (b as Record<string, unknown>).type === "tool_call",
              ) as Record<string, unknown>[]
              if (role === "user") {
                return (
                  <div key={String(m.id ?? i)} className="flex justify-end">
                    <div className="max-w-[85%] rounded-md bg-muted px-3 py-2 text-sm">{text}</div>
                  </div>
                )
              }
              return (
                <div key={String(m.id ?? i)} className="space-y-1.5">
                  {thinkingText && (
                    <ThinkingCollapse content={maskSecrets(thinkingText.slice(0, 4000))} defaultOpen={false} />
                  )}
                  {text && (
                    <StreamingResponse status="complete" copyText={text}>
                      <Markdown content={text} />
                    </StreamingResponse>
                  )}
                  {toolUses.map((tu) => (
                    <ToolResult
                      key={`tu-${String(tu.id)}`}
                      tool={<Badge variant="outline">工具</Badge>}
                      title={String(tu.name ?? "")}
                      status="success"
                      defaultOpen={false}
                      maxHeight={280}
                    >
                      <pre className="whitespace-pre-wrap break-words">
                        {maskSecrets(JSON.stringify(tu.input ?? {}).slice(0, 800))}
                      </pre>
                    </ToolResult>
                  ))}
                </div>
              )
            })}
            {liveThinking.map((b) => (
              <ThinkingCollapse key={b.id} loading={!b.finished} content={maskSecrets(b.text.slice(0, 4000))} defaultOpen />
            ))}
            {liveText.map((b) => (
              <StreamingResponse key={b.id} status={b.finished ? "complete" : "streaming"}>
                <Markdown content={b.text} />
              </StreamingResponse>
            ))}
            {stream.tools.map((t) => (
              <ToolResult
                key={t.id}
                tool={<Badge variant="outline">工具</Badge>}
                title={t.name}
                status={t.state === "success" ? "success" : t.state === "error" || t.state === "denied" ? "error" : "running"}
                defaultOpen={false}
                maxHeight={280}
              >
                {t.result && <pre className="whitespace-pre-wrap break-words">{maskSecrets(unwrapJsonString(t.result).slice(0, 1200))}</pre>}
              </ToolResult>
            ))}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
