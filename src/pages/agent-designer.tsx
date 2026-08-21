import {
  ArrowLeft,
  Copy,
  Crosshair,
  History,
  Play,
  Search,
  Trash2,
  Upload,
} from "lucide-react"
import { useCallback, useMemo, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"
import {
  Background,
  BaseEdge,
  EdgeLabelRenderer,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  getSmoothStepPath,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeProps,
  type Node,
} from "@xyflow/react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { StatusBadge } from "@/components/app/status-badge"
import { StatusIcon } from "@/components/app/status-indicator"
import { AgentFlowNode, NODE_KIND_META, type AgentFlowNodeData, type NodeRunStatus } from "@/components/agents/flow-node"
import { NodeInspector } from "@/components/agents/node-inspector"
import { TestRunPanel } from "@/components/agents/test-run-panel"
import { useAsyncData } from "@/hooks/use-async-data"
import { getAgent } from "@/services/mock-service"
import type { AgentNodeDef, AgentNodeKind } from "@/domain/types"
import { tasks } from "@/mocks/data"

const nodeTypes = { agent: AgentFlowNode }

function FlowEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected, markerEnd }: EdgeProps) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 8,
  })
  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{ stroke: selected ? "#525252" : "#e0e0e0", strokeWidth: 1.5 }}
      />
      {selected ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-auto absolute flex size-5 cursor-pointer items-center justify-center rounded-full border bg-background text-red-500"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            ×
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  )
}
const edgeTypes = { flow: FlowEdge }

function rowsFor(node: AgentNodeDef): { label: string; value: string }[] {
  switch (node.kind) {
    case "llm":
      return [
        { label: "model", value: (node.config.model as string) ?? "qwen-max" },
        { label: "prompt", value: `${((node.config.prompt as string) ?? "").slice(0, 14)}...` },
      ]
    case "tool":
      return [{ label: "tool", value: `${(node.config.toolId as string) ?? "—"} · ${(node.config.toolVersion as string) ?? ""}` }]
    case "condition":
      return [{ label: "expr", value: (node.config.expression as string) ?? "" }]
    case "create-record":
      return [{ label: "idempotency", value: (node.config.idempotency as string) ?? "" }]
    default:
      return []
  }
}

function toFlowNode(node: AgentNodeDef, runStatus?: NodeRunStatus): Node<AgentFlowNodeData> {
  return {
    id: node.id,
    type: "agent",
    position: node.position,
    data: {
      kind: node.kind,
      name: node.name,
      description: node.description,
      rows: rowsFor(node),
      branches: node.kind === "condition" ? ["if", "else"] : undefined,
      runStatus,
    },
  }
}

