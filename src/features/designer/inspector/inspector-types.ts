/** Inspector 契约类型：所有字段控件（x-control）统一接收 FieldControlProps。
 *  控件不允许感知 node type——类型差异全部由 schema 目录表达（MTC-007R 单一配置路径）。 */
import type { ReactNode } from "react"
import type { NodeDefinition, WfEdge, WfNode } from "@/services/wf-api"
import type { NodeCfgLoose } from "../designer-types"
import type { PropertySchema } from "../schema/node-schemas"

export interface InspectorContext {
  node: WfNode
  nodes: WfNode[]
  edges: WfEdge[]
  defs: NodeDefinition[]
  /** Agent 画布模式下的宿主 agent（成员池联动等） */
  agentId?: string
  cfg: NodeCfgLoose
  /** 写单个配置键 */
  set: (k: string, v: unknown) => void
  /** 整体替换节点（inputs/branches 等结构性变更） */
  onChange: (n: WfNode) => void
  /** 删除条件分支需同步移除画布出边（校验器 R7 依赖 handle 声明） */
  onRemoveBranchEdges?: (nodeId: string, handles: string[], nextNode: WfNode) => void
}

export interface FieldControlProps {
  /** schema 字段键；复合控件可用 __ 前缀虚拟键（不落 cfg） */
  fieldKey: string
  /** 已解析的中文字段 label */
  label: string
  schema: PropertySchema
  ctx: InspectorContext
}

export type FieldControl = (props: FieldControlProps) => ReactNode
