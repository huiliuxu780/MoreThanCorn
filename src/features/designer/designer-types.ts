/** 设计器跨模块共享类型（MTC-007R 拆分：入口只做组装，类型集中在本文件）。 */
import type { NodeDefinition, ValidationIssue, WfNode } from "@/services/wf-api"

/** 09 §5.7 已登记豁免：节点配置/注册表 schema 为自由 JSONB，设计器按松散对象处理。
 * 统一别名（仅此一处声明，可审计）；API 边界契约类型见 services/wf-api.ts。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type NodeCfgLoose = Record<string, any>

/** 画布节点卡运行态（demo-run 已退役，P1 真 SSE 驱动）。 */
export interface NodeRunState {
  status: "running" | "success" | "failed" | "skipped"
  durationMs?: number
  tokens?: number
  input?: unknown
  output?: unknown
  error?: string
}

/** React Flow 节点 data 契约（canvas/WorkflowNodeCard 消费）。 */
export interface WfNodeData extends Record<string, unknown> {
  wf: WfNode
  def?: NodeDefinition
  issues: ValidationIssue[]
  run?: NodeRunState
  onRunNode?: (id: string) => void
  onTestNode?: (id: string) => void
  onQuickAdd?: (handle: string | null, typeKey: string) => void
  palette?: NodeFamily[]
  onDelete?: (id: string) => void
}

/** 节点面板分组：[family 名, 该族节点定义]。 */
export type NodeFamily = [string, NodeDefinition[]]

/** 右侧抽屉种类（agentMeta 模式含 eval/evo 页签）。 */
export type DrawerKind =
  | "config" | "debug" | "history" | "runs" | "schedule" | "agent" | "eval" | "evo" | null

/** Agent 画布模式的元信息（wf-agent-editor 注入）。 */
export interface AgentMeta {
  name: string
  typeLabel: string
  agentType?: string
}

/** 设计器页面 props（默认导出契约，app.tsx / wf-agent-editor 消费，不可破坏）。 */
export interface DesignerPageProps {
  workflowId?: string
  agentId?: string
  agentMeta?: AgentMeta
  avatar?: string
  readOnly?: boolean
}

export type { NodeDefinition, ValidationIssue, WfDefinition, WfEdge, WfNode } from "@/services/wf-api"
