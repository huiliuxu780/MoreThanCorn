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
import { Copy, Plus, RotateCw } from "lucide-react"
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
import { asApi, type CreateSourceBody, type SourceRow } from "@/services/as-api"
import { useAsyncData } from "@/hooks/use-async-data"
import { toast } from "sonner"

const KIND_LABEL: Record<string, string> = {
  webhook: "Webhook",
  polling: "轮询",
  test_event: "测试事件",
}
const STATUS_LABEL: Record<string, string> = {
  active: "活跃",
  paused: "已暂停",
  error: "异常",
}
const FILTER_OPS = ["eq", "ne", "contains", "gt", "lt"] as const

interface FormState {
  name: string
  kind: "webhook" | "polling" | "test_event"
  url: string
  interval: string
  cursorField: string
  cursorParam: string
  mapping: string
  filter: string
}

const EMPTY_FORM: FormState = {
  name: "",
  kind: "webhook",
  url: "",
  interval: "300",
  cursorField: "id",
  cursorParam: "after",
  mapping: '{"value":"body.text"}',
  filter: "",
}

export default function DataSourcesPage() {
  const list = useAsyncData((o) => asApi.sources(o?.signal), [])
  const [open, setOpen] = React.useState(false)
  const [form, setForm] = React.useState<FormState>(EMPTY_FORM)
  const [token, setToken] = React.useState<string | null>(null)
  const [testPayload, setTestPayload] = React.useState('{"topic":"billing","id":"evt-demo-1"}')
  const [testTarget, setTestTarget] = React.useState<string | null>(null)
  const [creating, setCreating] = React.useState(false)
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
    if (form.kind === "polling") {
      const url = form.url.trim()
      if (!/^https?:\/\//.test(url)) {
        toast.error("轮询源必须填写 http(s):// 拉取地址")
        return
      }
      const interval = Number(form.interval)
      if (!Number.isFinite(interval) || interval < 10) {
        toast.error("轮询间隔须为 ≥10 秒的数字")
        return
      }
      config.url = url
      config.interval_seconds = interval
      config.cursor_field = form.cursorField.trim() || "id"
      config.cursor_param = form.cursorParam.trim() || "after"
    }
    setCreating(true)
    try {
      const r = await asApi.createSource({ name: form.name.trim(), kind: form.kind, config })
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

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
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
                  <SelectItem value="webhook">Webhook（外部推送）</SelectItem>
                  <SelectItem value="polling">轮询（平台拉取）</SelectItem>
                  <SelectItem value="test_event">测试事件</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.kind === "polling" && (
              <>
                <div className="grid gap-1">
                  <Label htmlFor="ds-url">拉取 URL（返回 JSON 数组或单对象）</Label>
                  <Input id="ds-url" placeholder="https://example.internal/api/tickets"
                         value={form.url} onChange={(e) => set({ url: e.target.value })} />
                </div>
                <div className="grid grid-cols-3 gap-2">
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
                </div>
                <p className="text-xs text-muted-foreground">
                  轮询目标须为可匿名 GET 的接口；带鉴权拉取（复用 Connection 凭据与统一出网策略）属后续切片。
                </p>
              </>
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
                  <Badge variant="outline">{KIND_LABEL[s.kind] ?? s.kind}</Badge>
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
    </div>
  )
}
