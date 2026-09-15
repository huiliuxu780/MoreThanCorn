/**
 * 数据接入（2026-09-09 换底 §五-G；09-13 审计修复轮重写；09-14 六型+D5）：
 * webhook/api_pull/maxcompute/feishu_bitable/sls/test_event 数据源管理。
 * 事件管线：接收→去重→过滤→映射→路由派发；流水/死信见 /api/v2/event-deliveries。
 *
 * 09-13 审计修复：
 * - P0：轮询源表单补齐后端真实消费的 config 字段（url/interval_seconds/
 *   cursor_field/cursor_param），原表单只提交 {mapping}，创建出的轮询源必然 422；
 * - P0：字段映射方向文案纠正为「触发输入键 → payload 路径」（与后端
 *   _apply_mapping 的 key→输出、value→取值路径一致，原文案写反）；
 * - loading/error/empty 三态分离（原失败与空数据不可区分）；
 * - webhook token 一次性交付：复制按钮 + 丢失后果强提醒；
 * - 测试事件错误分流：JSON 不合法 vs 后端拒绝分别提示；
 * - 表单 Label 全部 htmlFor/id 关联（可访问名称）；
 * - 空态文案去实现层语言；轮询源补「立即拉取」真实治理入口。
 * 09-14 D5：拉取型凭据统一走 Connection（设置 → 连接）或源级凭据 JSON；
 * 无凭据时后端如实匿名 GET，表单不摆假字段。
 */
import * as React from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { CircleCheck, CircleX, Clock, CloudDownload, Copy, Database, FlaskConical, OctagonAlert, Plus, RotateCw, ScrollText, Settings2, Table as TableIcon, Webhook } from "lucide-react"
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
import { Textarea } from "@/components/ui/textarea"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Link } from "react-router-dom"
import { IA_BOUNDARY } from "@/config/ui-terms"
import { HealthBand } from "@/components/ingress/health-band"
import { asApi, type CreateSourceBody, type SourceRow } from "@/services/as-api"
import { connApi } from "@/services/resource-api"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAsyncData } from "@/hooks/use-async-data"
import { toast } from "sonner"

/* 09-14 类型体系常量与按型字段组：16 号稿 B2 起单点在共享组件（老 Dialog 与向导共用） */
import {
  EMPTY_SOURCE_FORM, KIND_ICON, KIND_LABEL, PULL_KINDS,
  SourceKindFields, deriveSourcePayload, type SourceFormState,
} from "@/components/ingress/source-kind-fields"

const STATUS_LABEL: Record<string, string> = {
  active: "活跃",
  paused: "已暂停",
  error: "异常",
}

