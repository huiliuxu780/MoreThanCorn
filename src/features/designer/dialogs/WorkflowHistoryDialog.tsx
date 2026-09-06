/** WorkflowHistoryDialog：历史版本抽屉（工作流版本 / Agent 版本+部署徽标，含「对比」入口）。
 *  E-2.2：对比弹窗本体=components/agent-version-diff（入口持有 diffVersion 状态）。 */
import { History, X } from "lucide-react"
import { C } from "@/components/wf/controls"

export interface WorkflowVersionRow { versionNo: number; publishedAt: string }
export interface AgentVersionRow {
  versionId: string; versionNo: number; note: string; artifactHash: string; createdAt: string
}
export interface AgentReleaseRow {
  releaseId: string; environment: string; status: string; canaryPercent: number; versionNo: number | null
}

export function WorkflowHistoryDialog(props: {
  agentMode: boolean
  versions: WorkflowVersionRow[]
  agentVersions: AgentVersionRow[]
  agentReleases: AgentReleaseRow[]
  onDiff: (versionId: string) => void
  onClose: () => void
}) {
  const { agentMode, versions, agentVersions, agentReleases, onDiff, onClose } = props
  return (
    <div className="absolute inset-y-0 right-0 z-20 w-[320px] border-l bg-surface px-4" style={{ borderColor: C.cardBorder }}>
      <div className="flex items-center justify-between py-3">
        <span className="text-[15px] font-semibold" style={{ color: C.ink }}>历史版本</span>
        <button onClick={onClose} title="关闭历史版本"><X className="size-4 text-muted-foreground" /></button>
      </div>
      {agentMode ? (
        <>
          {agentVersions.length === 0 && (
            <div className="flex flex-col items-center gap-2 pt-24 text-xs" style={{ color: C.ink3 }}>
              <History className="size-8" /> 暂无历史版本
            </div>
          )}
          {agentVersions.map((v) => {
            const rels = agentReleases.filter((r) => r.status === "active" && r.versionNo === v.versionNo)
            return (
              <div key={v.versionId} className="border-b py-2 text-xs" style={{ borderColor: C.cardBorder, color: C.ink2 }}>
                <div className="flex items-center justify-between">
                  <span className="font-medium" style={{ color: C.ink }}>V{v.versionNo}</span>
                  <span className="flex items-center gap-1">
                    {rels.map((r) => (
                      <span key={r.environment} className="rounded px-1 py-0.5 text-[10px]"
                        style={r.environment === "prod"
                          ? { background: "var(--status-running-soft)", color: "var(--status-running)" }
                          : { background: "var(--status-success-soft)", color: "var(--status-success)" }}>
                        {r.environment === "prod" ? "线上" : "沙箱"}{r.canaryPercent > 0 ? ` · 灰度 ${r.canaryPercent}%` : ""}
                      </span>
                    ))}
                    <button className="rounded px-1 py-0.5 text-[10px] underline" style={{ color: C.ink3 }}
                      onClick={() => onDiff(v.versionId)}>对比</button>
                  </span>
                </div>
                {rels.filter((r) => r.canaryPercent > 0).map((r) => (
                  <div key={r.releaseId} className="flex items-center justify-between pt-1">
                    <span className="rounded px-1 py-0.5 text-[10px]" style={{ background: "var(--status-warning-soft)", color: "var(--status-warning)" }}>
                      灰度 {r.canaryPercent}%（{r.environment === "prod" ? "线上" : "沙箱"}）
                    </span>
                    {/* R-Archive：停止灰度为写操作，已封存 */}
                  </div>
                ))}
                <div className="pt-0.5 text-[10px]" style={{ color: C.ink3 }}>
                  {new Date(v.createdAt).toLocaleString()}{v.note ? ` · ${v.note}` : ""}
                </div>
                <div className="pt-0.5 font-mono text-[10px]" style={{ color: C.ink3 }}>sha256:{v.artifactHash.slice(0, 16)}…</div>
              </div>
            )
          })}
        </>
      ) : (
        <>
          {versions.length === 0 && (
            <div className="flex flex-col items-center gap-2 pt-24 text-xs" style={{ color: C.ink3 }}>
              <History className="size-8" /> 暂无历史版本
            </div>
          )}
          {versions.map((v) => (
            <div key={v.versionNo} className="flex justify-between border-b py-2 text-xs" style={{ borderColor: C.cardBorder, color: C.ink2 }}>
              <span>V{v.versionNo}</span><span>{new Date(v.publishedAt).toLocaleString()}</span>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
