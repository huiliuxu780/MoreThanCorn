/** WorkflowEdges：WfEdge[] → React Flow Edge[]（条件分支出边标注分支名，渲染期从源节点推导）。
 *  Theme-R：线色/标签底色走 token；选中态=状态红（语义：将被删除的焦点），非品牌色。 */
import type { Edge } from "@xyflow/react"
import { C, normCondBranches } from "@/components/wf/controls"
import type { NodeCfgLoose, WfDefinition } from "../designer-types"

export function buildFlowEdges(def: WfDefinition | null, selectedEdgeId: string | null): Edge[] {
  return (def?.graph.edges ?? []).map((e) => {
    let label: string | undefined
    if (e.sourceHandle) {
      const src = def?.graph.nodes.find((n) => n.id === e.source)
      if (src?.type === "condition") {
        const bs = normCondBranches((src.config as NodeCfgLoose)?.branches)
        const idx = bs.findIndex((b) => b.handle === e.sourceHandle)
        label = e.sourceHandle === "else" ? "否则" : idx >= 0 ? (idx === 0 ? "如果" : `否则如果 ${idx}`) : e.sourceHandle
      }
    }
    return {
      id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? undefined, label,
      labelStyle: { fontSize: 10, fill: C.ink2 },
      labelBgStyle: { fill: "var(--surface)", fillOpacity: 0.9 },
      reconnectable: true,
      style: {
        stroke: selectedEdgeId === e.id ? "var(--status-danger)" : "var(--wf-edge)",
        strokeWidth: selectedEdgeId === e.id ? 2.5 : 1.5,
      },
      interactionWidth: 24,
    }
  })
}
