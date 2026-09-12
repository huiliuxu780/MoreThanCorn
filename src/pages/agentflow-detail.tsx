/**
 * AgentFlow 详情（09-11 治理轮：展示形式对齐原站 WakerFlow 详情实测台账
 * research/morethancorn/10-qoderwake-product-research §4.5 + flow-01..04 截图）。
 *
 * 原站事实：头部=返回+标题+铅笔重命名+视图 radio(WakerFlow|执行记录)+添加触发方式+运行；
 * 工具条=显示模式段控(画布|脚本)+右「输入参数」折叠+时钟(历史版本)；
 * 画布=阶段卡(阶段标签/标题/说明/步骤行 Waker chip)+节点级调整+左下浮动缩放组；
 * 脚本视图=DSL 只读代码+保存；执行记录=画布按 run 着色(卡右上状态 chip+「N 个执行节点」)
 * +右「运行记录」行(第 N 次·触发·状态·相对时间+行内重跑/报告图标)；历史版本=右面板行+当前版本 chip。
 *
 * 我方诚实映射：脚本视图=版本 definition JSON 只读（我方契约为 JSON 非 DSL，不伪造 DSL）；
 * 节点执行过程=拍板路线 a：node_run.session_id 复用 session stream 代理（NodeRunPanel）。
 */
import * as React from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import CodeMirror from "@uiw/react-codemirror"
import { json } from "@codemirror/lang-json"
import {
  ArrowLeft, Clock, FileText, History, Pencil, Play, Plus,
  RefreshCw, RotateCw, Trash2, ZoomIn, ZoomOut, Maximize2,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { avatarFor } from "@/lib/agent-avatar"
import { asApi } from "@/services/as-api"
import { useAsyncData } from "@/hooks/use-async-data"
import { NodeRunPanel, type NodeRunPanelTarget } from "@/components/agentflow/node-run-panel"
import { toast } from "sonner"

interface NodeSpec {
  id: string
  kind: string
  agent_id: string
  prompt_template: string
  structured_schema?: Record<string, unknown> | null
}
interface NodeRunRow {
  id: string
  node_id: string
  attempt: number
  agent_id: string | null
  session_id: string | null
  status: string
  input_version: number
  output: Record<string, unknown> | null
  error: string
}
interface RunRow {
  id: string
  status: string
  trigger_kind: string
  input: Record<string, unknown>
  output: Record<string, unknown> | null
  error: string
  started_at: string
  ended_at: string | null
  nodes: NodeRunRow[]
}
interface VersionRow {
  id: string
  version_no: number
  digest: string
  created_at: string
  definition?: { nodes?: NodeSpec[] }
}

const TRIGGER_LABEL: Record<string, string> = {
  manual: "手动运行", schedule: "定时运行", api: "API 触发", event: "事件触发",
  webhook: "Webhook", agentflow: "AgentFlow",
}
const STATUS_LABEL: Record<string, string> = {
  succeeded: "已完成", success: "已完成", failed: "失败",
  running: "执行中", pending: "未执行", cancelled: "已终止", stopped: "已终止",
}

function relTime(v: string | null | undefined): string {
  if (!v) return "—"
  const diff = Date.now() - new Date(v).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return "刚刚"
  if (min < 60) return `${min} 分钟前`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  if (d <= 30) return "昨天"
  return new Date(v).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })
}

const statusTone = (s: string) =>
  s === "succeeded" || s === "success"
    ? { bg: "var(--status-success-soft)", fg: "var(--status-success)" }
    : s === "failed"
      ? { bg: "var(--status-danger-soft)", fg: "var(--status-danger)" }
      : s === "running"
        ? { bg: "var(--status-running-soft)", fg: "var(--status-running)" }
        : { bg: "var(--fill-tertiary)", fg: "var(--text-tertiary)" }

