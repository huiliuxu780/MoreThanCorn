/** NodeTestDialog：节点单测（E-4.3：⋯菜单 → 填 mock 输入 → 后端执行单节点，不落 Run、不记事件）。 */
import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { wfApi } from "@/services/wf-api"
import { toast } from "../toast"

export function NodeTestDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workflowId: string
  nodeId: string | null
  nodeName: string
}) {
  const { open, onOpenChange, workflowId, nodeId, nodeName } = props
  const [testInput, setTestInput] = useState("{}")
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; output?: unknown; error?: string; durationMs?: number } | null>(null)
  const reset = () => { setResult(null); setTestInput("{}") }
  const run = async () => {
    if (!nodeId) return
    let input: Record<string, unknown>
    try { input = JSON.parse(testInput || "{}") } catch { toast.error("输入 JSON 非法"); return }
    setBusy(true); setResult(null)
    try {
      setResult(await wfApi.nodeTest(workflowId, nodeId, input))
    } catch (e) {
      setResult({ ok: false, error: (e as Error).message.replace(/^\d+:\s*/, "").replace(/^"|"$/g, "") })
    } finally { setBusy(false) }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o) }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>单测节点：{nodeName}</DialogTitle>
          <DialogDescription>填入该节点的输入（JSON，键=输入名），单独执行不落 Run、不记事件。</DialogDescription>
        </DialogHeader>
        <Textarea className="min-h-24 font-mono text-xs" value={testInput} onChange={(e) => setTestInput(e.target.value)}
          placeholder='{ "text": "你好" }' />
        {result && (
          <div className="max-h-48 overflow-auto rounded-md border p-2 font-mono text-[11px]"
            style={result.ok
              ? { borderColor: "var(--status-success)", background: "var(--status-success-soft)", color: "var(--status-success)" }
              : { borderColor: "var(--status-danger)", background: "var(--status-danger-soft)", color: "var(--status-danger)" }}>
            {result.ok
              ? <>✓ 输出：{JSON.stringify(result.output ?? null)}（{result.durationMs ?? 0}ms）</>
              : <>✗ {result.error}</>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onOpenChange(false) }}>关闭</Button>
          <Button className="bg-primary text-primary-foreground hover:bg-brand-hover" disabled={busy} onClick={run}>
            {busy ? "执行中…" : "执行单测"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
