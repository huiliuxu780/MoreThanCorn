/** Agent Designer 入口（MTC-007R 物理拆分后仅保留组装职责）。
 *
 *  模块树与职责：
 *  - canvas/       画布：ReactFlow 组装、节点卡、边构造、小地图、缩放控件
 *  - palette/      左侧节点面板（分组列表共用组件）
 *  - inspector/    配置抽屉：NodeInspector 壳 + SchemaInspector 唯一渲染路径 + x-control 注册表
 *  - schema/       节点配置 schema 目录（前端控件映射 + 后端注册表合并解析）
 *  - toolbar/      顶栏 / 底部工具条
 *  - runtime/      运行会话（SSE）、运行观测、调试、评测、版本指标
 *  - dialogs/      历史版本、基础信息、发布警告、节点单测、定时任务
 *  - theme/        主题桥接（SVG attribute 场景具体值 + CodeMirror 模式）
 *  - use-designer-document / use-workflow-lock  文档编排与编辑锁
 *
 *  后端契约不变（server/ :8100）；运行态为 P1 真 SSE。 */
import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import {
  ReactFlowProvider, useReactFlow,
  type Connection, type Edge, type Node, type OnNodesChange,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"

import { useAgentVersionState } from "@/components/agent-publish-dialog"
import { AgentVersionDiffDialog } from "@/components/agent-version-diff"
import { AgentEvalPanel } from "@/components/agent-ops-panels"
import { C } from "@/components/wf/controls"
import { X } from "lucide-react"
import { agentApi, wfApi } from "@/services/wf-api"
import { rbac } from "@/services/rbac"

import { WorkflowCanvas } from "./canvas/WorkflowCanvas"
import { buildFlowEdges } from "./canvas/WorkflowEdges"
import { NodeInspector } from "./inspector/NodeInspector"
import { AgentConfigDrawer } from "./inspector/AgentConfigDrawer"
import { NodePalette } from "./palette/NodePalette"
import { DesignerTopbar } from "./toolbar/DesignerTopbar"
import { DesignerBottomToolbar, type ToolbarPop } from "./toolbar/DesignerBottomToolbar"
import { DebugRunDrawer } from "./runtime/DebugRunDrawer"
import { WorkflowRunPanel } from "./runtime/WorkflowRunPanel"
import { EvalPanel } from "./runtime/EvalPanel"
import { EvoPanel } from "./runtime/EvoPanel"
import { useRunSession } from "./runtime/use-run-session"
import {
  WorkflowHistoryDialog,
  type AgentReleaseRow, type AgentVersionRow, type WorkflowVersionRow,
} from "./dialogs/WorkflowHistoryDialog"
import { WorkflowMetaDialog } from "./dialogs/WorkflowMetaDialog"
import { PublishWarnDialog } from "./dialogs/PublishWarnDialog"
import { NodeTestDialog } from "./dialogs/NodeTestDialog"
import { ScheduleDialog } from "./dialogs/ScheduleDialog"
import { useDesignerDocument } from "./use-designer-document"
import { useWorkflowLock } from "./use-workflow-lock"
import { ToastHost, toast } from "./toast"
import type { DesignerPageProps, DrawerKind, NodeFamily, WfNodeData } from "./designer-types"

function DesignerInner({ workflowId: wfProp, agentId: agentProp, agentMeta, avatar, readOnly = false }: DesignerPageProps) {
  /* readOnly（R-Archive，SDD 10）：旧 Agent 绑定的画布只读——隐藏保存/发布/试运行/
     定时任务/节点面板与编辑锁，禁止连线、改接与拖放/快捷加节点；仅保留查看。 */
  const params = useParams()
  const workflowId = wfProp ?? params.agentId ?? ""
  const agentId = agentProp ?? ""
  const navigate = useNavigate()
  const rf = useReactFlow()

  const doc = useDesignerDocument(workflowId)
  const { def, defs, issues, mutate, defRef } = doc

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [drawer, setDrawer] = useState<DrawerKind>(null)
  const [showMiniMap, setShowMiniMap] = useState(true)
  const [metaOpen, setMetaOpen] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  const [testNodeId, setTestNodeId] = useState<string | null>(null)
  const [pop, setPop] = useState<ToolbarPop>(null)
  const [paletteOpen, setPaletteOpen] = useState(() => localStorage.getItem("wf-palette-open") !== "0")
  const [zoom, setZoom] = useState(1)
  const [versions, setVersions] = useState<WorkflowVersionRow[]>([])
  const [agentVersions, setAgentVersions] = useState<AgentVersionRow[]>([])
  const [agentReleases, setAgentReleases] = useState<AgentReleaseRow[]>([])
  const [diffVersion, setDiffVersion] = useState<string | null>(null)
  /* bugfix 语义保留：v12 MiniMap 读用户节点对象的 measured；受控模式下测量结果经
     onNodesChange 的 dimensions 事件下发，需回填节点对象，否则小地图全空 */
  const [nodeDims, setNodeDims] = useState<Record<string, { width: number; height: number }>>({})

  /* 编辑锁（E-2.4：Agent 模式 resourceId=agent:{id}；封存画布不取锁） */
  const lockResourceId = agentMeta && agentId ? `agent:${agentId}` : workflowId
  const lock = useWorkflowLock(lockResourceId, !(readOnly && !!agentMeta))

  /* SDD B：Agent 级版本/部署状态（agentMeta 模式的徽标与发布对话框） */
  const agentVersionState = useAgentVersionState(agentMeta && agentId ? agentId : undefined)

  /* P1 真执行：校验 → POST /api/runs → SSE 驱动画布状态 */
  const { runState, setRunState, running, lastRunId, startRealRun } = useRunSession({
    workflowId,
    onIssues: doc.setIssues,
  })

  const rbacCanPublish = rbac.can("agent.publish")  // D-4：发布门禁

  /* 键盘：⌘Z/⌘⇧Z 撤销重做；选中连线后 Delete/Backspace 删除 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault()
        if (e.shiftKey) doc.redo()
        else doc.undo()
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedEdgeId) {
        e.preventDefault()
        const d = defRef.current
        if (d) mutate({ ...d, graph: { ...d.graph, edges: d.graph.edges.filter((x) => x.id !== selectedEdgeId) } })
        setSelectedEdgeId(null)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [doc, selectedEdgeId, mutate, defRef])

  /* SDD C-2：按编排器类型过滤节点目录（调研 11 §7 editorKinds）；deprecated 不进 palette */
  const families = useMemo<NodeFamily[]>(() => {
    const kind: "FLOW" | "GROUP" | "WORKFLOW" = agentMeta
      ? (agentMeta.agentType === "expert-group" ? "GROUP" : "FLOW")
      : "WORKFLOW"
    const visible = defs.filter((d) => (d.editor_kinds ?? ["WORKFLOW"]).includes(kind) && !(d as unknown as Record<string, unknown>).deprecated)
    const m = new Map<string, NodeFamily[1]>()
    for (const d of visible) m.set(d.family, [...(m.get(d.family) ?? []), d])
    return [...m.entries()]
  }, [defs, agentMeta])

  /* 08-26：节点尾部+快捷添加（自动连线；分支节点按分支 handle 连） */
  const quickAdd = useCallback((sourceId: string, handle: string | null, typeKey: string) => {
    const d = defRef.current!
    const defn = defs.find((x) => x.type_key === typeKey)
    const id = `n_${typeKey}_${Date.now() % 100000}`
    const srcPos = d.ui.positions[sourceId] ?? { x: 260, y: 160 }
    const node = {
      id, type: typeKey, name: defn?.label ?? typeKey,
      config: typeKey === "condition" ? { branches: [{ handle: "b1", logic: "AND", conditions: [] }] } : {},
      inputs: [], branches: typeKey === "condition" ? ["b1", "else"] : undefined,
    }
    const edges2 = d.graph.edges.filter((e) =>
      !(handle && e.source === sourceId && e.sourceHandle === handle))
    edges2.push({ id: `e_${Date.now() % 100000}`, source: sourceId, target: id, sourceHandle: handle ?? undefined })
    mutate({
      ...d,
      ui: { ...d.ui, positions: { ...d.ui.positions, [id]: { x: srcPos.x + 380, y: srcPos.y + (handle ? 60 : 0) } } },
      graph: { ...d.graph, nodes: [...d.graph.nodes, node], edges: edges2 },
    })
    setSelectedId(id); setDrawer("config")
  }, [defs, mutate, defRef])

  const nodes: Node[] = useMemo(() => (def?.graph.nodes ?? []).map((n) => ({
    id: n.id, type: "wf",
    position: def!.ui.positions[n.id] ?? { x: 120, y: 160 },
    ...(nodeDims[n.id] ? { measured: nodeDims[n.id] } : {}),
    data: {
      wf: n, def: defs.find((d) => d.type_key === n.type),
      issues: issues.filter((i) => i.nodeId === n.id),
      run: runState[n.id],
      onRunNode: (id: string) => {
        // 08-26：单节点运行不带动其他节点——真单测 node-test；先置 running 显示呼吸环
        if (readOnly) return
        setRunState({ [id]: { status: "running" } })
        wfApi.nodeTest(workflowId, id, {}).then((r: { ok?: boolean; output?: unknown; durationMs?: number; error?: string }) => {
          setRunState({ [id]: r.ok ? { status: "success", output: r.output, durationMs: r.durationMs } : { status: "failed", error: r.error || "单测失败" } })
        }).catch((e: Error) => setRunState({ [id]: { status: "failed", error: e.message } }))
      },
      onQuickAdd: readOnly ? undefined : (h: string | null, t: string) => quickAdd(n.id, h, t),
      palette: families,
      onTestNode: readOnly ? undefined : (id: string) => setTestNodeId(id),  // E-4.3
      onDelete: readOnly ? undefined : (id: string) => {
        const d2 = defRef.current!
        mutate({ ...d2, graph: { nodes: d2.graph.nodes.filter((x) => x.id !== id), edges: d2.graph.edges.filter((e) => e.source !== id && e.target !== id) } })
        setSelectedId(null)
      },
    } satisfies WfNodeData,
  })), [def, defs, issues, runState, setRunState, mutate, nodeDims, families, quickAdd, workflowId, readOnly, defRef])

  const edges: Edge[] = useMemo(() => buildFlowEdges(def, selectedEdgeId), [def, selectedEdgeId])

  const onNodesChange: OnNodesChange = useCallback((chs) => {
    const d = defRef.current
    if (!d) return
    const positions = { ...d.ui.positions }
    let changed = false
    const dims: Record<string, { width: number; height: number }> = {}
    let dimsChanged = false
    for (const ch of chs) {
      if (ch.type === "position" && ch.position) { positions[ch.id] = { x: ch.position.x, y: ch.position.y }; changed = true }
      if (ch.type === "dimensions") {
        // @xyflow/system 该版本尺寸字段为 dimensions（{width,height}），兼容 measured
        const c = ch as { dimensions?: { width: number; height: number }; measured?: { width: number; height: number } }
        const m = c.dimensions ?? c.measured
        if (m?.width && m?.height) { dims[ch.id] = { width: m.width, height: m.height }; dimsChanged = true }
      }
    }
    if (changed && !readOnly) mutate({ ...d, ui: { ...d.ui, positions } })
    if (dimsChanged) setNodeDims((s) => ({ ...s, ...dims }))
  }, [mutate, defRef, readOnly])

  const onConnect = useCallback((conn: Connection) => {
    if (readOnly) return  // R-Archive：封存画布禁止改图
    const d = defRef.current
    if (!d || !conn.source || !conn.target) return
    const sh = conn.sourceHandle ?? undefined
    if (d.graph.edges.some((e) => e.source === conn.source && e.target === conn.target && (e.sourceHandle ?? undefined) === sh)) {
      toast.error("不能重复连线")
      return
    }
    if (sh && d.graph.edges.some((e) => e.source === conn.source && e.sourceHandle === sh)) {
      toast.error("该分支已有出边，请先删除")
      return
    }
    mutate({ ...d, graph: { ...d.graph, edges: [...d.graph.edges, { id: `e_${Date.now() % 100000}`, source: conn.source, target: conn.target, sourceHandle: sh }] } })
  }, [readOnly, mutate, defRef])

  const onReconnect = useCallback((oldEdge: Edge, conn: Connection) => {
    if (readOnly) return  // R-Archive 一致性返工：改接同属改图，封存画布禁止
    if (!conn.source || !conn.target) return
    const d = defRef.current
    if (!d) return
    const edges2 = d.graph.edges.filter((e) => e.id !== oldEdge.id)
    edges2.push({ id: `e_${Date.now() % 100000}`, source: conn.source, target: conn.target, sourceHandle: conn.sourceHandle ?? undefined })
    mutate({ ...d, graph: { ...d.graph, edges: edges2 } })
  }, [readOnly, mutate, defRef])

  /* 08-27 V2：palette 拖拽落画布任意位置 */
  const quickAddAt = useCallback((typeKey: string, pos: { x: number; y: number }) => {
    const d = defRef.current!
    const defn = defs.find((x) => x.type_key === typeKey)
    const id = `n_${typeKey}_${Date.now() % 100000}`
    const node = {
      id, type: typeKey, name: defn?.label ?? typeKey,
      config: typeKey === "condition" ? { branches: [{ handle: "b1", logic: "AND", conditions: [] }] } : {},
      inputs: [], branches: typeKey === "condition" ? ["b1", "else"] : undefined,
    }
    mutate({
      ...d,
      ui: { ...d.ui, positions: { ...d.ui.positions, [id]: pos } },
      graph: { ...d.graph, nodes: [...d.graph.nodes, node] },
    })
    setSelectedId(id); setDrawer("config")
  }, [defs, mutate, defRef])

  const addNode = useCallback((typeKey: string) => {
    const d = defRef.current
    if (!d) return
    const defn = defs.find((x) => x.type_key === typeKey)
    const id = `n_${typeKey}_${Date.now() % 100000}`
    const node = {
      id, type: typeKey, name: defn?.label ?? typeKey,
      config: typeKey === "condition" ? { branches: [{ handle: "b1", logic: "AND", conditions: [] }] } : {},
      inputs: [], branches: typeKey === "condition" ? ["b1", "else"] : undefined,
    }
    mutate({
      ...d,
      ui: { ...d.ui, positions: { ...d.ui.positions, [id]: { x: 260 + d.graph.nodes.length * 30, y: 140 + d.graph.nodes.length * 24 } } },
      graph: { ...d.graph, nodes: [...d.graph.nodes, node] },
    })
    setSelectedId(id); setDrawer("config"); setPop(null)
  }, [defs, mutate, defRef])

  const autoLayout = useCallback(() => {
    const d = defRef.current
    if (!d) return
    const depth: Record<string, number> = {}
    const adj: Record<string, string[]> = {}
    d.graph.edges.forEach((e) => (adj[e.source] = [...(adj[e.source] ?? []), e.target]))
    const start = d.graph.nodes.find((n) => n.type === "input")
    if (start) {
      depth[start.id] = 0
      const q = [start.id]
      while (q.length) {
        const u = q.shift()!
        for (const v of adj[u] ?? []) if (depth[v] === undefined) { depth[v] = (depth[u] ?? 0) + 1; q.push(v) }
      }
    }
    const perDepth: Record<number, number> = {}
    const positions: Record<string, { x: number; y: number }> = {}
    for (const n of d.graph.nodes) {
      const dpt = depth[n.id] ?? 0
      const idx = perDepth[dpt] = (perDepth[dpt] ?? 0) + 1
      positions[n.id] = { x: 80 + dpt * 360, y: 80 + idx * 180 }
    }
    mutate({ ...d, ui: { ...d.ui, positions } })
  }, [mutate, defRef])

  const onPublish = useCallback(async () => {
    try {
      const res = await wfApi.publish(workflowId, "replica publish")  // 08-26 修复：独立工作流页发布必须用 workflowId
      toast.success(`已发布 V${res.versionNo}`)
      setPublishOpen(false)
      doc.setDef((d) => d && { ...d, workflow: { ...d.workflow, status: "published" } })
    } catch (e) {
      toast.error((e as Error).message.includes("409") ? "发布前校验未通过" : (e as Error).message)
    }
  }, [workflowId, doc])

  const onOpenHistory = useCallback(async () => {
    if (agentMeta && agentId) {
      // SDD B：Agent 模式展示 Agent 版本（发布产生的是 agent_version，不是工作流版本）
      setAgentVersions(await agentApi.versions(agentId).catch(() => []))
      setAgentReleases(await agentApi.releases(agentId).catch(() => []))
    } else {
      setVersions(await wfApi.versions(workflowId))
    }
    setDrawer("history")
  }, [agentMeta, agentId, workflowId])

  if (!def) return <div className="p-8 text-sm" style={{ color: C.ink2 }}>加载中…</div>

  const selected = def.graph.nodes.find((n) => n.id === selectedId) ?? null

  return (
    <div className="relative flex h-full flex-col" data-testid="wf-designer-root" style={{ background: C.canvas }}>
      <DesignerTopbar
        def={def} agentMeta={agentMeta} avatar={avatar} readOnly={readOnly}
        savedAt={doc.savedAt} revision={doc.revision} latestVersion={doc.latestVersion}
        agentVersionState={agentVersionState}
        issues={issues} drawer={drawer} onDrawer={setDrawer}
        lockUser={lock.lockUser} lockByOther={lock.lockByOther}
        canPublish={rbacCanPublish} canForceUnlock={rbac.can("admin.force-unlock")}
        onBack={() => navigate(agentMeta ? "/agents" : "/workflows")}
        onOpenMeta={() => setMetaOpen(true)}
        onOpenHistory={onOpenHistory}
        onForceUnlock={lock.forceUnlock}
        onSelectIssueNode={(id) => { setSelectedId(id); setDrawer("config") }}
        onSave={() => doc.doSave(defRef.current!)}
        onPublishClick={() => (issues.length ? setPublishOpen(true) : onPublish())}
      />

      {/* 画布区（relative：抽屉层以此为定位基准，避免钻到顶栏下被遮挡） */}
      <div className="relative flex min-h-0 flex-1">
        {drawer === "eval" && (agentMeta && agentId ? (
          <div className="absolute inset-y-0 right-0 z-20 flex w-[420px] max-w-[92vw] flex-col border-l bg-surface" style={{ borderColor: C.cardBorder }}>
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-[15px] font-semibold" style={{ color: C.ink }}>效果评测</span>
              <button onClick={() => setDrawer(null)} title="关闭效果评测"><X className="size-4 text-muted-foreground" /></button>
            </div>
            <div className="min-h-0 flex-1"><AgentEvalPanel agentId={agentId} /></div>
          </div>
        ) : (
          <EvalPanel workflowId={workflowId} onClose={() => setDrawer(null)} />
        ))}
        {drawer === "evo" && <EvoPanel workflowId={workflowId} onClose={() => setDrawer(null)} />}
        {agentMeta && agentId && (
          <AgentConfigDrawer agentId={agentId} onClose={() => undefined} inline readOnly avatar={avatar} />
        )}
        {!readOnly && (
          <NodePalette families={families} onAdd={addNode} open={paletteOpen}
            onToggle={() => setPaletteOpen((v) => { localStorage.setItem("wf-palette-open", v ? "0" : "1"); return !v })} />
        )}
        <WorkflowCanvas
          nodes={nodes} edges={edges} zoom={zoom} readOnly={readOnly} showMiniMap={showMiniMap}
          onNodesChange={onNodesChange} onConnect={onConnect} onReconnect={onReconnect}
          onDropNode={quickAddAt}
          onNodeClick={(id) => { setSelectedId(id); setSelectedEdgeId(null); setDrawer("config"); setPop(null) }}
          onEdgeClick={(id) => { setSelectedEdgeId(id); setSelectedId(null) }}
          onPaneClick={() => { setSelectedId(null); setSelectedEdgeId(null); setPop(null) }}
          onGestureStart={() => setPop(null)}
          onZoomChange={setZoom}
        >
          <DesignerBottomToolbar
            readOnly={readOnly} paletteOpen={paletteOpen}
            onTogglePalette={() => setPaletteOpen((v) => { localStorage.setItem("wf-palette-open", v ? "0" : "1"); return !v })}
            onUndo={doc.undo} onRedo={doc.redo}
            showMiniMap={showMiniMap} onToggleMiniMap={() => setShowMiniMap((v) => !v)}
            onAutoLayout={autoLayout} zoom={zoom}
            pop={pop} onPop={setPop}
            graphNodes={def.graph.nodes}
            onSearchPick={(id) => {
              const p = def.ui.positions[id]
              if (p) rf.setCenter(p.x + 150, p.y + 60, { zoom: 1, duration: 300 })
              setSelectedId(id); setPop(null)
            }}
            running={running}
            onTryRun={() => setDrawer("debug")}
          />

          {/* 抽屉层 */}
          {drawer === "config" && selected && (
            <NodeInspector node={selected} defs={defs} nodes={def.graph.nodes} edges={def.graph.edges}
              agentId={agentId || undefined}
              issues={issues.filter((i) => i.nodeId === selected.id)}
              onClose={() => setDrawer(null)}
              onChange={(n) => mutate({ ...def, graph: { ...def.graph, nodes: def.graph.nodes.map((x) => (x.id === n.id ? n : x)) } })}
              onRemoveBranchEdges={(nodeId, handles, nextNode) => mutate({
                ...def,
                graph: {
                  nodes: def.graph.nodes.map((x) => (x.id === nodeId ? nextNode : x)),
                  edges: def.graph.edges.filter((e) => !(e.source === nodeId && handles.includes(e.sourceHandle ?? ""))),
                },
              })} />
          )}
          {drawer === "debug" && (
            <DebugRunDrawer def={def} onClose={() => setDrawer(null)}
              onRun={async (vals) => { await startRealRun(vals); setDrawer(null) }} />
          )}
          {drawer === "schedule" && <ScheduleDialog workflowId={workflowId} onClose={() => setDrawer(null)} />}
          {drawer === "runs" && <WorkflowRunPanel workflowId={workflowId} lastRunId={lastRunId} onClose={() => setDrawer(null)} />}
          {drawer === "history" && (
            <WorkflowHistoryDialog agentMode={!!(agentMeta && agentId)}
              versions={versions} agentVersions={agentVersions} agentReleases={agentReleases}
              onDiff={(vid) => setDiffVersion(vid)} onClose={() => setDrawer(null)} />
          )}
        </WorkflowCanvas>
      </div>

      <WorkflowMetaDialog open={metaOpen} onOpenChange={setMetaOpen} workflowId={workflowId}
        initial={{
          name: def.workflow.name ?? "",
          description: ((def.workflow as unknown as { description?: string }).description) ?? "",
          icon: ((def.workflow as unknown as { icon?: string | null }).icon) ?? null,
        }}
        onSaved={(meta) => doc.setDef((d) => d && { ...d, workflow: { ...d.workflow, ...meta } as typeof d.workflow })} />

      <PublishWarnDialog open={publishOpen} onOpenChange={setPublishOpen}
        onTryRun={() => setDrawer("debug")} onPublish={onPublish} />

      {/* SDD B：Agent 级发布对话框已随 R-Archive 封存移除（画布只读不挂发布） */}
      {/* E-2.2：历史抽屉「对比」入口（该版本 vs 当前草稿） */}
      {agentMeta && agentId && (
        <AgentVersionDiffDialog agentId={agentId} open={!!diffVersion} onClose={() => setDiffVersion(null)}
          versions={agentVersions.map((v) => ({ versionId: v.versionId, versionNo: v.versionNo }))}
          defaultLeft={diffVersion ?? undefined} defaultRight="draft" />
      )}

      {/* E-4.3：节点单测对话框 */}
      <NodeTestDialog open={!!testNodeId} onOpenChange={(o) => { if (!o) setTestNodeId(null) }}
        workflowId={workflowId} nodeId={testNodeId}
        nodeName={def?.graph.nodes.find((n) => n.id === testNodeId)?.name ?? testNodeId ?? ""} />
    </div>
  )
}

export default function WfDesignerPage(props: DesignerPageProps) {
  return (
    <ReactFlowProvider>
      <div className="h-[calc(100dvh-3.5rem)] min-h-0">
        <DesignerInner {...props} />
      </div>
      <ToastHost />
    </ReactFlowProvider>
  )
}