export default function DataSourcesPage() {
  const navigate = useNavigate()
  const list = useAsyncData((o) => asApi.sources(o?.signal), [])
  const [open, setOpen] = React.useState(false)
  const [form, setForm] = React.useState<SourceFormState>(EMPTY_SOURCE_FORM)
  const [token, setToken] = React.useState<string | null>(null)
  const [testPayload, setTestPayload] = React.useState('{"topic":"billing","id":"evt-demo-1"}')
  const [testTarget, setTestTarget] = React.useState<string | null>(null)
  const [creating, setCreating] = React.useState(false)
  // D5 两级选择器：Connection（凭据/端点）→ 目录（表/日志库）
  const [conns, setConns] = React.useState<{ id: string; name: string; protocol: string }[]>([])
  const [catalogItems, setCatalogItems] = React.useState<{ name: string; kind: string }[]>([])
  const [catalogErr, setCatalogErr] = React.useState<string | null>(null)
  React.useEffect(() => {
    connApi.list({}).then((r) => setConns(r.items)).catch(() => setConns([]))
  }, [])
  const loadCatalog = async (cid: string) => {
    setCatalogItems([]); setCatalogErr(null)
    try {
      const r = await connApi.catalog(cid)
      setCatalogItems(r.items)
    } catch (e) {
      setCatalogErr((e as Error).message)
    }
  }
  const [polling, setPolling] = React.useState<string | null>(null)

  const rows: SourceRow[] = list.data?.items ?? []
  const set = (patch: Partial<SourceFormState>) => setForm((f) => ({ ...f, ...patch }))

  const create = async () => {
    if (!form.name.trim()) {
      toast.error("请填写名称")
      return
    }
    // 16 号稿 B2：校验与配置推导单点在共享纯函数（向导同用）
    const derived = deriveSourcePayload(form)
    if (derived.error || !derived.payload) {
      toast.error(derived.error ?? "配置不合法")
      return
    }
    const { config, secret } = derived.payload
    setCreating(true)
    try {
      const r = await asApi.createSource({
        name: form.name.trim(), kind: form.kind,
        config: config as CreateSourceBody["config"],
        ...(form.connId ? { connection_id: form.connId } : {}),
        ...(secret ? { secret } : {}),
      })
      setOpen(false)
      setForm(EMPTY_SOURCE_FORM)
      list.retry()
      if (r.webhook_token) {
        setToken(String(r.webhook_token))  // 一次性交付弹窗
      } else {
        toast.success("数据源已创建")
      }
    } catch (e) {
      toast.error(`创建失败：${(e as Error).message}`)
    } finally {
      setCreating(false)
    }
  }

  const pollNow = async (s: SourceRow) => {
    setPolling(s.id)
    try {
      const r = await asApi.pollSource(s.id)
      toast.success(`拉取完成：${r.polled} 条，派发 ${r.dispatched} 条`)
      list.retry()
    } catch (e) {
      toast.error(`拉取失败：${(e as Error).message}`)
      list.retry()
    } finally {
      setPolling(null)
    }
  }

  const [searchParams, setSearchParams] = useSearchParams()
  const [tab, setTab] = React.useState(searchParams.get("tab") ?? "sources")
  React.useEffect(() => {
    const t = searchParams.get("tab") ?? "sources"
    if (t !== tab) setTab(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      {/* 09-14 终版 IA：数据接入只管事件接入=数据源+事件流水；
          连接凭据归 设置→连接（系统根凭据管理），数据资产(含目录挂载)归 能力与资源→数据资产 */}
      <Tabs value={tab} onValueChange={(v) => { setTab(v); setSearchParams((p) => { const n = new URLSearchParams(p); if (v === "sources") n.delete("tab"); else n.set("tab", v); return n }, { replace: true }) }}>
        <TabsList>
          <TabsTrigger value="sources">数据源</TabsTrigger>
          <TabsTrigger value="events">事件流水</TabsTrigger>
        </TabsList>
      <TabsContent value="sources" className="flex flex-col gap-4">
      {/* 09-14 D4 拍板：双「数据源」边界说明条（文案取自 ui-terms 单一事实源） */}
      <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-xs"
           style={{ borderColor: "var(--brand-subtle)", background: "var(--brand-soft)",
                    color: "var(--text-secondary)" }}>
        <span>ℹ︎ {IA_BOUNDARY.ingress.text}</span>
        <Link to={IA_BOUNDARY.ingress.to} className="font-medium"
              style={{ color: "var(--brand-primary)" }}>{IA_BOUNDARY.ingress.linkText}</Link>
      </div>
      <header className="flex items-center gap-3">
        <div>
          <h1 className="text-xl font-semibold">数据接入</h1>
          <p className="text-sm text-muted-foreground">
            Webhook / API 拉取 / MaxCompute / SLS / 多维表格 / 测试事件源；同一数据源可服务多个自动任务，去重与死信在事件层治理。
          </p>
        </div>
        <Button variant="outline" className="ml-auto" onClick={() => navigate("/data-sources/wizard")}>
          新建接入（向导）
        </Button>
        <Button onClick={() => setOpen(true)}>
          <Plus className="size-4" /> 新建数据源
        </Button>
      </header>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建数据源</DialogTitle>
            <DialogDescription>
              Webhook 由外部系统推送（token 鉴权）；拉取型源（API/MaxCompute/SLS/多维表格）由平台按间隔拉取，凭据可选 Connection（设置 → 连接）统一承载；测试事件用于链路验证。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1">
              <Label htmlFor="ds-name">名称</Label>
              <Input id="ds-name" value={form.name}
                     onChange={(e) => set({ name: e.target.value })} />
            </div>
            <div className="grid gap-1">
              <Label id="ds-kind-label">类型</Label>
              <Select value={form.kind} onValueChange={(v) => set({ kind: v as SourceFormState["kind"] })}>
                <SelectTrigger id="ds-kind" aria-labelledby="ds-kind-label">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="webhook"><Webhook className="size-3.5" /> Webhook（外部推送）</SelectItem>
                  <SelectItem value="api_pull"><CloudDownload className="size-3.5" /> API（拉取）</SelectItem>
                  <SelectItem value="maxcompute"><Database className="size-3.5" /> MaxCompute</SelectItem>
                  <SelectItem value="feishu_bitable"><TableIcon className="size-3.5" /> 飞书多维表格</SelectItem>
                  <SelectItem value="sls"><ScrollText className="size-3.5" /> SLS 日志</SelectItem>
                  <SelectItem value="test_event"><FlaskConical className="size-3.5" /> 测试事件</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {/* 16 号稿 B2：按型字段组单点共享（向导步③同用） */}
            <SourceKindFields form={form} set={set}
              cat={{ conns, items: catalogItems, err: catalogErr, load: loadCatalog }} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button disabled={creating} onClick={() => void create()}>
              {creating ? "创建中…" : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* webhook token 一次性交付：复制 + 丢失后果强提醒（09-13 审计 UI#12） */}
      <Dialog open={token !== null} onOpenChange={(v) => { if (!v) setToken(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>数据源已创建：保存 Webhook Token</DialogTitle>
            <DialogDescription>
              调用方式：POST /api/v2/ingress/webhook/{"{source_id}"}，携带 X-Source-Token 头。
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-3">
            <code className="min-w-0 flex-1 break-all text-xs">{token}</code>
            <Button size="sm" variant="outline" aria-label="复制 Token"
                    onClick={() => {
                      void navigator.clipboard.writeText(token ?? "").then(
                        () => toast.success("已复制到剪贴板"),
                        () => toast.error("复制失败，请手动选中复制"))
                    }}>
              <Copy className="size-3.5" /> 复制
            </Button>
          </div>
          <p className="text-sm font-medium text-status-warning" role="alert">
            Token 仅显示这一次，关闭后无法再次查看；丢失只能重建数据源。请先复制保存。
          </p>
          <DialogFooter>
            <Button onClick={() => setToken(null)}>我已保存，关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 16 号稿 B4：接入健康概览带（每源诊断；老列表保留在其下） */}
      <HealthBand />
      {/* 09-13 审计修复：loading / error / empty 三态分离，失败不再伪装成「暂无数据源」 */}
      {list.error ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-status-danger/40 p-8 text-sm" role="alert">
          <span className="text-status-danger">数据源列表加载失败：{list.error}</span>
          <Button size="sm" variant="outline" onClick={() => list.retry()}>
            <RotateCw className="size-3.5" /> 重试
          </Button>
        </div>
      ) : list.loading && !list.data ? (
        <div className="rounded-md border p-8 text-center text-sm text-muted-foreground">加载中…</div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>类型</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>最近拉取</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium">{s.name}</TableCell>
                <TableCell>
                  <Badge variant="outline">
                    {(() => { const I = KIND_ICON[s.kind as keyof typeof KIND_ICON] ?? Webhook
                      return <I className="size-3" /> })()}
                    {KIND_LABEL[s.kind] ?? s.kind}
                  </Badge>
                </TableCell>
                <TableCell>{STATUS_LABEL[s.status] ?? s.status}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {s.last_poll_at ? new Date(s.last_poll_at).toLocaleString() : "—"}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => setTestTarget(s.id)}>
                      发送测试事件
                    </Button>
                    {PULL_KINDS.includes(s.kind) && (
                      <Button size="sm" variant="outline" disabled={polling === s.id}
                              onClick={() => void pollNow(s)}>
                        {polling === s.id ? "拉取中…" : "立即拉取"}
                      </Button>
                    )}
                    {/* 09-14 D3 拍板：治理入口=独立详情页（非抽屉） */}
                    <Button size="sm" variant="outline"
                            onClick={() => navigate(`/data-sources/${s.id}`)}>
                      <Settings2 className="size-3.5" /> 管理
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {!rows.length && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  暂无数据源。创建 Webhook 源后可用「发送测试事件」验证接入链路；
                  拉取型源由平台按设定间隔自动拉取，也可在列表中「立即拉取」。
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}

      {testTarget && (
        <div className="rounded-md border p-3">
          <Label htmlFor="ds-test-payload">测试 payload（JSON）</Label>
          <Textarea id="ds-test-payload" rows={3} className="mt-1"
                    value={testPayload} onChange={(e) => setTestPayload(e.target.value)} />
          <div className="mt-2 flex items-center gap-2">
            <Button
              size="sm"
              onClick={async () => {
                // 09-13 审计修复：JSON 不合法与后端拒绝分别提示，不再统一「发送失败」
                let payload: Record<string, unknown>
                try {
                  payload = JSON.parse(testPayload) as Record<string, unknown>
                } catch (e) {
                  toast.error(`测试 payload 不是合法 JSON：${(e as Error).message}`)
                  return
                }
                try {
                  const r = await asApi.testEvent(testTarget, payload)
                  toast.success(`事件已接收（${r.status}）${r.dispatch_ref ? `，派发 ${r.dispatch_ref.slice(0, 8)}` : "，无匹配路由（可在事件流水查看 filtered 证据）"}`)
                  setTestTarget(null)
                } catch (e) {
                  toast.error(`后端拒绝：${(e as Error).message}`)
                }
              }}
            >
              发送
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setTestTarget(null)}>收起</Button>
          </div>
        </div>
      )}
          </TabsContent>
      <TabsContent value="events" className="flex flex-col gap-4">
        <EventsTab />
      </TabsContent>
      </Tabs>
</div>
  )
}


/** 09-14 冗余整合：事件流水 tab——跨源 EventDelivery 一览（状态/重试/死信证据）。 */
function EventsTab() {
  const deliveries = useAsyncData(() => asApi.eventDeliveries({ pageSize: 100 }), [])
  /* 后端 EventDelivery.status 为小写（pending/running/completed/failed/dead）；
     filtered/deduped 不产生投递行（F5 AC-023/024），故不在此表 */
  const ICON: Record<string, typeof Clock> = {
    completed: CircleCheck, failed: CircleX, dead: OctagonAlert,
    running: Clock, pending: Clock,
  }
  const LABEL: Record<string, string> = {
    pending: "待投递", running: "投递中", completed: "已投递",
    failed: "失败（待重试）", dead: "死信",
  }
  return (
    <div className="flex flex-col gap-3">
      {deliveries.error ? (
        <div className="rounded-md border px-3 py-2 text-sm" style={{ color: "var(--status-danger-text)" }}>
          事件流水加载失败：{deliveries.error}
        </div>
      ) : (deliveries.data?.items ?? []).length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
          暂无事件流水。数据源产生事件后，每条命中路由会产生一条投递记录（含重试与死信证据；filtered/deduped 不留投递行，证据在事件 route_outcomes）。
        </p>
      ) : (
        <table className="w-full border-collapse bg-card text-[12.5px]" style={{ border: "1px solid var(--border)" }}>
          <thead>
            <tr className="border-b text-left text-[11px] text-muted-foreground" style={{ background: "var(--surface-muted)" }}>
              <th className="px-3 py-2 font-medium">时间</th>
              <th className="px-3 py-2 font-medium">状态</th>
              <th className="px-3 py-2 font-medium">目的地</th>
              <th className="px-3 py-2 font-medium">尝试</th>
              <th className="px-3 py-2 font-medium">备注</th>
              <th className="px-3 py-2 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {(deliveries.data?.items ?? []).map((d) => {
              const Icon = ICON[d.status] ?? Clock
              return (
                <tr key={d.id} className="border-b last:border-b-0" style={{ borderColor: "var(--border)" }}>
                  <td className="px-3 py-2 tabular-nums text-(--text-tertiary)">
                    {d.createdAt ? new Date(d.createdAt).toLocaleString() : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1.5">
                      <Icon className="size-3.5" style={{ color: d.status === "completed" ? "var(--status-success-text)" : d.status === "dead" || d.status === "failed" ? "var(--status-danger-text)" : "var(--status-warning-text)" }} />
                      {LABEL[d.status] ?? d.status}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {d.destinationKind ?? "—"}{d.destinationId ? ` · ${String(d.destinationId).slice(0, 8)}…` : ""}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{d.attempts}/{d.maxAttempts}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {d.deadReason || d.error || (d.nextRetryAt ? `下次重试 ${new Date(d.nextRetryAt).toLocaleTimeString()}` : "")}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {(d.status === "failed" || d.status === "dead") && (
                      <button className="rounded border px-1.5 py-0.5 hover:bg-muted"
                              onClick={async () => {
                                try {
                                  await asApi.deliveryRetry(d.id)
                                  toast.success("已重发")
                                  deliveries.retry()
                                } catch (e) {
                                  toast.error(`${(e as Error).message}`)
                                }
                              }}>重试</button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
