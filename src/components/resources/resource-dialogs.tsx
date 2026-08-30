import { AlertTriangle, Ban, Check, FlaskConical, Loader2 } from "lucide-react"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import type { RefInfo, TestResult } from "@/services/resource-api"

/** ResourceTestDialog：空闲/执行中/成功/失败 四态。 */
export function ResourceTestDialog({ open, title, desc, onRun, onClose }: {
  open: boolean
  title: string
  desc: string
  onRun: (input: Record<string, unknown>) => Promise<TestResult>
  onClose: () => void
}) {
  const [input, setInput] = useState('{ "input": "ping" }')
  const [state, setState] = useState<"idle" | "running" | "ok" | "fail">("idle")
  const [result, setResult] = useState<TestResult | null>(null)

  useEffect(() => {
    if (open) { setState("idle"); setResult(null) }
  }, [open])

  const run = async () => {
    setState("running")
    let parsed: Record<string, unknown> = {}
    try { parsed = JSON.parse(input || "{}") } catch { /* 忽略，空入参 */ }
    try {
      const r = await onRun(parsed)
      setResult(r)
      setState(r.ok ? "ok" : "fail")
    } catch (e) {
      setResult({ ok: false, error: (e as Error).message })
      setState("fail")
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>测试 · {title}</DialogTitle>
          <DialogDescription>{desc}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Textarea className="min-h-16 font-mono text-xs" value={input} onChange={(e) => setInput(e.target.value)} />
          {state === "ok" && result && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">
              <div className="flex items-center gap-1.5 font-semibold"><Check className="size-3.5" /> 测试通过 · {result.latencyMs}ms</div>
              <pre className="mt-2 overflow-x-auto rounded bg-white/60 p-2 font-mono text-[11px]">{JSON.stringify(result.output ?? {}, null, 2).slice(0, 600)}</pre>
              {result.checkRunId && (
                <div className="mt-1.5 text-[10px] text-emerald-800/70">
                  CheckRun {result.checkRunId.slice(0, 8)} · 指纹 {result.configFingerprint} —— 启用门禁依据此记录
                </div>
              )}
            </div>
          )}
          {state === "fail" && result && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              <div className="flex items-center gap-1.5 font-semibold"><AlertTriangle className="size-3.5" /> 测试失败</div>
              <div className="mt-1 font-mono text-[11px]">{result.error}</div>
              <div className="mt-1">失败不会自动停用资源，健康度将标记为 Failed；配置或凭据变化后显示 Stale。</div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>关闭</Button>
          <Button onClick={run} disabled={state === "running"}>
            {state === "running" ? <Loader2 className="size-4 animate-spin" /> : <FlaskConical className="size-4" />}
            执行测试
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 删除防护：使用中资源拦截 + 引用清单。 */
export function DeleteBlockedDialog({ open, name, refs, onClose, onViewRefs }: {
  open: boolean
  name: string
  refs: RefInfo[]
  onClose: () => void
  onViewRefs?: (ref: RefInfo) => void
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ban className="size-4 text-destructive" /> 无法删除「{name}」
          </DialogTitle>
          <DialogDescription>使用中的资源不允许删除。该资源正被以下对象引用：</DialogDescription>
        </DialogHeader>
        <div className="max-h-56 space-y-1.5 overflow-y-auto">
          {refs.map((r, i) => (
            <button key={i}
              className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-xs hover:bg-muted"
              onClick={() => onViewRefs?.(r)}>
              <span className="font-medium">
                {r.workflowName ?? r.label ?? r.kind}
                {r.version ? <span className="ml-1 text-muted-foreground">{r.version}</span> : null}
              </span>
              <span className="text-muted-foreground">{r.nodeName ?? r.kind}</span>
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">如需下线：先移除引用，或停用该资源（保留数据，禁止新引用）。</p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>知道了</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 无引用删除二次确认。 */
export function ConfirmDeleteDialog({ open, name, busy, onConfirm, onClose }: {
  open: boolean
  name: string
  busy?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>删除「{name}」？</DialogTitle>
          <DialogDescription>该资源当前没有被引用。删除后配置与历史不可恢复。</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button variant="destructive" disabled={busy} onClick={onConfirm}>确认删除</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