export default function AgentFlowDetailPage() {
  const { fid = "" } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const view = params.get("view") === "runs" ? "runs" : "flow"
  const mode = params.get("mode") === "script" ? "script" : "canvas"
  const versions = useAsyncData(() => asApi.flowVersions(fid), [fid])
  const runs = useAsyncData(() => asApi.flowRuns(fid), [fid])
  const flows = useAsyncData(() => asApi.flows(), [])
  const flow = (flows.data?.items ?? []).find((f) => f.id === fid) as
    | { id: string; name: string; description: string; active_release_id: string | null; active_version_no: number | null }
    | undefined

  const [agents, setAgents] = React.useState<{ id: string; name: string }[]>([])
  const [runInput, setRunInput] = React.useState("{}")
  const [paramsOpen, setParamsOpen] = React.useState(false)
  const [histOpen, setHistOpen] = React.useState(false)
  const [selectedRun, setSelectedRun] = React.useState<string | null>(null)
  const [editing, setEditing] = React.useState<NodeSpec | null>(null)
  const [editNote, setEditNote] = React.useState("")
  const [renameOpen, setRenameOpen] = React.useState(false)
  const [renameVal, setRenameVal] = React.useState("")
  const [nodePanel, setNodePanel] = React.useState<NodeRunPanelTarget | null>(null)
  const [reportRun, setReportRun] = React.useState<RunRow | null>(null)
  const [zoom, setZoom] = React.useState(1)
  // 09-11 审计 P0：最小节点编辑器——UI 可造首版本（添加/删除阶段+Agent 选择）
  const [addOpen, setAddOpen] = React.useState(false)
  const [newNode, setNewNode] = React.useState({ id: "", agent_id: "", prompt_template: "" })
  const [delNode, setDelNode] = React.useState<NodeSpec | null>(null)
  const [inputDraft, setInputDraft] = React.useState<Record<string, string>>({})

  React.useEffect(() => {
    fetch(`${import.meta.env.VITE_WF_API_BASE ?? "http://127.0.0.1:8120"}/api/agents?page=1&pageSize=100`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("wf_api_token") ?? ""}` },
    })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setAgents((d.items ?? []).map((a: { id: string; name: string }) => ({ id: a.id, name: a.name }))))
      .catch(() => undefined)
  }, [])

  const versionRows = React.useMemo(() => (versions.data?.items ?? []) as unknown as VersionRow[], [versions.data])
  const latest = versionRows[0]
  const nodes: NodeSpec[] = latest?.definition?.nodes ?? []
  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? (id ? id.slice(0, 8) : "未指定")

  const runRows = React.useMemo(() => (runs.data?.items ?? []) as unknown as RunRow[], [runs.data])
  React.useEffect(() => {
    if (view === "runs" && !selectedRun && runRows.length) setSelectedRun(runRows[0].id)
  }, [view, selectedRun, runRows])
  // F0：flow 已异步化（queued→running→终态，节点增量落库）——存在活跃 run 时
  // 轮询刷新，让节点状态逐步出现而非结束后一次性出现
  const hasActiveRun = runRows.some((r) => r.status === "queued" || r.status === "running")
  React.useEffect(() => {
    if (view !== "runs" || !hasActiveRun) return
    const timer = window.setInterval(() => runs.retry(), 2500)
    return () => window.clearInterval(timer)
  }, [view, hasActiveRun, runs.retry])
  const current = runRows.find((r) => r.id === selectedRun) ?? runRows[0]
  const runIndex = (r: RunRow) => runRows.length - runRows.indexOf(r)
  const nodeRunOf = (nodeId: string) => current?.nodes.find((n) => n.node_id === nodeId)

  const saveVersion = async () => {
    if (!nodes.length) {
      toast.error("暂无可保存的节点")
      return
    }
    try {
      await asApi.createFlowVersion(fid, {
        nodes,
        edges: nodes.slice(0, -1).map((n, i) => ({ from: n.id, to: nodes[i + 1].id })),
      })
      toast.success("已保存为新版本")
      versions.retry()
    } catch (e) {
      toast.error(`保存失败：${(e as Error).message}`)
    }
  }

  const startRun = async (input?: Record<string, unknown>) => {
    if (!flow?.active_release_id) {
      toast.error("请先发布版本")
      return
    }
    let body: Record<string, unknown>
    if (input !== undefined) {
      body = input
    } else {
      try {
        body = JSON.parse(runInput || "{}")
      } catch {
        toast.error("输入 JSON 不合法")
        return
      }
    }
    try {
      const r = await asApi.runFlow(flow.active_release_id, body)
      toast.success(`运行已启动：${String(r.status)}`)
      runs.retry()
      setParams({ view: "runs" })
    } catch (e) {
      toast.error(`运行失败：${(e as Error).message}`)
    }
  }

  // P2/AC-S3：答复脚本 askUser 挂起节点；节点终态由轮询到的 stage:end 结算
  const answerInput = async (nodeRunId: string, payload: { value?: unknown; skipped?: boolean }) => {
    if (!current) return
    try {
      await asApi.answerFlowInput(current.id, nodeRunId, payload)
      toast.success("已答复，流程继续")
      runs.retry()
    } catch (e) {
      toast.error(`答复失败：${(e as Error).message}`)
    }
  }

  const applyNodeEdit = async () => {
    if (!editing) return
    const next = nodes.map((n) => (n.id === editing.id ? { ...n, prompt_template: editNote } : n))
    try {
      await asApi.createFlowVersion(fid, {
        nodes: next,
        edges: next.slice(0, -1).map((n, i) => ({ from: n.id, to: next[i + 1].id })),
      })
      toast.success("已生成新版本（阶段步骤已更新）")
      setEditing(null)
      versions.retry()
    } catch (e) {
      toast.error(`保存失败：${(e as Error).message}`)
    }
  }

  const applyRename = async () => {
    const name = renameVal.trim()
    if (!name) {
      toast.error("名称不能为空")
      return
    }
    try {
      await asApi.patchFlow(fid, { name })
      toast.success("已重命名")
      setRenameOpen(false)
      flows.retry()
    } catch (e) {
      toast.error(`重命名失败：${(e as Error).message}`)
    }
  }

  const persistNodes = async (next: NodeSpec[], msg: string) => {
    if (next.length === 0) {
      toast.error("至少保留一个节点")
      return
    }
    try {
      await asApi.createFlowVersion(fid, {
        nodes: next,
        edges: next.slice(0, -1).map((n, i) => ({ from: n.id, to: next[i + 1].id })),
      })
      toast.success(msg)
      versions.retry()
    } catch (e) {
      toast.error(`保存失败：${(e as Error).message}`)
    }
  }

  const addNode = async () => {
    const id = newNode.id.trim() || `stage-${nodes.length + 1}`
    if (!newNode.agent_id) {
      toast.error("请选择执行 Agent")
      return
    }
    await persistNodes(
      [...nodes, { id, kind: "agent", agent_id: newNode.agent_id, prompt_template: newNode.prompt_template }],
      "已生成新版本（新增阶段）",
    )
    setAddOpen(false)
    setNewNode({ id: "", agent_id: "", prompt_template: "" })
  }

  const openNodePanel = (nodeId: string) => {
    const nr = nodeRunOf(nodeId)
    if (!nr?.session_id || !nr.agent_id) {
      toast.info("该节点尚无执行会话（未执行或会话未登记）")
      return
    }
    setNodePanel({ nodeId, agentId: nr.agent_id, sessionId: nr.session_id, status: nr.status, attempt: nr.attempt })
  }

  const zoomGroup = (
    <div className="absolute bottom-4 left-4 z-10 flex flex-col items-center gap-1 rounded-md border bg-surface p-1 shadow-sm">
      <Button variant="ghost" size="icon" className="size-7" aria-label="适应" onClick={() => setZoom(1)}>
        <Maximize2 className="size-3.5" />
      </Button>
      <Button variant="ghost" size="icon" className="size-7" aria-label="缩小" onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.1).toFixed(1)))}>
        <ZoomOut className="size-3.5" />
      </Button>
      <Button variant="ghost" size="icon" className="size-7" aria-label="放大" onClick={() => setZoom((z) => Math.min(1.6, +(z + 0.1).toFixed(1)))}>
        <ZoomIn className="size-3.5" />
      </Button>
    </div>
  )

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <Button variant="ghost" size="icon" className="size-7" aria-label="返回 AgentFlow 列表" onClick={() => navigate("/agentflows")}>
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="truncate text-sm font-semibold">{flow?.name ?? fid}</h1>
        <Button
          variant="ghost" size="icon" className="size-6" aria-label="重命名"
          onClick={() => { setRenameVal(flow?.name ?? ""); setRenameOpen(true) }}
        >
          <Pencil className="size-3.5" />
        </Button>
        {flow?.active_release_id ? <Badge variant="secondary">已发布</Badge> : <Badge variant="outline">未发布</Badge>}
        <div className="ml-2 flex h-7 w-fit items-center gap-1 rounded-md bg-(--segment-bg) p-0.5" role="radiogroup" aria-label="视图">
          {([["flow", "AgentFlow"], ["runs", "执行记录"]] as const).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={view === k}
              onClick={() => setParams(k === "flow" ? (mode === "script" ? { mode: "script" } : {}) : { view: "runs" })}
              className={`h-6 rounded px-2.5 text-xs transition-colors ${view === k
                ? "bg-(--segment-active) font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="ml-auto" />
        <Button size="sm" variant="outline" onClick={() => toast.info("触发方式在「自动任务」中配置（执行者选本 AgentFlow）")}>
          管理触发方式
        </Button>
        <Button size="sm" onClick={() => void startRun()}>
          <Play className="size-4" /> 运行
        </Button>
      </header>

      {view === "flow" && (
        <div className="flex h-10 shrink-0 items-center gap-2 border-b px-4">
          <div className="flex h-7 w-fit items-center gap-1 rounded-md bg-(--segment-bg) p-0.5" role="radiogroup" aria-label="显示模式">
            {([["canvas", "画布"], ["script", "脚本"]] as const).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={mode === k}
                onClick={() => setParams(k === "canvas" ? {} : { mode: "script" })}
                className={`h-6 rounded px-2.5 text-xs transition-colors ${mode === k
                  ? "bg-(--segment-active) font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="ml-auto" />
          <Button variant={paramsOpen ? "secondary" : "ghost"} size="sm" onClick={() => setParamsOpen((v) => !v)}>
            输入参数
          </Button>
          <Button variant="ghost" size="icon" className="size-7" aria-label="历史版本" onClick={() => setHistOpen(true)}>
            <Clock className="size-4" />
          </Button>
        </div>
      )}
      {view === "flow" && paramsOpen && (
        <div className="shrink-0 space-y-1 border-b bg-surface px-4 py-2">
          <p className="text-[11px] text-muted-foreground">手动运行需要填写以下信息（作为首节点模板变量）：</p>
          <Textarea rows={3} value={runInput} onChange={(e) => setRunInput(e.target.value)} className="font-mono text-xs" />
        </div>
      )}

      {view === "flow" ? (
        mode === "canvas" ? (
          <div className="relative flex min-h-0 flex-1 flex-col" style={{ background: "var(--surface-muted)" }}>
            <div className="min-h-0 flex-1 overflow-auto p-4">
              {nodes.length === 0 ? (
                <div className="mx-auto max-w-md space-y-3 rounded-lg border border-dashed bg-surface p-8 text-center text-sm text-muted-foreground">
                  <p>暂无阶段：添加首个阶段后即可发布运行。</p>
                  <Button size="sm" onClick={() => setAddOpen(true)}>
                    <Plus className="size-4" /> 添加首个阶段
                  </Button>
                </div>
              ) : (
                <div className="flex items-start gap-3" style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}>
                  {nodes.map((n, i) => (
                    <div key={n.id} className="flex items-start gap-3">
                      <div
                        className="relative flex w-[220px] shrink-0 flex-col gap-3 border bg-surface px-3 py-4 shadow-sm"
                        style={{ borderColor: "var(--border)", borderRadius: "8px" }}
                      >
                        <span className="absolute right-2 top-2 flex items-center gap-0.5">
                          <button
                            type="button"
                            className="rounded p-0.5 text-muted-foreground hover:bg-muted"
                            aria-label="调整步骤说明"
                            title="调整步骤说明"
                            onClick={() => { setEditing(n); setEditNote(n.prompt_template) }}
                          >
                            <Pencil className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                            aria-label="删除该阶段"
                            title="删除该阶段（生成新版本）"
                            onClick={() => setDelNode(n)}
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </span>
                        <div className="text-[11px] font-medium" style={{ color: "var(--text-tertiary)" }}>
                          阶段 {String(i + 1).padStart(2, "0")}
                        </div>
                        <div className="text-sm font-medium">{n.id}</div>
                        <p className="line-clamp-3 text-xs leading-5 text-muted-foreground">
                          {n.prompt_template || "（未填写步骤说明）"}
                        </p>
                        <div className="flex items-center gap-2 border-t pt-2 text-xs">
                          <img src={avatarFor(n.agent_id || "?")} alt="" className="size-6 rounded-full object-cover" />
                          <span className="truncate">{agentName(n.agent_id)}</span>
                        </div>
                      </div>
                      {i < nodes.length - 1 && <span className="mt-16 shrink-0 text-muted-foreground">→</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {zoomGroup}
            <div className="flex shrink-0 items-center gap-2 border-t bg-background px-4 py-2">
              <span className="text-xs text-muted-foreground">
                版本 {latest ? `v${latest.version_no}` : "—"} · digest {String(latest?.digest ?? "").slice(0, 12) || "—"}
              </span>
              <div className="ml-auto flex items-center gap-1">
                <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
                  <Plus className="size-3.5" /> 添加阶段
                </Button>
                <Button variant="outline" size="sm" onClick={() => void saveVersion()}>
                  <Plus className="size-3.5" /> 保存为版本
                </Button>
                {latest && !flow?.active_release_id && (
                  <Button
                    size="sm"
                    onClick={async () => {
                      try {
                        await asApi.releaseFlow(fid, latest.id)
                        toast.success("已发布")
                        flows.retry()
                      } catch (e) {
                        toast.error(`发布失败：${(e as Error).message}`)
                      }
                    }}
                  >
                    发布
                  </Button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <CodeMirror
              value={JSON.stringify(latest?.definition ?? {}, null, 2)}
              readOnly
              height="100%"
              extensions={[json()]}
            />
          </div>
        )
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="relative min-h-0 flex-1 overflow-auto" style={{ background: "var(--surface-muted)" }}>
            {!current ? (
              <p className="py-16 text-center text-sm text-muted-foreground">暂无运行记录</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2 border-b bg-background px-4 py-2 text-xs">
                  <Badge variant={current.status === "succeeded" ? "secondary" : current.status === "failed" ? "destructive" : "outline"}>
                    {STATUS_LABEL[current.status] ?? current.status}
                  </Badge>
                  <span className="font-medium">第 {runIndex(current)} 次运行</span>
                  <span className="text-muted-foreground">
                    {TRIGGER_LABEL[current.trigger_kind] ?? current.trigger_kind} · {new Date(current.started_at).toLocaleString()}
                  </span>
                </div>
                {/* P2/AC-S3：askUser 挂起节点的人工确认卡（waiting） */}
                {(current.nodes ?? [])
                  .filter((n) => n.status === "waiting")
                  .map((n) => {
                    const req = (n as { input?: { prompt?: string; options?: string[] } }).input
                    const options = req?.options ?? []
                    return (
                      <div key={n.id} className="border-b bg-background px-4 py-3">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <span
                            className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium"
                            style={{ background: "var(--status-running-soft)", color: "var(--status-running)" }}
                          >
                            待确认
                          </span>
                          {n.node_id}
                        </div>
                        {req?.prompt && (
                          <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{req.prompt}</p>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {options.map((opt) => (
                            <Button key={opt} size="sm" variant="outline"
                              onClick={() => void answerInput(n.id, { value: opt })}>
                              {opt}
                            </Button>
                          ))}
                          <input
                            value={inputDraft[n.id] ?? ""}
                            onChange={(e) => setInputDraft((m) => ({ ...m, [n.id]: e.target.value }))}
                            placeholder="或输入意见…"
                            className="h-8 w-56 rounded border bg-surface px-2 text-xs"
                            aria-label={`输入 ${n.node_id} 的意见`}
                          />
                          <Button size="sm" disabled={!(inputDraft[n.id] ?? "").trim()}
                            onClick={() => void answerInput(n.id, { value: inputDraft[n.id] })}>
                            提交
                          </Button>
                          <Button size="sm" variant="ghost"
                            onClick={() => void answerInput(n.id, { skipped: true })}>
                            跳过
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                <div className="flex items-start gap-3 p-4">
                  {nodes.map((n, i) => {
                    const nr = nodeRunOf(n.id)
                    const tone = nr ? statusTone(nr.status) : null
                    return (
                      <div key={n.id} className="flex items-start gap-3">
                        <div
                          className="flex w-[220px] shrink-0 cursor-pointer flex-col gap-3 border bg-surface px-3 py-4 shadow-sm transition-colors hover:border-brand/60"
                          style={{
                            borderColor: nr?.status === "failed" ? "var(--status-danger)" : "var(--border)",
                            borderRadius: "8px",
                          }}
                          onClick={() => openNodePanel(n.id)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault()
                              openNodePanel(n.id)
                            }
                          }}
                          aria-label={`查看节点 ${n.id} 执行过程`}
                        >
                          <div className="flex items-center gap-2">
                            <div className="text-[11px] font-medium" style={{ color: "var(--text-tertiary)" }}>
                              阶段 {String(i + 1).padStart(2, "0")}
                            </div>
                            {nr && (
                              <span
                                className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium"
                                style={{ background: tone?.bg, color: tone?.fg }}
                              >
                                {STATUS_LABEL[nr.status] ?? nr.status}
                              </span>
                            )}
                          </div>
                          <div className="text-sm font-medium">{n.id}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {current.nodes.filter((x) => x.node_id === n.id).length} 个执行节点
                          </div>
                          <div className="flex items-center gap-2 border-t pt-2 text-xs">
                            <img src={avatarFor(n.agent_id || "?")} alt="" className="size-6 rounded-full object-cover" />
                            <span className="truncate">{agentName(n.agent_id)}</span>
                          </div>
                          {nr && (
                            <div className="flex items-center gap-2 border-t pt-2 text-[11px] text-muted-foreground">
                              <span>第 {nr.attempt} 次尝试</span>
                              <button
                                type="button"
                                className="ml-auto inline-flex items-center gap-1 underline"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  void (async () => {
                                    try {
                                      await asApi.rerunNode(current.id, n.id)
                                      toast.success("已发起节点重跑（新 attempt）")
                                      runs.retry()
                                    } catch (err) {
                                      toast.error(`重跑失败：${(err as Error).message}`)
                                    }
                                  })()
                                }}
                              >
                                <RefreshCw className="size-3" /> 重跑
                              </button>
                            </div>
                          )}
                        </div>
                        {i < nodes.length - 1 && <span className="mt-16 shrink-0 text-muted-foreground">→</span>}
                      </div>
                    )
                  })}
                </div>
              </>
            )}
            {zoomGroup}
          </div>
          <aside className="w-64 shrink-0 overflow-y-auto border-l" aria-label="运行记录">
            <div className="border-b px-3 py-2 text-sm font-semibold">运行记录（{runRows.length}）</div>
            <ul className="p-2">
              {runRows.map((r) => (
                <li key={r.id}>
                  <div
                    className={`w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                      current?.id === r.id ? "border bg-muted" : "hover:bg-muted/50"
                    }`}
                  >
                    <button type="button" className="w-full text-left" onClick={() => setSelectedRun(r.id)}>
                      <div className="flex items-center gap-1.5">
                        <span className={`size-1.5 rounded-full ${
                          r.status === "succeeded" ? "bg-status-success"
                            : r.status === "failed" ? "bg-status-danger" : "bg-status-warning"
                        }`} />
                        <span className="font-medium">第 {runIndex(r)} 次运行</span>
                        <span className="ml-auto text-muted-foreground">{STATUS_LABEL[r.status] ?? r.status}</span>
                      </div>
                      <div className="mt-0.5 text-muted-foreground">
                        {TRIGGER_LABEL[r.trigger_kind] ?? r.trigger_kind} · {relTime(r.started_at)}
                      </div>
                    </button>
                    <div className="mt-1 flex items-center gap-1">
                      <Button
                        variant="ghost" size="icon" className="size-6" aria-label="以相同输入重跑"
                        title="以相同输入重跑"
                        onClick={() => void startRun(r.input)}
                      >
                        <RotateCw className="size-3" />
                      </Button>
                      <Button
                        variant="ghost" size="icon" className="size-6" aria-label="运行报告"
                        title="运行报告"
                        onClick={() => setReportRun(r)}
                      >
                        <FileText className="size-3" />
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
              {!runRows.length && <li className="py-6 text-center text-xs text-muted-foreground">暂无运行记录</li>}
            </ul>
          </aside>
        </div>
      )}

      {/* 历史版本面板（原站时钟入口） */}
      <Sheet open={histOpen} onOpenChange={setHistOpen}>
        <SheetContent side="right" className="w-80 overflow-y-auto sm:max-w-80">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2 text-sm">
              <History className="size-4" /> 历史版本（{versionRows.length}）
            </SheetTitle>
          </SheetHeader>
          <ul className="space-y-2 pt-3">
            {versionRows.map((v) => (
              <li key={v.id} className="rounded-md border bg-surface px-3 py-2">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-semibold">版本 {v.version_no}</span>
                  {v.version_no === flow?.active_version_no && (
                    <Badge variant="secondary" className="text-[10px]">当前版本</Badge>
                  )}
                  {v.id === latest?.id && v.version_no !== flow?.active_version_no && (
                    <Badge variant="outline" className="text-[10px]">最新</Badge>
                  )}
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {new Date(v.created_at).toLocaleString()} · {String(v.digest ?? "").slice(0, 12)}…
                </div>
              </li>
            ))}
            {!versionRows.length && <li className="py-10 text-center text-xs text-muted-foreground">暂无版本</li>}
          </ul>
        </SheetContent>
      </Sheet>

      {/* 运行报告 */}
      <Sheet open={!!reportRun} onOpenChange={(o) => !o && setReportRun(null)}>
        <SheetContent side="right" className="w-[480px] overflow-y-auto sm:max-w-[480px]">
          <SheetHeader>
            <SheetTitle className="text-sm">
              运行报告 · 第 {reportRun ? runIndex(reportRun) : 0} 次运行
            </SheetTitle>
          </SheetHeader>
          {reportRun && (
            <div className="space-y-3 pt-3 text-xs">
              <div className="flex items-center gap-2">
                <Badge variant={reportRun.status === "succeeded" ? "secondary" : reportRun.status === "failed" ? "destructive" : "outline"}>
                  {STATUS_LABEL[reportRun.status] ?? reportRun.status}
                </Badge>
                <span className="text-muted-foreground">
                  {TRIGGER_LABEL[reportRun.trigger_kind] ?? reportRun.trigger_kind} · {new Date(reportRun.started_at).toLocaleString()}
                </span>
              </div>
              {reportRun.error && <p className="text-destructive">错误：{reportRun.error}</p>}
              <section>
                <h4 className="mb-1 font-medium text-muted-foreground">输入</h4>
                <pre className="max-h-40 overflow-auto rounded-md border bg-(--segment-bg) p-2 whitespace-pre-wrap break-words">
                  {JSON.stringify(reportRun.input ?? {}, null, 2)}
                </pre>
              </section>
              <section>
                <h4 className="mb-1 font-medium text-muted-foreground">输出</h4>
                <pre className="max-h-72 overflow-auto rounded-md border bg-(--segment-bg) p-2 whitespace-pre-wrap break-words">
                  {JSON.stringify(reportRun.output ?? {}, null, 2)}
                </pre>
              </section>
              <section>
                <h4 className="mb-1 font-medium text-muted-foreground">节点执行（{reportRun.nodes.length}）</h4>
                <ul className="space-y-1">
                  {reportRun.nodes.map((n) => (
                    <li key={n.id} className="flex items-center gap-2 rounded-md border px-2 py-1">
                      <span className="font-mono">{n.node_id}</span>
                      <span className="text-muted-foreground">attempt {n.attempt}</span>
                      <span className="ml-auto" style={{ color: statusTone(n.status).fg }}>
                        {STATUS_LABEL[n.status] ?? n.status}
                      </span>
                      {n.session_id && n.agent_id && (
                        <Button
                          variant="ghost" size="sm" className="h-6 px-1.5 text-[10px]"
                          onClick={() => {
                            setReportRun(null)
                            setNodePanel({ nodeId: n.node_id, agentId: n.agent_id!, sessionId: n.session_id!, status: n.status, attempt: n.attempt })
                          }}
                        >
                          执行过程
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <NodeRunPanel target={nodePanel} onClose={() => setNodePanel(null)} />

      {/* 添加阶段（审计 P0：UI 可造首版本） */}
      <Dialog open={addOpen} onOpenChange={(o) => !o && setAddOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加阶段</DialogTitle>
            <DialogDescription>新阶段追加到链尾；保存即生成新版本（不改动已发布版本）。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={newNode.id}
              onChange={(e) => setNewNode((v) => ({ ...v, id: e.target.value }))}
              placeholder={`阶段 id（留空自动 stage-${nodes.length + 1}）`}
            />
            <Select
              value={newNode.agent_id || "__none__"}
              onValueChange={(v) => setNewNode((x) => ({ ...x, agent_id: v === "__none__" ? "" : v }))}
            >
              <SelectTrigger><SelectValue placeholder="选择执行 Agent" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__" disabled>选择执行 Agent</SelectItem>
                {agents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Textarea
              rows={3}
              value={newNode.prompt_template}
              onChange={(e) => setNewNode((v) => ({ ...v, prompt_template: e.target.value }))}
              placeholder="步骤说明（Prompt 模板）"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>取消</Button>
            <Button onClick={() => void addNode()}>保存为新版本</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除阶段确认 */}
      <Dialog open={!!delNode} onOpenChange={(o) => !o && setDelNode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除阶段「{delNode?.id}」？</DialogTitle>
            <DialogDescription>删除后生成新版本；已发布版本不受影响。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDelNode(null)}>取消</Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (!delNode) return
                void persistNodes(nodes.filter((n) => n.id !== delNode.id), "已生成新版本（删除阶段）")
                setDelNode(null)
              }}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 重命名 */}
      <Dialog open={renameOpen} onOpenChange={(o) => !o && setRenameOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重命名 AgentFlow</DialogTitle>
            <DialogDescription>仅改展示名；版本与运行记录不受影响。</DialogDescription>
          </DialogHeader>
          <Textarea rows={2} value={renameVal} onChange={(e) => setRenameVal(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>取消</Button>
            <Button onClick={() => void applyRename()}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 节点级调整 */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>请输入调整内容</DialogTitle>
            <DialogDescription>修改阶段「{editing?.id}」的步骤说明；保存后生成新版本（不改动已发布版本）。</DialogDescription>
          </DialogHeader>
          <Textarea rows={4} value={editNote} onChange={(e) => setEditNote(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>取消</Button>
            <Button onClick={() => void applyNodeEdit()}>保存为新版本</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
