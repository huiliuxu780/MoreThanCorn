/** Agent Designer — quickservice 1:1 复刻版（16-ui-replication-spec.md）。
 *  后端契约不变（server/ :8100）。运行态为客户端 demo-run（P1 换真 SSE）。 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react"
import CodeMirror from "@uiw/react-codemirror"
import { python } from "@codemirror/lang-python"
import { AgentPublishDialog, useAgentVersionState } from "@/components/agent-publish-dialog"
import { ConversationPanel, MemorySchemaForm } from "@/components/agent-common-config"
import { useNavigate, useParams } from "react-router-dom"
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock,
  Crosshair,
  ZoomIn,
  ZoomOut,
  History,
  Inbox,
  LayoutTemplate,
  ListChecks,
  LockKeyhole,
  PanelLeftClose,
  Redo2,
  Undo2,
  PanelLeftOpen,
  FolderOpen,
  Map as MapIcon,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  Settings,
  Wrench,
  X,
  Zap,
  Activity,
  CalendarDays,
  Download,
  RotateCw,
  Bot,
  GitBranch,
  Network,
  Braces,
  Flag,
  FilePlus2,
  Bell,
  Server,
} from "lucide-react"
import {
  Background,
  Handle,
  MiniMap,
  Position,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  agentApi,
  evalApi,
  lockApi,
  runApi,
  runExportUrl,
  runRetry,
  scheduleApi,
  wfApi,
  WF_BASE,
  type NodeDefinition,
  type RunDetail,
  type ScheduleInfo,
  type ValidationIssue,
  type WfDefinition,
  type WfEdge,
  type WfNode,
} from "@/services/wf-api"
import { resApi } from "@/services/resource-api"
import { rbac } from "@/services/rbac"

/* ============ 视觉令牌（16 §1） ============ */
const C = {
  canvas: "#EEF1F6",
  dot: "#D9DEE7",
  primary: "#3D6BFF",
  orange: "#F97E2B",
  tagBg: "#FFF4EA",
  ink: "#1F2329",
  ink2: "#5A6472",
  ink3: "#B9C2CF",
  chipBg: "#F1F3F7",
  chipInk: "#7A8699",
  cardBorder: "#EDF0F4",
  danger: "#F56C6C",
}

/* Design Spec §8.5：黑白灰中性基底，禁止彩虹画布；icon 区分类型，颜色仅用于状态 */
const NEUTRAL = "#1F2329"
const TYPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  input: Play, llm: Bot, tool: Wrench, condition: GitBranch, transform: Braces,
  end: Flag, "create-record": FilePlus2, notification: Bell, "workflow-exec": Network,
  "knowledge-retrieval": BookOpen, "mcp-call": Server,
}
const TypeIcon = ({ type, className }: { type: string; className?: string }) => {
  const I = TYPE_ICON[type] ?? Braces
  return <I className={className} />
}

/* ============ Toast（16 §9：顶居中，红/绿边白底，2.5s 自隐） ============ */
let toastFn: ((kind: "error" | "success", msg: string) => void) | null = null
const toast = {
  error: (msg: string, _opts?: unknown) => toastFn?.("error", msg),
  success: (msg: string, _opts?: unknown) => toastFn?.("success", msg),
}
function ToastHost() {
  const [t, setT] = useState<{ kind: "error" | "success"; msg: string; key: number } | null>(null)
  useEffect(() => {
    toastFn = (kind, msg) => setT({ kind, msg, key: Date.now() })
    return () => { toastFn = null }
  }, [])
  useEffect(() => {
    if (!t) return
    const h = window.setTimeout(() => setT(null), 2500)
    return () => window.clearTimeout(h)
  }, [t])
  if (!t) return null
  const err = t.kind === "error"
  return (
    <div className="pointer-events-none fixed left-1/2 top-4 z-[100] -translate-x-1/2">
      <div className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs shadow-sm"
        style={{ borderColor: err ? C.danger : "#67C23A", background: err ? "#FEF0F0" : "#F0F9EB", color: err ? C.danger : "#67C23A" }}>
        {err ? <CircleAlert className="size-3.5" /> : <CheckCircle2 className="size-3.5" />} {t.msg}
      </div>
    </div>
  )
}

/* A-15：已删除硬编码 MODELS 回退——模型目录只来自注册表接口，失败显示空态 */

function TypeChip({ t }: { t: string }) {
  return (
    <span className="rounded px-1 text-[10px] leading-4" style={{ background: C.chipBg, color: C.chipInk }}>
      {t}.
    </span>
  )
}

/* ============ 节点卡（16 §3） ============ */
interface WfNodeData extends Record<string, unknown> {
  wf: WfNode
  def?: NodeDefinition
  issues: ValidationIssue[]
  run?: "running" | "success" | "failed" | "skipped"
  onRunNode?: (id: string) => void
  onDelete?: (id: string) => void
}

function SummaryRows({ n }: { n: WfNode }) {
  const cfg = n.config as Record<string, unknown>
  const rows: { label: string; body: React.ReactNode }[] = []
  const un = <span style={{ color: C.ink3 }}>未配置</span>
  if (n.type === "input") {
    rows.push({
      label: "输入",
      body: (
        <span className="flex flex-wrap gap-1">
          {["userQuery", "chatHistory", "userId"].map((k) => (
            <span key={k} className="text-xs" style={{ color: C.ink }}>{k} <TypeChip t="Str" /></span>
          ))}
        </span>
      ),
    })
  }
  if (n.type === "llm") {
    rows.push({ label: "输入", body: (n.inputs?.length ? <span className="text-xs">{n.inputs.map((i) => i.name).join("、")}</span> : un) })
    const model = (cfg.modelRef as { modelId?: string })?.modelId
    rows.push({ label: "模型", body: model ? <span className="text-xs">{model}</span> : un })
    rows.push({ label: "提示词", body: cfg.prompt ? <span className="max-w-40 truncate text-xs">{String(cfg.prompt)}</span> : un })
    rows.push({ label: "输出", body: <span className="flex flex-wrap gap-1 text-xs">output <TypeChip t="Str" /> thought <TypeChip t="Str" /></span> })
  }
  if (n.type === "tool") {
    rows.push({ label: "工具", body: cfg.toolVersionId ? <span className="text-xs">已绑定</span> : un })
  }
  if (n.type === "knowledge-retrieval") {
    rows.push({ label: "知识库", body: cfg.knowledgeSourceId ? <span className="text-xs">已绑定</span> : un })
    rows.push({ label: "查询", body: cfg.query ? <span className="max-w-40 truncate text-xs">{String(cfg.query)}</span> : un })
  }
  if (n.type === "mcp-call") {
    rows.push({ label: "MCP", body: cfg.mcpServerId ? <span className="text-xs">已绑定</span> : un })
    rows.push({ label: "工具", body: cfg.toolName ? <span className="text-xs">{String(cfg.toolName)}</span> : un })
  }
  if (n.type === "condition") {
    rows.push({ label: "如果", body: (cfg.branches as unknown[])?.length ? <span className="text-xs">已配置</span> : <span style={{ color: C.ink3 }} className="text-xs">未完成条件配置</span> })
    rows.push({ label: "否则", body: <span className="text-xs" style={{ color: C.ink2 }}>默认分支</span> })
  }
  if (n.type === "transform") rows.push({ label: "表达式", body: cfg.template ? <span className="text-xs">已配置</span> : un })
  if (n.type === "end") {
    rows.push({ label: "输出", body: <span className="text-xs">output <TypeChip t="Str" /></span> })
  }
  return (
    <div className="mt-2 space-y-1.5 overflow-hidden">
      {rows.map((r) => (
        <div key={r.label} className="flex items-start gap-2 text-xs">
          <span className="w-11 shrink-0" style={{ color: C.ink3 }}>{r.label}</span>
          <div className="min-w-0 flex-1 overflow-hidden" style={{ color: C.ink }}>{r.body}</div>
        </div>
      ))}
    </div>
  )
}

