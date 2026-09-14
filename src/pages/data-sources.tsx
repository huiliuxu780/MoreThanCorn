/**
 * 数据接入（2026-09-09 换底 §五-G；09-13 审计修复轮重写）：
 * webhook/polling/test_event 数据源管理。
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
 * 诚实边界：轮询拉取暂不支持鉴权头（后端匿名 GET），表单如实说明，不摆假字段。
 */
import * as React from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { CircleCheck, CircleX, Clock, CloudDownload, Copy, Database, Filter, FlaskConical, OctagonAlert, Plus, RotateCw, ScrollText, Settings2, Table as TableIcon, Webhook } from "lucide-react"
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
import { asApi, type CreateSourceBody, type SourceRow } from "@/services/as-api"
import { connApi } from "@/services/resource-api"
import { WfConnectionsContent } from "./wf-connections"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAsyncData } from "@/hooks/use-async-data"
import { toast } from "sonner"

/* 09-14 用户拍板类型体系：maxcompute / api 拉取 / webhook / 飞书多维表格（+测试事件工具） */
const KIND_LABEL: Record<string, string> = {
  webhook: "Webhook",
  api_pull: "API（拉取）",
  maxcompute: "MaxCompute",
  feishu_bitable: "飞书多维表格",
  sls: "SLS 日志",
  test_event: "测试事件",
}
const KIND_ICON = {
  webhook: Webhook, api_pull: CloudDownload, maxcompute: Database,
  feishu_bitable: TableIcon, sls: ScrollText, test_event: FlaskConical,
} as const
const STATUS_LABEL: Record<string, string> = {
  active: "活跃",
  paused: "已暂停",
  error: "异常",
}
const FILTER_OPS = ["eq", "ne", "contains", "gt", "lt"] as const

interface FormState {
  name: string
  kind: "webhook" | "api_pull" | "maxcompute" | "feishu_bitable" | "sls" | "test_event"
  url: string
  interval: string
  cursorField: string
  cursorParam: string
  endpoint: string
  project: string
  table: string
  appToken: string
  tableId: string
  viewId: string
  logstore: string
  slsQuery: string
  connId: string
  tablePick: string
  pageSize: string
  secretJson: string
  mapping: string
  filter: string
}

const EMPTY_FORM: FormState = {
  name: "",
  kind: "webhook",
  endpoint: "",
  project: "",
  table: "",
  appToken: "",
  tableId: "",
  viewId: "",
  logstore: "",
  slsQuery: "",
  connId: "",
  tablePick: "",
  pageSize: "100",
  secretJson: "",
  url: "",
  interval: "300",
  cursorField: "id",
  cursorParam: "after",
  mapping: '{"value":"body.text"}',
  filter: "",
}

