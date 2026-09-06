/** EvoPanel：版本指标面板（SDD A-12：原“进化”名实不符，真进化见 Phase D）。 */
import { useEffect, useState } from "react"
import { X } from "lucide-react"
import { C } from "@/components/wf/controls"
import { evalApi } from "@/services/wf-api"

export function EvoPanel({ workflowId, onClose }: { workflowId: string; onClose: () => void }) {
  const [data, setData] = useState<{
    versions: { versionNo: number; runs: number; successRate: number }[]
    failedCases: { runId: string; error: string }[]
  } | null>(null)
  useEffect(() => {
    evalApi.versionMetrics(workflowId).then(setData).catch(() => undefined)
  }, [workflowId])
  return (
    <div className="absolute inset-y-0 right-0 z-20 flex w-[420px] max-w-[92vw] flex-col border-l bg-surface" style={{ borderColor: C.cardBorder }}>
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-[15px] font-semibold" style={{ color: C.ink }}>版本指标</span>
        <button onClick={onClose} title="关闭版本指标"><X className="size-4 text-muted-foreground" /></button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-4">
        <div className="space-y-1">
          <div className="text-[13px] font-medium" style={{ color: C.ink }}>| 版本指标</div>
          {data?.versions.length ? data.versions.map((v) => (
            <div key={v.versionNo} className="flex items-center gap-2 rounded border px-2 py-1 text-xs" style={{ borderColor: C.cardBorder }}>
              <span className="w-12 font-medium" style={{ color: C.ink }}>V{v.versionNo}</span>
              <span style={{ color: C.ink3 }}>{v.runs} 次运行</span>
              <span className="flex-1 text-right" style={{ color: C.ink2 }}>成功率 {Math.round(v.successRate * 100)}%</span>
            </div>
          )) : <div className="text-xs" style={{ color: C.ink3 }}>暂无发布版本</div>}
        </div>
        <div className="space-y-1">
          <div className="text-[13px] font-medium" style={{ color: C.ink }}>| 进化建议（失败案例）</div>
          {data?.failedCases.length ? data.failedCases.map((f) => (
            <div key={f.runId} className="rounded border px-2 py-1 text-xs" style={{ borderColor: C.cardBorder }}>
              <div className="font-mono" style={{ color: C.ink3 }}>{f.runId.slice(0, 8)}</div>
              <div style={{ color: C.danger }}>{f.error || "-"}</div>
            </div>
          )) : <div className="text-xs" style={{ color: C.ink3 }}>暂无失败案例</div>}
        </div>
      </div>
    </div>
  )
}
