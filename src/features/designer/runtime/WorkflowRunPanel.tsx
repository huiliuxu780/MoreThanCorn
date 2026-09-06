/** WorkflowRunPanel：运行观测抽屉（P1 真 Run 列表 + 节点执行顺序 + 重试/导出）。
 *  Theme-R：状态点色=RUN_STATUS_COLOR semantic token；表面=bg-surface。 */
import { Fragment, useCallback, useEffect, useState } from "react"
import { Download, RotateCw, X } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { C } from "@/components/wf/controls"
import { runApi, runExportUrl, runRetry, type RunDetail } from "@/services/wf-api"
import { RUN_STATUS_COLOR } from "../theme/workflow-theme"

export function WorkflowRunPanel({ workflowId, lastRunId, onClose }: {
  workflowId: string; lastRunId: string | null; onClose: () => void
}) {
  const [runs, setRuns] = useState<RunDetail[]>([])
  const [sel, setSel] = useState<RunDetail | null>(null)
  const [filter, setFilter] = useState("")
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const load = useCallback(async () => {
    const list = await runApi.list(workflowId)
    const details = await Promise.all(list.slice(0, 10).map((r) => runApi.detail(r.runId)))
    setRuns(details)
    setSel((cur) => details.find((d) => d.runId === (cur?.runId ?? lastRunId)) ?? details[0] ?? null)
  }, [workflowId, lastRunId])
  useEffect(() => { load(); const t = setInterval(load, 3000); return () => clearInterval(t) }, [load])
  return (
    <div className="absolute inset-y-0 right-0 z-20 flex w-[400px] max-w-[92vw] flex-col border-l bg-surface" style={{ borderColor: C.cardBorder }}>
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-[15px] font-semibold" style={{ color: C.ink }}>运行观测</span>
        <button onClick={onClose} title="关闭运行观测"><X className="size-4 text-muted-foreground" /></button>
      </div>
      <div className="flex-1 overflow-y-auto px-4">
        <div className="flex items-center gap-2 pb-2">
          <Select value={filter || undefined} onValueChange={(v) => setFilter(v)}>
            <SelectTrigger className="h-6 w-28 text-xs"><SelectValue placeholder="全部状态" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="succeeded">succeeded</SelectItem>
              <SelectItem value="failed">failed</SelectItem>
              <SelectItem value="running">running</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1 pb-3">
          {runs.filter((r) => !filter || r.status === filter).length === 0 && <div className="py-10 text-center text-xs" style={{ color: C.ink3 }}>暂无运行记录</div>}
          {runs.filter((r) => !filter || r.status === filter).map((r) => (
            <Fragment key={r.runId}><button className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-xs ${sel?.runId === r.runId ? "border-muted-foreground" : ""}`} style={{ borderColor: sel?.runId === r.runId ? undefined : C.cardBorder }} onClick={() => setSel(r)}>
              <span className="size-2 rounded-full" style={{ background: RUN_STATUS_COLOR[r.status] ?? "var(--text-secondary)" }} />
              <span style={{ color: C.ink }}>{r.trigger}</span>
              <span style={{ color: C.ink3 }}>{r.status}</span>
              <span className="ml-auto" style={{ color: C.ink3 }}>{r.durationMs != null ? `${r.durationMs}ms` : ""}</span>
            </button>
            <div className="flex gap-1 pl-4">
              {r.status === "failed" && (
                <button className="flex items-center gap-1 text-[11px]" style={{ color: C.primary }}
                  onClick={async () => { await runRetry(r.runId); load() }}>
                  <RotateCw className="size-3" /> 重试
                </button>
              )}
              <a className="flex items-center gap-1 text-[11px]" style={{ color: C.ink2 }} href={runExportUrl(r.runId)} target="_blank" rel="noreferrer">
                <Download className="size-3" /> 导出
              </a>
            </div>
            </Fragment>
          ))}
        </div>
        {sel && (
          <div className="space-y-1 border-t pt-2" style={{ borderColor: C.cardBorder }}>
            <div className="pb-1 text-xs font-medium" style={{ color: C.ink2 }}>节点执行顺序（点击行展开完整输出）</div>
            {sel.nodeRuns.map((n) => (
              <button key={n.nodeRunId} className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:opacity-90" style={{ background: "var(--surface-muted)" }}
                onClick={() => setExpanded((s) => ({ ...s, [n.nodeRunId]: !s[n.nodeRunId] }))}>
                <div className="flex items-center gap-2">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: RUN_STATUS_COLOR[n.status] ?? "var(--text-secondary)" }} />
                  <span className="truncate" style={{ color: C.ink }}>{n.nodeId}</span>
                  <span className="shrink-0" style={{ color: C.ink3 }}>{n.nodeType}</span>
                  <span className="ml-auto shrink-0" style={{ color: C.ink3 }}>{n.durationMs != null ? `${n.durationMs}ms` : n.status}</span>
                </div>
                {n.output && (
                  expanded[n.nodeRunId] ? (
                    <div className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap break-all rounded bg-popover p-1.5 font-mono text-[11px]" style={{ color: C.ink2, border: `1px solid ${C.cardBorder}` }}>
                      {JSON.stringify(n.output, null, 2)}
                    </div>
                  ) : (
                    <div className="truncate pt-1" style={{ color: C.ink2 }}>{JSON.stringify(n.output).slice(0, 90)}…</div>
                  )
                )}
                {n.error && <div className="break-all pt-1" style={{ color: C.danger }}>{n.error.message}</div>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