function WfNodeCard({ data, selected }: NodeProps) {
  const d = data as WfNodeData
  const n = d.wf
  const [collapsed, setCollapsed] = useState(false)
  const ring =
    d.run === "running" ? `ring-[1.5px] ring-[#525252]` :
    d.run === "success" ? `ring-[1.5px] ring-emerald-500/70` :
    d.run === "failed" ? `ring-[1.5px] ring-red-500` :
    d.run === "skipped" ? `ring-[1.5px] ring-neutral-300` :
    selected ? `ring-[1.5px] ring-[#3D6BFF]` : ""
  return (
    <div className={`relative w-[300px] overflow-hidden rounded-lg border bg-white p-3 shadow-sm ${ring}`} style={{ borderColor: selected ? C.primary : C.cardBorder }}>
      {n.type !== "input" && <Handle type="target" position={Position.Left} style={{ width: 12, height: 12, background: "#fff", border: `2px solid ${C.primary}`, borderRadius: 6 }} />}
      {n.type !== "end" && <Handle type="source" position={Position.Right} style={{ width: 12, height: 12, background: C.primary, border: "2px solid #fff", borderRadius: 6 }} />}
      <div className="flex items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md" style={{ background: NEUTRAL }}>
          <TypeIcon type={n.type} className="size-3.5 text-white" />
        </span>
        <span className="flex-1 truncate text-sm font-medium" style={{ color: C.ink }}>{n.name}</span>
        {d.run === "running" && <span className="size-3 animate-spin rounded-full border-2 border-neutral-400 border-t-transparent" />}
        {selected && (
          <>
            <button className="flex size-5 items-center justify-center rounded-full border bg-white" style={{ borderColor: C.cardBorder }} onClick={() => d.onRunNode?.(n.id)} title="运行此节点">
              <Play className="size-2.5" style={{ color: C.ink }} />
            </button>
            <Popover>
              <PopoverTrigger asChild>
                <button className="flex size-5 items-center justify-center rounded-full border bg-white" style={{ borderColor: C.cardBorder }} title="更多">
                  <MoreHorizontal className="size-2.5 text-neutral-500" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-24 p-1">
                <button className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-neutral-50" style={{ color: C.danger }} onClick={() => d.onDelete?.(n.id)}>
                  删除节点
                </button>
              </PopoverContent>
            </Popover>
          </>
        )}
        <button onClick={() => setCollapsed((v) => !v)} className="text-neutral-400 hover:text-neutral-600">
          {collapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
        </button>
      </div>
      {!collapsed && <SummaryRows n={n} />}
    </div>
  )
}
const nodeTypes = { wf: WfNodeCard }

/* ============ 变量级联（16 §6；SDD A-04：可达祖先 + 注册表 io + 按 id；C-5：系统变量组） ============ */
let SYS_VARS_CACHE: { name: string; label: string }[] | null = null
function loadSystemVars(): Promise<{ name: string; label: string }[]> {
  if (SYS_VARS_CACHE) return Promise.resolve(SYS_VARS_CACHE)
  return fetch(`${WF_BASE}/api/registry/system-variables`).then((r) => r.json())
    .then((j) => { SYS_VARS_CACHE = j.items ?? []; return SYS_VARS_CACHE! })
    .catch(() => [] as { name: string; label: string }[])
}

function parseIoOutputs(def: NodeDefinition | undefined): { name: string; type: string }[] | null {
  const io = (def?.io ?? {}) as { outputs?: unknown }
  if (!Array.isArray(io.outputs)) return null  // 动态输出（如 tool from-tool-version）
  return io.outputs.map((s) => {
    const [name, type] = String(s).split(":")
    return { name, type: type || "string" }
  })
}

function VarCascader({ nodes, edges, selfId, defs, onPick }: {
  nodes: WfNode[]; edges: WfEdge[]; selfId: string; defs: NodeDefinition[]; onPick: (v: string) => void
}) {
  const [sysVars, setSysVars] = useState<{ name: string; label: string }[]>(SYS_VARS_CACHE ?? [])
  useEffect(() => { if (!SYS_VARS_CACHE) loadSystemVars().then(setSysVars) }, [])
  // 与后端校验器 _ancestors 同构：只有控制流可达的祖先输出可见（调研 11 §5.2）
  const ancestors = useMemo(() => {
    const parents: Record<string, string[]> = {}
    for (const e of edges) (parents[e.target] ??= []).push(e.source)
    const memo: Record<string, Set<string>> = {}
    const reach = (nid: string, seen: Set<string>): Set<string> => {
      if (memo[nid]) return memo[nid]
      const acc = new Set<string>()
      for (const p of parents[nid] ?? []) {
        if (seen.has(p)) continue
        acc.add(p)
        for (const x of reach(p, new Set([...seen, nid]))) acc.add(x)
      }
      memo[nid] = acc
      return acc
    }
    return reach(selfId, new Set([selfId]))
  }, [edges, selfId])
  const startNode = nodes.find((n) => n.type === "input")
  const ancNodes = nodes.filter((n) => ancestors.has(n.id) && n.type !== "input" && n.type !== "end")
  const firstId = "system"
  const [group, setGroup] = useState<string>(firstId)
  const gid = group || firstId
  const itemsFor = (id: string): { name: string; type: string; label?: string }[] => {
    if (id === "system") return sysVars.map((v) => ({ name: v.name, type: "string", label: v.label }))
    const node = nodes.find((n) => n.id === id)
    if (!node) return []
    return parseIoOutputs(defs.find((d) => d.type_key === node.type)) ?? []
  }
  const dynHint = (id: string) => {
    const node = nodes.find((n) => n.id === id)
    const io = (defs.find((d) => d.type_key === node?.type)?.io ?? {}) as { outputs?: unknown }
    return typeof io.outputs === "string" && io.outputs
  }
  const nameOf = (id: string) => (id === "system" ? "系统变量" : id === startNode?.id ? "开始" : nodes.find((n) => n.id === id)?.name ?? id)
  return (
    <div className="flex text-xs">
      <div className="w-28 border-r py-1" style={{ borderColor: C.cardBorder }}>
        {["system", ...(startNode ? [startNode.id] : []), ...ancNodes.map((n) => n.id)].map((id) => (
          <button key={id} className={`flex w-full items-center justify-between px-2 py-1 hover:bg-neutral-50 ${gid === id ? "bg-neutral-100" : ""}`} onClick={() => setGroup(id)}>
            {nameOf(id)} <ChevronRight className="size-3 text-neutral-400" />
          </button>
        ))}
        {!startNode && ancNodes.length === 0 && <div className="px-2 py-1 text-neutral-400">无可引用上游</div>}
      </div>
      <div className="w-40 py-1">
        {itemsFor(gid).map((it) => (
          <button key={it.name} className="flex w-full items-center gap-1 px-2 py-1 hover:bg-neutral-50"
            onClick={() => onPick(`{{${gid === "system" ? "system" : gid}.outputs.${it.name}}}`)}
            title={it.label}>
            {it.label ?? it.name} <TypeChip t={it.type === "array" ? "Arr" : it.type === "object" ? "Obj" : "Str"} />
          </button>
        ))}
        {dynHint(gid) && <div className="px-2 py-1 text-neutral-400">输出由资源配置决定</div>}
        {itemsFor(gid).length === 0 && !dynHint(gid) && <div className="px-2 py-1 text-neutral-400">无输出</div>}
      </div>
    </div>
  )
}

/* ============ 配置抽屉（16 §6） ============ */
function ResourceSelect({ types, value, onPick, placeholder }: {
  types: string
  value?: string
  onPick: (item: { id: string; name: string; metadata: Record<string, unknown> }) => void
  placeholder: string
}) {
  const [items, setItems] = useState<{ id: string; name: string; metadata: Record<string, unknown> }[]>([])
  useEffect(() => { resApi.registry(types).then((r) => setItems(r.items)).catch(() => undefined) }, [types])
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="flex w-full items-center gap-2 rounded-md border bg-white px-2 py-1.5 text-left text-xs" style={{ borderColor: C.cardBorder, color: C.ink }}>
          <span className="flex-1 truncate">{items.find((i) => i.id === value)?.name ?? placeholder}</span>
          <ChevronDown className="size-3.5 text-neutral-400" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-1" align="start">
        {items.length === 0 && <div className="px-2 py-1.5 text-xs" style={{ color: C.ink3 }}>暂无 Enabled 资源</div>}
        {items.map((m) => (
          <button key={m.id} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-neutral-50" style={{ color: C.ink }} onClick={() => onPick(m)}>
            <span className="flex-1 truncate text-left">{m.name}</span>
            {value === m.id && <CheckCircle2 className="size-3.5" style={{ color: C.primary }} />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-b py-3" style={{ borderColor: C.cardBorder }}>
      <button className="flex items-center gap-1 text-[13px] font-medium" style={{ color: C.ink }} onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />} {title}
      </button>
      {open && <div className="pt-2">{children}</div>}
    </div>
  )
}

function ConfigDrawer(props: {
  node: WfNode | null
  defs: NodeDefinition[]
  nodes: WfNode[]
  edges: WfEdge[]
  agentId?: string
  onClose: () => void
  onChange: (n: WfNode) => void
}) {
  const { node, defs, nodes, edges, agentId, onClose, onChange } = props
  const [varTarget, setVarTarget] = useState<"prompt" | string | null>(null)
  const [openBr, setOpenBr] = useState<Record<number, boolean>>({})
  if (!node) return null
  const def = defs.find((d) => d.type_key === node.type)
  const [models, setModels] = useState<{ id: string; caps: string[] }[]>([])
  useEffect(() => {
    resApi.registry("model").then((r) => setModels(r.items.map((m) => ({
      id: (m.metadata.modelKey as string) || m.id,
      caps: (m.metadata.capabilities as string[]) ?? [],
    })))).catch(() => setModels([]))
  }, [])
  const [mcpTools, setMcpTools] = useState<string[]>([])
  useEffect(() => {
    const sid = (node.config as Record<string, any>)?.mcpServerId
    if (!sid) { setMcpTools([]); return }
    resApi.get("mcp", sid).then((d) => setMcpTools(((d.config?.discoveredTools as { name?: string }[] | undefined) ?? []).map((t) => t.name ?? ""))).catch(() => undefined)
  }, [(node.config as Record<string, any>)?.mcpServerId])
  /* SDD D-1：成员池联动——agent-select/agent/agent-exec 的候选来自 Agent 成员配置 */
  const [memberPool, setMemberPool] = useState<{ id: string; name: string }[]>([])
  useEffect(() => {
    if (!agentId || !["agent-select", "agent", "agent-exec"].includes(node?.type ?? "")) return
    agentApi.get(agentId).then((a) => {
      const ids = ((a.config?.members ?? []) as string[])
      agentApi.list({ pageSize: 100 }).then((r) => {
        setMemberPool(ids.map((id) => ({ id, name: r.items.find((x) => x.id === id)?.name ?? id })))
      }).catch(() => setMemberPool(ids.map((id) => ({ id, name: id }))))
    }).catch(() => undefined)
  }, [agentId, node?.type])  // eslint-disable-line react-hooks/exhaustive-deps
  const cfg = node.config as Record<string, any>
  const set = (k: string, v: unknown) => onChange({ ...node, config: { ...cfg, [k]: v } })
  const setBranch = (i: number, patch: Record<string, unknown>) => {
    const bs = [...(cfg.branches ?? [])]
    bs[i] = { ...bs[i], ...patch }
    set("branches", bs)
  }
  const insertVar = (v: string) => {
    if (varTarget === "prompt") set("prompt", `${cfg.prompt ?? ""}${v}`)
    else if (varTarget?.startsWith("__brv")) setBranch(Number(varTarget.slice(5)), { value: v })
    else if (varTarget?.startsWith("__br")) setBranch(Number(varTarget.slice(4)), { variable: v })
    else if (varTarget) {
      const inputs = (node.inputs ?? []).map((b) => (b.name === varTarget ? { ...b, source: { kind: "fixed" as const, value: v } } : b))
      onChange({ ...node, inputs })
    }
    setVarTarget(null)
  }
  return (
    <div className="absolute inset-y-0 right-0 z-20 w-[360px] max-w-[92vw] overflow-y-auto border-l bg-white px-4" style={{ borderColor: C.cardBorder }}>
      <div className="sticky top-0 z-10 flex items-center gap-2 bg-white py-3">
        <span className="flex size-6 items-center justify-center rounded-md" style={{ background: NEUTRAL }}>
          <TypeIcon type={node.type} className="size-3.5 text-white" />
        </span>
        <span className="flex-1 text-[15px] font-semibold" style={{ color: C.ink }}>{node.name}</span>
        <MoreHorizontal className="size-4 text-neutral-400" />
        <button onClick={onClose}><X className="size-4 text-neutral-500" /></button>
      </div>
      <p className="pb-2 text-xs leading-5" style={{ color: C.ink2 }}>
        {def?.family === "智能" ? "大模型节点可调用大语言模型，根据输入参数与提示词生成指定格式的回复" :
         node.type === "end" ? "工作流的结束节点，在工作流完成运行后将相关信息通过Agent回答或通过API输入到其余工作流或外部系统中" :
         node.type === "condition" ? "条件判断节点可定义多个判断条件，对应多个流程分支。实现不同业务规则的分流" :
         "节点配置"}
      </p>
      {node.type === "llm" && (
        <>
          {/* R1 修复：移除“单次/批处理”假开关（无后端语义，批处理未实现——宁缺勿假） */}
          <Section title="模型">
            <Popover>
              <PopoverTrigger asChild>
                <button className="flex w-full items-center gap-2 rounded-md border bg-white px-2 py-1.5 text-left text-xs" style={{ borderColor: C.cardBorder, color: C.ink }}>
                  <span className="flex size-4 items-center justify-center rounded" style={{ background: "#5B8DEF" }}><Zap className="size-2.5 text-white" /></span>
                  <span className="flex-1 truncate">{cfg.modelRef?.modelId || "请选择模型"}</span>
                  <ChevronDown className="size-3.5 text-neutral-400" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-1" align="start">
                {models.map((m) => (
                  <button key={m.id} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-neutral-50" style={{ color: C.ink }}
                    onClick={() => set("modelRef", { ...cfg.modelRef, modelId: m.id })}>
                    <span className="flex size-4 items-center justify-center rounded" style={{ background: "#5B8DEF" }}><Zap className="size-2.5 text-white" /></span>
                    <span className="flex-1 truncate text-left">{m.id}</span>
                    {m.caps.map((c) => <span key={c} className="rounded px-1 text-[10px]" style={{ background: C.chipBg, color: C.chipInk }}>{c}</span>)}
                    {cfg.modelRef?.modelId === m.id && <CheckCircle2 className="size-3.5" style={{ color: C.primary }} />}
                  </button>
                ))}
              </PopoverContent>
            </Popover>
          </Section>
          <Section title="输入">
            <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2 pb-1 text-xs" style={{ color: C.ink3 }}>
              <span>变量名</span><span>类型</span><span className="w-24">变量值</span>
            </div>
            {(node.inputs ?? []).length === 0 && (
              <div className="flex flex-col items-center gap-1 py-6" style={{ color: C.ink3 }}>
                <Inbox className="size-8" />
                <span className="text-[11px]">No data</span>
              </div>
            )}
            {(node.inputs ?? []).map((b) => (
              <div key={b.name} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 py-1 text-xs">
                <span style={{ color: C.ink }}>{b.name}</span>
                <TypeChip t={b.type === "string" ? "Str" : b.type} />
                <Popover>
                  <PopoverTrigger asChild>
                    <button className="w-24 truncate rounded border px-1 py-0.5 text-left" style={{ borderColor: C.cardBorder, color: C.ink2 }}
                      onClick={() => setVarTarget(b.name)}>
                      {b.source.kind === "fixed" ? String(b.source.value || "请输入或引用变量值") : "引用"}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent><VarCascader nodes={nodes} edges={edges} selfId={node.id} defs={defs} onPick={insertVar} /></PopoverContent>
                </Popover>
              </div>
            ))}
            <button className="flex items-center gap-1 pt-1 text-xs" style={{ color: C.primary }}
              onClick={() => onChange({ ...node, inputs: [...(node.inputs ?? []), { name: `var${(node.inputs ?? []).length + 1}`, type: "string", source: { kind: "fixed", value: "" } }] })}>
              <Plus className="size-3" /> 添加
            </button>
          </Section>
          <Section title="提示词">
            <div className="relative">
              <Textarea
                className="min-h-24 text-xs"
                placeholder="请输入提示词"
                value={cfg.prompt ?? ""}
                onChange={(e) => {
                  set("prompt", e.target.value)
                  if (e.target.value.endsWith("#")) setVarTarget("prompt")
                }}
              />
              {varTarget === "prompt" && (
                <div className="absolute left-0 top-full z-30 rounded-md border bg-white shadow-lg" style={{ borderColor: C.cardBorder }}>
                  <VarCascader nodes={nodes} edges={edges} selfId={node.id} defs={defs} onPick={(v) => { set("prompt", `${(cfg.prompt ?? "").replace(/#$/, "")}${v}`); setVarTarget(null) }} />
                </div>
              )}
            </div>
            <p className="pt-1 text-[11px]" style={{ color: C.ink3 }}>输入 “#” 唤起变量选择器，支持插入变量</p>
          </Section>
          <Section title="输出">
            <div className="flex items-center gap-2 text-xs"><span style={{ color: C.ink2 }}>输出格式 :</span>
              <Select value={String(cfg.outputFormat ?? "Markdown")} onValueChange={(v) => set("outputFormat", v)}>
                <SelectTrigger className="h-6 w-28 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="Markdown">Markdown</SelectItem><SelectItem value="JSON">JSON</SelectItem></SelectContent>
              </Select>
            </div>
            <p className="py-1 text-[11px]" style={{ color: C.ink3 }}>大模型将以{cfg.outputFormat ?? "Markdown"}形式输出最终答案</p>
            <div className="space-y-1 py-1 text-xs">
              {[["output", "大模型的全部输出"], ["thought", "大模型的思考过程"], ["answer", "大模型的回复答案"]].map(([k, dsc]) => (
                <div key={k} className="grid grid-cols-[1fr_auto_1.4fr] gap-1"><span style={{ color: C.ink }}>{k}</span><TypeChip t="Str" /><span style={{ color: C.ink3 }}>{dsc}</span></div>
              ))}
            </div>
            {/* R1 修复：移除“输出示例”假按钮（仅 toast，无生成无保存） */}
          </Section>
        </>
      )}
      {node.type === "tool" && (
        <Section title="插件工具">
          <ResourceSelect types="tool" value={cfg.toolId ?? ""} placeholder="选择 Tool（仅 Enabled）"
            onPick={async (m) => {
              let versionId = ""
              try {
                const vs = await resApi.toolVersions(m.id)
                versionId = vs[0]?.id ?? ""
              } catch { /* 忽略 */ }
              onChange({ ...node, config: { ...cfg, toolId: m.id, toolVersionId: versionId } })
            }} />
          <p className="pt-1 text-[11px]" style={{ color: C.ink3 }}>默认绑定最新版本；节点引用计入删除防护。</p>
        </Section>
      )}
      {node.type === "knowledge-retrieval" && (
        <>
          <Section title="Knowledge Source">
            <ResourceSelect types="knowledge" value={cfg.knowledgeSourceId ?? ""} placeholder="选择 Knowledge Source（仅 Enabled）"
              onPick={(m) => set("knowledgeSourceId", m.id)} />
          </Section>
          <Section title="检索配置">
            <input className="w-full rounded-md border p-2 text-xs" style={{ borderColor: C.cardBorder }}
              value={cfg.query ?? ""} onChange={(e) => set("query", e.target.value)} placeholder="{{s.outputs.userQuery}}" />
            <div className="flex items-center gap-2 pt-2 text-xs" style={{ color: C.ink3 }}>
              topK
              <input type="number" className="w-20 rounded-md border p-1.5 text-xs" style={{ borderColor: C.cardBorder }}
                value={cfg.topK ?? 5} onChange={(e) => set("topK", Number(e.target.value))} />
            </div>
          </Section>
        </>
      )}
      {node.type === "mcp-call" && (
        <>
          <Section title="MCP Server">
            <ResourceSelect types="mcp" value={cfg.mcpServerId ?? ""} placeholder="选择 MCP Server（仅 Enabled）"
              onPick={(m) => set("mcpServerId", m.id)} />
          </Section>
          <Section title="MCP 工具">
            <Select value={(cfg.toolName as string) || undefined} onValueChange={(v) => set("toolName", v)}>
              <SelectTrigger className="h-8 w-full text-xs"><SelectValue placeholder="选择工具" /></SelectTrigger>
              <SelectContent>
                {mcpTools.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="pt-1 text-[11px]" style={{ color: C.ink3 }}>工具列表来自 MCP Server 握手发现；无真实服务时为示例工具（不可当真）。</p>
          </Section>
        </>
      )}
      {node.type === "condition" && (
        <Section title="条件分支">
          {(cfg.branches ?? []).map((b: any, i: number) => (
            <div key={i} className="mb-2 rounded-md p-2" style={{ background: "#F7F9FC" }}>
              <button className="flex items-center gap-1 pb-1 text-xs" style={{ color: C.ink2 }} onClick={() => setOpenBr((s) => ({ ...s, [i]: !(s[i] ?? true) }))}>
                {openBr[i] ?? true ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                {i === 0 ? "如果" : `否则如果 ${i}`}
              </button>
              {(openBr[i] ?? true) && (
                <div className="grid grid-cols-[1fr_auto] gap-1">
                  <Popover>
                    <PopoverTrigger asChild><button className="truncate rounded border bg-white px-1 py-0.5 text-left text-xs" style={{ borderColor: (b as any).variable ? C.cardBorder : C.danger }} onClick={() => setVarTarget(`__br${i}`)}>{(b as any).variable ? "已引用" : "引用变量"}</button></PopoverTrigger>
                    <PopoverContent><VarCascader nodes={nodes} edges={edges} selfId={node.id} defs={defs} onPick={insertVar} /></PopoverContent>
                  </Popover>
                  <Select value={(b as any).operator || undefined} onValueChange={(v) => setBranch(i, { operator: v })}>
                    <SelectTrigger className="h-6 w-28 text-xs"><SelectValue placeholder="条件关系" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="eq">等于</SelectItem><SelectItem value="neq">不等于</SelectItem>
                      <SelectItem value="contains">包含</SelectItem><SelectItem value="not_contains">不包含</SelectItem>
                      <SelectItem value="empty">为空</SelectItem><SelectItem value="not_empty">不为空</SelectItem>
                      <SelectItem value="gt">大于</SelectItem><SelectItem value="lt">小于</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input className="h-6 text-xs" placeholder="比较变量" value={(b as any).value ?? ""} onChange={(e) => setBranch(i, { value: e.target.value })} />
                  <Popover>
                    <PopoverTrigger asChild><button className="flex size-6 items-center justify-center rounded border bg-white" style={{ borderColor: C.cardBorder }} title="引用变量" onClick={() => setVarTarget(`__brv${i}`)}><Settings className="size-3 text-neutral-500" /></button></PopoverTrigger>
                    <PopoverContent><VarCascader nodes={nodes} edges={edges} selfId={node.id} defs={defs} onPick={insertVar} /></PopoverContent>
                  </Popover>
                </div>
              )}
            </div>
          ))}
          <div className="flex gap-3">
            <button className="flex items-center gap-1 text-xs" style={{ color: C.primary }} onClick={() => set("branches", [...(cfg.branches ?? []), { handle: `b${(cfg.branches ?? []).length + 1}` }])}>
              <Plus className="size-3" /> 添加条件
            </button>
            <button className="flex items-center gap-1 text-xs" style={{ color: C.primary }} onClick={() => set("branches", [...(cfg.branches ?? []), { handle: `b${(cfg.branches ?? []).length + 1}` }])}>
              <Plus className="size-3" /> 添加分支
            </button>
          </div>
          <div className="pt-1 text-xs" style={{ color: C.ink2 }}>否则</div>
        </Section>
      )}
      {node.type === "end" && (
        <Section title="输出">
          <div className="grid grid-cols-[1fr_auto_1.4fr] items-center gap-2 pb-1 text-xs" style={{ color: C.ink3 }}><span>变量名</span><span>类型</span><span>变量值（可引用上游）</span></div>
          {(node.inputs ?? []).map((b) => (
            <div key={b.name} className="grid grid-cols-[1fr_auto_1.4fr] items-center gap-2 py-1 text-xs">
              <span style={{ color: C.ink }}>{b.name}</span><TypeChip t="Str" />
              {b.source.kind === "upstream" ? (
                <div className="flex items-center gap-1">
                  <span className="flex-1 truncate rounded border px-1 py-0.5" style={{ borderColor: C.cardBorder, color: C.primary }}>
                    {`{{${(b.source as { nodeId: string }).nodeId}.outputs.${(b.source as { path: string }).path.replace(/^outputs\./, "")}}}`}
                  </span>
                  <button title="改为固定值" onClick={() => onChange({ ...node, inputs: (node.inputs ?? []).map((x) => (x.name === b.name ? { ...x, source: { kind: "fixed", value: "" } } : x)) })}>
                    <X className="size-3 text-neutral-400" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <Input className="h-6 flex-1 text-xs" placeholder="固定值" value={String((b.source as { value?: unknown }).value ?? "")}
                    onChange={(e) => onChange({ ...node, inputs: (node.inputs ?? []).map((x) => (x.name === b.name ? { ...x, source: { kind: "fixed", value: e.target.value } } : x)) })} />
                  <Popover>
                    <PopoverTrigger asChild>
                      <button className="shrink-0 rounded border px-1 py-0.5 text-[10px]" style={{ borderColor: C.cardBorder, color: C.primary }} title="引用变量">引用</button>
                    </PopoverTrigger>
                    <PopoverContent className="w-72" align="start">
                      <VarCascader nodes={nodes} edges={edges} selfId={node.id} defs={defs}
                        onPick={(v) => {
                          const m = /^\{\{(.+?)\.outputs\.(.+?)\}\}$/.exec(v)
                          if (m) onChange({ ...node, inputs: (node.inputs ?? []).map((x) => (x.name === b.name ? { ...x, source: { kind: "upstream", nodeId: m[1], path: `outputs.${m[2]}` } } : x)) })
                        }} />
                    </PopoverContent>
                  </Popover>
                </div>
              )}
            </div>
          ))}
          <button className="flex items-center gap-1 pt-1 text-xs" style={{ color: C.primary }}
            onClick={() => onChange({ ...node, inputs: [...(node.inputs ?? []), { name: `out${(node.inputs ?? []).length + 1}`, type: "string", source: { kind: "fixed", value: "" } }] })}>
            <Plus className="size-3" /> 添加
          </button>
        </Section>
      )}
      {node.type === "workflow-exec" && <WorkflowPicker value={(cfg.workflowCode as string) ?? ""} onPick={(v) => set("workflowCode", v)} />}
      {/* 用户报告修复：代码编写/Query改写/决策分类 专项表单（原通用表单与执行器键不匹配=假功能） */}
      {node.type === "code-write" && (
        <Section title="代码（Python 沙箱，10s 超时）">
          <div className="overflow-hidden rounded-md border" style={{ borderColor: C.cardBorder }}>
            <CodeMirror
              value={typeof cfg.code === "string" ? cfg.code : ""}
              onChange={(v) => set("code", v)}
              theme="light"
              height="180px"
              extensions={[python()]}
              placeholder={'def main(args):\n    # args.params 为输入绑定值字典\n    return {"output": args.params.get("input", "")}'}
              basicSetup={{ lineNumbers: true, foldGutter: true, autocompletion: true, bracketMatching: true, highlightActiveLine: true }}
              style={{ fontSize: 12 }}
            />
          </div>
          <p className="pt-1 text-[11px]" style={{ color: C.ink3 }}>必须定义 main(args)，返回 dict；输入来自下方输入绑定（args.params）。</p>
          <Section title="输入绑定">
            {(node.inputs ?? []).map((b) => (
              <div key={b.name} className="flex items-center gap-2 pb-1 text-xs">
                <span className="w-20 truncate" style={{ color: C.ink }}>{b.name}</span>
                <Input className="h-6 flex-1 text-xs" placeholder="固定值" value={b.source.kind === "fixed" ? String((b.source as { value?: unknown }).value ?? "") : ""}
                  onChange={(e) => onChange({ ...node, inputs: (node.inputs ?? []).map((x) => (x.name === b.name ? { ...x, source: { kind: "fixed", value: e.target.value } } : x)) })} />
              </div>
            ))}
            <button className="flex items-center gap-1 pt-1 text-xs" style={{ color: C.primary }}
              onClick={() => onChange({ ...node, inputs: [...(node.inputs ?? []), { name: `in${(node.inputs ?? []).length + 1}`, type: "string", source: { kind: "fixed", value: "" } }] })}>
              <Plus className="size-3" /> 添加输入
            </button>
          </Section>
        </Section>
      )}
      {node.type === "query-rewrite" && (
        <Section title="Query 改写">
          <div className="flex items-center gap-2 pb-1 text-xs" style={{ color: C.ink2 }}>
            <span>策略</span>
            <Select value={(cfg.strategy as string) ?? "default"} onValueChange={(v) => set("strategy", v)}>
              <SelectTrigger className="h-7 flex-1 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="default">默认（透传原问题）</SelectItem>
                <SelectItem value="custom">自定义（LLM 改写）</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {cfg.strategy === "custom" && (
            <Textarea className="min-h-20 text-xs"
              placeholder="改写提示词（真 LLM 生效；无模型配置时回落透传）"
              value={typeof cfg.template === "string" ? cfg.template : ""} onChange={(e) => set("template", e.target.value)} />
          )}
          <p className="pt-1 text-[11px]" style={{ color: C.ink3 }}>输出 queryList（数组）。输入绑定在下方输入区（query / chatHistory）。</p>
          <Section title="输入绑定">
            {(node.inputs ?? []).map((b) => (
              <div key={b.name} className="flex items-center gap-2 pb-1 text-xs">
                <span className="w-24 truncate" style={{ color: C.ink }}>{b.name}</span>
                <Input className="h-6 flex-1 text-xs" placeholder="固定值或留空取 Start" value={b.source.kind === "fixed" ? String((b.source as { value?: unknown }).value ?? "") : ""}
                  onChange={(e) => onChange({ ...node, inputs: (node.inputs ?? []).map((x) => (x.name === b.name ? { ...x, source: { kind: "fixed", value: e.target.value } } : x)) })} />
              </div>
            ))}
            <button className="flex items-center gap-1 pt-1 text-xs" style={{ color: C.primary }}
              onClick={() => onChange({ ...node, inputs: [...(node.inputs ?? []), { name: (node.inputs ?? []).length === 0 ? "query" : "chatHistory", type: "string", source: { kind: "fixed", value: "" } }] })}>
              <Plus className="size-3" /> 添加输入
            </button>
          </Section>
        </Section>
      )}
      {node.type === "decision-class" && (
        <Section title="分类项（命中走对应分支，未命中走 else）">
          {((cfg.branches as { title?: string; description?: string }[] | undefined) ?? []).map((br, i) => (
            <div key={i} className="space-y-1 rounded border p-1.5" style={{ borderColor: C.cardBorder }}>
              <div className="flex items-center gap-1">
                <Input className="h-6 flex-1 text-xs" placeholder={`分类 ${i + 1} 名称`} value={br.title ?? ""}
                  onChange={(e) => { const bs = [...((cfg.branches as object[]) ?? [])]; bs[i] = { ...bs[i], title: e.target.value }; set("branches", bs) }} />
                <button onClick={() => set("branches", ((cfg.branches as object[]) ?? []).filter((_, j) => j !== i))}><X className="size-3 text-neutral-400" /></button>
              </div>
              <Input className="h-6 text-xs" placeholder="分类说明（供路由判断）" value={br.description ?? ""}
                onChange={(e) => { const bs = [...((cfg.branches as object[]) ?? [])]; bs[i] = { ...bs[i], description: e.target.value }; set("branches", bs) }} />
              <div className="text-[10px]" style={{ color: C.ink3 }}>分支出口：c{i}（在画布上从该节点拉线即分支）</div>
            </div>
          ))}
          <button className="flex items-center gap-1 pt-1 text-xs" style={{ color: C.primary }}
            onClick={() => set("branches", [...((cfg.branches as object[]) ?? []), { title: "", description: "" }])}>
            <Plus className="size-3" /> 添加分类
          </button>
        </Section>
      )}
      {/* SDD D-1：Agent 节点从成员池选择 */}
      {node.type === "agent-select" && (
        <Section title="主要 Agent（来自左侧成员池）">
          {memberPool.length === 0 && <p className="text-xs" style={{ color: C.ink3 }}>成员池为空，请先在左侧「成员 Agent」添加</p>}
          {memberPool.map((m) => {
            const primary = (cfg.primaryAgents as string[] | undefined) ?? []
            const checked = primary.includes(m.id)
            return (
              <label key={m.id} className="flex cursor-pointer items-center gap-1 py-0.5 text-xs" style={{ color: C.ink }}>
                <Checkbox checked={checked}
                  onCheckedChange={(v) => set("primaryAgents", v ? [...primary, m.id] : primary.filter((x) => x !== m.id))} />
                <span className="truncate">{m.name}</span>
              </label>
            )
          })}
          <div className="pt-1 text-xs" style={{ color: C.ink2 }}>兜底 Agent（未命中主要时使用）</div>
          <Select value={(cfg.fallbackAgent as string) || undefined} onValueChange={(v) => set("fallbackAgent", v)}>
            <SelectTrigger className="h-7 w-full text-xs"><SelectValue placeholder="不配置兜底" /></SelectTrigger>
            <SelectContent>
              {memberPool.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </Section>
      )}
      {(node.type === "agent" || node.type === "agent-exec") && (
        <Section title={node.type === "agent" ? "固定 Agent（来自成员池）" : "执行 Agent"}>
          <Select value={(cfg.agentCode as string) || undefined} onValueChange={(v) => set("agentCode", v)}>
            <SelectTrigger className="h-7 w-full text-xs"><SelectValue placeholder="请选择" /></SelectTrigger>
            <SelectContent>
              {memberPool.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {node.type === "agent-exec" && (
            <p className="pt-1 text-[11px]" style={{ color: C.ink3 }}>也可不选，通过输入绑定 agentCode（如 Agent选择 节点的输出）动态执行。</p>
          )}
        </Section>
      )}
      {/* SDD C-3：无专项表单的节点按注册表 schema 通用渲染（替代“暂无专项配置区”） */}
      {!["llm", "tool", "knowledge-retrieval", "mcp-call", "condition", "end", "workflow-exec", "agent-select", "agent", "agent-exec", "code-write", "query-rewrite", "decision-class"].includes(node.type) && (
        <GenericSchemaForm def={def} cfg={cfg} set={set} node={node} onChange={onChange} />
      )}
    </div>
  )
}

/** 注册表 schema 驱动的通用节点配置（SDD C-3）。 */
function GenericSchemaForm({ def, cfg, set, node, onChange }: {
  def: NodeDefinition | undefined; cfg: Record<string, any>; set: (k: string, v: unknown) => void;
  node: WfNode; onChange: (n: WfNode) => void
}) {
  const props = ((def?.schema as Record<string, any>)?.properties ?? {}) as Record<string, any>
  const keys = Object.keys(props)
  if (keys.length === 0) return null
  return (
    <Section title="配置">
      {keys.map((k) => {
        const p = props[k] ?? {}
        const x = p["x-control"] as string | undefined
        const label = k
        if (x === "workflow-picker") {
          return <WorkflowPicker key={k} value={(cfg[k] as string) ?? ""} onPick={(v) => set(k, v)} />
        }
        if (Array.isArray(p.enum)) {
          return (
            <div key={k} className="space-y-1">
              <div className="text-xs" style={{ color: C.ink2 }}>{label}</div>
              <Select value={(cfg[k] as string) || undefined} onValueChange={(v) => set(k, v)}>
                <SelectTrigger className="h-7 w-full text-xs"><SelectValue placeholder="请选择" /></SelectTrigger>
                <SelectContent>
                  {p.enum.map((v: string) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )
        }
        if (p.type === "boolean") {
          return (
            <label key={k} className="flex items-center justify-between text-xs" style={{ color: C.ink2 }}>
              <span>{label}</span>
              <Switch checked={!!cfg[k]} onCheckedChange={(v) => set(k, v)} />
            </label>
          )
        }
        if (p.type === "number") {
          return (
            <div key={k} className="space-y-1">
              <div className="text-xs" style={{ color: C.ink2 }}>{label}</div>
              <Input className="h-7 text-xs" type="number" value={cfg[k] ?? ""} onChange={(e) => set(k, Number(e.target.value))} />
            </div>
          )
        }
        if (p.type === "array") {
          const arr = Array.isArray(cfg[k]) ? cfg[k] : []
          return (
            <div key={k} className="space-y-1">
              <div className="text-xs" style={{ color: C.ink2 }}>{label}（每行一项）</div>
              <Textarea className="min-h-14 text-xs" value={arr.join("\n")}
                onChange={(e) => set(k, e.target.value.split("\n").map((s: string) => s.trim()).filter(Boolean))} />
            </div>
          )
        }
        // string / object / 其他：多行文本（prompt-editor、code 等）
        return (
          <div key={k} className="space-y-1">
            <div className="text-xs" style={{ color: C.ink2 }}>{label}</div>
            <Textarea className={`min-h-20 text-xs ${x === "prompt-editor" || k === "code" ? "font-mono" : ""}`}
              value={typeof cfg[k] === "string" ? cfg[k] : JSON.stringify(cfg[k] ?? "", null, 2)}
              onChange={(e) => set(k, e.target.value)} />
          </div>
        )
      })}
      {node.type === "memory-variable" && cfg.mode === "write" && (
        <Section title="写入值（输入绑定：变量名=记忆键）">
          {(node.inputs ?? []).map((b) => (
            <div key={b.name} className="flex items-center gap-2 pb-1 text-xs">
              <span style={{ color: C.ink }}>{b.name}</span>
              <Input className="h-6 text-xs" placeholder="请输入或引用变量值"
                value={b.source.kind === "fixed" ? String(b.source.value ?? "") : `{{引用}}`}
                onChange={(e) => onChange({ ...node, inputs: (node.inputs ?? []).map((x) => (x.name === b.name ? { ...x, source: { kind: "fixed", value: e.target.value } } : x)) })} />
            </div>
          ))}
          <button className="flex items-center gap-1 pt-1 text-xs" style={{ color: C.primary }}
            onClick={() => onChange({ ...node, inputs: [...(node.inputs ?? []), { name: `mem${(node.inputs ?? []).length + 1}`, type: "string", source: { kind: "fixed", value: "" } }] })}>
            <Plus className="size-3" /> 添加写入键
          </button>
        </Section>
      )}
    </Section>
  )
}

/* ============ 调试配置抽屉（16 §7） ============ */
function DebugDrawer(props: { def: WfDefinition; onClose: () => void; onRun: (vals: Record<string, string>) => void }) {
  const { onClose, onRun } = props
  const [vals, setVals] = useState<Record<string, string>>({})
  const [chat, setChat] = useState([{ u: "user: 你好", a: "answer: 你好，有什么可以帮助你的吗？" }])
  return (
    <div className="absolute inset-y-0 right-0 z-20 flex w-[380px] max-w-[92vw] flex-col border-l bg-white" style={{ borderColor: C.cardBorder }}>
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-[15px] font-semibold" style={{ color: C.ink }}>调试配置</span>
        <button onClick={onClose}><X className="size-4 text-neutral-500" /></button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-4">
        {["userQuery", "userId", "conversationId", "chatId"].map((k) => (
          <div key={k}>
            <div className="pb-1 text-[13px]" style={{ color: C.ink }}>{k} <span className="text-[11px]" style={{ color: C.ink3 }}>String</span></div>
            <Input placeholder="系统内置参数，按需填写" value={vals[k] ?? ""} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} />
          </div>
        ))}
        <div>
          <div className="pb-1 text-[13px]" style={{ color: C.ink }}>chatHistory <span className="text-[11px]" style={{ color: C.ink3 }}>String</span></div>
          {chat.map((c, i) => (
            <div key={i} className="mb-1 rounded-md px-2 py-1 text-xs" style={{ background: "#F7F9FC", color: C.ink }}>
              <Input className="mb-1 h-6 border-0 bg-transparent p-0" value={c.u} onChange={(e) => { const n = [...chat]; n[i] = { ...n[i], u: e.target.value }; setChat(n) }} />
              <Input className="h-6 border-0 bg-transparent p-0" value={c.a} onChange={(e) => { const n = [...chat]; n[i] = { ...n[i], a: e.target.value }; setChat(n) }} />
            </div>
          ))}
          <button className="flex items-center gap-1 text-xs" style={{ color: C.primary }} onClick={() => setChat([...chat, { u: "user: ", a: "answer: " }])}>
            <Plus className="size-3" /> 添加一组对话
          </button>
        </div>
      </div>
      <div className="p-4">
        <Button className="w-full bg-black text-white hover:bg-neutral-800" onClick={() => onRun(vals)}>开始运行</Button>
      </div>
    </div>
  )
}





/* ============ 工作流资源选择器（引用资源对象） ============ */
function WorkflowPicker({ value, onPick }: { value: string; onPick: (v: string) => void }) {
  const [list, setList] = useState<{ id: string; name: string }[]>([])
  useEffect(() => { wfApi.list({ pageSize: 100 }).then((r) => setList(r.items as { id: string; name: string }[])).catch(() => undefined) }, [])
  return (
    <Section title="工作流">
      <Select value={value || undefined} onValueChange={(v) => onPick(v)}>
        <SelectTrigger className="h-8 w-full text-xs"><SelectValue placeholder="请选择工作流资源" /></SelectTrigger>
        <SelectContent>
          {list.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </Section>
  )
}

/* ============ Agent 配置信息抽屉（对话编排型，quickservice 同款） ============ */
/* A-16：已移除私有 WF_BASE2 包装，统一走 wf-api 服务层；原 AddInline 自由文本添加器随 A-10/A-11 删除 */

/* A-11：知识兜底多选（真注册表）。A-10 已删除：闲聊兜底死开关/高级设置死行/词库/经验库/记忆自由文本。 */
function KnowledgeFallbackPicker({ ids, onChange }: { ids: string[]; onChange: (v: string[]) => void }) {
  const [items, setItems] = useState<{ id: string; name: string }[]>([])
  const [open, setOpen] = useState(false)
  useEffect(() => { resApi.registry("knowledge").then((r) => setItems(r.items)).catch(() => setItems([])) }, [])
  const nameOf = (id: string) => items.find((i) => i.id === id)?.name ?? id
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium" style={{ color: C.ink }}>| Agent 知识兜底</span>
        <button className="text-xs" style={{ color: C.primary }} onClick={() => setOpen(!open)}>{open ? "收起" : "添加知识"}</button>
      </div>
      {ids.length === 0 && !open && (
        <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-lg border" style={{ borderColor: C.cardBorder, background: "#FAFBFC" }}>
          <FolderOpen className="size-8 text-neutral-300" />
          <span className="px-4 text-center text-xs" style={{ color: C.ink3 }}>添加知识文件，让Agent具备知识信息大脑</span>
        </div>
      )}
      {ids.map((id) => (
        <div key={id} className="flex items-center gap-1 text-xs">
          <span className="flex-1 truncate rounded border px-1 py-0.5" style={{ borderColor: C.cardBorder }}>{nameOf(id)}</span>
          <button onClick={() => onChange(ids.filter((x) => x !== id))}><X className="size-3 text-neutral-400" /></button>
        </div>
      ))}
      {open && (
        <div className="max-h-40 space-y-0.5 overflow-y-auto rounded border p-1" style={{ borderColor: C.cardBorder }}>
          {items.length === 0 && <div className="px-1 py-1 text-[11px]" style={{ color: C.ink3 }}>暂无 Enabled 知识资源</div>}
          {items.map((it) => (
            <label key={it.id} className="flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-xs hover:bg-neutral-50">
              <Checkbox checked={ids.includes(it.id)}
                onCheckedChange={(v) => onChange(v ? [...ids, it.id] : ids.filter((x) => x !== it.id))} />
              <span className="truncate">{it.name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

/* SDD D-1：专家组成员池选择器（排除自身；供 Agent选择/执行节点联动） */
function MemberPoolPicker({ ids, onChange, selfId }: { ids: string[]; onChange: (v: string[]) => void; selfId: string }) {
  const [all, setAll] = useState<{ id: string; name: string }[]>([])
  const [open, setOpen] = useState(false)
  useEffect(() => {
    agentApi.list({ pageSize: 100 }).then((r) => setAll(r.items.filter((a) => a.id !== selfId))).catch(() => undefined)
  }, [selfId])
  const nameOf = (id: string) => all.find((a) => a.id === id)?.name ?? id
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium" style={{ color: C.ink }}>| 成员 Agent</span>
        <button className="text-xs" style={{ color: C.primary }} onClick={() => setOpen(!open)}>{open ? "收起" : "添加成员"}</button>
      </div>
      {ids.length === 0 && !open && (
        <p className="text-[11px]" style={{ color: C.ink3 }}>添加后，画布中「Agent选择/执行」节点可从成员池选择。</p>
      )}
      {ids.map((id) => (
        <div key={id} className="flex items-center gap-1 text-xs">
          <span className="flex-1 truncate rounded border px-1 py-0.5" style={{ borderColor: C.cardBorder }}>{nameOf(id)}</span>
          <button onClick={() => onChange(ids.filter((x) => x !== id))}><X className="size-3 text-neutral-400" /></button>
        </div>
      ))}
      {open && (
        <div className="max-h-40 space-y-0.5 overflow-y-auto rounded border p-1" style={{ borderColor: C.cardBorder }}>
          {all.length === 0 && <div className="px-1 py-1 text-[11px]" style={{ color: C.ink3 }}>暂无可添加的 Agent</div>}
          {all.map((a) => (
            <label key={a.id} className="flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-xs hover:bg-neutral-50">
              <Checkbox checked={ids.includes(a.id)}
                onCheckedChange={(v) => onChange(v ? [...ids, a.id] : ids.filter((x) => x !== a.id))} />
              <span className="truncate">{a.name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

function AgentConfigDrawer({ agentId, inline, avatar, onAvatar, onClose }: { agentId: string; onClose?: () => void; inline?: boolean; avatar?: string; onAvatar?: (v: string) => void }) {
  const [avatarOpen, setAvatarOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [agent, setAgent] = useState<{ name: string; description: string; config: Record<string, any>; workflowId?: string | null; configRevision: number; avatar?: string | null; type?: string } | null>(null)
  useEffect(() => {
    agentApi.get(agentId).then(setAgent)
  }, [agentId])
  if (!agent) return null
  const cfg = agent.config ?? {}
  const setCfg = (k: string, v: unknown) => setAgent({ ...agent, config: { ...cfg, [k]: v } })
  const save = async () => {
    try {
      const r = await agentApi.update(agentId, { config: cfg, workflowId: agent.workflowId, name: agent.name, description: agent.description }, agent.configRevision)
      setAgent({ ...agent, config: r.config, configRevision: r.configRevision })
      toast.success("Agent 配置已保存")
    } catch (e) {
      if (String((e as Error).message).startsWith("409")) {
        toast.error("配置已被更新，请刷新后重试")
        agentApi.get(agentId).then(setAgent)
      } else toast.error((e as Error).message)
    }
  }
  if (collapsed) {
    return (
      <div className="flex h-full w-10 shrink-0 flex-col items-center border-r bg-white py-2" style={{ borderColor: C.cardBorder }}>
        <button className="rounded p-1 hover:bg-neutral-100" title="展开配置" onClick={() => setCollapsed(false)}>
          <PanelLeftOpen className="size-4" style={{ color: C.ink2 }} />
        </button>
      </div>
    )
  }
  return (
    <div className={inline ? "flex h-full w-[360px] max-w-[92vw] shrink-0 flex-col border-r bg-white" : "absolute inset-y-0 right-0 z-20 flex w-[360px] max-w-[92vw] flex-col border-l bg-white"} style={{ borderColor: C.cardBorder }}>
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-[15px] font-semibold" style={{ color: C.ink }}>Agent 配置信息</span>
        <span className="flex items-center gap-2">
          <button className="rounded p-1 hover:bg-neutral-100" title="收起配置" onClick={() => setCollapsed(true)}>
            <PanelLeftClose className="size-4" style={{ color: C.ink2 }} />
          </button>
          {!inline && <button onClick={onClose}><X className="size-4 text-neutral-500" /></button>}
        </span>
      </div>
<div className="flex-1 space-y-4 overflow-y-auto p-4">
        <div className="space-y-2">
          <span className="text-[13px] font-medium" style={{ color: C.ink }}>| 基本信息</span>
          <div className="flex items-start gap-3">
            <div className="flex-1 space-y-3">
              <div className="relative">
                <Input value={agent.name} maxLength={20} placeholder="请输入Agent名称" className="pr-12"
                  onChange={(e) => setAgent({ ...agent, name: e.target.value })} />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px]" style={{ color: C.ink3 }}>{agent.name.length}/20</span>
              </div>
              <div className="relative">
                <Textarea value={agent.description} maxLength={20000} placeholder="请输入该Agent描述介绍文案（仅在管理平台展示）" className="min-h-24 pb-6"
                  onChange={(e) => setAgent({ ...agent, description: e.target.value })} />
                <span className="absolute bottom-2 right-2 text-[11px]" style={{ color: C.ink3 }}>{(agent.description ?? "").length}/20000</span>
              </div>
            </div>
            <button className="shrink-0 overflow-hidden rounded-lg border bg-white p-1" style={{ borderColor: C.cardBorder }} title="选择头像"
              onClick={() => setAvatarOpen(true)}>
              {/* 头像优先级：本次会话新选 > 已保存头像 > 默认第一张（bugfix：此前漏读已保存头像） */}
              <img src={avatar ?? agent.avatar ?? "/avatars/avatar-0.png"} alt="agent头像" className="size-24 rounded-md object-cover" />
            </button>
            <Dialog open={avatarOpen} onOpenChange={setAvatarOpen}>
              <DialogContent className="max-w-2xl">
                <DialogHeader><DialogTitle>推荐头像</DialogTitle></DialogHeader>
                <div className="text-xs" style={{ color: C.ink2 }}>推荐图形</div>
                <div className="grid grid-cols-6 gap-3 pt-2">
                  {Array.from({ length: 20 }, (_, i) => `/avatars/avatar-${i}.png`).map((src) => (
                    <button key={src} className={`overflow-hidden rounded-lg ${avatar === src ? "ring-2 ring-primary" : ""}`}
                      onClick={() => { onAvatar?.(src); setAvatarOpen(false) }}>
                      <img src={src} alt="头像" className="size-full object-cover" />
                    </button>
                  ))}
                </div>
                <div className="pt-3 text-xs" style={{ color: C.ink2 }}>自定义上传</div>
                <input type="file" accept="image/*" className="pt-1 text-xs"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (!f) return
                    const r = new FileReader()
                    r.onload = () => { onAvatar?.(String(r.result)); setAvatarOpen(false) }
                    r.readAsDataURL(f)
                  }} />
              </DialogContent>
            </Dialog>
          </div>
        </div>
        {/* A-10 门面已删除；Phase B：结构化记忆 Schema + 对话体验真实现 */}
        <KnowledgeFallbackPicker ids={cfg.knowledges ?? []} onChange={(v) => setCfg("knowledges", v)} />
        {/* SDD D-1：专家组成员池（画布 Agent选择/执行节点从这里取候选） */}
        {agent.type === "expert-group" && (
          <MemberPoolPicker ids={(cfg.members ?? []) as string[]} onChange={(v) => setCfg("members", v)} selfId={agentId} />
        )}
        <div className="space-y-2">
          <span className="text-[13px] font-medium" style={{ color: C.ink }}>| Agent 记忆</span>
          <MemorySchemaForm memories={cfg.memoriesSchema ?? []} onChange={(v) => setCfg("memoriesSchema", v)} />
        </div>
        <div className="space-y-2">
          <span className="text-[13px] font-medium" style={{ color: C.ink }}>| 对话体验</span>
          <ConversationPanel cfg={cfg} setCfg={(v) => setAgent({ ...agent, config: v })} />
        </div>
        <Button size="sm" className="bg-black text-white hover:bg-neutral-800" onClick={save}>保存配置</Button>
      </div>
    </div>
  )
}

function ScheduleDrawer({ workflowId, onClose }: { workflowId: string; onClose: () => void }) {
  const [list, setList] = useState<ScheduleInfo[]>([])
  const [cron, setCron] = useState("0 9 * * *")
  const [tz, setTz] = useState("Asia/Shanghai")
  const load = useCallback(() => { scheduleApi.list(workflowId).then(setList) }, [workflowId])
  useEffect(() => { load() }, [load])
  return (
    <div className="absolute inset-y-0 right-0 z-20 flex w-[380px] max-w-[92vw] flex-col border-l bg-white" style={{ borderColor: C.cardBorder }}>
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-[15px] font-semibold" style={{ color: C.ink }}>定时任务</span>
        <button onClick={onClose}><X className="size-4 text-neutral-500" /></button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto px-4">
        <div className="space-y-2 rounded-md p-2" style={{ background: "#F7F9FC" }}>
          <div className="text-xs" style={{ color: C.ink2 }}>Cron 表达式</div>
          <Input className="h-7 text-xs" value={cron} onChange={(e) => setCron(e.target.value)} />
          <div className="text-xs" style={{ color: C.ink2 }}>时区</div>
          <Input className="h-7 text-xs" value={tz} onChange={(e) => setTz(e.target.value)} />
          <Button size="sm" className="bg-black text-white hover:bg-neutral-800"
            onClick={async () => { try { await scheduleApi.create(workflowId, cron, tz); load() } catch (e) { toast.error((e as Error).message) } }}>
            创建定时任务
          </Button>
        </div>
        {list.map((sc) => (
          <div key={sc.id} className="rounded-md border p-2 text-xs" style={{ borderColor: C.cardBorder }}>
            <div className="flex items-center gap-2">
              <span className="font-medium" style={{ color: C.ink }}>{sc.cron}</span>
              <span style={{ color: C.ink3 }}>{sc.timezone}</span>
              <span className={sc.enabled ? "text-emerald-600" : ""} style={{ color: sc.enabled ? undefined : C.ink3 }}>
                {sc.enabled ? "启用" : "停用"}
              </span>
              <div className="ml-auto flex gap-1">
                <Button variant="outline" size="sm" className="h-6 text-[11px]"
                  onClick={async () => { await (sc.enabled ? scheduleApi.disable(sc.id) : scheduleApi.enable(sc.id)); load() }}>
                  {sc.enabled ? "停用" : "启用"}
                </Button>
                <Button variant="outline" size="sm" className="h-6 text-[11px]"
                  onClick={async () => { await scheduleApi.remove(sc.id); load() }}>删除</Button>
              </div>
            </div>
            <div className="pt-1" style={{ color: C.ink3 }}>
              下次执行：{sc.nextRunAt ? new Date(sc.nextRunAt).toLocaleString() : "—"}
              {sc.lastRanAt ? ` · 上次：${new Date(sc.lastRanAt).toLocaleString()}` : ""}
            </div>
          </div>
        ))}
        {list.length === 0 && <div className="py-8 text-center text-xs" style={{ color: C.ink3 }}>暂无定时任务</div>}
      </div>
    </div>
  )
}

/* ============ 运行观测抽屉（P1） ============ */
function RunsDrawer({ workflowId, lastRunId, onClose }: { workflowId: string; lastRunId: string | null; onClose: () => void }) {
  const [runs, setRuns] = useState<RunDetail[]>([])
  const [sel, setSel] = useState<RunDetail | null>(null)
  const [filter, setFilter] = useState("")
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const load = useCallback(async () => {
    const list = await runApi.list(workflowId)
    const details = await Promise.all(list.slice(0, 10).map((r) => runApi.detail(r.runId)))
    setRuns(details)
    setSel((cur) => details.find((d) => d.runId === (cur?.runId ?? lastRunId)) ?? details[0] ?? null)
  }, [workflowId, lastRunId])
  useEffect(() => { load(); const t = setInterval(load, 3000); return () => clearInterval(t) }, [load])
  const STATUS_COLOR: Record<string, string> = { succeeded: "#188F00", failed: "#F56C6C", running: "#3D6BFF", queued: "#B9C2CF", cancelled: "#B9C2CF" }
  return (
    <div className="absolute inset-y-0 right-0 z-20 flex w-[400px] max-w-[92vw] flex-col border-l bg-white" style={{ borderColor: C.cardBorder }}>
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-[15px] font-semibold" style={{ color: C.ink }}>运行观测</span>
        <button onClick={onClose}><X className="size-4 text-neutral-500" /></button>
      </div>
      <div className="flex-1 overflow-y-auto px-4">
        <div className="flex items-center gap-2 pb-2">
          <Select value={filter || undefined} onValueChange={(v) => setFilter(v)}>
            <SelectTrigger className="h-6 w-28 text-xs"><SelectValue placeholder="全部状态" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="succeeded">succeeded</SelectItem>
              <SelectItem value="failed">failed</SelectItem>
              <SelectItem value="running">running</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1 pb-3">
          {runs.filter((r) => !filter || r.status === filter).length === 0 && <div className="py-10 text-center text-xs" style={{ color: C.ink3 }}>暂无运行记录</div>}
          {runs.filter((r) => !filter || r.status === filter).map((r) => (
            <Fragment key={r.runId}><button className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-xs ${sel?.runId === r.runId ? "border-neutral-400" : ""}`} style={{ borderColor: sel?.runId === r.runId ? undefined : C.cardBorder }} onClick={() => setSel(r)}>
              <span className="size-2 rounded-full" style={{ background: STATUS_COLOR[r.status] ?? "#B9C2CF" }} />
              <span style={{ color: C.ink }}>{r.trigger}</span>
              <span style={{ color: C.ink3 }}>{r.status}</span>
              <span className="ml-auto" style={{ color: C.ink3 }}>{r.durationMs != null ? `${r.durationMs}ms` : ""}</span>
            </button>
            <div className="flex gap-1 pl-4">
              {r.status === "failed" && (
                <button className="flex items-center gap-1 text-[11px]" style={{ color: C.primary }}
                  onClick={async () => { await runRetry(r.runId); load() }}>
                  <RotateCw className="size-3" /> 重试
                </button>
              )}
              <a className="flex items-center gap-1 text-[11px]" style={{ color: C.ink2 }} href={runExportUrl(r.runId)} target="_blank" rel="noreferrer">
                <Download className="size-3" /> 导出
              </a>
            </div>
            </Fragment>
          ))}
        </div>
        {sel && (
          <div className="space-y-1 border-t pt-2" style={{ borderColor: C.cardBorder }}>
            <div className="pb-1 text-xs font-medium" style={{ color: C.ink2 }}>节点执行顺序（点击行展开完整输出）</div>
            {sel.nodeRuns.map((n) => (
              <button key={n.nodeRunId} className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:opacity-90" style={{ background: "#F7F9FC" }}
                onClick={() => setExpanded((s) => ({ ...s, [n.nodeRunId]: !s[n.nodeRunId] }))}>
                <div className="flex items-center gap-2">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: STATUS_COLOR[n.status] ?? "#B9C2CF" }} />
                  <span className="truncate" style={{ color: C.ink }}>{n.nodeId}</span>
                  <span className="shrink-0" style={{ color: C.ink3 }}>{n.nodeType}</span>
                  <span className="ml-auto shrink-0" style={{ color: C.ink3 }}>{n.durationMs != null ? `${n.durationMs}ms` : n.status}</span>
                </div>
                {n.output && (
                  expanded[n.nodeRunId] ? (
                    <div className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap break-all rounded bg-white p-1.5 font-mono text-[11px]" style={{ color: C.ink2, border: `1px solid ${C.cardBorder}` }}>
                      {JSON.stringify(n.output, null, 2)}
                    </div>
                  ) : (
                    <div className="truncate pt-1" style={{ color: C.ink2 }}>{JSON.stringify(n.output).slice(0, 90)}…</div>
                  )
                )}
                {n.error && <div className="break-all pt-1" style={{ color: C.danger }}>{n.error.message}</div>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ============ 主页面 ============ */
function DesignerInner({ workflowId: wfProp, agentId: agentProp, agentMeta, avatar }: { workflowId?: string; agentId?: string; agentMeta?: { name: string; typeLabel: string; agentType?: string }; avatar?: string }) {
  const params = useParams()
  const workflowId = wfProp ?? params.agentId ?? ""
  const agentId = agentProp ?? ""
  const navigate = useNavigate()
  const rf = useReactFlow()
  const [def, setDef] = useState<WfDefinition | null>(null)
  const [defs, setDefs] = useState<NodeDefinition[]>([])
  const [issues, setIssues] = useState<ValidationIssue[]>([])
  const [savedAt, setSavedAt] = useState("")
  const [revision, setRevision] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [drawer, setDrawer] = useState<"config" | "debug" | "history" | "runs" | "schedule" | "agent" | "eval" | "evo" | null>(null)
  const [showMiniMap, setShowMiniMap] = useState(true)
  const [runState, setRunState] = useState<Record<string, "running" | "success" | "failed" | "skipped">>({})
  const [lastRunId, setLastRunId] = useState<string | null>(null)
  const [publishOpen, setPublishOpen] = useState(false)
  const [agentPublishOpen, setAgentPublishOpen] = useState(false)
  const rbacCanPublish = rbac.can("agent.publish")  // D-4：发布门禁
  /* SDD B：Agent 级版本/部署状态（agentMeta 模式的徽标与发布对话框） */
  const agentVersionState = useAgentVersionState(agentMeta && agentId ? agentId : undefined)
  const [pop, setPop] = useState<null | "add" | "zoom" | "search">(null)
  const [versions, setVersions] = useState<{ versionNo: number; publishedAt: string }[]>([])
  const [agentVersions, setAgentVersions] = useState<{ versionId: string; versionNo: number; note: string; artifactHash: string; createdAt: string }[]>([])
  const [agentReleases, setAgentReleases] = useState<{ environment: string; status: string; versionNo: number | null }[]>([])
  const [latestVersion, setLatestVersion] = useState<number | null>(null)
  const [zoom, setZoom] = useState(1)
  const [lockUser, setLockUser] = useState("")
  /* bugfix：v12 MiniMap 读用户节点对象的 measured；受控模式下测量结果经
     onNodesChange 的 dimensions 事件下发，此前被丢弃导致小地图全空 */
  const [nodeDims, setNodeDims] = useState<Record<string, { width: number; height: number }>>({})
  const [agentAvatar, setAgentAvatar] = useState<string | undefined>(undefined)
  const historyRef = useRef<WfDefinition[]>([])
  const pointerRef = useRef(-1)
  const wsIdRef = useRef(Math.random().toString(36).slice(2, 8))
  const saveTimer = useRef<number | null>(null)
  const defRef = useRef<WfDefinition | null>(null)
  defRef.current = def

  /* 真实编辑锁与操作人（后端 resource_lock；SDD A-16 走 lockApi） */
  useEffect(() => {
    const wsId = wsIdRef.current
    lockApi.acquire(workflowId, wsId, "质量管理员")
      .then((r) => setLockUser(r.user ?? "")).catch(() => undefined)
    return () => { lockApi.release(workflowId, wsId).catch(() => undefined) }
  }, [workflowId])

  useEffect(() => {
    let alive = true
    Promise.all([wfApi.get(workflowId), wfApi.nodeDefinitions()]).then(([d, nd]) => {
      if (!alive) return
      historyRef.current = [JSON.parse(JSON.stringify(d.definition))]
      pointerRef.current = 0
      setDef(d.definition); setRevision(d.draftRevision); setDefs(nd); setSavedAt(d.updatedAt)
      wfApi.validate(workflowId).then((r) => alive && setIssues(r.issues))
    })
    wfApi.versions(workflowId).then((vs) => alive && setLatestVersion(vs[0]?.versionNo ?? null)).catch(() => undefined)
    return () => { alive = false }
  }, [workflowId])

  const doSave = useCallback(async (next: WfDefinition) => {
    try {
      const res = await wfApi.saveDraft(workflowId, next, revision)
      setRevision((r) => r + 1); setSavedAt(res.savedAt)
      setIssues((await wfApi.validate(workflowId)).issues)
    } catch (e) { toast.error(`保存失败：${(e as Error).message}`) }
  }, [workflowId, revision])

  const mutate = useCallback((next: WfDefinition) => {
    const h = historyRef.current.slice(0, pointerRef.current + 1)
    h.push(JSON.parse(JSON.stringify(next)))
    if (h.length > 50) h.shift()
    historyRef.current = h
    pointerRef.current = h.length - 1
    defRef.current = next
    setDef(next)
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => doSave(next), 1200)
  }, [doSave])

  const applyHistory = useCallback((defn: WfDefinition) => {
    setDef(defn)
    doSave(defn)
  }, [doSave])

  const undo = useCallback(() => {
    if (pointerRef.current > 0) {
      pointerRef.current -= 1
      applyHistory(JSON.parse(JSON.stringify(historyRef.current[pointerRef.current])))
    }
  }, [applyHistory])

  const redo = useCallback(() => {
    if (pointerRef.current < historyRef.current.length - 1) {
      pointerRef.current += 1
      applyHistory(JSON.parse(JSON.stringify(historyRef.current[pointerRef.current])))
    }
  }, [applyHistory])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      }
      /* 用户报告修复：连线可删除——点选连线后按 Delete/Backspace */
      if ((e.key === "Delete" || e.key === "Backspace") && selectedEdgeId) {
        e.preventDefault()
        const d = defRef.current
        if (d) mutate({ ...d, graph: { ...d.graph, edges: d.graph.edges.filter((x) => x.id !== selectedEdgeId) } })
        setSelectedEdgeId(null)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [undo, redo, selectedEdgeId, mutate])

  const nodes: Node[] = useMemo(() => (def?.graph.nodes ?? []).map((n) => ({
    id: n.id, type: "wf",
    position: def!.ui.positions[n.id] ?? { x: 120, y: 160 },
    ...(nodeDims[n.id] ? { measured: nodeDims[n.id] } : {}),
    data: {
      wf: n, def: defs.find((d) => d.type_key === n.type),
      issues: issues.filter((i) => i.nodeId === n.id),
      run: runState[n.id],
      onRunNode: (id: string) => demoRun([id]),
      onDelete: (id: string) => {
        const d2 = defRef.current!
        mutate({ ...d2, graph: { nodes: d2.graph.nodes.filter((x) => x.id !== id), edges: d2.graph.edges.filter((e) => e.source !== id && e.target !== id) } })
        setSelectedId(null)
      },
    } satisfies WfNodeData,
  })), [def, defs, issues, runState, mutate, nodeDims])

  const edges: Edge[] = useMemo(() => (def?.graph.edges ?? []).map((e) => ({
    id: e.id, source: e.source, target: e.target,
    style: { stroke: selectedEdgeId === e.id ? "#F56C6C" : "#A8B3C5", strokeWidth: selectedEdgeId === e.id ? 2.5 : 1.5 },
    interactionWidth: 24,
  })), [def, selectedEdgeId])

  const families = useMemo(() => {
    // SDD C-2：按编排器类型过滤节点目录（调研 11 §7 editorKinds）
    const kind: "FLOW" | "GROUP" | "WORKFLOW" = agentMeta
      ? ((agentMeta as { agentType?: string }).agentType === "expert-group" ? "GROUP" : "FLOW")
      : "WORKFLOW"
    const visible = defs.filter((d) => (d.editor_kinds ?? ["WORKFLOW"]).includes(kind))
    const m = new Map<string, NodeDefinition[]>()
    for (const d of visible) m.set(d.family, [...(m.get(d.family) ?? []), d])
    return [...m.entries()]
  }, [defs, agentMeta])

  /* demo-run（16 §7，P1 换真 SSE） */
  /* P1：真执行 — POST /api/runs + SSE 事件驱动画布状态 */
  const subscribeRun = useCallback((runId: string) => {
    const es = new EventSource(runApi.eventsUrl(runId))
    const onNode = (e: MessageEvent) => {
      const d = JSON.parse(e.data)
      const st = e.type === "node_started" ? "running" : e.type === "node_completed" ? "success" : e.type === "node_skipped" ? "skipped" : "failed"
      if (d.nodeId) setRunState((s) => ({ ...s, [d.nodeId]: st as "running" }))
    }
    for (const t of ["node_started", "node_completed", "node_failed", "node_skipped"]) es.addEventListener(t, onNode)
    es.addEventListener("workflow_completed", () => { toast.success("运行成功"); es.close() })
    es.addEventListener("workflow_failed", (e) => { const d = JSON.parse((e as MessageEvent).data); toast.error(`运行失败：${d.payload?.error ?? ""}`); es.close() })
  }, [])

  const startRealRun = useCallback(async (input: Record<string, unknown>) => {
    const rep = await wfApi.validate(workflowId)
    setIssues(rep.issues)
    if (!rep.ok) { setDrawer(null); toast.error("请先配置节点"); return }
    setDrawer(null)
    try {
      const r = await runApi.start(workflowId, input)
      setRunState({})
      setLastRunId(r.runId)
      subscribeRun(r.runId)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }, [workflowId, subscribeRun])
  const startDebugRun = startRealRun
  const demoRun = (_only?: string[]) => startRealRun({})

  if (!def) return <div className="p-8 text-sm" style={{ color: C.ink2 }}>加载中…</div>

  const selected = def.graph.nodes.find((n) => n.id === selectedId) ?? null

  const onConnect = (conn: { source: string | null; target: string | null }) => {
    if (!conn.source || !conn.target) return
    if (def.graph.edges.some((e) => e.source === conn.source && e.target === conn.target)) {
      toast.error("不能重复连线", { position: "top-center" })
      return
    }
    mutate({ ...def, graph: { ...def.graph, edges: [...def.graph.edges, { id: `e_${Date.now() % 100000}`, source: conn.source, target: conn.target }] } })
  }

  const addNode = (typeKey: string) => {
    const d = defs.find((x) => x.type_key === typeKey)
    const id = `n_${typeKey}_${Date.now() % 100000}`
    const node: WfNode = {
      id, type: typeKey, name: d?.label ?? typeKey,
      config: typeKey === "condition" ? { branches: [{ handle: "b1" }] } : {},
      inputs: [], branches: typeKey === "condition" ? ["yes", "no"] : undefined,
    }
    mutate({
      ...def,
      ui: { ...def.ui, positions: { ...def.ui.positions, [id]: { x: 260 + def.graph.nodes.length * 30, y: 140 + def.graph.nodes.length * 24 } } },
      graph: { ...def.graph, nodes: [...def.graph.nodes, node] },
    })
    setSelectedId(id); setDrawer("config"); setPop(null)
  }

  const autoLayout = () => {
    const depth: Record<string, number> = {}
    const adj: Record<string, string[]> = {}
    def.graph.edges.forEach((e) => (adj[e.source] = [...(adj[e.source] ?? []), e.target]))
    const start = def.graph.nodes.find((n) => n.type === "input")
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
    for (const n of def.graph.nodes) {
      const dpt = depth[n.id] ?? 0
      const idx = perDepth[dpt] = (perDepth[dpt] ?? 0) + 1
      positions[n.id] = { x: 80 + dpt * 360, y: 80 + idx * 180 }
    }
    mutate({ ...def, ui: { ...def.ui, positions } })
  }

  const tryRun = () => setDrawer("debug")

  const onPublish = async () => {
    try {
      const res = await wfApi.publish(agentId, "replica publish")
      toast.success(`已发布 V${res.versionNo}`, { position: "top-center" })
      setPublishOpen(false)
      setDef((d) => d && { ...d, workflow: { ...d.workflow, status: "published" } })
    } catch (e) {
      toast.error((e as Error).message.includes("409") ? "发布前校验未通过" : (e as Error).message, { position: "top-center" })
    }
  }

  return (
    <div className="relative flex h-full flex-col" style={{ background: C.canvas }}>
      {/* 顶栏（16 §2） */}
      <div className="z-30 flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 border-b bg-white px-4 py-1" style={{ borderColor: C.cardBorder }}>
        <button onClick={() => navigate(agentMeta ? "/config/agents" : "/config/workflows")}><ArrowLeft className="size-4" style={{ color: C.ink2 }} /></button>
        {agentMeta && avatar ? (
          <img src={avatar} alt={agentMeta.name} className="size-8 shrink-0 rounded-md object-cover" />
        ) : (
          <span className="flex size-7 items-center justify-center rounded-lg" style={{ background: NEUTRAL }}>
            <Zap className="size-4 text-white" />
          </span>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-[15px] font-semibold" style={{ color: C.ink }}>{agentMeta ? agentMeta.name : def.workflow.name}</span>
            {agentMeta ? (
              <button className="flex items-center gap-1 rounded border bg-white px-1.5 py-0.5 text-[11px]" style={{ borderColor: C.cardBorder, color: C.ink2 }} onClick={() => setDrawer("history")}>
                {agentVersionState.latest ? `V${agentVersionState.latest.versionNo}` : (latestVersion ? `V${latestVersion}` : `草稿 V1.0.${revision}`)} <ChevronDown className="size-3" />
              </button>
            ) : null}
            {agentMeta && agentVersionState.envs.sandbox != null && (
              <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-600">沙箱 V{agentVersionState.envs.sandbox}</span>
            )}
            {agentMeta && agentVersionState.envs.prod != null && (
              <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-600">线上 V{agentVersionState.envs.prod}</span>
            )}
            {/* A-13：agentMeta 模式也显示发布状态（此前只有类型标签） */}
            <span className="rounded px-1.5 py-0.5 text-[11px]" style={{ background: C.tagBg, color: C.orange }}>
              {def.workflow.status === "published" ? "已发布" : "待发布"}
            </span>
            {agentMeta && (
              <span className="rounded px-1.5 py-0.5 text-[11px]" style={{ background: "#F1F3F7", color: C.ink2 }}>{agentMeta.typeLabel}</span>
            )}
          </div>
          <div className="text-[11px]" style={{ color: C.ink3 }}>
            自动保存于 {savedAt ? new Date(savedAt).toLocaleString() : "—"}
          </div>
        </div>
        {agentMeta && (
          <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-lg p-0.5" style={{ background: "#F1F3F7" }}>
            {/* bugfix：选中态跟随 drawer 状态（此前硬编码 i===0 不切换） */}
            {([["build", "Agent搭建", null], ["runs", "运行观测", "runs"], ["eval", "效果评测", "eval"], ["evo", "版本指标", "evo"]] as [string, string, null | "runs" | "eval" | "evo"][]).map(([key, label, target]) => {
              const active = (drawer === null && key === "build") || drawer === target
              return (
                <button key={key} className="rounded-md px-3 py-1 text-[13px]"
                  style={active ? { background: "#fff", color: C.ink, boxShadow: "0 1px 3px rgba(31,35,41,.12)" } : { color: C.ink2 }}
                  onClick={() => setDrawer(target)}>{label}</button>
              )
            })}
          </div>
        )}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <button className="rounded p-1.5 hover:bg-neutral-100" title="设置"><Settings className="size-4" style={{ color: C.ink2 }} /></button>
          <Popover>
            <PopoverTrigger asChild>
              <button className="relative rounded p-1.5 hover:bg-neutral-100" title="检查">
                <ListChecks className="size-4" style={{ color: C.ink2 }} />
                {issues.length > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-0.5 text-[9px] text-white" style={{ background: C.danger }}>
                    {issues.length}
                  </span>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-72" align="end">
              <div className="pb-1 text-[13px] font-medium" style={{ color: C.ink }}>检查({issues.length})</div>
              <div className="max-h-56 space-y-1 overflow-y-auto">
                {issues.length === 0 && <div className="text-xs" style={{ color: C.ink3 }}>暂无问题</div>}
                {issues.map((i, k) => {
                  const nd = def.graph.nodes.find((n) => n.id === i.nodeId)
                  return (
                    <button key={k} className="flex w-full items-start gap-2 rounded px-1 py-1 text-left text-xs hover:bg-neutral-50" style={{ color: C.danger }}
                      onClick={() => {
                        const p = def.ui.positions[i.nodeId]
                        if (p) rf.setCenter(p.x + 150, p.y + 60, { zoom: 1, duration: 300 })
                        setSelectedId(i.nodeId); setDrawer("config")
                      }}>
                      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded" style={{ background: NEUTRAL }}>
                        <TypeIcon type={nd?.type ?? ""} className="size-2.5 text-white" />
                      </span>
                      <span>{i.message}</span>
                    </button>
                  )
                })}
              </div>
            </PopoverContent>
          </Popover>
          <button className="rounded p-1.5 hover:bg-neutral-100" title="历史版本"
            onClick={async () => {
              if (agentMeta && agentId) {
                // SDD B：Agent 模式展示 Agent 版本（发布产生的是 agent_version，不是工作流版本）
                setAgentVersions(await agentApi.versions(agentId).catch(() => []))
                setAgentReleases(await agentApi.releases(agentId).catch(() => []))
              } else {
                setVersions(await wfApi.versions(workflowId))
              }
              setDrawer("history")
            }}>
            <Clock className="size-4" style={{ color: C.ink2 }} />
          </button>
          <button className="rounded p-1.5 hover:bg-neutral-100" title="运行观测"
            onClick={() => setDrawer("runs")}>
            <Activity className="size-4" style={{ color: C.ink2 }} />
          </button>
          <button className="rounded p-1.5 hover:bg-neutral-100" title="定时任务"
            onClick={() => setDrawer("schedule")}>
            <CalendarDays className="size-4" style={{ color: C.ink2 }} />
          </button>
          {lockUser && (
            <span className="flex items-center gap-1 text-xs" style={{ color: C.ink2 }}>
              {lockUser} <LockKeyhole className="size-3.5" style={{ color: "#34C759" }} />
            </span>
          )}
          <Button variant="outline" size="sm" className="rounded-md" onClick={() => doSave(defRef.current!)}>保存</Button>
          <Button size="sm" className="rounded-md bg-black text-white hover:bg-neutral-800"
            disabled={!rbacCanPublish} title={rbacCanPublish ? "" : "当前角色无发布权限（需 Publisher 及以上）"}
            onClick={() => (agentMeta && agentId ? setAgentPublishOpen(true) : (issues.length ? setPublishOpen(true) : onPublish()))}>发布</Button>
        </div>
      </div>

      {/* 画布 */}
      <div className="flex min-h-0 flex-1">
      {drawer === "eval" && <EvalPanel workflowId={workflowId} onClose={() => setDrawer(null)} />}
      {drawer === "evo" && <EvoPanel workflowId={workflowId} onClose={() => setDrawer(null)} />}
      {agentMeta && agentId && <AgentConfigDrawer agentId={agentId} onClose={() => undefined} inline avatar={agentAvatar} onAvatar={(v) => { setAgentAvatar(v); agentApi.update(agentId, { avatar: v }).catch(() => undefined) }} />}
      <div className="relative flex-1">
        <ReactFlow
          nodes={nodes} edges={edges} nodeTypes={nodeTypes}
          onNodesChange={(chs) => {
            const positions = { ...def.ui.positions }
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
            if (changed) mutate({ ...def, ui: { ...def.ui, positions } })
            if (dimsChanged) setNodeDims((d) => ({ ...d, ...dims }))
          }}
          onConnect={onConnect}
          onNodeClick={(_, n) => { setSelectedId(n.id); setSelectedEdgeId(null); setDrawer("config"); setPop(null) }}
          onEdgeClick={(_, e) => { setSelectedEdgeId(e.id); setSelectedId(null) }}
          onPaneClick={() => { setSelectedId(null); setSelectedEdgeId(null); setPop(null) }}
          onMoveStart={() => setPop(null)}
          onNodeDragStart={() => setPop(null)}
          onMove={(_, vp) => setZoom(vp.zoom)}
          fitView
          fitViewOptions={{ padding: 0.25, maxZoom: 0.9 }}
          minZoom={0.4}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={16} color={C.dot} />
          {showMiniMap && <MiniMap pannable zoomable nodeColor={() => "#A8B3C5"} nodeStrokeColor={() => "#A8B3C5"} maskColor="rgba(238,241,246,0.6)" className="!bottom-16 !left-1/2 !-translate-x-1/2 !rounded-md !border !bg-white" style={{ width: 180, height: 110 }} />}
        </ReactFlow>

        <Panel position="bottom-left" className="!bottom-4 !left-4 flex items-center gap-1 rounded-lg border bg-white px-1.5 py-1 shadow-sm" style={{ borderColor: C.cardBorder }}>
          <button className="rounded p-1 hover:bg-neutral-100" title="适应画布" onClick={() => rf.fitView({ padding: 0.25, maxZoom: 0.9 })}><Crosshair className="size-4" style={{ color: C.ink2 }} /></button>
          <button className="rounded p-1 hover:bg-neutral-100" title="放大" onClick={() => rf.zoomIn()}><ZoomIn className="size-4" style={{ color: C.ink2 }} /></button>
          <button className="rounded p-1 hover:bg-neutral-100" title="缩小" onClick={() => rf.zoomOut()}><ZoomOut className="size-4" style={{ color: C.ink2 }} /></button>
          <span className="px-1 text-[11px]" style={{ color: C.ink3 }}>{Math.round(zoom * 100)}%</span>
        </Panel>
        {/* 底部工具条（16 §4） */}
        <div className="absolute bottom-4 left-1/2 z-10 flex max-w-[95%] -translate-x-1/2 flex-wrap items-center justify-center gap-1 rounded-lg border bg-white px-2 py-1.5 shadow-sm" style={{ borderColor: C.cardBorder }}>
          <Popover open={pop === "add"} onOpenChange={(o) => setPop(o ? "add" : null)}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="border-0 shadow-none" style={{ color: C.primary }}>
                <Plus className="size-4" /> 添加节点
              </Button>
            </PopoverTrigger>
            <PopoverContent side="top" className="w-56">
              {families.map(([fam, list]) => (
                <div key={fam} className="py-1">
                  <div className="px-1 pb-1 text-xs" style={{ color: C.ink2 }}>{fam}</div>
                  {list.map((d) => (
                    <button key={d.type_key} className="flex w-full items-center gap-2 rounded px-2 py-1 text-[13px] hover:bg-neutral-50" style={{ color: C.ink }} onClick={() => addNode(d.type_key)}>
                      <span className="flex size-4 items-center justify-center rounded" style={{ background: NEUTRAL }}>
                        <TypeIcon type={d.type_key} className="size-2.5 text-white" />
                      </span>
                      {d.label}
                    </button>
                  ))}
                </div>
              ))}
            </PopoverContent>
          </Popover>
          <span className="mx-1 h-4 w-px bg-neutral-200" />
          <button className="rounded p-1.5 hover:bg-neutral-100" title="撤销 (⌘Z)" onClick={undo}><Undo2 className="size-4" style={{ color: C.ink2 }} /></button>
          <button className="rounded p-1.5 hover:bg-neutral-100" title="重做 (⌘⇧Z)" onClick={redo}><Redo2 className="size-4" style={{ color: C.ink2 }} /></button>
          <button className="rounded p-1.5 hover:bg-neutral-100" title="缩略图" onClick={() => setShowMiniMap((v) => !v)}>
            <MapIcon className="size-4" style={{ color: showMiniMap ? C.primary : C.ink2 }} />
          </button>
          <button className="rounded p-1.5 hover:bg-neutral-100" title="优化布局" onClick={autoLayout}>
            <LayoutTemplate className="size-4" style={{ color: C.ink2 }} />
          </button>
          <button className="rounded p-1.5 hover:bg-neutral-100" title="适应画布" onClick={() => rf.fitView()}>
            <Crosshair className="size-4" style={{ color: C.ink2 }} />
          </button>
          <Popover open={pop === "zoom"} onOpenChange={(o) => setPop(o ? "zoom" : null)}>
            <PopoverTrigger asChild><button className="px-1 text-xs" style={{ color: C.ink2 }}>{Math.round(zoom * 100)}% ⌄</button></PopoverTrigger>
            <PopoverContent className="w-20 p-1">
              {[0.5, 0.75, 1, 1.25, 1.5].map((z) => (
                <button key={z} className="block w-full rounded px-2 py-0.5 text-xs hover:bg-neutral-50" onClick={() => { rf.zoomTo(z); setPop(null) }}>{z * 100}%</button>
              ))}
            </PopoverContent>
          </Popover>
          <Popover open={pop === "search"} onOpenChange={(o) => setPop(o ? "search" : null)}>
            <PopoverTrigger asChild><button className="rounded p-1.5 hover:bg-neutral-100" title="节点搜索"><Search className="size-4" style={{ color: C.ink2 }} /></button></PopoverTrigger>
            <PopoverContent className="w-56 p-2">
              <NodeSearch nodes={def.graph.nodes} onPick={(id) => {
                const p = def.ui.positions[id]
                if (p) rf.setCenter(p.x + 150, p.y + 60, { zoom: 1, duration: 300 })
                setSelectedId(id); setPop(null)
              }} />
            </PopoverContent>
          </Popover>
          <button className="rounded p-1.5 hover:bg-neutral-100" title="工具"><Wrench className="size-4" style={{ color: C.ink2 }} /></button>
          <Button size="sm" className="rounded-md" style={{ background: C.primary }} onClick={tryRun}>
            <Play className="size-3.5" /> 试运行
          </Button>
        </div>

        {/* 抽屉层 */}
        {drawer === "config" && selected && (
          <ConfigDrawer node={selected} defs={defs} nodes={def.graph.nodes} edges={def.graph.edges} agentId={agentId || undefined} onClose={() => setDrawer(null)}
            onChange={(n) => mutate({ ...def, graph: { ...def.graph, nodes: def.graph.nodes.map((x) => (x.id === n.id ? n : x)) } })} />
        )}
        {drawer === "debug" && <DebugDrawer def={def} onClose={() => setDrawer(null)} onRun={startDebugRun} />}
        {drawer === "schedule" && <ScheduleDrawer workflowId={workflowId} onClose={() => setDrawer(null)} />}
        {drawer === "runs" && <RunsDrawer workflowId={workflowId} lastRunId={lastRunId} onClose={() => setDrawer(null)} />}
        {drawer === "history" && (
          <div className="absolute inset-y-0 right-0 z-20 w-[320px] border-l bg-white px-4" style={{ borderColor: C.cardBorder }}>
            <div className="flex items-center justify-between py-3">
              <span className="text-[15px] font-semibold" style={{ color: C.ink }}>历史版本</span>
              <button onClick={() => setDrawer(null)}><X className="size-4 text-neutral-500" /></button>
            </div>
            {agentMeta && agentId ? (
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
                            <span key={r.environment} className={`rounded px-1 py-0.5 text-[10px] ${r.environment === "prod" ? "bg-blue-50 text-blue-600" : "bg-emerald-50 text-emerald-600"}`}>
                              {r.environment === "prod" ? "线上" : "沙箱"}
                            </span>
                          ))}
                        </span>
                      </div>
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
        )}
      </div>
      </div>

      {/* 发布软警告（16 §9） */}
      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent className="rounded-xl">
          <DialogHeader className="flex-row items-start gap-2 space-y-0">
            <CircleAlert className="mt-0.5 size-5 shrink-0" style={{ color: C.orange }} />
            <div className="space-y-1.5">
              <DialogTitle>发布前未试运行</DialogTitle>
              <DialogDescription>发布前未进行试运行，建议确认工作流正常运行后再发布。</DialogDescription>
            </div>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setPublishOpen(false); tryRun() }}>试运行</Button>
            <Button className="bg-black text-white hover:bg-neutral-800" onClick={onPublish}>继续发布</Button>
            <Button variant="outline" onClick={() => setPublishOpen(false)}>取消</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* SDD B：Agent 级发布（生成不可变版本 → 沙箱/线上部署；回滚=重新部署旧版本） */}
      {agentMeta && agentId && (
        <AgentPublishDialog agentId={agentId} open={agentPublishOpen} onClose={() => setAgentPublishOpen(false)}
          onPublished={agentVersionState.refresh} />
      )}
    </div>
  )
}

function NodeSearch({ nodes, onPick }: { nodes: WfNode[]; onPick: (id: string) => void }) {
  const [q, setQ] = useState("")
  const hits = nodes.filter((n) => n.name.includes(q))
  return (
    <div>
      <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索节点" />
      <div className="pt-1">
        {hits.map((n) => (
          <button key={n.id} className="flex w-full items-center gap-2 rounded px-2 py-1 text-[13px] hover:bg-neutral-50" onClick={() => onPick(n.id)}>
            <span className="size-2 rounded-full" style={{ background: C.primary }} /> {n.name}
          </button>
        ))}
      </div>
    </div>
  )
}


/* ============ 效果评测面板 ============ */
function EvalPanel({ workflowId, onClose }: { workflowId: string; onClose: () => void }) {
  const [samples, setSamples] = useState<{ id: string; name: string; input: Record<string, unknown> }[]>([])
  const [summary, setSummary] = useState<Record<string, any> | null>(null)
  const [name, setName] = useState("")
  const [inputJson, setInputJson] = useState('{ "userQuery": "你好" }')
  const load = () => {
    evalApi.samples(workflowId).then((r) => setSamples(r.items)).catch(() => undefined)
    evalApi.summary(workflowId).then(setSummary).catch(() => undefined)
  }
  useEffect(() => { load() }, [workflowId])
  return (
    <div className="absolute inset-y-0 right-0 z-20 flex w-[420px] max-w-[92vw] flex-col border-l bg-white" style={{ borderColor: C.cardBorder }}>
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-[15px] font-semibold" style={{ color: C.ink }}>效果评测</span>
        <button onClick={onClose}><X className="size-4 text-neutral-500" /></button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-4">
        {summary && (
          <div className="grid grid-cols-4 gap-2 text-center">
            {[["总数", summary.total], ["成功", summary.succeeded], ["失败", summary.failed], ["成功率", `${Math.round((summary.successRate ?? 0) * 100)}%`]].map(([l, v]) => (
              <div key={l as string} className="rounded-lg border px-2 py-2" style={{ borderColor: C.cardBorder }}>
                <div className="text-[11px]" style={{ color: C.ink3 }}>{l}</div>
                <div className="text-sm font-semibold" style={{ color: C.ink }}>{v}</div>
              </div>
            ))}
          </div>
        )}
        <div className="space-y-2">
          <div className="text-[13px] font-medium" style={{ color: C.ink }}>| 评测集</div>
          {samples.map((sp) => (
            <div key={sp.id} className="flex items-center gap-2 rounded border px-2 py-1 text-xs" style={{ borderColor: C.cardBorder }}>
              <span className="flex-1 truncate" style={{ color: C.ink }}>{sp.name}</span>
              <button className="text-neutral-400" onClick={async () => { await evalApi.delSample(sp.id); load() }}><X className="size-3" /></button>
            </div>
          ))}
          <Input className="h-7 text-xs" placeholder="样本名称" value={name} onChange={(e) => setName(e.target.value)} />
          <Textarea className="min-h-16 text-xs" value={inputJson} onChange={(e) => setInputJson(e.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={async () => {
              try {
                await evalApi.addSample(workflowId, name || "样本", JSON.parse(inputJson || "{}"))
                setName(""); load()
              } catch { toast.error("输入 JSON 非法") }
            }}>添加样本</Button>
            <Button size="sm" className="bg-black text-white hover:bg-neutral-800" onClick={async () => {
              await evalApi.run(workflowId)
              toast.success("评测已启动"); setTimeout(load, 4000)
            }}>运行评测</Button>
          </div>
        </div>
        {summary && summary.samples?.length > 0 && (
          <div className="space-y-1">
            <div className="text-[13px] font-medium" style={{ color: C.ink }}>| 评测结果</div>
            {summary.samples.map((r: any) => (
              <div key={r.runId} className="flex items-center gap-2 rounded border px-2 py-1 text-xs" style={{ borderColor: C.cardBorder }}>
                <span className={`size-2 rounded-full ${r.status === "succeeded" ? "bg-emerald-400" : "bg-red-400"}`} />
                <span className="w-24 font-mono" style={{ color: C.ink3 }}>{r.runId.slice(0, 8)}</span>
                <span className="flex-1 truncate" style={{ color: C.ink2 }}>{r.output || "-"}</span>
                <span style={{ color: C.ink3 }}>{r.durationMs != null ? `${r.durationMs}ms` : ""}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ============ 版本指标面板（SDD A-12：原“进化”名实不符，真进化见 Phase D） ============ */
function EvoPanel({ workflowId, onClose }: { workflowId: string; onClose: () => void }) {
  const [data, setData] = useState<{ versions: any[]; failedCases: any[] } | null>(null)
  useEffect(() => {
    evalApi.versionMetrics(workflowId).then(setData).catch(() => undefined)
  }, [workflowId])
  return (
    <div className="absolute inset-y-0 right-0 z-20 flex w-[420px] max-w-[92vw] flex-col border-l bg-white" style={{ borderColor: C.cardBorder }}>
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-[15px] font-semibold" style={{ color: C.ink }}>版本指标</span>
        <button onClick={onClose}><X className="size-4 text-neutral-500" /></button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-4">
        <div className="space-y-1">
          <div className="text-[13px] font-medium" style={{ color: C.ink }}>| 版本指标</div>
          {data?.versions.length ? data.versions.map((v: any) => (
            <div key={v.versionNo} className="flex items-center gap-2 rounded border px-2 py-1 text-xs" style={{ borderColor: C.cardBorder }}>
              <span className="w-12 font-medium" style={{ color: C.ink }}>V{v.versionNo}</span>
              <span style={{ color: C.ink3 }}>{v.runs} 次运行</span>
              <span className="flex-1 text-right" style={{ color: C.ink2 }}>成功率 {Math.round(v.successRate * 100)}%</span>
            </div>
          )) : <div className="text-xs" style={{ color: C.ink3 }}>暂无发布版本</div>}
        </div>
        <div className="space-y-1">
          <div className="text-[13px] font-medium" style={{ color: C.ink }}>| 进化建议（失败案例）</div>
          {data?.failedCases.length ? data.failedCases.map((f: any) => (
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

export default function WfDesignerPage({ workflowId, agentId, agentMeta, avatar }: { workflowId?: string; agentId?: string; agentMeta?: { name: string; typeLabel: string; agentType?: string }; avatar?: string }) {
  return (
    <ReactFlowProvider>
      <div className="h-[calc(100dvh-3.5rem)] min-h-0">
        <DesignerInner workflowId={workflowId} agentId={agentId} agentMeta={agentMeta} avatar={avatar} />
      </div>
      <ToastHost />
    </ReactFlowProvider>
  )
}
