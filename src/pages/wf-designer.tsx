/** Agent Designer — quickservice 1:1 复刻版（16-ui-replication-spec.md）。
 *  后端契约不变（server/ :8100）。运行态为客户端 demo-run（P1 换真 SSE）。 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react"
import CodeMirror from "@uiw/react-codemirror"
import { python } from "@codemirror/lang-python"
import { useAgentVersionState } from "@/components/agent-publish-dialog"
import { AgentVersionDiffDialog } from "@/components/agent-version-diff"
import { avatarFor, AVATARS } from "./wf-agents-list"
import { WORKFLOW_ICONS, WfIcon } from "@/components/wf/wf-icons"
import { ConversationPanel, MemorySchemaForm } from "@/components/agent-common-config"
import { useNavigate, useParams } from "react-router-dom"
import {
  Check,
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
  Route,
  Code,
  MessageSquare,
  Brain,
  PenLine,
  GripVertical,
  Trash2,
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
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
import { AgentEvalPanel } from "@/components/agent-ops-panels"
import { C, NEUTRAL, TypeChip, VarCascader, describeVar, PromptArea, VarButton, ResourceSelect, Section, WorkflowPicker, OP_LABEL, OPS_BY_TYPE, NO_VALUE_OPS, normCondBranches, condHandlesOf, type CondBranch, type CondCondition } from "@/components/wf/controls"
import { CandidatesMulti, DataReadSection, InputMappingTable, LoopSection, OutputSchemaEditor, OutputVarsSection, RobustnessSection, ToolParamsSection, WaitReviewSection } from "@/components/wf/sections"
import { getStartFields, setStartFields } from "@/components/wf/controls"
import { formsApi, type FormDef } from "@/services/wf-api"

/* 07-SDD form：开始节点=引用集中表单（字段=全局固定输入变量，不允许追加） */
const LEGACY_SIX_CLIENT = [
  { key: "userQuery", type: "textarea", dataType: "string", label: "用户问题", required: true },
  { key: "chatHistory", type: "textarea", dataType: "string", label: "历史对话" },
  { key: "userId", type: "text", dataType: "string", label: "用户 ID" },
  { key: "conversationId", type: "text", dataType: "string", label: "会话 ID" },
  { key: "chatId", type: "text", dataType: "string", label: "对话 ID" },
  { key: "reference", type: "text", dataType: "string", label: "引用内容" },
]
/** 09 §5.7 已登记豁免：节点配置/注册表 schema 为自由 JSONB，设计器按松散对象处理。
 * 统一别名（仅此一处声明，可审计）；API 边界契约类型见 services/api-types.ts。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NodeCfgLoose = Record<string, any>
function StartFormSection({ cfg, set }: { cfg: NodeCfgLoose; set: (k: string, v: unknown) => void }) {
  const [forms, setForms] = useState<FormDef[]>([])
  const [cur, setCur] = useState<FormDef | null>(null)
  const navigate = useNavigate()
  useEffect(() => { formsApi.list().then((r) => setForms(r.items)).catch(() => undefined) }, [])
  useEffect(() => {
    if (!cfg.formId) { setCur(null); return }
    formsApi.get(cfg.formId).then(setCur).catch(() => setCur(null))
  }, [cfg.formId])
  return (
    <Section title="输入表单（输入契约）">
      <Select value={(cfg.formId as string) || undefined} onValueChange={(v) => set("formId", v)}>
        <SelectTrigger className="h-7 w-full text-xs"><SelectValue placeholder="选择表单（字段=全局输入变量）" /></SelectTrigger>
        <SelectContent>{forms.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent>
      </Select>
      {cur && (
        <div className="flex flex-wrap gap-1 pt-2">
          {(cur.fields ?? []).map((f) => (
            <span key={f.key} className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-600">
              {f.key}{f.validation?.required ? " *" : ""} <span className="text-neutral-400">{f.dataType}</span>
            </span>
          ))}
        </div>
      )}
      {cur && <p className="pt-1 text-[11px]" style={{ color: C.ink3 }}>表单字段即本流程固定输入变量，不允许追加；需变体请“创建副本并编辑”。</p>}
      {!cfg.formId && (
        <Button variant="outline" size="sm" className="mt-2" onClick={async () => {
          try {
            const f = await formsApi.create({ name: `对话六件套-${new Date().getMinutes()}${new Date().getSeconds()}`, description: "存量六件套转表单", fields: LEGACY_SIX_CLIENT })
            set("formId", f.id)
            toast.success("已转为表单")
          } catch { toast.error("转表单失败") }
        }}>转为表单（ legacy 六件套）</Button>
      )}
      <div className="pt-2">
        <button className="text-[11px] underline" style={{ color: C.primary }} onClick={() => navigate("/config/forms")}>管理表单</button>
      </div>
    </Section>
  )
}
import { Repeat, Hourglass, Database } from "lucide-react"

/* ============ 视觉令牌（16 §1） ============ */
const TYPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  input: Play, llm: Bot, tool: Wrench, condition: GitBranch, transform: Braces,
  end: Flag, "create-record": FilePlus2, notification: Bell, "workflow-exec": Network,
  "knowledge-retrieval": BookOpen, "mcp-call": Server,
  "workflow-select": Route, "workflow-fixed": Route, reply: MessageSquare,
  "memory-variable": Brain, "code-write": Code, "query-rewrite": PenLine,
  "decision-class": GitBranch, agent: Bot, "agent-select": Route, "agent-exec": Play,
  loop: Repeat, "wait-review": Hourglass, "data-read": Database,
}
const TypeIcon = ({ type, className }: { type: string; className?: string }) => {
  const I = TYPE_ICON[type] ?? Braces
  return <I className={className} />
}

/* 06-master-spec §2.5：抽屉头部一句节点描述（全量 21 节点，评审 08-25） */
const NODE_DESC: Record<string, string> = {
  input: "工作流的开始节点，定义公共输入变量，全节点可引用",
  llm: "大模型节点可调用大语言模型，根据输入参数与提示词生成指定格式的回复",
  tool: "绑定一个插件工具版本，按工具声明的参数发起外部调用",
  condition: "条件判断节点可定义多个判断条件，对应多个流程分支。实现不同业务规则的分流",
  "decision-class": "决策分类节点用大模型把输入归入预设分类，每个分类对应一条分支",
  transform: "变量处理节点用声明式模板聚合/拼接上游变量，不执行任意代码",
  "query-rewrite": "Query 改写节点在检索前改写查询，输出 queryList 数组",
  "code-write": "代码编写节点在 Python 沙箱中执行 main(args)，10 秒超时",
  end: "工作流的结束节点，在工作流完成运行后将相关信息通过Agent回答或通过API输入到其余工作流或外部系统中",
  "create-record": "创建质检记录节点把结构化输出幂等写入质检业务层",
  notification: "通知节点把消息写入运行日志（V1 渠道=日志）",
  "workflow-exec": "工作流执行节点按编码同步调用另一个工作流",
  "workflow-select": "工作流选择节点用大模型从候选工作流中路由出一个",
  "workflow-fixed": "工作流节点绑定一个固定工作流并执行",
  "knowledge-retrieval": "知识检索节点在指定知识源中按 query 召回切片",
  "mcp-call": "MCP 工具节点调用 MCP Server 握手发现的具体工具",
  reply: "对话回复节点把内容写入对话流",
  "memory-variable": "记忆变量节点读写 run 内共享状态（跨会话 Future）",
  agent: "Agent 节点调用一个固定的成员 Agent，输入按映射表解析",
  "agent-select": "Agent 选择节点根据问题与 Agent 描述路由出一个成员，未命中走兜底",
  "agent-exec": "Agent 执行节点按 agentCode 执行对应成员，支持输入绑定动态执行",
  loop: "循环迭代节点对 Array 变量逐条执行循环体子图，输出聚合",
  "wait-review": "暂停 Run 等待人工或定时，落盘可恢复",
  "data-read": "从 DataAsset 按窗口/抽样取数，与创建质检记录对称",
}

/* 07-SDD 08-26 决策：添加节点=左侧固定面板（可折叠+搜索），替代底部 Popover */
/* 08-26：分组节点列表共用组件（左面板与快捷+共用，杜绝手搓两份） */
function PaletteGroups({ families, onPick }: { families: [string, NodeDefinition[]][]; onPick: (t: string) => void }) {
  return (
    <>
      {families.map(([fam, list]) => (
        <div key={fam} className="py-1">
          <div className="px-1 pb-1 text-[11px] font-medium" style={{ color: C.ink2 }}>{fam}</div>
          {list.map((d) => (
            <button key={d.type_key} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-neutral-50" style={{ color: C.ink }}
              onClick={() => onPick(d.type_key)}>
              <span className="flex size-4 shrink-0 items-center justify-center rounded" style={{ background: NEUTRAL }}>
                <TypeIcon type={d.type_key} className="size-2.5 text-white" />
              </span>
              {d.label}
            </button>
          ))}
        </div>
      ))}
    </>
  )
}

function NodePalette({ families, onAdd, open, onToggle }: {
  families: [string, NodeDefinition[]][]; onAdd: (typeKey: string) => void
  open: boolean; onToggle: () => void
}) {
  const [kw, setQ] = useState("")
  if (!open) {
    return (
      <div className="flex w-10 shrink-0 flex-col items-center gap-1 border-r bg-white py-2" style={{ borderColor: C.cardBorder }}>
        <button className="rounded p-1.5 hover:bg-neutral-100" onClick={onToggle} title="展开节点面板">
          <PanelLeftOpen className="size-4" style={{ color: C.ink2 }} />
        </button>
      </div>
    )
  }
  const q = kw.trim()
  const fs = q
    ? families.map(([f, list]) => [f, list.filter((d) => d.label.includes(q) || f.includes(q) || d.type_key.includes(q))] as [string, NodeDefinition[]])
        .filter(([, l]) => l.length > 0)
    : families
  return (
    <div className="flex w-[224px] shrink-0 flex-col border-r bg-white" style={{ borderColor: C.cardBorder }}>
      <div className="flex items-center gap-1 border-b p-2" style={{ borderColor: C.cardBorder }}>
        <Input className="h-7 flex-1 text-xs" placeholder="搜索节点" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="rounded p-1 hover:bg-neutral-100" onClick={onToggle} title="折叠节点面板">
          <PanelLeftClose className="size-4" style={{ color: C.ink2 }} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {fs.length === 0 && <div className="px-1 py-2 text-[11px]" style={{ color: C.ink3 }}>无匹配节点</div>}
        <PaletteGroups families={fs} onPick={onAdd} />
      </div>
    </div>
  )
}

