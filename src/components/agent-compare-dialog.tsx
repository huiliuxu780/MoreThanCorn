/** 09-16 用户指认「测试 agent 是单独功能；对比=模型对比/版本对比，弹窗左右分栏+底部输入」。
 *  左栏=当前 active prod Release（V#·线上）；右栏=对比目标：
 *  - 版本对比：选另一 active Release 版本（prod 灰度/沙箱）；
 *  - 模型对比：同 Release、右栏模型覆盖（modelOverride，仅 test 触发，后端闸门）。
 *  运行=agentApi.run(trigger="test")，双栏并行轮询 runDetail；输入=文本（输出契约按
 *  Module outputSchema / custom content 契约渲染）。 */
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
import { agentApi, wfApi, type AgentInfo, type AgentVersionInfo } from "@/services/wf-api"

interface ReleaseOpt { releaseId: string; environment: string; status: string; canaryPercent: number; versionNo: number | null }
interface PaneState { running: boolean; runId?: string; text?: string; output?: Record<string, unknown>; status?: string; at?: string }

function Pane({ title, right, state }: {
  title: string
  right?: React.ReactNode
  state: PaneState
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-lg border bg-(--surface-muted)"
         style={{ borderColor: "var(--border)" }}>
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2"
           style={{ borderColor: "var(--border)" }}>
        <span className="text-[13px] font-semibold">{title}</span>
        {right}
        <Button variant="ghost" size="sm" className="ml-auto h-7 px-2"
          aria-label="复制回复"
          disabled={!state.output}
          onClick={() => {
            void navigator.clipboard.writeText(JSON.stringify(state.output ?? {}, null, 2))
            toast.success("已复制回复")
          }}>
          <Copy className="size-3.5" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {state.running ? (
          <p className="text-xs text-(--text-tertiary)">运行中…</p>
        ) : state.text ? (
          /* 09-16 用户指认：对话渲染不手搓，与 agent-chat 同组件（beUI Message/
             MessageBubble/StreamingResponse+Markdown） */
          <div className="space-y-3">
            <Message from="user">
              <MessageBubble align="end">
                <span className="text-sm">{state.text}</span>
              </MessageBubble>
            </Message>
            <Message from="assistant">
              <div className="space-y-1">
                {state.status && state.status !== "succeeded" && (
                  <Badge variant="outline">{state.status}</Badge>
                )}
                {state.output ? (
                  <StreamingResponse status="complete"
                    copyText={JSON.stringify(state.output, null, 2)}>
                    <Markdown content={"```json\n" + JSON.stringify(state.output, null, 2) + "\n```"} />
                  </StreamingResponse>
                ) : null}
                <div className="text-[11px] text-(--text-tertiary)">{state.at}</div>
              </div>
            </Message>
          </div>
        ) : (
          <p className="text-xs text-(--text-tertiary)">底部输入问题后双栏并行运行。</p>
        )}
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
  const [versions, setVersions] = useState<AgentVersionInfo[]>([])
  const [releases, setReleases] = useState<ReleaseOpt[]>([])
  const [models, setModels] = useState<{ modelKey: string }[]>([])
  const [rightVersion, setRightVersion] = useState("")
  const [rightModel, setRightModel] = useState("")
  const [input, setInput] = useState("")
  const [left, setLeft] = useState<PaneState>({ running: false })
  const [right, setRight] = useState<PaneState>({ running: false })

  useEffect(() => {
    if (!open) return
    agentApi.versions(agent.id).then(setVersions).catch(() => undefined)
    agentApi.releases(agent.id).then((rs) => setReleases(rs.filter((x) => x.status === "active"))).catch(() => undefined)
    wfApi.models().then(setModels).catch(() => undefined)
  }, [open, agent.id])

  const prodStable = releases.find((r) => r.environment === "prod" && !(r.canaryPercent > 0))
  const rightVersionOpts = mode === "version"
    ? releases.filter((r) => r.releaseId !== prodStable?.releaseId)
    : []

  const poll = async (runId: string, set: (p: PaneState) => void, text: string) => {
    const deadline = Date.now() + 60000
    for (;;) {
      const d = await agentApi.runDetail(agent.id, runId)
      if (["succeeded", "failed", "cancelled"].includes(d.status)) {
        set({ running: false, runId, text, status: d.status,
              output: (d.output as Record<string, unknown>) ?? undefined,
              at: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) })
        return
      }
      if (Date.now() > deadline) { set({ running: false, runId, text, status: "timeout" }); return }
      await new Promise((r) => setTimeout(r, 400))
    }
  }

  const runBoth = async (text: string) => {
    if (!text.trim()) { toast.error("请输入问题"); return }
    if (!prodStable) { toast.error("无 active prod Release：请先发布"); return }
    const leftVer = versions.find((v) => v.versionNo === prodStable.versionNo)
    if (!leftVer) { toast.error("当前 Release 的版本不存在"); return }
    if (mode === "version" && !rightVersion) { toast.error("请选择对比版本"); return }
    if (mode === "model" && !rightModel) { toast.error("请选择对比模型"); return }
    const rightVer = mode === "version"
      ? versions.find((v) => v.versionNo === releases.find((r) => r.releaseId === rightVersion)?.versionNo)
      : leftVer
    setLeft({ running: true, text }); setRight({ running: true, text })
    try {
      const lr = await agentApi.run(agent.id, { content: text }, "test", { versionId: leftVer.versionId })
      const rr = await agentApi.run(agent.id, { content: text }, "test", {
        versionId: rightVer?.versionId ?? leftVer.versionId,
        ...(mode === "model" ? { modelOverride: { model: rightModel } } : {}),
      })
      void poll(lr.runId, setLeft, text)
      void poll(rr.runId, setRight, text)
    } catch (e) {
      toast.error((e as Error).message)
      setLeft((p) => ({ ...p, running: false })); setRight((p) => ({ ...p, running: false }))
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[82vh] flex-col p-0" style={{ width: "min(1280px, 94vw)", maxWidth: "none" }}>
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
                  {rightVersionOpts.map((r) => (
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
            disabled={!left.text}
            onClick={() => void runBoth(left.text ?? input)}>
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
