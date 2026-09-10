/**
 * AgentFlow 详情（2026-09-10 第二轮返工：对齐 QoderWake WakerFlow 详情「阶段卡画布」）。
 *
 * 原站事实（/wakerflow/<uuid>，实测 1440×900）：
 *  - 头部：返回 + 标题 + 视图切换（WakerFlow | 执行记录）+ 管理触发方式 + 运行；
 *  - WakerFlow 视图：**阶段卡画布**（浅底 #FCFCFC），每阶段一张白卡
 *    （圆角8/边框/内距 16×12）：阶段标签（11px 三级色）+ 阶段标题 + 说明 + 步骤行
 *    （Waker avatar+名 chip）；节点级「请输入调整内容」；右下画布缩放组；
 *  - 执行记录视图：阶段卡按 run 状态着色（已完成/失败/未执行）+ 右栏「运行记录」
 *    run 列表（第 N 次运行 · 触发方式 · 状态 · 相对时间，选中高亮）。
 *
 * 我方映射：definition.nodes 为线性链（agent/aggregate）→ 每节点=一个阶段卡；
 * 节点级调整=就地改 Prompt 后生成新版本（不改已发布版本）。
 */
import * as React from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import {
  ArrowLeft, Check, Minus, Pencil, Play, Plus, RefreshCw, ZoomIn, ZoomOut, Maximize2,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { avatarFor } from "@/lib/agent-avatar"
import { asApi } from "@/services/as-api"
import { useAsyncData } from "@/hooks/use-async-data"
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
  if (d === 1) return "昨天"
  if (d <= 30) return `${d} 天前`
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
  const versions = useAsyncData(() => asApi.flowVersions(fid), [fid])
  const runs = useAsyncData(() => asApi.flowRuns(fid), [fid])
  const flows = useAsyncData(() => asApi.flows(), [])
  const flow = (flows.data?.items ?? []).find((f) => f.id === fid) as
    | { id: string; name: string; description: string; active_release_id: string | null }
    | undefined

  const [agents, setAgents] = React.useState<{ id: string; name: string }[]>([])
  const [runOpen, setRunOpen] = React.useState(false)
  const [runInput, setRunInput] = React.useState("{}")
  const [selectedRun, setSelectedRun] = React.useState<string | null>(null)
  const [editing, setEditing] = React.useState<NodeSpec | null>(null)
  const [editNote, setEditNote] = React.useState("")
  const [zoom, setZoom] = React.useState(1)

  React.useEffect(() => {
    fetch(`${import.meta.env.VITE_WF_API_BASE ?? "http://127.0.0.1:8120"}/api/agents?page=1&pageSize=100`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("wf_api_token") ?? ""}` },
    })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setAgents((d.items ?? []).map((a: { id: string; name: string }) => ({ id: a.id, name: a.name }))))
      .catch(() => undefined)
  }, [])

  const latest = (versions.data?.items ?? [])[0] as
    | { id: string; version_no: number; digest?: string; definition?: { nodes?: NodeSpec[] } }
    | undefined
  const nodes: NodeSpec[] = latest?.definition?.nodes ?? []
  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? (id ? id.slice(0, 8) : "未指定")

  const runRows = React.useMemo(
    () => (runs.data?.items ?? []) as unknown as RunRow[],
    [runs.data],
  )
  React.useEffect(() => {
    if (view === "runs" && !selectedRun && runRows.length) setSelectedRun(runRows[0].id)
  }, [view, selectedRun, runRows])
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

  const startRun = async () => {
    if (!flow?.active_release_id) {
      toast.error("请先发布版本")
      return
    }
    let input: Record<string, unknown> = {}
    try {
      input = JSON.parse(runInput || "{}")
    } catch {
      toast.error("输入 JSON 不合法")
      return
    }
    try {
      const r = await asApi.runFlow(flow.active_release_id, input)
      toast.success(`运行已启动：${String(r.status)}`)
      setRunOpen(false)
      runs.retry()
      setParams({ view: "runs" })
    } catch (e) {
      toast.error(`运行失败：${(e as Error).message}`)
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

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <Button variant="ghost" size="icon" className="size-7" aria-label="返回 AgentFlow 列表" onClick={() => navigate("/agentflows")}>
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="truncate text-sm font-semibold">{flow?.name ?? fid}</h1>
        {flow?.active_release_id ? <Badge variant="secondary">已发布</Badge> : <Badge variant="outline">未发布</Badge>}
        <div className="ml-2 flex h-7 w-fit items-center gap-1 rounded-md bg-(--segment-bg) p-0.5" role="radiogroup" aria-label="视图">
          {([["flow", "AgentFlow"], ["runs", "执行记录"]] as const).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={view === k}
              onClick={() => setParams(k === "flow" ? {} : { view: "runs" })}
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
        <Button size="sm" onClick={() => setRunOpen(true)}>
          <Play className="size-4" /> 运行
        </Button>
      </header>

      {view === "flow" ? (
        <div className="relative flex min-h-0 flex-1 flex-col" style={{ background: "var(--surface-muted, #FCFCFC)" }}>
          <div className="min-h-0 flex-1 overflow-auto p-4">
            {nodes.length === 0 ? (
              <div className="mx-auto max-w-md rounded-lg border border-dashed bg-surface p-8 text-center text-sm text-muted-foreground">
                暂无阶段：先在「自动任务」或脚本中定义节点后保存为首个版本。
              </div>
            ) : (
              <div className="flex items-start gap-3" style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}>
                {nodes.map((n, i) => (
                  <div key={n.id} className="flex items-start gap-3">
                    <div
                      className="relative flex w-[220px] shrink-0 flex-col gap-3 border bg-surface px-3 py-4 shadow-sm"
                      style={{ borderColor: "var(--border)", borderRadius: "8px" }}
                    >
                      <button
                        type="button"
                        className="absolute right-2 top-2 rounded p-0.5 text-muted-foreground hover:bg-muted"
                        aria-label="请输入调整内容"
                        title="请输入调整内容"
                        onClick={() => { setEditing(n); setEditNote(n.prompt_template) }}
                      >
                        <Pencil className="size-3.5" />
                      </button>
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
          <div className="flex shrink-0 items-center gap-2 border-t bg-background px-4 py-2">
            <span className="text-xs text-muted-foreground">
              版本 {latest ? `v${latest.version_no}` : "—"} · digest {String(latest?.digest ?? "").slice(0, 12) || "—"}
            </span>
            <div className="ml-auto flex items-center gap-1">
              <Button variant="ghost" size="icon" className="size-7" aria-label="缩小" onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.1).toFixed(1)))}>
                <ZoomOut className="size-3.5" />
              </Button>
              <span className="w-10 text-center text-xs tabular-nums">{Math.round(zoom * 100)}%</span>
              <Button variant="ghost" size="icon" className="size-7" aria-label="放大" onClick={() => setZoom((z) => Math.min(1.6, +(z + 0.1).toFixed(1)))}>
                <ZoomIn className="size-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="size-7" aria-label="适应" onClick={() => setZoom(1)}>
                <Maximize2 className="size-3.5" />
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
        <div className="flex min-h-0 flex-1">
          <div className="min-h-0 flex-1 overflow-auto" style={{ background: "var(--surface-muted, #FCFCFC)" }}>
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
                <div className="flex items-start gap-3 p-4">
                  {nodes.map((n, i) => {
                    const nr = nodeRunOf(n.id)
                    const tone = nr ? statusTone(nr.status) : null
                    return (
                      <div key={n.id} className="flex items-start gap-3">
                        <div
                          className="flex w-[220px] shrink-0 flex-col gap-3 border bg-surface px-3 py-4 shadow-sm"
                          style={{ borderColor: "var(--border)", borderRadius: "8px" }}
                        >
                          <div className="text-[11px] font-medium" style={{ color: "var(--text-tertiary)" }}>阶段 {String(i + 1).padStart(2, "0")}</div>
                          <div className="text-sm font-medium">{n.id}</div>
                          <div className="flex items-center gap-2 text-xs">
                            <img src={avatarFor(n.agent_id || "?")} alt="" className="size-6 rounded-full object-cover" />
                            <span className="truncate">{agentName(n.agent_id)}</span>
                            <span
                              className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium"
                              style={{ background: tone?.bg ?? "var(--fill-tertiary)", color: tone?.fg ?? "var(--text-tertiary)" }}
                            >
                              {nr?.status === "succeeded" || nr?.status === "success" ? <Check className="size-2.5" /> : <Minus className="size-2.5" />}
                              {nr ? STATUS_LABEL[nr.status] ?? nr.status : "未执行"}
                            </span>
                          </div>
                          {nr && (
                            <div className="flex items-center gap-2 border-t pt-2 text-[11px] text-muted-foreground">
                              <span>attempt {nr.attempt}</span>
                              {nr.session_id && (
                                <button
                                  type="button"
                                  className="underline"
                                  onClick={() => navigate(`/agents/${nr.agent_id}/chat?session=${nr.session_id}`)}
                                >
                                  Session {nr.session_id.slice(0, 8)}
                                </button>
                              )}
                              <button
                                type="button"
                                className="ml-auto inline-flex items-center gap-1 underline"
                                onClick={async () => {
                                  try {
                                    await asApi.rerunNode(current.id, n.id)
                                    toast.success("已发起节点重跑（新 attempt）")
                                    runs.retry()
                                  } catch (e) {
                                    toast.error(`重跑失败：${(e as Error).message}`)
                                  }
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
          </div>
          <aside className="w-64 shrink-0 overflow-y-auto border-l" aria-label="运行记录">
            <div className="border-b px-3 py-2 text-sm font-semibold">运行记录（{runRows.length}）</div>
            <ul className="p-2">
              {runRows.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedRun(r.id)}
                    className={`w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                      current?.id === r.id ? "bg-muted" : "hover:bg-muted/50"
                    }`}
                  >
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
                </li>
              ))}
              {!runRows.length && <li className="py-6 text-center text-xs text-muted-foreground">暂无运行记录</li>}
            </ul>
          </aside>
        </div>
      )}

      <Dialog open={runOpen} onOpenChange={setRunOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>运行 AgentFlow</DialogTitle>
            <DialogDescription>使用当前 active Release；输入将作为首节点模板变量。</DialogDescription>
          </DialogHeader>
          <Textarea rows={4} value={runInput} onChange={(e) => setRunInput(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRunOpen(false)}>取消</Button>
            <Button onClick={() => void startRun()}>运行</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