function DesignerInner() {
  const { agentId = "" } = useParams()
  const navigate = useNavigate()
  const { data: agent } = useAsyncData(() => getAgent(agentId), [agentId])

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<AgentFlowNodeData>>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [loadedFor, setLoadedFor] = useState("")
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [panelTab, setPanelTab] = useState<"editor" | "palette">("palette")
  const [paletteSearch, setPaletteSearch] = useState("")
  const [saved, setSaved] = useState(true)
  const [runOpen, setRunOpen] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  const [publishStage, setPublishStage] = useState<1 | 2>(1)
  const [versionNote, setVersionNote] = useState("")
  const [historyOpen, setHistoryOpen] = useState(false)
  const [readOnly, setReadOnly] = useState(false)
  const [testPassed, setTestPassed] = useState<boolean | null>(null)
  const [changedSinceTest, setChangedSinceTest] = useState<boolean | null>(null)
  const [nodeDefs, setNodeDefs] = useState<AgentNodeDef[]>([])
  const { fitView } = useReactFlow()
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 载入 agent graph
  if (agent && loadedFor !== agent.id) {
    setLoadedFor(agent.id)
    setNodeDefs(agent.graph.nodes)
    setNodes(agent.graph.nodes.map((n) => toFlowNode(n)))
    setEdges(
      agent.graph.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        type: "flow",
      })),
    )
    setTestPassed(agent.lastTestPassed)
    setChangedSinceTest(agent.changedSinceTest)
    setTimeout(() => fitView({ padding: 0.25, maxZoom: 1 }), 50)
  }

  const markChanged = () => {
    setSaved(false)
    setChangedSinceTest(true)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      setSaved(true)
    }, 900)
  }

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => addEdge({ ...connection, type: "flow" }, eds))
      markChanged()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setEdges],
  )

  const selectedNode = nodeDefs.find((n) => n.id === selectedNodeId) ?? null
  const upstreamNames = useMemo(() => {
    if (!selectedNode) return []
    const upstreamIds = new Set<string>()
    const walk = (id: string) => {
      for (const e of edges) {
        if (e.target === id && !upstreamIds.has(e.source)) {
          upstreamIds.add(e.source)
          walk(e.source)
        }
      }
    }
    walk(selectedNode.id)
    return nodeDefs.filter((n) => upstreamIds.has(n.id)).map((n) => n.name)
  }, [selectedNode, edges, nodeDefs])

  const addNode = (kind: AgentNodeKind) => {
    const id = `n-${Date.now()}`
    const def: AgentNodeDef = {
      id,
      kind,
      name: NODE_KIND_META[kind].label,
      position: { x: 200 + Math.random() * 200, y: 100 + Math.random() * 200 },
      config: {},
    }
    setNodeDefs((defs) => [...defs, def])
    setNodes((nds) => [...nds, toFlowNode(def)])
    markChanged()
  }

  const updateNode = (nodeId: string, patch: Partial<AgentNodeDef>) => {
    setNodeDefs((defs) =>
      defs.map((d) => {
        if (d.id !== nodeId) return d
        const next = { ...d, ...patch }
        setNodes((nds) => nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...("name" in patch ? { name: patch.name } : {}), rows: rowsFor(next) } } : n)))
        return next
      }),
    )
    markChanged()
  }

  const deleteNode = (nodeId: string) => {
    setNodeDefs((defs) => defs.filter((d) => d.id !== nodeId))
    setNodes((nds) => nds.filter((n) => n.id !== nodeId))
    setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId))
    setSelectedNodeId(null)
    markChanged()
  }

  const setNodeStatus = (nodeId: string, status: NodeRunStatus) => {
    setNodes((nds) => nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, runStatus: status } } : n)))
  }

  /* Publish checks */
  const checks = useMemo(() => {
    if (!agent) return []
    const hasInput = nodeDefs.some((n) => n.kind === "input")
    const hasEnd = nodeDefs.some((n) => n.kind === "end")
    const hasRecord = nodeDefs.some((n) => n.kind === "create-record")
    const allConnected = nodeDefs.every(
      (n) => n.kind === "end" || edges.some((e) => e.source === n.id),
    )
    const llmOk = nodeDefs.filter((n) => n.kind === "llm").every((n) => (n.config.prompt as string)?.trim())
    const toolOk = nodeDefs.filter((n) => n.kind === "tool").every((n) => n.config.toolId)
    const testOk = (testPassed ?? false) && !(changedSinceTest ?? true)
    return [
      { label: "Graph 合法（Input / End / Create Record / 出边完整）", ok: hasInput && hasEnd && hasRecord && allConnected },
      { label: "必填 Node 配置完整（LLM Prompt / Tool Reference）", ok: llmOk && toolOk },
      { label: "Tool Reference 有效且锁定版本", ok: toolOk },
      { label: "Input Schema 有效", ok: (agent.inputSchema ?? []).length > 0 },
      { label: "Structured Output Schema 有效", ok: (agent.structuredOutputs ?? []).length > 0 },
      { label: "当前 Draft 存在成功 Test Run", ok: testOk },
    ]
  }, [agent, nodeDefs, edges, testPassed, changedSinceTest])
  const allChecksPass = checks.length > 0 && checks.every((c) => c.ok)
  const affectedTasks = tasks.filter((t) => t.agentId === agentId && t.agentVersionPolicy === "Latest Published")

  const paletteKinds = (Object.keys(NODE_KIND_META) as AgentNodeKind[]).filter((kind) =>
    NODE_KIND_META[kind].label.toLowerCase().includes(paletteSearch.toLowerCase()),
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Designer 顶栏：返回 / 名称 / 版本+状态 / 保存状态 / Run / Publish */}
      <div className="flex h-12 shrink-0 items-center gap-3 border-b bg-background px-4">
        <Button variant="ghost" size="sm" className="gap-1 px-2" onClick={() => navigate("/config/agents")}>
          <ArrowLeft className="size-4" /> Agents
        </Button>
        <div className="text-sm font-semibold">{agent?.name ?? "..."}</div>
        <button type="button" className="flex items-center gap-1.5" onClick={() => setHistoryOpen(true)}>
          <Badge variant={readOnly ? "success" : "neutral"}>{agent?.currentVersion ?? ""}</Badge>
          <History className="size-3.5 text-muted-foreground" />
        </button>
        <span className="text-xs text-muted-foreground">{saved ? "已保存" : "保存中..."}</span>
        {readOnly ? <Badge variant="info">只读</Badge> : null}
        {changedSinceTest && !readOnly ? (
          <span className="text-xs text-amber-600">Agent changed since last successful test</span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setRunOpen(true)}>
            <Play className="size-3.5" /> Run
          </Button>
          <Button size="sm" disabled={readOnly} onClick={() => { setPublishStage(1); setPublishOpen(true) }}>
            <Upload className="size-3.5" /> Publish
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Canvas */}
        <div className="min-w-0 flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={readOnly ? undefined : onNodesChange}
            onEdgesChange={readOnly ? undefined : onEdgesChange}
            onConnect={readOnly ? undefined : onConnect}
            onNodeClick={(_, node) => {
              setSelectedNodeId(node.id)
              setPanelTab("editor")
            }}
            onPaneClick={() => setSelectedNodeId(null)}
            nodesDraggable={!readOnly}
            nodesConnectable={!readOnly}
            minZoom={0.25}
            maxZoom={1.6}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={20} color="var(--border)" />
            <Panel position="bottom-left">
              <div className="flex h-9 items-center gap-1 rounded-lg border bg-background p-1">
                <Button variant="ghost" size="icon" className="size-7" onClick={() => fitView({ padding: 0.25, maxZoom: 1 })}>
                  <Crosshair className="size-3.5" />
                </Button>
              </div>
            </Panel>
          </ReactFlow>
        </div>

        {/* 右栏：Editor / 节点库 */}
        <aside className="flex w-[340px] shrink-0 flex-col border-l bg-background">
          <Tabs value={panelTab} onValueChange={(v) => setPanelTab(v as "editor" | "palette")}>
            <TabsList className="w-full rounded-none border-b">
              <TabsTrigger value="editor" className="flex-1">Editor</TabsTrigger>
              <TabsTrigger value="palette" className="flex-1">节点库</TabsTrigger>
            </TabsList>
          </Tabs>
          <ScrollArea className="min-h-0 flex-1">
            {panelTab === "editor" ? (
              <>
                <NodeInspector
                  node={selectedNode}
                  agent={agent}
                  upstreamNames={upstreamNames}
                  readOnly={readOnly}
                  onChange={updateNode}
                />
                {selectedNode ? (
                  <div className="flex gap-2 px-4 pb-4">
                    <Button variant="outline" size="sm" disabled={readOnly} onClick={() => { addNode(selectedNode.kind); toast.success("已复制节点") }}>
                      <Copy className="size-3.5" /> 复制
                    </Button>
                    <Button variant="outline" size="sm" className="text-destructive" disabled={readOnly} onClick={() => deleteNode(selectedNode.id)}>
                      <Trash2 className="size-3.5" /> 删除
                    </Button>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="space-y-2 p-3">
                <div className="relative">
                  <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input className="h-8 pl-7 text-xs" placeholder="搜索节点类型" value={paletteSearch} onChange={(e) => setPaletteSearch(e.target.value)} />
                </div>
                <div className="space-y-1">
                  {paletteKinds.map((kind) => {
                    const meta = NODE_KIND_META[kind]
                    return (
                      <button
                        key={kind}
                        type="button"
                        disabled={readOnly}
                        onClick={() => addNode(kind)}
                        className="flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-sm hover:bg-muted/50 disabled:opacity-50"
                      >
                        <span className="flex size-5 items-center justify-center rounded-md" style={{ backgroundColor: meta.accent, color: meta.fg }}>
                          <meta.icon className="size-3" />
                        </span>
                        {meta.label}
                        <span className="ml-auto text-[10px] text-muted-foreground">点击添加</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </ScrollArea>
        </aside>
      </div>

      {/* Test Run */}
      <TestRunPanel
        agent={agent}
        open={runOpen}
        onOpenChange={setRunOpen}
        onNodeStatus={setNodeStatus}
        onTestComplete={(success) => {
          setTestPassed(success)
          if (success) {
            setChangedSinceTest(false)
            toast.success("Test Run 成功：当前 Draft 可发布")
          } else {
            toast.error("Test Run 未通过")
          }
        }}
      />

      {/* Publish Dialog：Dependency Check → 二次确认 + Version Note */}
      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{publishStage === 1 ? "发布检查" : "确认发布"}</DialogTitle>
            <DialogDescription>
              {publishStage === 1
                ? "Dependency Check：全部通过后才能继续"
                : "新 Published Version 不可原地修改；Latest Published Task 从下一次新 Run 使用新版本"}
            </DialogDescription>
          </DialogHeader>
          {publishStage === 1 ? (
            <div className="space-y-2">
              {checks.map((check) => (
                <div key={check.label} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                  <StatusIcon tone={check.ok ? "success" : "danger"} />
                  {check.label}
                </div>
              ))}
              {affectedTasks.length > 0 ? (
                <p className="text-xs text-muted-foreground">
                  使用 Latest Published 的周期 Task：{affectedTasks.map((t) => t.name).join("、")}；预计下一次新 Run 生效。
                </p>
              ) : null}
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                <li>新版本成为当前 Published</li>
                <li>Published 不可原地修改</li>
                <li>已创建或运行中的 Run 不受影响</li>
              </ul>
              <Textarea
                placeholder="Version Note（必填）"
                className="min-h-20 text-xs"
                value={versionNote}
                onChange={(e) => setVersionNote(e.target.value)}
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPublishOpen(false)}>取消</Button>
            {publishStage === 1 ? (
              <Button disabled={!allChecksPass} onClick={() => setPublishStage(2)}>继续发布</Button>
            ) : (
              <Button
                disabled={!versionNote.trim()}
                onClick={() => {
                  setPublishOpen(false)
                  toast.success("已发布新版本")
                }}
              >
                Publish
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Version History Sheet */}
      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent className="w-[380px]">
          <SheetHeader>
            <SheetTitle>Version History</SheetTitle>
            <SheetDescription>Published 历史版本只读，可基于此版本创建草稿</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-2">
            {(agent?.versions ?? []).map((version) => (
              <div key={version.version} className="rounded-md border px-3 py-2">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium">{version.version}</span>
                  <StatusBadge status={version.status} />
                  {version.version === agent?.currentVersion ? <span className="text-xs text-muted-foreground">当前</span> : null}
                </div>
                {version.versionNote ? <div className="mt-1 text-xs text-muted-foreground">{version.versionNote}</div> : null}
                {version.status === "Published" ? (
                  <div className="mt-2 flex gap-2">
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setReadOnly(true); setHistoryOpen(false) }}>
                      只读查看
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => {
                        if (agent?.status !== "Deprecated" && nodeDefs.length > 0) {
                          toast.warning("当前已存在活动 Draft：创建新草稿将替换现有 Draft")
                        } else {
                          toast.success("已基于此版本创建草稿")
                        }
                        setReadOnly(false)
                        setHistoryOpen(false)
                      }}
                    >
                      基于此版本创建草稿
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          {readOnly ? (
            <div className="mt-4">
              <Separator className="mb-3" />
              <Button variant="outline" size="sm" onClick={() => setReadOnly(false)}>返回当前 Draft</Button>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  )
}

export default function AgentDesignerPage() {
  return (
    <ReactFlowProvider>
      <DesignerInner />
    </ReactFlowProvider>
  )
}