/* 07-SDD §4.3：提示词 AI 润色（替换/撤销） */
function PolishRow({ text, onApply }: { text: string; onApply: (v: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [prev, setPrev] = useState<string | null>(null)
  return (
    <div className="flex items-center gap-2 pt-1">
      <button className="rounded border px-2 py-0.5 text-[11px] disabled:opacity-40" style={{ borderColor: C.cardBorder, color: C.primary }}
        disabled={busy || !text}
        onClick={async () => {
          setBusy(true); setPrev(text)
          try { onApply((await wfApi.polish(text)).text) } catch { toast.error("润色失败") } finally { setBusy(false) }
        }}>
        {busy ? "润色中…" : "AI 润色"}
      </button>
      {prev !== null && (
        <button className="text-[11px]" style={{ color: C.ink2 }} onClick={() => { onApply(prev); setPrev(null) }}>撤销</button>
      )}
    </div>
  )
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


/* ============ 节点卡（16 §3） ============ */
interface WfNodeData extends Record<string, unknown> {
  wf: WfNode
  def?: NodeDefinition
  issues: ValidationIssue[]
  run?: { status: "running" | "success" | "failed" | "skipped"; durationMs?: number; tokens?: number; input?: unknown; output?: unknown; error?: string }
  onRunNode?: (id: string) => void
  onTestNode?: (id: string) => void  // E-4.3：单测此节点
  onQuickAdd?: (handle: string | null, typeKey: string) => void
  palette?: [string, NodeDefinition[]][]
  onDelete?: (id: string) => void
}

function SummaryRows({ n }: { n: WfNode }) {
  const cfg = n.config as Record<string, unknown>
  const rows: { label: string; body: React.ReactNode }[] = []
  const un = <span style={{ color: C.ink3 }}>未配置</span>
  if (n.type === "input") {
    // 08-26 用户反馈：选了表单后开始卡输入=表单字段（无表单回退六件套）
    const sf = getStartFields()
    const list = sf && sf.length ? sf : ["userQuery", "chatHistory", "userId", "conversationId", "chatId", "reference"].map((n2) => ({ name: n2, type: "string" }))
    rows.push({
      label: "输入",
      body: (
        <span className="flex flex-wrap gap-1">
          {list.map((k) => (
            <span key={k.name} className="text-xs" style={{ color: C.ink }}>{k.name} <TypeChip t={k.type === "array" ? "Arr" : k.type === "number" ? "Num" : k.type === "boolean" ? "Bool" : "Str"} /></span>
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
    const llmCfg = (n.config ?? {}) as { outputFormat?: string; outputSchema?: Record<string, unknown> }
    const schemaKeys = llmCfg.outputFormat === "JSON" && llmCfg.outputSchema ? Object.keys(llmCfg.outputSchema) : []
    rows.push({ label: "输出", body: <span className="flex flex-wrap gap-1 text-xs">output <TypeChip t="Str" /> thought <TypeChip t="Str" /> answer <TypeChip t="Str" />{schemaKeys.map((k) => <span key={k}>{k} <TypeChip t="Json" /></span>)}</span> })
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

/* 条件节点摘要行：每分支一行，右侧各挂一个 source handle（调研 11 §3.14：分支=出边 handle） */
function ConditionRows({ n, onQuickAdd, palette }: { n: WfNode; onQuickAdd?: (h: string | null, t: string) => void; palette?: [string, NodeDefinition[]][] }) {
  const bs = normCondBranches((n.config as NodeCfgLoose)?.branches)
  const rows = [
    ...bs.map((b, i) => ({
      handle: b.handle,
      label: i === 0 ? "如果" : `否则如果 ${i}`,
      desc: b.conditions.length === 0 ? "未配置条件"
        : `${b.conditions.length} 个条件 · ${b.logic === "OR" ? "或" : "且"}`,
    })),
    { handle: "else", label: "否则", desc: "默认分支" },
  ]
  return (
    <div className="mt-2 space-y-2">
      {rows.map((r) => (
        <div key={r.handle} className="relative flex items-center gap-2 pr-3 text-xs">
          <span className="w-14 shrink-0 truncate" style={{ color: C.ink3 }}>{r.label}</span>
          <span className="min-w-0 flex-1 truncate" style={{ color: C.ink }}>{r.desc}</span>
          <Handle id={r.handle} type="source" position={Position.Right}
            style={{ width: 12, height: 12, background: r.handle === "else" ? "#94A3B8" : C.primary, border: "2px solid #fff", borderRadius: 6 }} />
          {onQuickAdd && palette && (
            <span className="shrink-0">
              <QuickAddButton palette={palette} onPick={(t) => onQuickAdd(r.handle, t)} />
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

function WfNodeCard({ data, selected }: NodeProps) {
  const d = data as WfNodeData
  const n = d.wf
  const [collapsed, setCollapsed] = useState(false)
  const rs = d.run?.status
  // 08-26 用户反馈：运行状态边框参考 reactflow NodeStatusIndicator（呼吸环/状态色边框）
  const stCls =
    rs === "running" ? "node-st-running" :
    rs === "success" ? "node-st-success" :
    rs === "failed" ? "node-st-failed" :
    rs === "skipped" ? "node-st-skipped" : ""
  const ring = selected ? `ring-[1.5px] ring-[#3D6BFF]` : ""
  // 08-26 用户反馈：悬浮边框+阴影效果
  const hoverFx = selected ? "" : "border-[#EDF0F4] hover:border-[#3D6BFF] hover:shadow-[0_4px_16px_rgba(61,107,255,0.18)]"
  const isBranch = ["condition", "decision-class", "workflow-select"].includes(n.type)
  return (
    <div className="group w-[300px]">
    <div className="relative">
    <div className={`relative w-full overflow-hidden rounded-[8px] border bg-white p-3 shadow-sm transition-all ${hoverFx} ${ring} ${stCls}`} style={{ borderColor: selected ? C.primary : undefined }}>
      {n.type !== "input" && <Handle type="target" position={Position.Left} style={{ width: 12, height: 12, background: "#fff", border: `2px solid ${C.primary}`, borderRadius: 6 }} />}
      {n.type !== "end" && n.type !== "condition" && <Handle type="source" position={Position.Right} style={{ width: 12, height: 12, background: C.primary, border: "2px solid #fff", borderRadius: 6 }} />}
      {n.type === "condition" && collapsed && condHandlesOf(n).map((h, i, arr) => (
        <Handle key={h} id={h} type="source" position={Position.Right}
          style={{ width: 12, height: 12, background: h === "else" ? "#94A3B8" : C.primary, border: "2px solid #fff", borderRadius: 6, top: `${((i + 1) / (arr.length + 1)) * 100}%` }} />
      ))}
      <div className="flex items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md" style={{ background: NEUTRAL }}>
          <TypeIcon type={n.type} className="size-3.5 text-white" />
        </span>
        <span className="flex-1 truncate text-sm font-medium" style={{ color: C.ink }}>{n.name}</span>
        {/* 06-master-spec §2.4：节点卡错误红点+计数（原 issues 传入即弃，现渲染） */}
        {d.issues.length > 0 && (
          <span className="flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px]" style={{ background: "#FEF0F0", color: C.danger }}
            title={d.issues.map((i) => i.message).join("；")}>
            <CircleAlert className="size-3" />{d.issues.length}
          </span>
        )}
        {rs === "running" && <span className="size-3 animate-spin rounded-full border-2 border-neutral-400 border-t-transparent" />}
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
              <PopoverContent className="w-28 p-1">
                <button className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-neutral-50" style={{ color: C.ink }} onClick={() => d.onTestNode?.(n.id)}>
                  单测此节点
                </button>
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
      {/* 07-SDD §2.6-5：画布卡 subtitle 回显关键配置 */}
      {(n.type === "loop" || n.type === "wait-review" || n.type === "workflow-fixed") && (
        <div className="mt-1 truncate text-[10px]" style={{ color: C.ink3 }}>
          {n.type === "loop" && String(((n.config as Record<string, unknown>)?.iteratorRef) || "未配置循环源")}
          {n.type === "wait-review" && `恢复方式：${((n.config as Record<string, unknown>)?.resumeMode) ?? "human"}`}
          {n.type === "workflow-fixed" && `版本策略：${((n.config as Record<string, unknown>)?.versionPolicy) ?? "latest"}`}
        </div>
      )}
      {!collapsed && (n.type === "condition" ? <ConditionRows n={n} onQuickAdd={d.onQuickAdd} palette={d.palette} /> : <SummaryRows n={n} />)}
    </div>
    {!isBranch && d.onQuickAdd && d.palette && (
      <span className={`absolute -right-2 -top-2 z-10 transition-opacity ${selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
        <QuickAddButton palette={d.palette} onPick={(t) => d.onQuickAdd?.(null, t)} />
      </span>
    )}
    </div>
    {d.run && d.run.status !== "running" && <NodeRunResult run={d.run} />}
    </div>
  )
}

/* 08-26 用户反馈：节点尾部“+”快捷添加（点击后选节点并自动连线） */
function QuickAddButton({ palette, onPick }: { palette: [string, NodeDefinition[]][]; onPick: (t: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex size-6 items-center justify-center rounded-full border-2 bg-white shadow-md transition-transform hover:scale-110" style={{ borderColor: C.primary }} title="快捷添加节点">
          <Plus className="size-3.5" style={{ color: C.primary }} />
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="max-h-80 w-64 overflow-y-auto p-2">
        <PaletteGroups families={palette} onPick={(t) => { onPick(t); setOpen(false) }} />
      </PopoverContent>
    </Popover>
  )
}

/* 08-26 用户反馈：试运行结果展示在节点下方，可收起/展开（quickservice 深色面板形态） */
function NodeRunResult({ run }: { run: NonNullable<WfNodeData["run"]> }) {
  const [open, setOpen] = useState(false)
  const ok = run.status === "success"
  const skipped = run.status === "skipped"
  const KV = ({ title, obj }: { title: string; obj: unknown }) => {
    const o = (obj ?? {}) as Record<string, unknown>
    return (
      <div>
        <div className="pb-0.5 text-[10px] text-neutral-300">{title}</div>
        <div className="whitespace-pre-wrap break-all rounded bg-[#2A3242] p-2 font-mono text-[10px] leading-4">
          {Object.entries(o).length === 0 && <span className="text-neutral-400">∅</span>}
          {Object.entries(o).map(([k, v]) => (
            <div key={k}>
              <span className="text-[#7ED491]">{k}:</span>{" "}
              <span className="break-all text-neutral-200">{typeof v === "string" ? `"${v}"` : JSON.stringify(v)}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }
  return (
    <div className="nodrag mt-1.5 overflow-hidden rounded-md" style={{ background: "#3B4557" }}>
      <button className="flex w-full items-center gap-2 px-2.5 py-1.5" onClick={() => setOpen((v) => !v)}>
        <span className="flex size-3.5 items-center justify-center rounded-full" style={{ background: ok ? "#34C759" : skipped ? "#9AA4B2" : "#F56C6C" }}>
          {ok ? <Check className="size-2.5 text-white" /> : <X className="size-2.5 text-white" />}
        </span>
        <span className="text-xs text-white">{ok ? "运行成功" : skipped ? "已跳过" : "运行失败"}</span>
        {run.durationMs != null && <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white">{run.durationMs}ms</span>}
        {!!run.tokens && <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white">{run.tokens} tokens</span>}
        <ChevronDown className={`ml-auto size-3.5 text-white transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="space-y-1.5 px-2.5 pb-2">
          {run.error && <div className="rounded bg-[#2A3242] p-2 font-mono text-[10px] text-red-300">{run.error}</div>}
          <KV title="输入" obj={run.input} />
          <KV title="输出" obj={run.output} />
        </div>
      )}
    </div>
  )
}
const nodeTypes = { wf: WfNodeCard }


function ConfigDrawer(props: {
  node: WfNode | null
  defs: NodeDefinition[]
  nodes: WfNode[]
  edges: WfEdge[]
  agentId?: string
  issues?: ValidationIssue[]
  onClose: () => void
  onChange: (n: WfNode) => void
  onRemoveBranchEdges?: (nodeId: string, handles: string[], nextNode: WfNode) => void
}) {
  const { node, defs, nodes, edges, agentId, issues = [], onClose, onChange, onRemoveBranchEdges } = props
  const [varTarget, setVarTarget] = useState<"prompt" | string | null>(null)
  const [dragBr, setDragBr] = useState<number | null>(null)
  // 09 P0-B4：所有 hooks 必须在早退之前调用（rules-of-hooks）
  const [models, setModels] = useState<{ id: string; caps: string[] }[]>([])
  useEffect(() => {
    resApi.registry("model").then((r) => setModels(r.items.map((m) => ({
      id: (m.metadata.modelKey as string) || m.id,
      caps: (m.metadata.capabilities as string[]) ?? [],
    })))).catch(() => setModels([]))
  }, [])
  const mcpServerId = (node?.config as Record<string, unknown> | undefined)?.mcpServerId as string | undefined
  const [mcpTools, setMcpTools] = useState<string[]>([])
  useEffect(() => {
    if (!mcpServerId) { setMcpTools([]); return }
    resApi.get("mcp", mcpServerId).then((d) => setMcpTools(((d.config?.discoveredTools as { name?: string }[] | undefined) ?? []).map((t) => t.name ?? ""))).catch(() => undefined)
  }, [mcpServerId])
  /* SDD D-1：成员池联动——agent-select/agent/agent-exec 的候选来自 Agent 成员配置 */
  const nodeType = node?.type ?? ""
  const [memberPool, setMemberPool] = useState<{ id: string; name: string }[]>([])
  useEffect(() => {
    if (!agentId || !["agent-select", "agent", "agent-exec"].includes(nodeType)) return
    agentApi.get(agentId).then((a) => {
      const ids = ((a.config?.members ?? []) as string[])
      agentApi.list({ pageSize: 100 }).then((r) => {
        setMemberPool(ids.map((id) => ({ id, name: r.items.find((x) => x.id === id)?.name ?? id })))
      }).catch(() => setMemberPool(ids.map((id) => ({ id, name: id }))))
    }).catch(() => undefined)
  }, [agentId, nodeType])
  if (!node) return null
  const def = defs.find((d) => d.type_key === node.type)
  const cfg = node.config as NodeCfgLoose
  const set = (k: string, v: unknown) => onChange({ ...node, config: { ...cfg, [k]: v } })
  /* 规则构建器：branches 写入即同步节点声明 handle（含 else 兜底），校验器 R7 依赖 */
  const condBranches = normCondBranches(cfg.branches)
  const setCondBranches = (bs: CondBranch[]) =>
    onChange({ ...node, config: { ...cfg, branches: bs }, branches: [...bs.map((b) => b.handle), "else"] })
  const patchBranch = (bi: number, patch: Partial<CondBranch>) => {
    const bs = [...condBranches]
    bs[bi] = { ...bs[bi], ...patch }
    setCondBranches(bs)
  }
  const patchCond = (bi: number, ci: number, patch: Partial<CondCondition>) => {
    const bs = [...condBranches]
    const conds = [...bs[bi].conditions]
    conds[ci] = { ...conds[ci], ...patch }
    bs[bi] = { ...bs[bi], conditions: conds }
    setCondBranches(bs)
  }
  const addBranch = () => {
    const used = condBranches.map((b) => b.handle)
    let n = condBranches.length + 1
    while (used.includes(`b${n}`)) n++
    setCondBranches([...condBranches, { handle: `b${n}`, logic: "AND", conditions: [] }])
  }
  const removeBranch = (bi: number) => {
    const removed = condBranches[bi].handle
    const bs = condBranches.filter((_, j) => j !== bi)
    const nextNode: WfNode = { ...node, config: { ...cfg, branches: bs }, branches: [...bs.map((b) => b.handle), "else"] }
    if (onRemoveBranchEdges) onRemoveBranchEdges(node.id, [removed], nextNode)
    else onChange(nextNode)
  }
  const dropBranch = (to: number) => {
    if (dragBr === null || dragBr === to) { setDragBr(null); return }
    const bs = [...condBranches]
    const [m] = bs.splice(dragBr, 1)
    bs.splice(to, 0, m)
    setDragBr(null)
    setCondBranches(bs)
  }
  const emptyCond: CondCondition = { variable: "", variableType: "string", operator: "eq", valueMode: "LITERAL", value: "", valueRef: "" }
  const insertVar = (v: string, t?: string) => {
    if (varTarget === "prompt") set("prompt", `${cfg.prompt ?? ""}${v}`)
    else if (varTarget?.startsWith("__cfg:")) {
      const key = varTarget.slice(6)
      set(key, `${String(cfg[key] ?? "").replace(/#$/, "")}${v}`)
    }
    else if (varTarget?.startsWith("__cL:")) {
      const [bi, ci] = varTarget.slice(5).split(":").map(Number)
      const vt = t && OPS_BY_TYPE[t] ? t : "string"
      const ops = OPS_BY_TYPE[vt]
      const cur = condBranches[bi]?.conditions[ci]
      patchCond(bi, ci, { variable: v, variableType: vt,
        ...(cur && !ops.includes(cur.operator) ? { operator: ops[0], value: "", valueRef: "" } : {}) })
    } else if (varTarget?.startsWith("__cR:")) {
      const [bi, ci] = varTarget.slice(5).split(":").map(Number)
      patchCond(bi, ci, { valueMode: "VARIABLE", valueRef: v })
    } else if (varTarget) {
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
      <p className="pb-2 text-xs leading-5" style={{ color: C.ink2 }}>{NODE_DESC[node.type] ?? "节点配置"}</p>
      {/* 06-master-spec §2.4：抽屉内节点级问题清单（与顶栏检查 Popover 同源） */}
      {issues.length > 0 && (
        <div className="mb-2 space-y-1 rounded-md border px-2 py-1.5" style={{ borderColor: C.danger, background: "#FEF0F0" }}>
          {issues.map((i, idx) => (
            <div key={idx} className="flex items-start gap-1 text-[11px]" style={{ color: C.danger }}>
              <CircleAlert className="mt-0.5 size-3 shrink-0" /> {i.message}
            </div>
          ))}
        </div>
      )}
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
          <Section title="系统设定（可选）" defaultOpen={false}>
            <PromptArea value={cfg.systemPrompt ?? ""} onChange={(v) => set("systemPrompt", v)}
              nodes={nodes} edges={edges} selfId={node.id} defs={defs}
              placeholder="人设/回复逻辑/语言风格；优先级高于提示词" minH="min-h-14" />
          </Section>
          <Section title="提示词">
            <PromptArea value={cfg.prompt ?? ""} onChange={(v) => set("prompt", v)}
              nodes={nodes} edges={edges} selfId={node.id} defs={defs} placeholder="请输入提示词" minH="min-h-24" />
            <PolishRow text={cfg.prompt ?? ""} onApply={(v) => set("prompt", v)} />
          </Section>
          <Section title="输出">
            <div className="flex items-center gap-2 text-xs"><span style={{ color: C.ink2 }}>输出格式 :</span>
              <Select value={String(cfg.outputFormat ?? "Markdown")} onValueChange={(v) => set("outputFormat", v)}>
                <SelectTrigger className="h-6 w-28 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="Markdown">Markdown</SelectItem><SelectItem value="JSON">JSON</SelectItem></SelectContent>
              </Select>
            </div>
            {String(cfg.outputFormat ?? "Markdown") === "JSON" && (
              <OutputSchemaEditor value={cfg.outputSchema} onChange={(v) => set("outputSchema", v)} />
            )}
            <p className="py-1 text-[11px]" style={{ color: C.ink3 }}>大模型将以{cfg.outputFormat ?? "Markdown"}形式输出最终答案</p>
            <div className="space-y-1 py-1 text-xs">
              {[["output", "大模型的全部输出"], ["thought", "大模型的思考过程"], ["answer", "大模型的回复答案"]].map(([k, dsc]) => (
                <div key={k} className="grid grid-cols-[1fr_auto_1.4fr] gap-1"><span style={{ color: C.ink }}>{k}</span><TypeChip t="Str" /><span style={{ color: C.ink3 }}>{dsc}</span></div>
              ))}
            </div>
            {/* R1 修复：移除“输出示例”假按钮（仅 toast，无生成无保存） */}
          </Section>
          <Section title="批处理" defaultOpen={false}>
            <ToggleGroup type="single" size="sm" value={cfg.batchMode === "batch" ? "batch" : "single"}
              onValueChange={(v) => v && set("batchMode", v)}>
              <ToggleGroupItem value="single" className="h-6 px-2 text-[10px]">单次</ToggleGroupItem>
              <ToggleGroupItem value="batch" className="h-6 px-2 text-[10px]">批处理</ToggleGroupItem>
            </ToggleGroup>
            {cfg.batchMode === "batch" && (
              <div className="pt-2">
                <VarButton value={(cfg.batchListRef as string) ?? ""} nodes={nodes} edges={edges} selfId={node.id} defs={defs}
                  onPick={(v) => set("batchListRef", v)} />
                <div className="grid grid-cols-2 gap-2 pt-2 text-xs">
                  <div><div className="pb-1" style={{ color: C.ink2 }}>最大批次数</div>
                    <Input type="number" className="h-7 text-xs" value={String(cfg.maxBatches ?? 100)}
                      onChange={(e) => set("maxBatches", Number(e.target.value) || 100)} /></div>
                  <div><div className="pb-1" style={{ color: C.ink2 }}>并发数</div>
                    <Input type="number" className="h-7 text-xs" value={String(cfg.batchParallel ?? 10)}
                      onChange={(e) => set("batchParallel", Number(e.target.value) || 10)} /></div>
                </div>
                <p className="pt-1 text-[11px]" style={{ color: C.ink3 }}>输出 outputList:Array（批量列表变量限 Array）。</p>
              </div>
            )}
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
      {node.type === "tool" && (
        <ToolParamsSection cfg={cfg} set={set} nodes={nodes} edges={edges} selfId={node.id} defs={defs} />
      )}
      {node.type === "knowledge-retrieval" && (
        <>
          <Section title="Knowledge Source">
            <ResourceSelect types="knowledge" value={cfg.knowledgeSourceId ?? ""} placeholder="选择 Knowledge Source（仅 Enabled）"
              onPick={(m) => set("knowledgeSourceId", m.id)} />
          </Section>
          <Section title="检索配置">
            <PromptArea value={cfg.query ?? ""} onChange={(v) => set("query", v)}
              nodes={nodes} edges={edges} selfId={node.id} defs={defs} placeholder="{{开始.outputs.userQuery}}" minH="min-h-14" />
            <div className="flex items-center gap-2 pt-2 text-xs" style={{ color: C.ink3 }}>
              topK
              <Input type="number" className="h-7 w-20 text-xs"
                value={cfg.topK ?? 5} onChange={(e) => set("topK", Number(e.target.value))} />
            </div>
            <div className="flex items-center gap-2 pt-2 text-xs" style={{ color: C.ink2 }}>
              检索模式
              <ToggleGroup type="single" size="sm" value={(cfg.retrievalMode as string) ?? "multiWay"}
                onValueChange={(v) => v && set("retrievalMode", v)}>
                <ToggleGroupItem value="oneWay" className="h-6 px-2 text-[10px]">单路</ToggleGroupItem>
                <ToggleGroupItem value="multiWay" className="h-6 px-2 text-[10px]">多路</ToggleGroupItem>
              </ToggleGroup>
            </div>
            {((cfg.retrievalMode as string) ?? "multiWay") === "multiWay" && (
              <div className="grid grid-cols-2 gap-2 pt-2 text-xs">
                <div><div className="pb-1" style={{ color: C.ink2 }}>分数阈值</div>
                  <Input type="number" className="h-7 text-xs" value={String(cfg.scoreThreshold ?? "")}
                    placeholder="0.5" onChange={(e) => set("scoreThreshold", Number(e.target.value))} /></div>
                <div className="flex items-end justify-between pb-1">
                  <span style={{ color: C.ink2 }}>rerank</span>
                  <Switch checked={!!cfg.rerankEnable} onCheckedChange={(v) => set("rerankEnable", v)} />
                </div>
              </div>
            )}
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
        <>
        <Section title="条件分支">
          {condBranches.map((b, bi) => (
            <div key={b.handle} className={`mb-2 rounded-md p-2 ${dragBr === bi ? "opacity-60" : ""}`} style={{ background: "#F7F9FC" }}
              onDragOver={(e) => e.preventDefault()} onDrop={() => dropBranch(bi)}>
              <div className="flex items-center gap-1 pb-1.5">
                <span className="cursor-grab text-neutral-400" draggable onDragStart={() => setDragBr(bi)} title="拖拽排序">
                  <GripVertical className="size-3.5" />
                </span>
                <span className="text-xs font-medium" style={{ color: C.ink }}>{bi === 0 ? "如果" : `否则如果 ${bi}`}</span>
                <Input className="h-5 min-w-0 flex-1 text-[11px]" value={(b as CondBranch & { title?: string }).title ?? ""}
                  placeholder="分支名（画布标签跟随）"
                  onChange={(e) => patchBranch(bi, { title: e.target.value } as Partial<CondBranch>)} />
                <ToggleGroup type="single" size="sm" value={b.logic} title="组内多条件的连接方式"
                  onValueChange={(v) => v && patchBranch(bi, { logic: v as "AND" | "OR" })}>
                  <ToggleGroupItem value="AND" className="h-5 px-1.5 text-[10px]">且</ToggleGroupItem>
                  <ToggleGroupItem value="OR" className="h-5 px-1.5 text-[10px]">或</ToggleGroupItem>
                </ToggleGroup>
                <button title="删除分支" onClick={() => removeBranch(bi)}><Trash2 className="size-3 text-neutral-400 hover:text-red-500" /></button>
              </div>
              {b.conditions.map((c, ci) => (
                <div key={ci} className="mb-1.5 rounded border bg-white p-1.5" style={{ borderColor: C.cardBorder }}>
                  <div className="flex items-center gap-1">
                    <Popover>
                      <PopoverTrigger asChild>
                        <button className="min-w-0 flex-1 truncate rounded border px-1.5 py-1 text-left text-xs"
                          style={{ borderColor: c.variable ? C.cardBorder : C.danger, color: c.variable ? C.ink : C.ink3 }}
                          onClick={() => setVarTarget(`__cL:${bi}:${ci}`)}>
                          {c.variable ? describeVar(c.variable, nodes) : "选择变量"}
                        </button>
                      </PopoverTrigger>
                      <PopoverContent><VarCascader nodes={nodes} edges={edges} selfId={node.id} defs={defs} onPick={insertVar} /></PopoverContent>
                    </Popover>
                    <button title="删除条件" onClick={() => patchBranch(bi, { conditions: b.conditions.filter((_, j) => j !== ci) })}>
                      <X className="size-3 text-neutral-400" />
                    </button>
                  </div>
                  <div className="flex items-center gap-1 pt-1">
                    <Select value={c.operator} onValueChange={(v) => patchCond(bi, ci, { operator: v })}>
                      <SelectTrigger className="h-6 w-24 shrink-0 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(OPS_BY_TYPE[c.variableType] ?? OPS_BY_TYPE.string).map((op) => (
                          <SelectItem key={op} value={op}>{OP_LABEL[op]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!NO_VALUE_OPS.has(c.operator) && (c.valueMode === "VARIABLE" ? (
                      <div className="flex min-w-0 flex-1 items-center gap-1">
                        <Popover>
                          <PopoverTrigger asChild>
                            <button className="min-w-0 flex-1 truncate rounded border px-1.5 py-1 text-left text-xs"
                              style={{ borderColor: C.cardBorder, color: c.valueRef ? C.primary : C.ink3 }}
                              onClick={() => setVarTarget(`__cR:${bi}:${ci}`)}>
                              {c.valueRef ? describeVar(c.valueRef, nodes) : "选择变量"}
                            </button>
                          </PopoverTrigger>
                          <PopoverContent><VarCascader nodes={nodes} edges={edges} selfId={node.id} defs={defs} onPick={insertVar} /></PopoverContent>
                        </Popover>
                        <button title="改为字面量" onClick={() => patchCond(bi, ci, { valueMode: "LITERAL", valueRef: "" })}>
                          <X className="size-3 text-neutral-400" />
                        </button>
                      </div>
                    ) : c.variableType === "boolean" ? (
                      <Select value={c.value || undefined} onValueChange={(v) => patchCond(bi, ci, { value: v })}>
                        <SelectTrigger className="h-6 flex-1 text-xs"><SelectValue placeholder="选择" /></SelectTrigger>
                        <SelectContent><SelectItem value="true">true</SelectItem><SelectItem value="false">false</SelectItem></SelectContent>
                      </Select>
                    ) : (
                      <div className="flex min-w-0 flex-1 items-center gap-1">
                        <Input className="h-6 min-w-0 flex-1 text-xs" placeholder={c.variableType === "number" ? "数值" : "比较值"}
                          type={c.variableType === "number" ? "number" : "text"}
                          value={c.value} onChange={(e) => patchCond(bi, ci, { value: e.target.value })} />
                        <Popover>
                          <PopoverTrigger asChild>
                            <button className="shrink-0 rounded border px-1 py-0.5 text-[10px]" style={{ borderColor: C.cardBorder, color: C.primary }}
                              title="引用变量" onClick={() => setVarTarget(`__cR:${bi}:${ci}`)}>引用</button>
                          </PopoverTrigger>
                          <PopoverContent><VarCascader nodes={nodes} edges={edges} selfId={node.id} defs={defs} onPick={insertVar} /></PopoverContent>
                        </Popover>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <button className="flex items-center gap-1 pt-0.5 text-xs" style={{ color: C.primary }}
                onClick={() => patchBranch(bi, { conditions: [...b.conditions, { ...emptyCond }] })}>
                <Plus className="size-3" /> 添加条件
              </button>
            </div>
          ))}
          <button className="flex items-center gap-1 text-xs" style={{ color: C.primary }} onClick={addBranch}>
            <Plus className="size-3" /> 添加分支
          </button>
          <div className="mt-2 flex items-center justify-between rounded-md px-2 py-1.5" style={{ background: "#F7F9FC" }}>
            <span className="text-xs" style={{ color: C.ink2 }}>否则（Else）</span>
            <span className="text-[10px]" style={{ color: C.ink3 }}>兜底分支 · 不可删除</span>
          </div>
        </Section>
        <Section title="高级" defaultOpen={false}>
          <label className="flex items-center justify-between text-xs" style={{ color: C.ink2 }}>
            <span>大小写不敏感</span><Switch checked={cfg.ignoreCase !== false} onCheckedChange={(v) => set("ignoreCase", v)} />
          </label>
          <label className="flex items-center justify-between pt-2 text-xs" style={{ color: C.ink2 }}>
            <span>宽松类型校验</span><Switch checked={!!cfg.looseTypeValidation} onCheckedChange={(v) => set("looseTypeValidation", v)} />
          </label>
          <p className="pt-1 text-[11px]" style={{ color: C.ink3 }}>操作符族含 in/not_in/exists/is_null 系；object/file 子属性条件经变量级联子路径选择。</p>
        </Section>
        </>
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
      {node.type === "workflow-exec" && (
        <Section title="绑定模式">
          <ToggleGroup type="single" size="sm" value={(cfg.mode as string) ?? "fixed"} onValueChange={(v) => v && set("mode", v)}>
            <ToggleGroupItem value="fixed" className="h-6 px-2 text-[10px]">固定</ToggleGroupItem>
            <ToggleGroupItem value="dynamic" className="h-6 px-2 text-[10px]">动态</ToggleGroupItem>
          </ToggleGroup>
          {((cfg.mode as string) ?? "fixed") === "fixed" ? (
            <div className="pt-2"><WorkflowPicker value={(cfg.workflowCode as string) ?? ""} onPick={(v) => set("workflowCode", v)} /></div>
          ) : (
            <div className="pt-2">
              <VarButton value={((node.inputs ?? []).find((b) => b.name === "workflowCode")?.source as { value?: string } | undefined)?.value ?? ""}
                nodes={nodes} edges={edges} selfId={node.id} defs={defs}
                onPick={(v) => onChange({ ...node, inputs: [...(node.inputs ?? []).filter((b) => b.name !== "workflowCode"), { name: "workflowCode", type: "string", source: { kind: "fixed", value: v } }] })} />
              <p className="pt-1 text-[11px]" style={{ color: C.ink3 }}>workflowCode 来自输入绑定（接路由输出）。</p>
            </div>
          )}
        </Section>
      )}
      {node.type === "workflow-fixed" && (
        <>
          <WorkflowPicker value={(cfg.workflowId as string) ?? ""} onPick={(v) => set("workflowId", v)} />
          <Section title="版本策略">
            <ToggleGroup type="single" size="sm" value={(cfg.versionPolicy as string) ?? "latest"} onValueChange={(v) => v && set("versionPolicy", v)}>
              <ToggleGroupItem value="latest" className="h-6 px-2 text-[10px]">最新已发布</ToggleGroupItem>
              <ToggleGroupItem value="pinned" className="h-6 px-2 text-[10px]">钉版本</ToggleGroupItem>
            </ToggleGroup>
            {(cfg.versionPolicy as string) === "pinned" && (
              <div className="pt-2"><Input className="h-7 text-xs" placeholder="pinnedVersionId" value={cfg.pinnedVersionId ?? ""} onChange={(e) => set("pinnedVersionId", e.target.value)} /></div>
            )}
          </Section>
          <InputMappingTable cfg={cfg} set={set} nodes={nodes} edges={edges} selfId={node.id} defs={defs} />
        </>
      )}
      {node.type === "workflow-select" && (
        <CandidatesMulti cfg={cfg} set={set} />
      )}
      {node.type === "workflow-select" && (
        <Section title="路由模型">
          <Select value={(cfg.routingModel as string) ?? "qwen-plus"} onValueChange={(v) => set("routingModel", v)}>
            <SelectTrigger className="h-7 w-full text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{models.map((m) => <SelectItem key={m.id} value={m.id}>{m.id}</SelectItem>)}</SelectContent>
          </Select>
          <p className="pt-1 text-[11px]" style={{ color: C.ink3 }}>候选多选见 workflow-picker-multi；未命中走 else；路由超时 10s 失败降级 else。</p>
        </Section>
      )}
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
          <div className="flex items-center gap-2 pt-1">
            <button className="rounded border px-2 py-0.5 text-[11px]" style={{ borderColor: C.cardBorder, color: C.primary }}
              onClick={() => {
                const code = String(cfg.code ?? "")
                const ins = [...code.matchAll(/args\.params\.get\(\s*["']([A-Za-z0-9_]+)["']/g)].map((m) => m[1])
                const ret = code.match(/return\s*\{([^}]*)\}/)
                const outs = ret ? [...ret[1].matchAll(/["']?([A-Za-z0-9_]+)["']?\s*:/g)].map((m) => m[1]) : []
                onChange({
                  ...node,
                  inputs: ins.map((nme) => ({ name: nme, type: "string", source: { kind: "fixed", value: "" } })),
                  config: { ...cfg, outputs: Object.fromEntries(outs.map((o) => [o, { type: "string" }])) },
                })
                toast.success("已同步函数签名")
              }}>⇄ 同步函数签名</button>
            <span className="text-[11px]" style={{ color: C.ink3 }}>解析 args.params.get 与 return 键</span>
          </div>
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
            <PromptArea value={typeof cfg.template === "string" ? cfg.template : ""} onChange={(v) => set("template", v)}
              nodes={nodes} edges={edges} selfId={node.id} defs={defs}
              placeholder="改写提示词（真 LLM 生效；无模型配置时回落透传）" />
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
      {/* 07-SDD form：开始节点=引用集中表单 */}
      {node.type === "input" && <StartFormSection cfg={cfg} set={set} />}
      {/* 07-SDD §4：P2 三节点专项抽屉 */}
      {node.type === "loop" && <LoopSection cfg={cfg} set={set} nodes={nodes} edges={edges} selfId={node.id} defs={defs} />}
      {node.type === "wait-review" && <WaitReviewSection cfg={cfg} set={set} nodes={nodes} edges={edges} selfId={node.id} defs={defs} />}
      {node.type === "data-read" && <DataReadSection cfg={cfg} set={set} />}
      {/* 07-SDD §2.6：健壮性 + 输出变量统一区（全节点） */}
      {node.type !== "input" && <RobustnessSection node={node} onChange={onChange} />}
      {node.type !== "input" && <OutputVarsSection def={def} />}
      {/* SDD C-3：无专项表单的节点按注册表 schema 通用渲染 */}
      {!["input", "llm", "tool", "knowledge-retrieval", "mcp-call", "condition", "end", "workflow-exec", "workflow-fixed", "workflow-select", "loop", "wait-review", "data-read", "agent-select", "agent", "agent-exec", "code-write", "query-rewrite", "decision-class"].includes(node.type) && (
        <GenericSchemaForm def={def} cfg={cfg} set={set} node={node} onChange={onChange} nodes={nodes} edges={edges} defs={defs} />
      )}
    </div>
  )
}

/* 06-master-spec §2.1：x-control→组件 统一映射表（字段 label 中文化） */
const FIELD_LABEL: Record<string, string> = {
  modelRef: "模型", prompt: "提示词", template: "模板", code: "代码", query: "查询",
  topK: "topK", keys: "记忆键", mode: "模式", candidates: "候选工作流", branches: "分支",
  toolVersionId: "插件工具", knowledgeSourceId: "知识源", mcpServerId: "MCP Server",
  toolName: "MCP 工具", workflowCode: "工作流", workflowId: "工作流", message: "消息内容",
  content: "回复内容", outputKey: "输出键", strategy: "策略",
}

/** 注册表 schema 驱动的通用节点配置（SDD C-3；06-master-spec §2.1 x-control 映射表）。 */
function GenericSchemaForm({ def, cfg, set, node, onChange, nodes, edges, defs }: {
  def: NodeDefinition | undefined; cfg: NodeCfgLoose; set: (k: string, v: unknown) => void;
  node: WfNode; onChange: (n: WfNode) => void; nodes: WfNode[]; edges: WfEdge[]; defs: NodeDefinition[]
}) {
  const props = ((def?.schema as NodeCfgLoose)?.properties ?? {}) as NodeCfgLoose
  const keys = Object.keys(props)
  const [mcpTools, setMcpTools] = useState<string[]>([])
  useEffect(() => {
    const sid = cfg.mcpServerId as string | undefined
    if (!sid) { setMcpTools([]); return }
    resApi.get("mcp", sid).then((d) => setMcpTools(((d.config?.discoveredTools as { name?: string }[] | undefined) ?? []).map((t) => t.name ?? ""))).catch(() => undefined)
  }, [cfg.mcpServerId])
  const [wfList, setWfList] = useState<{ id: string; name: string }[]>([])
  useEffect(() => { wfApi.list({ pageSize: 100 }).then((r) => setWfList(r.items as { id: string; name: string }[])).catch(() => undefined) }, [])
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([])
  useEffect(() => { agentApi.list({ pageSize: 100 }).then((r) => setAgents(r.items.map((a) => ({ id: a.id, name: a.name })))).catch(() => undefined) }, [])
  if (keys.length === 0) return null
  return (
    <Section title="配置">
      {keys.map((k) => {
        const p = props[k] ?? {}
        const x = p["x-control"] as string | undefined
        const label = FIELD_LABEL[k] ?? k
        if (x === "workflow-picker") {
          return (
            <div key={k} className="space-y-1">
              <div className="text-xs" style={{ color: C.ink2 }}>{label}</div>
              <Select value={(cfg[k] as string) || undefined} onValueChange={(v) => set(k, v)}>
                <SelectTrigger className="h-7 w-full text-xs"><SelectValue placeholder="请选择工作流" /></SelectTrigger>
                <SelectContent>{wfList.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )
        }
        if (x === "workflow-picker-multi") {
          const sel = Array.isArray(cfg[k]) ? (cfg[k] as string[]) : []
          return (
            <div key={k} className="space-y-1">
              <div className="text-xs" style={{ color: C.ink2 }}>{label}（多选）</div>
              <div className="max-h-36 space-y-0.5 overflow-y-auto rounded border p-1" style={{ borderColor: C.cardBorder }}>
                {wfList.length === 0 && <div className="px-1 py-1 text-[11px]" style={{ color: C.ink3 }}>暂无工作流</div>}
                {wfList.map((w) => (
                  <label key={w.id} className="flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-xs hover:bg-neutral-50" style={{ color: C.ink }}>
                    <Checkbox checked={sel.includes(w.id)}
                      onCheckedChange={(v) => set(k, v ? [...sel, w.id] : sel.filter((id) => id !== w.id))} />
                    <span className="truncate">{w.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )
        }
        if (x === "prompt-editor" || x === "expression-editor") {
          return (
            <div key={k} className="space-y-1">
              <div className="text-xs" style={{ color: C.ink2 }}>{label}</div>
              <PromptArea value={typeof cfg[k] === "string" ? cfg[k] : ""} onChange={(v) => set(k, v)}
                nodes={nodes} edges={edges} selfId={node.id} defs={defs}
                minH={x === "expression-editor" ? "min-h-10" : "min-h-20"} />
            </div>
          )
        }
        if (x === "variable-picker") {
          return (
            <div key={k} className="space-y-1">
              <div className="text-xs" style={{ color: C.ink2 }}>{label}</div>
              <VarButton value={(cfg[k] as string) ?? ""} nodes={nodes} edges={edges} selfId={node.id} defs={defs} onPick={(v) => set(k, v)} />
            </div>
          )
        }
        if (x === "tool-picker") {
          return (
            <div key={k} className="space-y-1">
              <div className="text-xs" style={{ color: C.ink2 }}>{label}</div>
              <ResourceSelect types="tool" value={(cfg[k] as string) ?? ""} placeholder="选择 Tool（仅 Enabled）"
                onPick={async (m) => {
                  let versionId = ""
                  try { versionId = ((await resApi.toolVersions(m.id))[0]?.id) ?? "" } catch { /* 忽略 */ }
                  set(k, versionId || m.id)
                }} />
            </div>
          )
        }
        if (x === "knowledge-picker") {
          return (
            <div key={k} className="space-y-1">
              <div className="text-xs" style={{ color: C.ink2 }}>{label}</div>
              <ResourceSelect types="knowledge" value={(cfg[k] as string) ?? ""} placeholder="选择知识源" onPick={(m) => set(k, m.id)} />
            </div>
          )
        }
        if (x === "mcp-picker") {
          return (
            <div key={k} className="space-y-1">
              <div className="text-xs" style={{ color: C.ink2 }}>{label}</div>
              <ResourceSelect types="mcp" value={(cfg[k] as string) ?? ""} placeholder="选择 MCP Server" onPick={(m) => set(k, m.id)} />
            </div>
          )
        }
        if (x === "mcp-tool-picker") {
          return (
            <div key={k} className="space-y-1">
              <div className="text-xs" style={{ color: C.ink2 }}>{label}</div>
              <Select value={(cfg[k] as string) || undefined} onValueChange={(v) => set(k, v)}>
                <SelectTrigger className="h-7 w-full text-xs"><SelectValue placeholder="选择工具" /></SelectTrigger>
                <SelectContent>{mcpTools.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )
        }
        if (x === "agent-picker") {
          return (
            <div key={k} className="space-y-1">
              <div className="text-xs" style={{ color: C.ink2 }}>{label}</div>
              <Select value={(cfg[k] as string) || undefined} onValueChange={(v) => set(k, v)}>
                <SelectTrigger className="h-7 w-full text-xs"><SelectValue placeholder="请选择 Agent" /></SelectTrigger>
                <SelectContent>{agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )
        }
        if (x === "agent-picker-multi") {
          const sel = Array.isArray(cfg[k]) ? (cfg[k] as string[]) : []
          return (
            <div key={k} className="space-y-1">
              <div className="text-xs" style={{ color: C.ink2 }}>{label}（多选）</div>
              <div className="max-h-36 space-y-0.5 overflow-y-auto rounded border p-1" style={{ borderColor: C.cardBorder }}>
                {agents.length === 0 && <div className="px-1 py-1 text-[11px]" style={{ color: C.ink3 }}>暂无 Agent</div>}
                {agents.map((a) => (
                  <label key={a.id} className="flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-xs hover:bg-neutral-50" style={{ color: C.ink }}>
                    <Checkbox checked={sel.includes(a.id)}
                      onCheckedChange={(v) => set(k, v ? [...sel, a.id] : sel.filter((id) => id !== a.id))} />
                    <span className="truncate">{a.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )
        }
        if (x === "code-editor") {
          return (
            <div key={k} className="space-y-1">
              <div className="text-xs" style={{ color: C.ink2 }}>{label}</div>
              <div className="overflow-hidden rounded-md border" style={{ borderColor: C.cardBorder }}>
                <CodeMirror value={typeof cfg[k] === "string" ? cfg[k] : ""} onChange={(v) => set(k, v)} theme="light" height="160px"
                  extensions={[python()]} basicSetup={{ lineNumbers: true, foldGutter: true, autocompletion: true, bracketMatching: true, highlightActiveLine: true }} style={{ fontSize: 12 }} />
              </div>
            </div>
          )
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
              <Input className="h-6 flex-1 text-xs" placeholder="请输入或引用变量值"
                value={b.source.kind === "fixed" ? String(b.source.value ?? "") : `{{引用}}`}
                onChange={(e) => onChange({ ...node, inputs: (node.inputs ?? []).map((x) => (x.name === b.name ? { ...x, source: { kind: "fixed", value: e.target.value } } : x)) })} />
              <Popover>
                <PopoverTrigger asChild>
                  <button className="shrink-0 rounded border px-1 text-[10px]" style={{ borderColor: C.cardBorder, color: C.primary }} title="引用变量">⚙</button>
                </PopoverTrigger>
                <PopoverContent align="start">
                  <VarCascader nodes={nodes} edges={edges} selfId={node.id} defs={defs} onPick={(v) => {
                    const m = /^\{\{(.+?)\.outputs\.(.+?)\}\}$/.exec(v)
                    if (m) onChange({ ...node, inputs: (node.inputs ?? []).map((x) => (x.name === b.name ? { ...x, source: { kind: "upstream", nodeId: m[1], path: `outputs.${m[2]}` } } : x)) })
                  }} />
                </PopoverContent>
              </Popover>
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
        {/* 07-SDD form：调试表单按开始节点 form 渲染（无 form 回退存量四字段） */}
        {(getStartFields() ?? ["userQuery", "userId", "conversationId", "chatId"].map((n2) => ({ name: n2, type: "string" }))).map((f) => (
          <div key={f.name}>
            <div className="pb-1 text-[13px]" style={{ color: C.ink }}>{f.name}{(f as { required?: boolean }).required ? " *" : ""} <span className="text-[11px]" style={{ color: C.ink3 }}>{f.type}</span></div>
            <Input placeholder="按需填写" value={vals[f.name] ?? ""} onChange={(e) => setVals({ ...vals, [f.name]: e.target.value })} />
          </div>
        ))}
        {!getStartFields() && (
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
        )}
      </div>
      <div className="p-4">
        <Button className="w-full bg-black text-white hover:bg-neutral-800" onClick={() => onRun(vals)}>开始运行</Button>
      </div>
    </div>
  )
}





/* ============ 工作流资源选择器（引用资源对象） ============ */

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

/* SDD D-1：专家组成员池选择器（排除自身；供 Agent选择/执行节点联动）
 * R-Archive：readOnly 时只展示成员清单，隐藏添加/移除。 */
function MemberPoolPicker({ ids, onChange, selfId, readOnly = false }: { ids: string[]; onChange: (v: string[]) => void; selfId: string; readOnly?: boolean }) {
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
        {!readOnly && (
          <button className="text-xs" style={{ color: C.primary }} onClick={() => setOpen(!open)}>{open ? "收起" : "添加成员"}</button>
        )}
      </div>
      {ids.length === 0 && !open && (
        <p className="text-[11px]" style={{ color: C.ink3 }}>添加后，画布中「Agent选择/执行」节点可从成员池选择。</p>
      )}
      {ids.map((id) => (
        <div key={id} className="flex items-center gap-1 text-xs">
          <span className="flex-1 truncate rounded border px-1 py-0.5" style={{ borderColor: C.cardBorder }}>{nameOf(id)}</span>
          {!readOnly && <button onClick={() => onChange(ids.filter((x) => x !== id))}><X className="size-3 text-neutral-400" /></button>}
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

function AgentConfigDrawer({ agentId, inline, avatar, onClose, readOnly = false }: { agentId: string; onClose?: () => void; inline?: boolean; avatar?: string; readOnly?: boolean }) {
  const [collapsed, setCollapsed] = useState(false)
  const [agent, setAgent] = useState<{ name: string; description: string; config: NodeCfgLoose; workflowId?: string | null; configRevision: number; avatar?: string | null; type?: string } | null>(null)
  useEffect(() => {
    agentApi.get(agentId).then(setAgent)
  }, [agentId])
  if (!agent) return null
  const cfg = agent.config ?? {}
  const setCfg = (k: string, v: unknown) => setAgent({ ...agent, config: { ...cfg, [k]: v } })
  /* R-Archive：本抽屉仅在旧 Agent 页挂载（readOnly），保存/头像编辑已移除 */
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
                <Input value={agent.name} maxLength={20} placeholder="请输入Agent名称" className="pr-12" readOnly={readOnly}
                  onChange={(e) => setAgent({ ...agent, name: e.target.value })} />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px]" style={{ color: C.ink3 }}>{agent.name.length}/20</span>
              </div>
              <div className="relative">
                <Textarea value={agent.description} maxLength={20000} placeholder="请输入该Agent描述介绍文案（仅在管理平台展示）" className="min-h-24 pb-6" readOnly={readOnly}
                  onChange={(e) => setAgent({ ...agent, description: e.target.value })} />
                <span className="absolute bottom-2 right-2 text-[11px]" style={{ color: C.ink3 }}>{(agent.description ?? "").length}/20000</span>
              </div>
            </div>
            <button className="shrink-0 overflow-hidden rounded-lg border bg-white p-1" style={{ borderColor: C.cardBorder }} title="头像"
              disabled>
              {/* 头像优先级：本次会话新选 > 已保存头像 > 按 id 哈希回落（与列表/头部一致） */}
              <img src={avatar ?? avatarFor(agentId ?? "", agent.avatar)} alt="agent头像" className="size-24 rounded-md object-cover" />
            </button>
          </div>
        </div>
        {/* A-10 门面已删除；Phase B：结构化记忆 Schema + 对话体验真实现 */}
        <KnowledgeFallbackPicker ids={cfg.knowledges ?? []} onChange={(v) => setCfg("knowledges", v)} />
        {/* SDD D-1：专家组成员池（画布 Agent选择/执行节点从这里取候选） */}
        {agent.type === "expert-group" && (
          <MemberPoolPicker ids={(cfg.members ?? []) as string[]} onChange={(v) => setCfg("members", v)} selfId={agentId} readOnly={readOnly} />
        )}
        <div className="space-y-2">
          <span className="text-[13px] font-medium" style={{ color: C.ink }}>| Agent 记忆</span>
          <MemorySchemaForm memories={cfg.memoriesSchema ?? []} onChange={(v) => setCfg("memoriesSchema", v)} readOnly={readOnly} />
        </div>
        <div className="space-y-2">
          <span className="text-[13px] font-medium" style={{ color: C.ink }}>| 对话体验</span>
          <ConversationPanel cfg={cfg} setCfg={(v) => setAgent({ ...agent, config: v })} readOnly={readOnly} />
        </div>
        {readOnly && (
          <div className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-600">
            该旧版 Agent 已封存，仅支持历史查询；配置编辑不再开放。
          </div>
        )}
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
function DesignerInner({ workflowId: wfProp, agentId: agentProp, agentMeta, avatar, readOnly = false }: { workflowId?: string; agentId?: string; agentMeta?: { name: string; typeLabel: string; agentType?: string }; avatar?: string; readOnly?: boolean }) {
  /* readOnly（R-Archive，SDD 10）：旧 Agent 绑定的画布只读——隐藏保存/发布/试运行/
     定时任务/节点面板与编辑锁，禁止连线与拖放加节点；仅保留查看。 */
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
  const [runState, setRunState] = useState<Record<string, NonNullable<WfNodeData["run"]>>>({})
  const [running, setRunning] = useState(false)
  const runningRef = useRef(false)
  // 08-26 用户反馈：工作流基础信息编辑（名称/简介/图标，图标复用 agent 头像库）
  const [metaOpen, setMetaOpen] = useState(false)
  const [avatarOpen, setAvatarOpen] = useState(false)
  const [metaName, setMetaName] = useState("")
  const [metaDesc, setMetaDesc] = useState("")
  const [metaIcon, setMetaIcon] = useState<string | null>(null)
  const [lastRunId, setLastRunId] = useState<string | null>(null)
  const [publishOpen, setPublishOpen] = useState(false)
  /* E-4.3：节点单测（⋯菜单 → 填 mock 输入 → 后端执行单节点，不落 Run） */
  const [testNodeId, setTestNodeId] = useState<string | null>(null)
  const [testInput, setTestInput] = useState("{}")
  const [testBusy, setTestBusy] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; output?: unknown; error?: string; durationMs?: number } | null>(null)
  const runNodeTest = async () => {
    if (!testNodeId) return
    let input: Record<string, unknown>
    try { input = JSON.parse(testInput || "{}") } catch { toast.error("输入 JSON 非法"); return }
    setTestBusy(true); setTestResult(null)
    try {
      const r = await wfApi.nodeTest(workflowId, testNodeId, input)
      setTestResult(r)
    } catch (e) {
      setTestResult({ ok: false, error: (e as Error).message.replace(/^\d+:\s*/, "").replace(/^"|"$/g, "") })
    } finally { setTestBusy(false) }
  }
  const rbacCanPublish = rbac.can("agent.publish")  // D-4：发布门禁
  /* SDD B：Agent 级版本/部署状态（agentMeta 模式的徽标与发布对话框） */
  const agentVersionState = useAgentVersionState(agentMeta && agentId ? agentId : undefined)
  const [pop, setPop] = useState<null | "add" | "zoom" | "search">(null)
  const [paletteOpen, setPaletteOpen] = useState(() => localStorage.getItem("wf-palette-open") !== "0")
  // 07-SDD form：开始字段缓存注入（VarCascader/DebugDrawer/OutputVars 消费）
  const startFormId = (((def?.graph.nodes.find((n) => n.type === "input")?.config) as Record<string, unknown> | undefined)?.formId as string) || ""
  const [, bumpStart] = useState(0)
  useEffect(() => {
    if (!startFormId) { setStartFields(null); bumpStart((x) => x + 1); return }
    formsApi.get(startFormId).then((f) => {
      setStartFields((f.fields ?? []).map((x) => ({ name: x.key ?? (x as unknown as { name?: string }).name ?? "", type: x.dataType ?? x.type })))
      bumpStart((x) => x + 1)
    }).catch(() => { setStartFields(null); bumpStart((x) => x + 1) })
  }, [startFormId])
  const [versions, setVersions] = useState<{ versionNo: number; publishedAt: string }[]>([])
  const [agentVersions, setAgentVersions] = useState<{ versionId: string; versionNo: number; note: string; artifactHash: string; createdAt: string }[]>([])
  const [agentReleases, setAgentReleases] = useState<{ releaseId: string; environment: string; status: string; canaryPercent: number; versionNo: number | null }[]>([])
  const [diffVersion, setDiffVersion] = useState<string | null>(null)  // E-2.2：对比弹窗（默认右侧版本）
  const [latestVersion, setLatestVersion] = useState<number | null>(null)
  const [zoom, setZoom] = useState(1)
  const [lockUser, setLockUser] = useState("")
  /* bugfix：v12 MiniMap 读用户节点对象的 measured；受控模式下测量结果经
     onNodesChange 的 dimensions 事件下发，此前被丢弃导致小地图全空 */
  const [nodeDims, setNodeDims] = useState<Record<string, { width: number; height: number }>>({})
  const [agentAvatar] = useState<string | undefined>(undefined)
  const historyRef = useRef<WfDefinition[]>([])
  const pointerRef = useRef(-1)
  const wsIdRef = useRef(Math.random().toString(36).slice(2, 8))
  const saveTimer = useRef<number | null>(null)
  const defRef = useRef<WfDefinition | null>(null)
  defRef.current = def

  /* 真实编辑锁与操作人（后端 resource_lock；SDD A-16 走 lockApi；E-2.4：Agent 编辑锁 resourceId=agent:{id}） */
  const lockResourceId = agentMeta && agentId ? `agent:${agentId}` : workflowId
  const [lockByOther, setLockByOther] = useState(false)
  useEffect(() => {
    if (readOnly && agentMeta) return  // R-Archive：封存画布不取编辑锁
    const wsId = wsIdRef.current
    lockApi.acquire(lockResourceId, wsId, "质量管理员")
      .then((r) => { setLockUser(r.user ?? ""); setLockByOther(!!r.lockedByOther) })
      .catch(() => undefined)
    return () => { lockApi.release(lockResourceId, wsId).catch(() => undefined) }
  }, [lockResourceId, readOnly, agentMeta])

  useEffect(() => {
    let alive = true
    Promise.all([wfApi.get(workflowId), wfApi.nodeDefinitions()]).then(([d, nd]) => {
      if (!alive) return
      /* 旧条件数据归一：分支升级为 conditions[] 结构，并同步声明 handle（含 else） */
      const defn = d.definition as WfDefinition
      defn.graph.nodes = defn.graph.nodes.map((n) => {
        if (n.type !== "condition") return n
        const bs = normCondBranches((n.config as NodeCfgLoose)?.branches)
        return { ...n, config: { ...(n.config as NodeCfgLoose), branches: bs }, branches: [...bs.map((b) => b.handle), "else"] }
      })
      defn.graph.edges = defn.graph.edges.map((e) => {
        if (e.sourceHandle) return e
        const src = defn.graph.nodes.find((n) => n.id === e.source)
        if (src?.type !== "condition") return e
        const first = (src.config as NodeCfgLoose).branches?.[0]?.handle
        return first ? { ...e, sourceHandle: first } : e  // 旧图单出边视为第一分支
      })
      historyRef.current = [JSON.parse(JSON.stringify(defn))]
      pointerRef.current = 0
      setDef(defn); setRevision(d.draftRevision); setDefs(nd); setSavedAt(d.updatedAt)
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

  const families = useMemo(() => {
    // SDD C-2：按编排器类型过滤节点目录（调研 11 §7 editorKinds）
    const kind: "FLOW" | "GROUP" | "WORKFLOW" = agentMeta
      ? ((agentMeta as { agentType?: string }).agentType === "expert-group" ? "GROUP" : "FLOW")
      : "WORKFLOW"
    // 07-SDD D8：deprecated（退役 agent 三键）不进 palette
    const visible = defs.filter((d) => (d.editor_kinds ?? ["WORKFLOW"]).includes(kind) && !(d as unknown as Record<string, unknown>).deprecated)
    const m = new Map<string, NodeDefinition[]>()
    for (const d of visible) m.set(d.family, [...(m.get(d.family) ?? []), d])
    return [...m.entries()]
  }, [defs, agentMeta])
  // 08-26 用户反馈：节点尾部+快捷添加（自动连线；分支节点按分支 handle 连）
  // 09 P0-B4：上移至 nodes memo 之前并 useCallback 化，消除 rules-of-hooks/exhaustive-deps
  const quickAdd = useCallback((sourceId: string, handle: string | null, typeKey: string) => {
    const d = defRef.current!
    const defn = defs.find((x) => x.type_key === typeKey)
    const id = `n_${typeKey}_${Date.now() % 100000}`
    const srcPos = d.ui.positions[sourceId] ?? { x: 260, y: 160 }
    const node: WfNode = {
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
  }, [defs, mutate])

  const nodes: Node[] = useMemo(() => (def?.graph.nodes ?? []).map((n) => ({
    id: n.id, type: "wf",
    position: def!.ui.positions[n.id] ?? { x: 120, y: 160 },
    ...(nodeDims[n.id] ? { measured: nodeDims[n.id] } : {}),
    data: {
      wf: n, def: defs.find((d) => d.type_key === n.type),
      issues: issues.filter((i) => i.nodeId === n.id),
      run: runState[n.id],
      onRunNode: (id: string) => {
        // 08-26 用户反馈：单节点运行不带动其他节点——真单测 node-test；先置 running 显示呼吸环
        setRunState({ [id]: { status: "running" } })
        wfApi.nodeTest(workflowId, id, {}).then((r: { ok?: boolean; output?: unknown; durationMs?: number; error?: string }) => {
          setRunState({ [id]: r.ok ? { status: "success", output: r.output, durationMs: r.durationMs } : { status: "failed", error: r.error || "单测失败" } })
        }).catch((e: Error) => setRunState({ [id]: { status: "failed", error: e.message } }))
      },
      onQuickAdd: (h: string | null, t: string) => quickAdd(n.id, h, t),
      palette: families,
      onTestNode: (id: string) => setTestNodeId(id),  // E-4.3
      onDelete: (id: string) => {
        const d2 = defRef.current!
        mutate({ ...d2, graph: { nodes: d2.graph.nodes.filter((x) => x.id !== id), edges: d2.graph.edges.filter((e) => e.source !== id && e.target !== id) } })
        setSelectedId(null)
      },
    } satisfies WfNodeData,
  })), [def, defs, issues, runState, mutate, nodeDims, families, quickAdd, workflowId])

  const edges: Edge[] = useMemo(() => (def?.graph.edges ?? []).map((e) => {
    // 条件分支出边标注分支名（不持久化，渲染期从源节点推导）
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
      labelStyle: { fontSize: 10, fill: C.ink2 }, labelBgStyle: { fill: "#fff", fillOpacity: 0.9 },
      reconnectable: true,
      style: { stroke: selectedEdgeId === e.id ? "#F56C6C" : "#A8B3C5", strokeWidth: selectedEdgeId === e.id ? 2.5 : 1.5 },
      interactionWidth: 24,
    }
  }), [def, selectedEdgeId])



  /* demo-run（16 §7，P1 换真 SSE） */
  /* P1：真执行 — POST /api/runs + SSE 事件驱动画布状态 */
  const subscribeRun = useCallback((runId: string) => {
    const es = new EventSource(runApi.eventsUrl(runId))
    const onNode = (e: MessageEvent) => {
      const d = JSON.parse(e.data)
      const st = e.type === "node_started" ? "running" : e.type === "node_completed" ? "success" : e.type === "node_skipped" ? "skipped" : "failed"
      if (d.nodeId) setRunState((s) => ({ ...s, [d.nodeId]: {
        status: st, durationMs: d.durationMs ?? d.duration_ms,
        tokens: d.payload?.tokens || undefined, input: d.payload?.input, output: d.payload?.output,
        error: d.payload?.error,
      } }))
    }
    for (const t of ["node_started", "node_completed", "node_failed", "node_skipped"]) es.addEventListener(t, onNode)
    es.addEventListener("workflow_completed", () => { toast.success("运行成功"); runningRef.current = false; setRunning(false); es.close() })
    es.addEventListener("workflow_failed", (e) => { const d = JSON.parse((e as MessageEvent).data); toast.error(`运行失败：${d.payload?.error ?? ""}`); runningRef.current = false; setRunning(false); es.close() })
  }, [])

  const startRealRun = useCallback(async (input: Record<string, unknown>) => {
    if (runningRef.current) return  // 08-26：进行中禁止重复点击
    runningRef.current = true
    setRunning(true)
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
      runningRef.current = false
      setRunning(false)
    }
  }, [workflowId, subscribeRun])
  const startDebugRun = startRealRun

  if (!def) return <div className="p-8 text-sm" style={{ color: C.ink2 }}>加载中…</div>

  const selected = def.graph.nodes.find((n) => n.id === selectedId) ?? null

  const onConnect = (conn: { source: string | null; target: string | null; sourceHandle?: string | null }) => {
    if (readOnly) return  // R-Archive：封存画布禁止改图
    if (!conn.source || !conn.target) return
    const sh = conn.sourceHandle ?? undefined
    if (def.graph.edges.some((e) => e.source === conn.source && e.target === conn.target && (e.sourceHandle ?? undefined) === sh)) {
      toast.error("不能重复连线", { position: "top-center" })
      return
    }
    if (sh && def.graph.edges.some((e) => e.source === conn.source && e.sourceHandle === sh)) {
      toast.error("该分支已有出边，请先删除", { position: "top-center" })
      return
    }
    mutate({ ...def, graph: { ...def.graph, edges: [...def.graph.edges, { id: `e_${Date.now() % 100000}`, source: conn.source, target: conn.target, sourceHandle: sh }] } })
  }

  // 08-27 V2：palette 拖拽落画布任意位置
  const quickAddAt = (typeKey: string, pos: { x: number; y: number }) => {
    const d = defRef.current!
    const defn = defs.find((x) => x.type_key === typeKey)
    const id = `n_${typeKey}_${Date.now() % 100000}`
    const node: WfNode = {
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
  }

  // 08-26 用户反馈：已连连线可拖动改接其他节点
  const onReconnect = (oldEdge: Edge, conn: { source: string | null; target: string | null; sourceHandle?: string | null }) => {
    if (!conn.source || !conn.target) return
    const d = defRef.current!
    const edges2 = d.graph.edges.filter((e) => e.id !== oldEdge.id)
    edges2.push({ id: `e_${Date.now() % 100000}`, source: conn.source, target: conn.target, sourceHandle: conn.sourceHandle ?? undefined })
    mutate({ ...d, graph: { ...d.graph, edges: edges2 } })
  }

  const addNode = (typeKey: string) => {
    const d = defs.find((x) => x.type_key === typeKey)
    const id = `n_${typeKey}_${Date.now() % 100000}`
    const node: WfNode = {
      id, type: typeKey, name: d?.label ?? typeKey,
      config: typeKey === "condition" ? { branches: [{ handle: "b1", logic: "AND", conditions: [] }] } : {},
      inputs: [], branches: typeKey === "condition" ? ["b1", "else"] : undefined,
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
      const res = await wfApi.publish(workflowId, "replica publish")  // 08-26 修复：独立工作流页无 agentId，发布必须用 workflowId
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
          <WfIcon icon={(def.workflow as unknown as { icon?: string }).icon} className="size-7 shrink-0 rounded-lg" iconCls="size-4" />
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
            {readOnly && agentMeta && (
              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-600">已封存 · 只读</span>
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
          <button className="rounded p-1.5 hover:bg-neutral-100" title="工作流基础信息"
            onClick={() => {
              setMetaName(def.workflow.name ?? "")
              setMetaDesc(((def.workflow as unknown as { description?: string }).description) ?? "")
              setMetaIcon(((def.workflow as unknown as { icon?: string | null }).icon) ?? null)
              setMetaOpen(true)
            }}><Settings className="size-4" style={{ color: C.ink2 }} /></button>
          <Dialog open={metaOpen} onOpenChange={setMetaOpen}>
            <DialogContent className="max-w-2xl">
              <DialogHeader><DialogTitle>工作流基础信息</DialogTitle></DialogHeader>
              <div className="flex gap-3">
                <div className="flex-1 space-y-2">
                  <Input value={metaName} placeholder="名称" onChange={(e) => setMetaName(e.target.value)} />
                  <Textarea className="min-h-24 text-xs" value={metaDesc} placeholder="简介" onChange={(e) => setMetaDesc(e.target.value)} />
                </div>
                <button className="shrink-0 overflow-hidden rounded-lg border bg-white p-1" style={{ borderColor: C.cardBorder }} title="选择图标" onClick={() => setAvatarOpen(true)}>
                  <WfIcon icon={metaIcon} className="size-20 rounded-md" iconCls="size-8" />
                </button>
              </div>
              <Dialog open={avatarOpen} onOpenChange={setAvatarOpen}>
                <DialogContent className="max-w-2xl">
                  <DialogHeader><DialogTitle>选择图标</DialogTitle></DialogHeader>
                  <div className="grid grid-cols-6 gap-3">
                    {WORKFLOW_ICONS.map((w) => (
                      <button key={w.key} className={`flex aspect-square w-full items-center justify-center rounded-lg ${metaIcon === w.key ? "ring-2 ring-primary" : ""}`}
                        style={{ background: w.color }} title={w.label}
                        onClick={() => { setMetaIcon(w.key); setAvatarOpen(false) }}>
                        <w.Icon className="size-6 text-white" />
                      </button>
                    ))}
                  </div>
                  <div className="pb-1 pt-2 text-xs text-muted-foreground">或使用头像库</div>
                  <div className="grid grid-cols-6 gap-3">
                    {AVATARS.map((src) => (
                      <button key={src} className={`aspect-square w-full overflow-hidden rounded-lg ${(metaIcon ?? avatarFor(def.workflow.id)) === src ? "ring-2 ring-primary" : ""}`}
                        onClick={() => { setMetaIcon(src); setAvatarOpen(false) }}>
                        <img src={src} alt="" className="size-full object-cover" />
                      </button>
                    ))}
                  </div>
                </DialogContent>
              </Dialog>
              <DialogFooter>
                <Button variant="outline" onClick={() => setMetaOpen(false)}>取消</Button>
                <Button onClick={async () => {
                  try {
                    await wfApi.updateMeta(workflowId, { name: metaName, description: metaDesc, icon: metaIcon })
                    setDef({ ...def, workflow: { ...def.workflow, name: metaName, description: metaDesc, icon: metaIcon } as typeof def.workflow })
                    toast.success("已保存")
                    setMetaOpen(false)
                  } catch (e) { toast.error((e as Error).message) }
                }}>保存</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
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
          {!agentMeta && (
            <button className="rounded p-1.5 hover:bg-neutral-100" title="效果评测"
              onClick={() => setDrawer("eval")}>
              <ListChecks className="size-4" style={{ color: C.ink2 }} />
            </button>
          )}
          {!readOnly && (
            <button className="rounded p-1.5 hover:bg-neutral-100" title="定时任务"
              onClick={() => setDrawer("schedule")}>
              <CalendarDays className="size-4" style={{ color: C.ink2 }} />
            </button>
          )}
          {!readOnly && lockUser && (
            <span className="flex items-center gap-1 text-xs" style={{ color: lockByOther ? "#D97706" : C.ink2 }}>
              {lockByOther ? `${lockUser} 编辑中` : lockUser} <LockKeyhole className="size-3.5" style={{ color: lockByOther ? "#D97706" : "#34C759" }} />
              {lockByOther && rbac.can("admin.force-unlock") && (
                <button className="underline" onClick={async () => {
                  await lockApi.forceRelease(lockResourceId).catch(() => undefined)
                  const r = await lockApi.acquire(lockResourceId, wsIdRef.current, "质量管理员").catch(() => null)
                  if (r) { setLockUser(r.user ?? ""); setLockByOther(!!r.lockedByOther) }
                }}>强制解锁</button>
              )}
            </span>
          )}
          {!readOnly && <Button variant="outline" size="sm" className="rounded-md" onClick={() => doSave(defRef.current!)}>保存</Button>}
          {!readOnly && (
            <Button size="sm" className="rounded-md bg-black text-white hover:bg-neutral-800"
              disabled={!rbacCanPublish} title={rbacCanPublish ? "" : "当前角色无发布权限（需 Publisher 及以上）"}
              onClick={() => (issues.length ? setPublishOpen(true) : onPublish())}>发布</Button>
          )}
        </div>
      </div>

      {/* 画布（relative：抽屉层以此为定位基准，避免钻到顶栏下被遮挡） */}
      <div className="relative flex min-h-0 flex-1">
      {drawer === "eval" && (agentMeta && agentId ? (
        <div className="absolute inset-y-0 right-0 z-20 flex w-[420px] max-w-[92vw] flex-col border-l bg-white" style={{ borderColor: C.cardBorder }}>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-[15px] font-semibold" style={{ color: C.ink }}>效果评测</span>
            <button onClick={() => setDrawer(null)}><X className="size-4 text-neutral-500" /></button>
          </div>
          <div className="min-h-0 flex-1"><AgentEvalPanel agentId={agentId} /></div>
        </div>
      ) : (
        <EvalPanel workflowId={workflowId} onClose={() => setDrawer(null)} />
      ))}
      {drawer === "evo" && <EvoPanel workflowId={workflowId} onClose={() => setDrawer(null)} />}
      {agentMeta && agentId && (
        <AgentConfigDrawer agentId={agentId} onClose={() => undefined} inline readOnly
          avatar={agentAvatar} />
      )}
      {!readOnly && <NodePalette families={families} onAdd={addNode} open={paletteOpen}
        onToggle={() => setPaletteOpen((v) => { localStorage.setItem("wf-palette-open", v ? "0" : "1"); return !v })} />}
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
          onReconnect={onReconnect}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move" }}
          onDrop={(e) => {
            if (readOnly) return  // R-Archive：封存画布禁止拖放加节点
            const t = e.dataTransfer.getData("application/wf-node")
            if (!t) return
            e.preventDefault()
            quickAddAt(t, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }))
          }}
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
          {!readOnly && (
            <button className="rounded p-1.5 hover:bg-neutral-100" title="节点面板开关"
              onClick={() => setPaletteOpen((v) => { localStorage.setItem("wf-palette-open", v ? "0" : "1"); return !v })}>
              {paletteOpen ? <PanelLeftClose className="size-4" style={{ color: C.ink2 }} /> : <PanelLeftOpen className="size-4" style={{ color: C.primary }} />}
            </button>
          )}
          {!readOnly && <span className="mx-1 h-4 w-px bg-neutral-200" />}
          {!readOnly && (
            <button className="rounded p-1.5 hover:bg-neutral-100" title="撤销 (⌘Z)" onClick={undo}><Undo2 className="size-4" style={{ color: C.ink2 }} /></button>
          )}
          {!readOnly && (
            <button className="rounded p-1.5 hover:bg-neutral-100" title="重做 (⌘⇧Z)" onClick={redo}><Redo2 className="size-4" style={{ color: C.ink2 }} /></button>
          )}
          <button className="rounded p-1.5 hover:bg-neutral-100" title="缩略图" onClick={() => setShowMiniMap((v) => !v)}>
            <MapIcon className="size-4" style={{ color: showMiniMap ? C.primary : C.ink2 }} />
          </button>
          {!readOnly && (
            <button className="rounded p-1.5 hover:bg-neutral-100" title="优化布局" onClick={autoLayout}>
              <LayoutTemplate className="size-4" style={{ color: C.ink2 }} />
            </button>
          )}
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
          {!readOnly && (
            <Button size="sm" className="rounded-md" style={{ background: C.primary }} disabled={running} onClick={tryRun}>
              {running ? <span className="size-3 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <Play className="size-3.5" />} {running ? "运行中" : "试运行"}
            </Button>
          )}
        </div>

        {/* 抽屉层 */}
        {drawer === "config" && selected && (
          <ConfigDrawer node={selected} defs={defs} nodes={def.graph.nodes} edges={def.graph.edges} agentId={agentId || undefined}
            issues={issues.filter((i) => i.nodeId === selected.id)} onClose={() => setDrawer(null)}
            onChange={(n) => mutate({ ...def, graph: { ...def.graph, nodes: def.graph.nodes.map((x) => (x.id === n.id ? n : x)) } })}
            onRemoveBranchEdges={(nodeId, handles, nextNode) => mutate({
              ...def,
              graph: {
                nodes: def.graph.nodes.map((x) => (x.id === nodeId ? nextNode : x)),
                edges: def.graph.edges.filter((e) => !(e.source === nodeId && handles.includes(e.sourceHandle ?? ""))),
              },
            })} />
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
                              {r.environment === "prod" ? "线上" : "沙箱"}{r.canaryPercent > 0 ? ` · 灰度 ${r.canaryPercent}%` : ""}
                            </span>
                          ))}
                          <button className="rounded px-1 py-0.5 text-[10px] underline" style={{ color: C.ink3 }}
                            onClick={() => setDiffVersion(v.versionId)}>对比</button>
                        </span>
                      </div>
                      {rels.filter((r) => r.canaryPercent > 0).map((r) => (
                        <div key={r.releaseId} className="flex items-center justify-between pt-1">
                          <span className="rounded bg-purple-50 px-1 py-0.5 text-[10px] text-purple-600">灰度 {r.canaryPercent}%（{r.environment === "prod" ? "线上" : "沙箱"}）</span>
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

      {/* SDD B：Agent 级发布对话框已随 R-Archive 封存移除（画布只读不挂发布） */}
      {/* E-2.2：历史抽屉「对比」入口（该版本 vs 当前草稿） */}
      {agentMeta && agentId && (
        <AgentVersionDiffDialog agentId={agentId} open={!!diffVersion} onClose={() => setDiffVersion(null)}
          versions={agentVersions.map((v) => ({ versionId: v.versionId, versionNo: v.versionNo }))}
          defaultLeft={diffVersion ?? undefined} defaultRight="draft" />
      )}

      {/* E-4.3：节点单测对话框 */}
      <Dialog open={!!testNodeId} onOpenChange={(o) => { if (!o) { setTestNodeId(null); setTestResult(null); setTestInput("{}") } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>单测节点：{def?.graph.nodes.find((n) => n.id === testNodeId)?.name ?? testNodeId}</DialogTitle>
            <DialogDescription>填入该节点的输入（JSON，键=输入名），单独执行不落 Run、不记事件。</DialogDescription>
          </DialogHeader>
          <Textarea className="min-h-24 font-mono text-xs" value={testInput} onChange={(e) => setTestInput(e.target.value)}
            placeholder='{ "text": "你好" }' />
          {testResult && (
            <div className={`max-h-48 overflow-auto rounded-md border p-2 font-mono text-[11px] ${testResult.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-600"}`}>
              {testResult.ok
                ? <>✓ 输出：{JSON.stringify(testResult.output ?? null)}（{testResult.durationMs ?? 0}ms）</>
                : <>✗ {testResult.error}</>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setTestNodeId(null); setTestResult(null); setTestInput("{}") }}>关闭</Button>
            <Button className="bg-black text-white hover:bg-neutral-800" disabled={testBusy} onClick={runNodeTest}>
              {testBusy ? "执行中…" : "执行单测"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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


/* ============ 效果评测面板（对齐 Agent 级：期望答案 + rule/model Judge + 人评覆盖） ============ */
interface EvalRunRow {
  sampleId: string; name: string; runId?: string; status: string
  durationMs?: number | null; output?: string; error?: string | null
  judge?: { kind: string; score: number } | null
}
function EvalPanel({ workflowId, onClose }: { workflowId: string; onClose: () => void }) {
  const [samples, setSamples] = useState<{ id: string; name: string; input: Record<string, unknown>; expected?: { text?: string } | null }[]>([])
  const [summary, setSummary] = useState<{ total?: number; succeeded?: number; failed?: number; successRate?: number } | null>(null)
  const [results, setResults] = useState<EvalRunRow[] | null>(null)
  const [name, setName] = useState("")
  const [inputJson, setInputJson] = useState('{ "userQuery": "你好" }')
  const [expectedText, setExpectedText] = useState("")
  const [judge, setJudge] = useState<"none" | "rule" | "model">("rule")
  const [running, setRunning] = useState(false)
  const load = useCallback(() => {
    evalApi.samples(workflowId).then((r) => setSamples(r.items)).catch(() => undefined)
    evalApi.summary(workflowId).then(setSummary).catch(() => undefined)
  }, [workflowId])
  useEffect(() => { load() }, [load])
  const humanScore = async (sampleId: string, score: number) => {
    try {
      const r = await evalApi.humanScore(sampleId, score)
      setResults((rs) => rs?.map((x) => (x.sampleId === sampleId ? { ...x, judge: r.judge } : x)) ?? rs)
      toast.success(`已人评 ${score} 分`)
    } catch (e) { toast.error((e as Error).message) }
  }
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
          <div className="text-[13px] font-medium" style={{ color: C.ink }}>| 评测集（样本 = 固定输入 + 可选期望答案）</div>
          {samples.map((sp) => (
            <div key={sp.id} className="flex items-center gap-2 rounded border px-2 py-1 text-xs" style={{ borderColor: C.cardBorder }}>
              <span className="flex-1 truncate" style={{ color: C.ink }}>{sp.name}</span>
              {sp.expected?.text && <span className="truncate rounded bg-emerald-50 px-1 text-[10px] text-emerald-600">期望：{sp.expected.text.slice(0, 16)}</span>}
              <button className="text-neutral-400" onClick={async () => { await evalApi.delSample(sp.id); load() }}><X className="size-3" /></button>
            </div>
          ))}
          <Input className="h-7 text-xs" placeholder="样本名称" value={name} onChange={(e) => setName(e.target.value)} />
          <Textarea className="min-h-16 text-xs" value={inputJson} onChange={(e) => setInputJson(e.target.value)} />
          <Input className="h-7 text-xs" placeholder="期望答案（可选；供规则/模型 Judge 对照）" value={expectedText} onChange={(e) => setExpectedText(e.target.value)} />
          <div className="flex items-center gap-2">
            <Select value={judge} onValueChange={(v) => setJudge(v as typeof judge)}>
              <SelectTrigger className="h-7 flex-1 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="rule">规则 Judge（期望包含匹配）</SelectItem>
                <SelectItem value="model">模型 Judge（LLM 打 1-5 分）</SelectItem>
                <SelectItem value="none">不 Judge（只看运行成败）</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" onClick={async () => {
              try {
                await evalApi.addSample(workflowId, name || "样本", JSON.parse(inputJson || "{}"), expectedText)
                setName(""); setExpectedText(""); load()
              } catch { toast.error("输入 JSON 非法") }
            }}>添加样本</Button>
            <Button size="sm" className="bg-black text-white hover:bg-neutral-800" disabled={running || samples.length === 0}
              onClick={async () => {
                setRunning(true)
                try {
                  const r = await evalApi.run(workflowId, judge)
                  setResults(r.results); load()
                } catch (e) { toast.error((e as Error).message) }
                finally { setRunning(false) }
              }}>{running ? "评测中…" : "运行评测"}</Button>
          </div>
        </div>
        {results && (
          <div className="space-y-1">
            <div className="text-[13px] font-medium" style={{ color: C.ink }}>| 评测结果（可人评覆盖）</div>
            {results.map((r) => (
              <div key={r.sampleId} className="flex items-center gap-2 rounded border px-2 py-1 text-xs" style={{ borderColor: C.cardBorder }}>
                <span className={`size-2 shrink-0 rounded-full ${r.status === "succeeded" ? "bg-emerald-400" : "bg-red-400"}`} />
                <span className="w-20 truncate" style={{ color: C.ink }}>{r.name}</span>
                <span className="flex-1 truncate" style={{ color: C.ink2 }}>{r.error ?? r.output ?? "-"}</span>
                {r.judge && (
                  <span className={`shrink-0 rounded px-1 py-0.5 text-[10px] ${r.judge.score >= 3 ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-500"}`}>
                    {r.judge.kind === "human" ? "人评" : r.judge.kind === "model" ? "模型" : "规则"} {r.judge.score}
                  </span>
                )}
                <span className="flex shrink-0 items-center gap-1">
                  <button className="rounded border px-1 text-[10px]" style={{ borderColor: C.cardBorder }} title="人评 5 分" onClick={() => humanScore(r.sampleId, 5)}>👍</button>
                  <button className="rounded border px-1 text-[10px]" style={{ borderColor: C.cardBorder }} title="人评 1 分" onClick={() => humanScore(r.sampleId, 1)}>👎</button>
                </span>
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
  const [data, setData] = useState<{
    versions: { versionNo: number; runs: number; successRate: number }[]
    failedCases: { runId: string; error: string }[]
  } | null>(null)
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
          {data?.versions.length ? data.versions.map((v) => (
            <div key={v.versionNo} className="flex items-center gap-2 rounded border px-2 py-1 text-xs" style={{ borderColor: C.cardBorder }}>
              <span className="w-12 font-medium" style={{ color: C.ink }}>V{v.versionNo}</span>
              <span style={{ color: C.ink3 }}>{v.runs} 次运行</span>
              <span className="flex-1 text-right" style={{ color: C.ink2 }}>成功率 {Math.round(v.successRate * 100)}%</span>
            </div>
          )) : <div className="text-xs" style={{ color: C.ink3 }}>暂无发布版本</div>}
        </div>
        <div className="space-y-1">
          <div className="text-[13px] font-medium" style={{ color: C.ink }}>| 进化建议（失败案例）</div>
          {data?.failedCases.length ? data.failedCases.map((f) => (
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

export default function WfDesignerPage({ workflowId, agentId, agentMeta, avatar, readOnly }: { workflowId?: string; agentId?: string; agentMeta?: { name: string; typeLabel: string; agentType?: string }; avatar?: string; readOnly?: boolean }) {
  return (
    <ReactFlowProvider>
      <div className="h-[calc(100dvh-3.5rem)] min-h-0">
        <DesignerInner workflowId={workflowId} agentId={agentId} agentMeta={agentMeta} avatar={avatar} readOnly={readOnly} />
      </div>
      <ToastHost />
    </ReactFlowProvider>
  )
}
