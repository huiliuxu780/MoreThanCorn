/**
 * 自动任务 v2（2026-09-10 P0-G 重建，QoderWake /autonomous-work 同构）。
 * 实地观察对齐（qoderwake-live-observations.md §5）：
 * - 指标带四卡（总数/已启用/Agent 执行/AgentFlow 执行）；
 * - 筛选四控件：执行者 / 触发类型 / 自动任务状态 / 排序 + 分页（共 N 条 + 每页条数）；
 * - 表七列：自动任务/触发来源/触发条件/执行者(头像+名+类型)/最近触发/累计自动运行/状态 switch；
 * - 新建弹窗：执行方式卡 + 执行对象**真实选择器**（仅已发布可执行对象；后端保存阶段 422 兜底）。
 * 触发层解耦（任务书 §九）：自动任务定义“执行什么”；Trigger 定义“何时”；
 * DataSource/Connector 定义“数据从哪来”；Filter/Mapping 定义“哪些数据触发”。
 * MQ 消费适配器当前未实现——如实标记 UNC（见验收报告），不伪造入口。
 */
import * as React from "react"
import { Link, useNavigate , useSearchParams } from "react-router-dom"
import { Plus } from "lucide-react"
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
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { avatarFor } from "@/lib/agent-avatar"
import {
  defaultExecutorId,
  executableAgentFlows,
  executableAgents,
  executableWorkflows,
} from "@/lib/executable-targets"
import { asApi } from "@/services/as-api"
import { agentApi, wfApi } from "@/services/wf-api"
import { toast } from "sonner"

interface ExecutorInfo {
  kind: string
  id: string | null
  name: string | null
  avatar: string | null
  missing?: boolean
}
interface AutoRow {
  id: string
  name: string
  target_kind: string
  agent_id: string | null
  workflow_id: string | null
  agentflow_id: string | null
  enabled: boolean
  auto_run_count: number
  last_auto_fire_at: string | null
  executor?: ExecutorInfo
  triggers: { id: string; kind: string; config: Record<string, unknown>; enabled?: boolean }[]
}

const KIND_LABEL: Record<string, string> = {
  schedule: "定时",
  api: "API",
  event: "事件",
  polling: "轮询",
}
const EXECUTOR_LABEL: Record<string, string> = {
  agent: "Agent",
  workflow: "Workflow",
  agentflow: "AgentFlow",
}

