/** WorkflowCanvas：React Flow 画布组装（受控 nodes/edges + 事件回调上抛）。
 *  抽屉/工具条等浮层由入口通过 children 注入（画布容器是它们的定位基准）。
 *  Theme-R：colorMode 跟随 resolvedTheme，Background 点色走 --wf-canvas-dot token。 */
import type { ReactNode } from "react"
import {
  Background, ReactFlow, useReactFlow,
  type Connection, type Edge, type Node, type NodeChange, type OnNodesChange,
} from "@xyflow/react"
import { C } from "@/components/wf/controls"
import { baseMode, useUiTheme } from "../theme/workflow-theme"
import { nodeTypes } from "./WorkflowNodeCard"
import { CanvasControls } from "./CanvasControls"
import { WorkflowMiniMap } from "./WorkflowMiniMap"

export interface WorkflowCanvasProps {
  nodes: Node[]
  edges: Edge[]
  zoom: number
  readOnly: boolean
  showMiniMap: boolean
  onNodesChange: OnNodesChange
  onConnect: (conn: Connection) => void
  onReconnect: (oldEdge: Edge, conn: Connection) => void
  /** palette 拖拽落画布（已换算 flow 坐标） */
  onDropNode: (typeKey: string, pos: { x: number; y: number }) => void
  onNodeClick: (id: string) => void
  onEdgeClick: (id: string) => void
  onPaneClick: () => void
  /** 画布手势开始（收起浮层 Popover 用） */
  onGestureStart: () => void
  onZoomChange: (zoom: number) => void
  children?: ReactNode
}

export function WorkflowCanvas(props: WorkflowCanvasProps) {
  const {
    nodes, edges, zoom, readOnly, showMiniMap,
    onNodesChange, onConnect, onReconnect, onDropNode,
    onNodeClick, onEdgeClick, onPaneClick, onGestureStart, onZoomChange, children,
  } = props
  const rf = useReactFlow()
  const ui = useUiTheme()
  return (
    <div className="relative flex-1" data-testid="wf-canvas-root">
      <ReactFlow
        nodes={nodes} edges={edges} nodeTypes={nodeTypes}
        colorMode={baseMode(ui)}
        onNodesChange={(chs: NodeChange[]) => onNodesChange(chs)}
        onConnect={onConnect}
        onReconnect={onReconnect}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move" }}
        onDrop={(e) => {
          if (readOnly) return  // R-Archive：封存画布禁止拖放加节点
          const t = e.dataTransfer.getData("application/wf-node")
          if (!t) return
          e.preventDefault()
          onDropNode(t, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }))
        }}
        onNodeClick={(_, n) => onNodeClick(n.id)}
        onEdgeClick={(_, e) => onEdgeClick(e.id)}
        onPaneClick={onPaneClick}
        onMoveStart={onGestureStart}
        onNodeDragStart={onGestureStart}
        onMove={(_, vp) => onZoomChange(vp.zoom)}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 0.9 }}
        minZoom={0.4}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} color={C.dot} />
        {showMiniMap && <WorkflowMiniMap />}
      </ReactFlow>
      <CanvasControls zoom={zoom} />
      {children}
    </div>
  )
}
