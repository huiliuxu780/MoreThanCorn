/** NodeRunState：画布节点运行态的 SSE 事件映射与订阅器（P1 真执行：POST /api/runs + SSE）。 */
import { runApi } from "@/services/wf-api"
import type { NodeRunState } from "../designer-types"

export type { NodeRunState }
export type RunStateMap = Record<string, NodeRunState>

/** SSE node_* 事件 → 画布运行态状态机（与 node-st-* 边框类一一对应）。 */
export function sseStatusOf(eventType: string): NodeRunState["status"] {
  return eventType === "node_started" ? "running"
    : eventType === "node_completed" ? "success"
    : eventType === "node_skipped" ? "skipped"
    : "failed"
}

export interface RunSubscriptionHandlers {
  onCompleted: () => void
  onFailed: (error: string) => void
}

/** 订阅一个 Run 的节点事件流；返回 close 函数。 */
export function subscribeRun(
  runId: string,
  setRunState: React.Dispatch<React.SetStateAction<RunStateMap>>,
  handlers: RunSubscriptionHandlers,
): () => void {
  const es = new EventSource(runApi.eventsUrl(runId))
  const onNode = (e: MessageEvent) => {
    const d = JSON.parse(e.data)
    const st = sseStatusOf(e.type)
    if (d.nodeId) setRunState((s) => ({ ...s, [d.nodeId]: {
      status: st, durationMs: d.durationMs ?? d.duration_ms,
      tokens: d.payload?.tokens || undefined, input: d.payload?.input, output: d.payload?.output,
      error: d.payload?.error,
    } }))
  }
  for (const t of ["node_started", "node_completed", "node_failed", "node_skipped"]) es.addEventListener(t, onNode)
  es.addEventListener("workflow_completed", () => { handlers.onCompleted(); es.close() })
  es.addEventListener("workflow_failed", (e) => {
    const d = JSON.parse((e as MessageEvent).data)
    handlers.onFailed(String(d.payload?.error ?? ""))
    es.close()
  })
  return () => es.close()
}