export default function AutomationsV2Page() {
  const navigate = useNavigate()
  const [filters, setFilters] = React.useState({
    executor: "",
    triggerKind: "",
    status: "",
    sort: "created_at",
    order: "desc",
    page: 1,
    pageSize: 10,
  })
  const [list, setList] = React.useState<{ items: AutoRow[]; total: number }>({ items: [], total: 0 })
  const [metrics, setMetrics] = React.useState({ total: 0, enabled: 0, agent: 0, flow: 0 })
  const [loading, setLoading] = React.useState(true)

  const reload = React.useCallback(() => {
    setLoading(true)
    const params: Record<string, string> = {
      page: String(filters.page),
      pageSize: String(filters.pageSize),
      sort: filters.sort,
      order: filters.order,
    }
    if (filters.executor) params.executor = filters.executor
    if (filters.triggerKind) params.triggerKind = filters.triggerKind
    if (filters.status) params.status = filters.status
    asApi
      .automations(params)
      .then((r) => setList({ items: r.items as unknown as AutoRow[], total: r.total }))
      .catch((e) => toast.error(`列表加载失败：${(e as Error).message}`))
      .finally(() => setLoading(false))
  }, [filters])

  React.useEffect(() => {
    reload()
  }, [reload])
  React.useEffect(() => {
    asApi
      .automations({ pageSize: "100" })
      .then((r) => {
        const rows = r.items as unknown as AutoRow[]
        setMetrics({
          total: r.total,
          enabled: rows.filter((x) => x.enabled).length,
          agent: rows.filter((x) => x.target_kind === "agent").length,
          flow: rows.filter((x) => x.target_kind === "agentflow").length,
        })
      })
      .catch(() => undefined)
  }, [list.total])

  // 新建弹窗
  const [open, setOpen] = React.useState(false)
  // 09-11 批5：对话页「自动任务」tab 的新建入口带 ?new=1 直达新建弹窗
  const [routeParams, setRouteParams] = useSearchParams()
  React.useEffect(() => {
    if (routeParams.get("new") === "1") {
      setOpen(true)
      setRouteParams({}, { replace: true })
    }
  }, [routeParams, setRouteParams])
  const [form, setForm] = React.useState({
    name: "",
    target_kind: "agent",
    agent_id: "",
    workflow_id: "",
    agentflow_id: "",
    prompt_template: "",
    session_policy: "fresh",
    max_runs: "",
    deadline: "",
  })
  const [triggers, setTriggers] = React.useState<
    { kind: string; cron: string; timezone: string; source_id: string; filter: string; mapping: string }[]
  >([{ kind: "schedule", cron: "0 9 * * *", timezone: "Asia/Shanghai", source_id: "", filter: "", mapping: "" }])
  const [agentOpts, setAgentOpts] = React.useState<{ id: string; name: string; description?: string }[]>([])
  const [wfOpts, setWfOpts] = React.useState<{ id: string; name: string }[]>([])
  const [flowOpts, setFlowOpts] = React.useState<{ id: string; name: string }[]>([])
  const [sourceOpts, setSourceOpts] = React.useState<{ id: string; name: string }[]>([])

  const loadExecutorOpts = React.useCallback(() => {
    // 唯一判定在 @/lib/executable-targets（与后端 as_automations._validate_target 同一语义）：
    // Agent=executable(未归档+active prod Release)；Workflow=published；AgentFlow=有 active Release。
    agentApi.list({ pageSize: 100 }).then((r) => {
      const list = executableAgents(r.items)
      setAgentOpts(list)
      // 默认执行者只能取自真正可执行对象；空列表保持 ""（由空态接管，不回填草稿）
      setForm((f) => (f.agent_id ? f : { ...f, agent_id: defaultExecutorId(list) }))
    }).catch(() => undefined)
    wfApi.list({ pageSize: 100 }).then((r) => setWfOpts(executableWorkflows(r.items))).catch(() => undefined)
    asApi.flows().then((r) =>
      setFlowOpts(executableAgentFlows(r.items as { id: string; name: string; active_release_id?: string | null }[])),
    ).catch(() => undefined)
    asApi.sources().then((r) =>
      setSourceOpts(((r as { items?: { id: string; name: string }[] }).items ?? []).map((s) => ({ id: s.id, name: s.name }))),
    ).catch(() => undefined)
  }, [])

  React.useEffect(() => {
    loadExecutorOpts()
  }, [loadExecutorOpts])

  const openCreate = () => {
    setOpen(true)
    loadExecutorOpts()
  }

  const submit = async () => {
    if (!form.name.trim()) {
      toast.error("请填写名称")
      return
    }
    if (form.target_kind === "agent" && !form.agent_id) {
      toast.error("请选择执行 Agent")
      return
    }
    if (form.target_kind === "workflow" && !form.workflow_id) {
      toast.error("请选择执行 Workflow")
      return
    }
    if (form.target_kind === "agentflow" && !form.agentflow_id) {
      toast.error("请选择执行 AgentFlow")
      return
    }
    if (form.target_kind === "agent" && !form.prompt_template.trim()) {
      toast.error("请填写执行指令")
      return
    }
    const triggerPayload: Record<string, unknown>[] = triggers.slice(0, 5).map((t) => {
      if (t.kind === "schedule") return { kind: "schedule", config: { cron: t.cron, timezone: t.timezone } }
      if (t.kind === "api") return { kind: "api", config: {} }
      let filter: Record<string, unknown> = {}
      let mapping: Record<string, unknown> = {}
      try {
        filter = t.filter.trim() ? JSON.parse(t.filter) : {}
        mapping = t.mapping.trim() ? JSON.parse(t.mapping) : {}
      } catch {
        toast.error("事件过滤/映射 JSON 不合法")
        throw new Error("bad json")
      }
      return { kind: t.kind, config: { data_source_id: t.source_id, filter, mapping } }
    })
    try {
      await asApi.createAutomation({
        name: form.name,
        target_kind: form.target_kind,
        agent_id: form.target_kind === "agent" ? form.agent_id || null : null,
        workflow_id: form.target_kind === "workflow" ? form.workflow_id || null : null,
        agentflow_id: form.target_kind === "agentflow" ? form.agentflow_id || null : null,
        session_policy: form.session_policy,
        prompt_template: form.prompt_template,
        max_runs: form.max_runs ? Number(form.max_runs) : null,
        deadline: form.deadline ? new Date(form.deadline).toISOString() : null,
        triggers: triggerPayload,
      })
      toast.success("自动任务已创建")
      setOpen(false)
      reload()
    } catch (e) {
      toast.error(`创建失败：${(e as Error).message}`)
    }
  }

  const pages = Math.max(1, Math.ceil(list.total / filters.pageSize))

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:p-6">
      <header className="flex items-center gap-3">
        <div>
          <h1 className="text-[28px] font-semibold leading-9">自动任务</h1>
          <p className="text-sm text-muted-foreground">
            通过定时、事件或 API 自动开工，并由 Agent / Workflow / AgentFlow 响应。
          </p>
        </div>
        <Button className="ml-auto" onClick={openCreate}>
          <Plus className="size-4" /> 新建自动任务
        </Button>
      </header>

      {/* 指标带（原站 qc-autonomous-work-stats 同构：单条带 #F9F9F9/圆角6/内距20；
          数值 44px·600 / 名称 13px / 说明 12px 三级色；项内右距 20 分隔，无边框卡） */}
      <section
        aria-label="自主工作"
        className="grid grid-cols-2 gap-y-5 rounded-md p-5 md:grid-cols-4"
        style={{ background: "var(--fill-tertiary)" }}
      >
        {[
          { label: "自动任务总数", value: metrics.total, note: "全部自动任务" },
          { label: "已启用", value: metrics.enabled, note: "当前已启用的自动任务" },
          { label: "Agent 执行", value: metrics.agent, note: "由 Agent 执行的自动任务" },
          { label: "AgentFlow 执行", value: metrics.flow, note: "由 AgentFlow 执行的自动任务" },
        ].map((m) => (
          <div key={m.label} className="pr-5">
            <strong className="block text-[44px] font-semibold leading-[48px]">{m.value}</strong>
            <span className="block text-[13px] leading-5">{m.label}</span>
            <span className="block text-xs leading-[18px] text-muted-foreground">{m.note}</span>
          </div>
        ))}
      </section>

      <section aria-label="筛选" className="flex flex-wrap items-center gap-2">
        <Select
          value={filters.executor || "__all"}
          onValueChange={(v) => setFilters({ ...filters, executor: v === "__all" ? "" : v, page: 1 })}
        >
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">全部执行者</SelectItem>
            {agentOpts.map((a) => (
              <SelectItem key={a.id} value={`agent:${a.id}`}>{a.name}</SelectItem>
            ))}
            {wfOpts.map((w) => (
              <SelectItem key={w.id} value={`workflow:${w.id}`}>{w.name}</SelectItem>
            ))}
            {flowOpts.map((f) => (
              <SelectItem key={f.id} value={`agentflow:${f.id}`}>{f.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.triggerKind || "__all"}
          onValueChange={(v) => setFilters({ ...filters, triggerKind: v === "__all" ? "" : v, page: 1 })}
        >
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">全部类型</SelectItem>
            <SelectItem value="schedule">定时</SelectItem>
            <SelectItem value="api">API</SelectItem>
            <SelectItem value="event">事件</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={filters.status || "__all"}
          onValueChange={(v) => setFilters({ ...filters, status: v === "__all" ? "" : v, page: 1 })}
        >
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">全部状态</SelectItem>
            <SelectItem value="enabled">已启用</SelectItem>
            <SelectItem value="disabled">已停用</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={`${filters.sort}:${filters.order}`}
          onValueChange={(v) => {
            const [sort, order] = v.split(":")
            setFilters({ ...filters, sort, order, page: 1 })
          }}
        >
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="created_at:desc">最近创建</SelectItem>
            <SelectItem value="created_at:asc">最早创建</SelectItem>
            <SelectItem value="name:asc">名称 A→Z</SelectItem>
            <SelectItem value="last_auto_fire_at:desc">最近触发</SelectItem>
            <SelectItem value="auto_run_count:desc">累计运行</SelectItem>
          </SelectContent>
        </Select>
      </section>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>自动任务</TableHead>
            <TableHead>触发来源</TableHead>
            <TableHead>触发条件</TableHead>
            <TableHead>执行者</TableHead>
            <TableHead>最近触发</TableHead>
            <TableHead>累计自动运行</TableHead>
            <TableHead>状态</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.items.map((r) => (
            <TableRow key={r.id} className="cursor-pointer" onClick={() => navigate(`/autonomous-tasks/${r.id}`)}>
              <TableCell className="font-medium">{r.name}</TableCell>
              <TableCell>
                {r.triggers.map((t) => KIND_LABEL[t.kind] ?? t.kind).join(" / ") || "—"}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {r.triggers[0]?.kind === "schedule"
                  ? `cron ${(r.triggers[0].config as Record<string, string>).cron ?? ""}`
                  : r.triggers[0]?.kind === "api"
                    ? "通过 POST 请求触发"
                    : r.triggers[0]?.kind ?? "—"}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <img src={executorAvatar(r.executor)} alt="avatar" className="size-5 rounded-full" />
                  <span className="text-xs font-medium">{r.executor?.name ?? r.executor?.id ?? "—"}</span>
                  <Badge variant="outline">{EXECUTOR_LABEL[r.target_kind] ?? r.target_kind}</Badge>
                </div>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {r.last_auto_fire_at ? new Date(r.last_auto_fire_at).toLocaleString() : "—"}
              </TableCell>
              <TableCell>{r.auto_run_count} 次</TableCell>
              <TableCell onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={r.enabled}
                    onCheckedChange={async (v) => {
                      try {
                        await asApi.setEnabled(r.id, v)
                        reload()
                      } catch (e) {
                        toast.error(`启停失败：${(e as Error).message}`)
                      }
                    }}
                    aria-label="启用"
                  />
                  <span className="text-xs">{r.enabled ? "启用" : "停用"}</span>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {!list.items.length && !loading && (
            <TableRow>
              <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                暂无自动任务（调整筛选或点击「新建自动任务」）
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <footer className="flex items-center gap-3 text-xs text-muted-foreground">
        <span>共 {list.total} 条</span>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={filters.page <= 1}
            onClick={() => setFilters({ ...filters, page: filters.page - 1 })}>
            上一页
          </Button>
          <span>{filters.page} / {pages}</span>
          <Button variant="outline" size="sm" disabled={filters.page >= pages}
            onClick={() => setFilters({ ...filters, page: filters.page + 1 })}>
            下一页
          </Button>
          <Select
            value={String(filters.pageSize)}
            onValueChange={(v) => setFilters({ ...filters, pageSize: Number(v), page: 1 })}
          >
            <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[10, 20, 50].map((n) => (
                <SelectItem key={n} value={String(n)}>{n} 条/页</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </footer>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>新建自动任务</DialogTitle>
            <DialogDescription>
              配置自动任务的名称、触发条件、执行方式、执行指令与高级设置。保存后执行方式与执行对象锁定；如需更换请新建自动任务。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1">
              <Label>名称 *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid gap-1">
              <Label>执行方式 *</Label>
              <div className="grid gap-2 sm:grid-cols-3">
                {(["agent", "workflow", "agentflow"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setForm({ ...form, target_kind: k })}
                    className={`rounded-md border p-2 text-left text-xs transition-colors ${
                      form.target_kind === k ? "border-brand bg-brand-soft" : "hover:border-brand/50"
                    }`}
                  >
                    <div className="text-sm font-medium">
                      {k === "agent" ? "交给 Agent" : k === "workflow" ? "运行 Workflow" : "运行 AgentFlow"}
                    </div>
                    <div className="mt-0.5 text-muted-foreground">
                      {k === "agent" ? "由一个指定的 Agent 完成任务" : k === "workflow" ? "由已发布工作流执行" : "由一个编排好的流程完成任务"}
                    </div>
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-1">
              <Label>执行对象 *</Label>
              {form.target_kind === "agent" &&
                (agentOpts.length === 0 ? (
                  <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground" data-testid="empty-exec-agent">
                    暂无可执行 Agent（需未归档且有 active prod Release）。请先在
                    <Link to="/agents" className="mx-1 text-brand underline">Agent 管理</Link>
                    发布一个生产版本，再回来创建自动任务。
                  </div>
                ) : (
                  <Select value={form.agent_id || "__pick"} onValueChange={(v) => setForm({ ...form, agent_id: v === "__pick" ? "" : v })}>
                    <SelectTrigger><SelectValue placeholder="选择已发布的 Agent" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__pick" disabled>请选择 Agent</SelectItem>
                      {agentOpts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ))}
              {form.target_kind === "workflow" &&
                (wfOpts.length === 0 ? (
                  <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground" data-testid="empty-exec-workflow">
                    暂无已发布 Workflow。请先在
                    <Link to="/workflows" className="mx-1 text-brand underline">Workflow</Link>
                    页面完成发布，再回来创建自动任务。
                  </div>
                ) : (
                  <Select value={form.workflow_id || "__pick"} onValueChange={(v) => setForm({ ...form, workflow_id: v === "__pick" ? "" : v })}>
                    <SelectTrigger><SelectValue placeholder="选择已发布的 Workflow" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__pick" disabled>请选择 Workflow</SelectItem>
                      {wfOpts.map((w) => (
                        <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ))}
              {form.target_kind === "agentflow" &&
                (flowOpts.length === 0 ? (
                  <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground" data-testid="empty-exec-agentflow">
                    暂无有 active Release 的 AgentFlow。请先在
                    <Link to="/agentflows" className="mx-1 text-brand underline">AgentFlow</Link>
                    页面发布一个流程，再回来创建自动任务。
                  </div>
                ) : (
                  <Select value={form.agentflow_id || "__pick"} onValueChange={(v) => setForm({ ...form, agentflow_id: v === "__pick" ? "" : v })}>
                    <SelectTrigger><SelectValue placeholder="选择 AgentFlow" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__pick" disabled>请选择 AgentFlow</SelectItem>
                      {flowOpts.map((f) => (
                        <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ))}
              <p className="text-[11px] text-muted-foreground">
                仅展示当前环境可执行的对象（与后端保存校验同一判定）；保存时后端再次校验类型/存在性/发布态，无效目标返回 422。
              </p>
            </div>
            {form.target_kind === "agent" && (
              <>
                <div className="grid gap-1">
                  <Label>执行指令 *</Label>
                  <Textarea
                    rows={4}
                    value={form.prompt_template}
                    onChange={(e) => setForm({ ...form, prompt_template: e.target.value })}
                    placeholder="每次触发时，都会将这里的内容作为 Prompt 发送给所选 Agent；支持 {{field}} / {{nested.field}} 占位符"
                  />
                </div>
                <div className="grid gap-1">
                  <Label>Session 策略</Label>
                  <Select value={form.session_policy} onValueChange={(v) => setForm({ ...form, session_policy: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fresh">每次新建 Session</SelectItem>
                      <SelectItem value="stateful">跨触发复用 Session</SelectItem>
                      <SelectItem value="conversation">按 conversation key 复用</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
            <div className="grid gap-2 rounded-md border p-2">
              <div className="flex items-center justify-between">
                <Label>触发方式（{triggers.length}/5）</Label>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={triggers.length >= 5}
                  onClick={() =>
                    setTriggers([
                      ...triggers,
                      { kind: "schedule", cron: "0 9 * * *", timezone: "Asia/Shanghai", source_id: "", filter: "", mapping: "" },
                    ])
                  }
                >
                  添加触发方式
                </Button>
              </div>
              {triggers.map((t, i) => (
                <div key={i} className="grid gap-2 rounded-md border p-2">
                  <div className="flex items-center gap-2">
                    <Select
                      value={t.kind}
                      onValueChange={(v) => setTriggers(triggers.map((x, j) => (j === i ? { ...x, kind: v } : x)))}
                    >
                      <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="schedule">定时（按计划运行）</SelectItem>
                        <SelectItem value="api">API（收到请求时运行）</SelectItem>
                        <SelectItem value="event">Webhook/事件</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button variant="ghost" size="sm" onClick={() => setTriggers(triggers.filter((_, j) => j !== i))}>
                      删除此触发方式
                    </Button>
                  </div>
                  {t.kind === "schedule" && (
                    <div className="grid gap-1 md:grid-cols-2">
                      <Input value={t.cron} onChange={(e) => setTriggers(triggers.map((x, j) => (j === i ? { ...x, cron: e.target.value } : x)))} placeholder="cron: 0 9 * * *" />
                      <Input value={t.timezone} onChange={(e) => setTriggers(triggers.map((x, j) => (j === i ? { ...x, timezone: e.target.value } : x)))} placeholder="timezone" />
                    </div>
                  )}
                  {t.kind === "api" && (
                    <p className="text-xs text-muted-foreground">保存后在详情页生成 API key；调用带 Idempotency-Key 头去重。</p>
                  )}
                  {t.kind === "event" && (
                    <div className="grid gap-1">
                      <Select
                        value={t.source_id || "__none"}
                        onValueChange={(v) => setTriggers(triggers.map((x, j) => (j === i ? { ...x, source_id: v === "__none" ? "" : v } : x)))}
                      >
                        <SelectTrigger><SelectValue placeholder="选择数据源（Webhook/Polling）" /></SelectTrigger>
                        <SelectContent>
                          {sourceOpts.map((src) => (
                            <SelectItem key={src.id} value={src.id}>{src.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input value={t.filter} onChange={(e) => setTriggers(triggers.map((x, j) => (j === i ? { ...x, filter: e.target.value } : x)))} placeholder='过滤 JSON: {"field":"topic","op":"eq","value":"refund"}' />
                      <Input value={t.mapping} onChange={(e) => setTriggers(triggers.map((x, j) => (j === i ? { ...x, mapping: e.target.value } : x)))} placeholder='映射 JSON: {"topic":"topic"}' />
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="grid gap-1 md:grid-cols-2">
              <div className="grid gap-1">
                <Label>最大运行次数（空=不限）</Label>
                <Input value={form.max_runs} onChange={(e) => setForm({ ...form, max_runs: e.target.value })} />
              </div>
              <div className="grid gap-1">
                <Label>截止日期（空=永不）</Label>
                <Input type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            {/* 审计返工 P0-1：无可执行对象/未选目标/Agent 无执行指令时禁止提交（空态可见且不可保存） */}
            <Button
              onClick={() => void submit()}
              disabled={
                !form.name.trim() ||
                (form.target_kind === "agent" && (!form.agent_id || !form.prompt_template.trim())) ||
                (form.target_kind === "workflow" && !form.workflow_id) ||
                (form.target_kind === "agentflow" && !form.agentflow_id)
              }
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// 执行者头像兜底（后端 executor.avatar 为空时按 id 哈希）
export function executorAvatar(exec: ExecutorInfo | undefined): string {
  return exec?.avatar ?? avatarFor(exec?.id ?? "unknown")
}
