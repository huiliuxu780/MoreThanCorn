/** NodeInspector：节点配置抽屉壳（头部/描述/问题清单）+ SchemaInspector 唯一配置路径
 *  + 全节点统一的健壮性/输出变量分区（开始节点除外，与既有行为一致）。
 *  Theme-R：表面色全部走 token（bg-surface/border-border/status-soft）。 */
import { CircleAlert, MoreHorizontal, X } from "lucide-react"
import { C, NEUTRAL } from "@/components/wf/controls"
import { OutputVarsSection, RobustnessSection } from "@/components/wf/sections"
import type { NodeDefinition, ValidationIssue, WfEdge, WfNode } from "@/services/wf-api"
import type { NodeCfgLoose } from "../designer-types"
import { NODE_DESC, TypeIcon } from "../node-meta"
import { SchemaInspector } from "./SchemaInspector"
import type { InspectorContext } from "./inspector-types"

export function NodeInspector(props: {
  node: WfNode
  defs: NodeDefinition[]
  nodes: WfNode[]
  edges: WfEdge[]
  agentId?: string
  issues?: ValidationIssue[]
  onClose: () => void
  onChange: (n: WfNode) => void
  onRemoveBranchEdges?: InspectorContext["onRemoveBranchEdges"]
}) {
  const { node, defs, nodes, edges, agentId, issues = [], onClose, onChange, onRemoveBranchEdges } = props
  const def = defs.find((d) => d.type_key === node.type)
  const cfg = node.config as NodeCfgLoose
  const set = (k: string, v: unknown) => onChange({ ...node, config: { ...cfg, [k]: v } })
  return (
    <div className="absolute inset-y-0 right-0 z-20 w-[360px] max-w-[92vw] overflow-y-auto border-l bg-surface px-4" data-testid="wf-inspector" style={{ borderColor: C.cardBorder }}>
      <div className="sticky top-0 z-10 flex items-center gap-2 bg-surface py-3">
        <span className="flex size-6 items-center justify-center rounded-md" style={{ background: NEUTRAL }}>
          <TypeIcon type={node.type} className="size-3.5 text-background" />
        </span>
        <span className="flex-1 text-[15px] font-semibold" style={{ color: C.ink }}>{node.name}</span>
        <MoreHorizontal className="size-4 text-muted-foreground" />
        <button onClick={onClose} title="关闭配置"><X className="size-4 text-muted-foreground" /></button>
      </div>
      <p className="pb-2 text-xs leading-5" style={{ color: C.ink2 }}>{NODE_DESC[node.type] ?? "节点配置"}</p>
      {/* 06-master-spec §2.4：抽屉内节点级问题清单（与顶栏检查 Popover 同源） */}
      {issues.length > 0 && (
        <div className="mb-2 space-y-1 rounded-md border px-2 py-1.5" style={{ borderColor: C.danger, background: "var(--status-danger-soft)" }}>
          {issues.map((i, idx) => (
            <div key={idx} className="flex items-start gap-1 text-[11px]" style={{ color: C.danger }}>
              <CircleAlert className="mt-0.5 size-3 shrink-0" /> {i.message}
            </div>
          ))}
        </div>
      )}
      <SchemaInspector node={node} def={def} nodes={nodes} edges={edges} defs={defs}
        agentId={agentId} cfg={cfg} set={set} onChange={onChange} onRemoveBranchEdges={onRemoveBranchEdges} />
      {/* 07-SDD §2.6：健壮性 + 输出变量统一区（全节点；开始节点无执行语义） */}
      {node.type !== "input" && <RobustnessSection node={node} onChange={onChange} />}
      {node.type !== "input" && <OutputVarsSection def={def} />}
    </div>
  )
}