export default function DataSourcesPage() {
  const navigate = useNavigate()
  const list = useAsyncData((o) => asApi.sources(o?.signal), [])
  const [open, setOpen] = React.useState(false)
  const [form, setForm] = React.useState<FormState>(EMPTY_FORM)
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
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }))

  const create = async () => {
    if (!form.name.trim()) {
      toast.error("请填写名称")
      return
    }
    let mapping: Record<string, string> | undefined
    try {
      const parsed = JSON.parse(form.mapping || "{}") as unknown
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        toast.error("字段映射必须是 JSON 对象：{触发输入键: payload 路径}")
        return
      }
      const bad = Object.entries(parsed as Record<string, unknown>).find(([, v]) => typeof v !== "string")
      if (bad) {
        toast.error(`字段映射的值必须是 payload 路径字符串（键「${bad[0]}」不是）`)
        return
      }
      mapping = parsed as Record<string, string>
    } catch (e) {
      toast.error(`字段映射 JSON 不合法：${(e as Error).message}`)
      return
    }
    let filter: CreateSourceBody["config"]["filter"] | undefined
    if (form.filter.trim()) {
      try {
        const parsed = JSON.parse(form.filter) as { field?: string; op?: string; value?: unknown }
        if (!parsed.field || !parsed.op) {
          toast.error('过滤条件需要 {"field","op","value"} 三个键')
          return
        }
        if (!(FILTER_OPS as readonly string[]).includes(parsed.op)) {
          toast.error(`过滤 op 只支持 ${FILTER_OPS.join("|")}（未知 op 会被拒绝而非放行）`)
          return
        }
        filter = { field: parsed.field, op: parsed.op, value: parsed.value }
      } catch (e) {
        toast.error(`过滤条件 JSON 不合法：${(e as Error).message}`)
        return
      }
    }
    const config: CreateSourceBody["config"] = {}
    if (mapping && Object.keys(mapping).length) config.mapping = mapping
    if (filter) config.filter = filter
    if (form.kind === "api_pull") {
      const url = form.url.trim()
      if (!/^https?:\/\//.test(url)) {
        toast.error("API 拉取源必须填写 http(s):// 地址")
        return
      }
      const interval = Number(form.interval)
      if (!Number.isFinite(interval) || interval < 10) {
        toast.error("拉取间隔须为 ≥10 秒的数字")
        return
      }
      config.url = url
      config.interval_seconds = interval
      config.cursor_field = form.cursorField.trim() || "id"
      config.cursor_param = form.cursorParam.trim() || "after"
      config.page_size = Number(form.pageSize) || 100
    }
    if (form.kind === "maxcompute") {
      if (form.connId) {
        if (!form.tablePick) {
          toast.error("请从目录选择表")
          return
        }
        config.table = form.tablePick
      } else if (!form.endpoint.trim() || !form.project.trim() || !form.table.trim()) {
        toast.error("MaxCompute 源需要 endpoint / project / table（或选择 Connection）")
        return
      }
      config.endpoint = form.endpoint.trim()
      config.project = form.project.trim()
      config.table = form.table.trim()
      config.page_size = Number(form.pageSize) || 100
    }
    if (form.kind === "feishu_bitable") {
      if (!form.appToken.trim() || !form.tableId.trim()) {
        toast.error("飞书多维表格源需要 app_token 与 table_id")
        return
      }
      config.app_token = form.appToken.trim()
      config.table_id = form.tableId.trim()
      if (form.viewId.trim()) config.view_id = form.viewId.trim()
      config.page_size = Number(form.pageSize) || 100
    }
    if (form.kind === "sls") {
      if (form.connId) {
        if (!form.tablePick) {
          toast.error("请从目录选择 logstore")
          return
        }
        config.logstore = form.tablePick
      } else if (!form.endpoint.trim() || !form.project.trim() || !form.logstore.trim()) {
        toast.error("SLS 源需要 endpoint / project / logstore（或选择 Connection）")
        return
      }
      config.endpoint = form.endpoint.trim()
      config.project = form.project.trim()
      config.logstore = form.logstore.trim()
      if (form.slsQuery.trim()) config.query = form.slsQuery.trim()
      config.page_size = Number(form.pageSize) || 100
    }
    let secret: Record<string, unknown> | undefined
    if (!form.connId && form.secretJson.trim()) {
      try {
        secret = JSON.parse(form.secretJson) as Record<string, unknown>
      } catch (e) {
        toast.error(`凭据 JSON 不合法：${(e as Error).message}`)
        return
      }
    }
    setCreating(true)
    try {
      const r = await asApi.createSource({
        name: form.name.trim(), kind: form.kind, config,
        ...(form.connId ? { connection_id: form.connId } : {}),
        ...(secret ? { secret } : {}),
      })
      setOpen(false)
      setForm(EMPTY_FORM)
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
      {/* 09-14 用户拍板（冗余整合）：数据接入=单入口三 tab——数据源/连接与目录/事件流水；
          Connections 自设置页并入此处，消除三处分散 */}
      <Tabs value={tab} onValueChange={(v) => { setTab(v); setSearchParams((p) => { const n = new URLSearchParams(p); if (v === "sources") n.delete("tab"); else n.set("tab", v); return n }, { replace: true }) }}>
        <TabsList>
          <TabsTrigger value="sources">数据源</TabsTrigger>
          <TabsTrigger value="connections">连接与目录</TabsTrigger>
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
            Webhook / 轮询 / 测试事件源；同一数据源可服务多个自动任务，去重与死信在事件层治理。
          </p>
        </div>
        <Button className="ml-auto" onClick={() => setOpen(true)}>
          <Plus className="size-4" /> 新建数据源
        </Button>
      </header>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建数据源</DialogTitle>
            <DialogDescription>
              Webhook 由外部系统推送（token 鉴权）；轮询由平台按间隔拉取；测试事件用于链路验证。
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
              <Select value={form.kind} onValueChange={(v) => set({ kind: v as FormState["kind"] })}>
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
            {form.kind === "api_pull" && (
              <>
                <div className="grid gap-1">
                  <Label htmlFor="ds-url">拉取 URL（返回 JSON 数组或 {`{items:[…]}`}）</Label>
                  <Input id="ds-url" placeholder="https://example.internal/api/tickets"
                         value={form.url} onChange={(e) => set({ url: e.target.value })} />
                </div>
                <div className="grid grid-cols-4 gap-2">
                  <div className="grid gap-1">
                    <Label htmlFor="ds-interval">间隔（秒）</Label>
                    <Input id="ds-interval" inputMode="numeric" value={form.interval}
                           onChange={(e) => set({ interval: e.target.value })} />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor="ds-cursor-field">游标字段</Label>
                    <Input id="ds-cursor-field" value={form.cursorField}
                           onChange={(e) => set({ cursorField: e.target.value })} />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor="ds-cursor-param">游标参数名</Label>
                    <Input id="ds-cursor-param" value={form.cursorParam}
                           onChange={(e) => set({ cursorParam: e.target.value })} />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor="ds-pagesize">页大小</Label>
                    <Input id="ds-pagesize" inputMode="numeric" value={form.pageSize}
                           onChange={(e) => set({ pageSize: e.target.value })} />
                  </div>
                </div>
              </>
            )}
            {(form.kind === "maxcompute" || form.kind === "sls") && (
              <div className="grid gap-1">
                <Label id="ds-conn-label">Connection（凭据与端点，可选）</Label>
                <Select value={form.connId} onValueChange={(v) => { set({ connId: v, tablePick: "" }); void loadCatalog(v) }}>
                  <SelectTrigger id="ds-conn" aria-labelledby="ds-conn-label">
                    <SelectValue placeholder="选择连接后从目录选表；不选则手工配置" />
                  </SelectTrigger>
                  <SelectContent>
                    {conns.filter((c) => c.protocol === form.kind).map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {(form.kind === "maxcompute" || form.kind === "sls") && form.connId && (
              <div className="grid gap-1">
                <Label id="ds-pick-label">{form.kind === "sls" ? "Logstore（目录发现）" : "表（目录发现）"}</Label>
                <Select value={form.tablePick} onValueChange={(v) => set({ tablePick: v })}>
                  <SelectTrigger id="ds-pick" aria-labelledby="ds-pick-label">
                    <SelectValue placeholder={catalogErr ? "目录发现失败" : "选择表/日志库"} />
                  </SelectTrigger>
                  <SelectContent>
                    {catalogItems.map((it) => (
                      <SelectItem key={it.name} value={it.name}>{it.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {catalogErr && (
                  <p className="text-xs" style={{ color: "var(--status-danger-text)" }}>{catalogErr}</p>
                )}
              </div>
            )}
            {form.kind === "maxcompute" && !form.connId && (
              <>
                <div className="grid gap-1">
                  <Label htmlFor="ds-endpoint">Endpoint</Label>
                  <Input id="ds-endpoint" placeholder="https://service.cn-shanghai.maxcompute.aliyun.com/api"
                         value={form.endpoint} onChange={(e) => set({ endpoint: e.target.value })} />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="grid gap-1">
                    <Label htmlFor="ds-project">Project</Label>
                    <Input id="ds-project" value={form.project}
                           onChange={(e) => set({ project: e.target.value })} />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor="ds-table">Table</Label>
                    <Input id="ds-table" value={form.table}
                           onChange={(e) => set({ table: e.target.value })} />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor="ds-pagesize">页大小</Label>
                    <Input id="ds-pagesize" inputMode="numeric" value={form.pageSize}
                           onChange={(e) => set({ pageSize: e.target.value })} />
                  </div>
                </div>
              </>
            )}
            {form.kind === "feishu_bitable" && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div className="grid gap-1">
                    <Label htmlFor="ds-apptoken">app_token（多维表格 token）</Label>
                    <Input id="ds-apptoken" value={form.appToken}
                           onChange={(e) => set({ appToken: e.target.value })} />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor="ds-tableid">table_id（数据表）</Label>
                    <Input id="ds-tableid" value={form.tableId}
                           onChange={(e) => set({ tableId: e.target.value })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="grid gap-1">
                    <Label htmlFor="ds-viewid">view_id（可选）</Label>
                    <Input id="ds-viewid" value={form.viewId}
                           onChange={(e) => set({ viewId: e.target.value })} />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor="ds-pagesize">页大小</Label>
                    <Input id="ds-pagesize" inputMode="numeric" value={form.pageSize}
                           onChange={(e) => set({ pageSize: e.target.value })} />
                  </div>
                </div>
              </>
            )}
            {form.kind === "sls" && !form.connId && (
              <>
                <div className="grid gap-1">
                  <Label htmlFor="ds-endpoint">Endpoint</Label>
                  <Input id="ds-endpoint" placeholder="cn-shanghai.log.aliyuncs.com"
                         value={form.endpoint} onChange={(e) => set({ endpoint: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="grid gap-1">
                    <Label htmlFor="ds-project">Project</Label>
                    <Input id="ds-project" value={form.project}
                           onChange={(e) => set({ project: e.target.value })} />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor="ds-logstore">Logstore</Label>
                    <Input id="ds-logstore" value={form.logstore}
                           onChange={(e) => set({ logstore: e.target.value })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="grid gap-1">
                    <Label htmlFor="ds-slsquery">查询语句（可选）</Label>
                    <Input id="ds-slsquery" placeholder="* 或 status: 500"
                           value={form.slsQuery} onChange={(e) => set({ slsQuery: e.target.value })} />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor="ds-pagesize">页大小</Label>
                    <Input id="ds-pagesize" inputMode="numeric" value={form.pageSize}
                           onChange={(e) => set({ pageSize: e.target.value })} />
                  </div>
                </div>
              </>
            )}
            {form.kind !== "webhook" && form.kind !== "test_event" && !form.connId && (
              <div className="grid gap-1">
                <Label htmlFor="ds-secret">凭据 JSON（加密存储，永不回显；选 Connection 后由连接承载）</Label>
                <Textarea id="ds-secret" rows={2} placeholder={
                  form.kind === "feishu_bitable"
                    ? '{"app_id":"cli_x","app_secret":"…"}'
                    : form.kind === "maxcompute" || form.kind === "sls"
                      ? '{"access_key_id":"…","access_key_secret":"…"}'
                      : '{"type":"bearer","token":"…"}'}
                  value={form.secretJson} onChange={(e) => set({ secretJson: e.target.value })} />
                <p className="text-xs text-muted-foreground">
                  服务端信封加密落库；也可创建后经详情页「凭据」卡设置/更换。
                </p>
              </div>
            )}
            <div className="grid gap-1">
              <Label htmlFor="ds-mapping">字段映射 JSON（触发输入键 → payload 取值路径）</Label>
              <Textarea id="ds-mapping" rows={3} value={form.mapping}
                        onChange={(e) => set({ mapping: e.target.value })} />
              <p className="text-xs text-muted-foreground">
                例：{"{\"value\":\"body.text\"}"} 表示把 payload 的 body.text 作为触发输入 value。
              </p>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="ds-filter">过滤条件 JSON（可选）</Label>
              <Input id="ds-filter" placeholder='{"field":"type","op":"eq","value":"ticket"}'
                     value={form.filter} onChange={(e) => set({ filter: e.target.value })} />
              <p className="text-xs text-muted-foreground">op 支持 {FILTER_OPS.join(" / ")}；不满足条件的事件不派发并留 filtered 证据。</p>
            </div>
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
                    {s.kind === "polling" && (
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
                  轮询源由平台按设定间隔自动拉取，也可在列表中「立即拉取」。
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
      <TabsContent value="connections" className="flex flex-col gap-4">
        <WfConnectionsContent embedded />
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
  const ICON: Record<string, typeof Clock> = {
    COMPLETED: CircleCheck, FAILED: CircleX, DEAD: OctagonAlert,
    RUNNING: Clock, PENDING: Clock, FILTERED: Filter, DEDUPED: Copy,
  }
  return (
    <div className="flex flex-col gap-3">
      {deliveries.error ? (
        <div className="rounded-md border px-3 py-2 text-sm" style={{ color: "var(--status-danger-text)" }}>
          事件流水加载失败：{deliveries.error}
        </div>
      ) : (deliveries.data?.items ?? []).length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
          暂无事件流水。Webhook/轮询源收到事件后，每条命中路由会产生一条投递记录（含重试与死信证据）。
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
                      <Icon className="size-3.5" style={{ color: d.status === "COMPLETED" ? "var(--status-success-text)" : d.status === "DEAD" || d.status === "FAILED" ? "var(--status-danger-text)" : d.status === "FILTERED" || d.status === "DEDUPED" ? "var(--text-tertiary)" : "var(--status-warning-text)" }} />
                      {d.status}
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
