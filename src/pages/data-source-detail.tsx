/**
 * 数据源独立详情页（09-14 D3 用户拍板：抽屉改独立页，映射行编辑器给足空间）。
 * 原型：docs/v2-design/prototypes/audit-rework-d1-d4-v1.html #d3（v2）。
 * 左列：字段映射行编辑器 / 过滤条件 / 接收配置（webhook 只读+限速，polling 可编辑+立即拉取）；
 * 右列：Token（重新生成一次性展示）/ 事件路由 / 事件流水（结果 icon + 重试）。
 */
import * as React from "react"
import { useNavigate, useParams } from "react-router-dom"
import { EMPTY_ROUTE_FORM, RouteForm, type RouteFormValue } from "@/components/ingress/route-form"
import {
  ArrowLeft, CloudDownload, Copy, Database, Filter,
  FlaskConical, History, KeyRound, Pause, Play, Plus,
  Route as RouteIcon, ScrollText, Table as TableIcon, Trash2, Webhook,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { asApi, type EventDeliveryDTO, type EventRouteDTO } from "@/services/as-api"
import { connApi, resApi } from "@/services/resource-api"
import { useAsyncData } from "@/hooks/use-async-data"
import { toast } from "sonner"

const KIND_ICON = {
  webhook: Webhook, api_pull: CloudDownload, maxcompute: Database,
  feishu_bitable: TableIcon, sls: ScrollText, test_event: FlaskConical,
} as const
const KIND_LABEL: Record<string, string> = {
  webhook: "Webhook", api_pull: "API（拉取）", maxcompute: "MaxCompute",
  feishu_bitable: "飞书多维表格", sls: "SLS 日志", test_event: "测试事件",
}
const PULL_KINDS = ["api_pull", "feishu_bitable", "maxcompute", "sls"]
const STATUS_LABEL: Record<string, string> = {
  active: "活跃", paused: "已暂停", error: "异常",
}
const FILTER_OPS = ["eq", "ne", "contains", "gt", "lt"] as const


const DELIVERY_LABEL: Record<string, string> = {
  COMPLETED: "已投递", DEAD: "死信", FAILED: "失败", RUNNING: "投递中",
  PENDING: "待派发", FILTERED: "已过滤", DEDUPED: "已去重",
}

function Card({ icon: Icon, title, extra, children }: {
  icon: typeof KeyRound; title: string; extra?: React.ReactNode; children: React.ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-xl border bg-card" style={{ borderColor: "var(--border)" }}>
      <header className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
        <Icon className="size-4 text-muted-foreground" />
        <h2 className="text-[13px] font-semibold">{title}</h2>
        <span className="ml-auto">{extra}</span>
      </header>
      <div className="p-4">{children}</div>
    </section>
  )
}

/** 16 号稿 B4：路由创建入口（全站首个路由创建 UI；向导步④同用 RouteForm）。 */
function RouteCreateBox({ sid, onCreated }: { sid: string; onCreated: () => void }) {
  const [open, setOpen] = React.useState(false)
  const [form, setForm] = React.useState<RouteFormValue>(EMPTY_ROUTE_FORM)
  const [saving, setSaving] = React.useState(false)
  if (!open) {
    return (
      <Button size="xs" variant="outline" className="mb-2" onClick={() => setOpen(true)}>
        <Plus className="size-3" /> 新建路由
      </Button>
    )
  }
  return (
    <div className="mb-3 grid gap-2 rounded-md border p-3" style={{ borderColor: "var(--border)", background: "var(--surface-muted)" }}>
      <RouteForm value={form} set={(p) => setForm((f) => ({ ...f, ...p }))} idp="dtl" />
      <div className="flex gap-2">
        <Button size="xs" disabled={saving} onClick={() => {
          if (!form.destId) { toast.error("请选择目的地实例"); return }
          setSaving(true)
          asApi.createRoute({ sourceId: sid, destination: { kind: form.destKind, id: form.destId } })
            .then(() => { toast.success("路由已创建"); setForm(EMPTY_ROUTE_FORM); setOpen(false); onCreated() })
            .catch((e) => toast.error(`创建失败：${(e as Error).message}`))
            .finally(() => setSaving(false))
        }}>保存路由</Button>
        <Button size="xs" variant="ghost" onClick={() => setOpen(false)}>取消</Button>
      </div>
    </div>
  )
}

export default function DataSourceDetailPage() {
  const { sid = "" } = useParams()
  const navigate = useNavigate()
  const src = useAsyncData(() => asApi.sourceGet(sid), [sid])
  const routes = useAsyncData(
    () => asApi.eventRoutes({ sourceId: sid, includeArchived: "yes" }), [sid])
  const deliveries = useAsyncData(
    () => asApi.eventDeliveries({ sourceId: sid, pageSize: 50 }), [sid])

  const cfg = (src.data?.config ?? {}) as Record<string, unknown>
  const [rotateSecret, setRotateSecret] = React.useState("")
  const [rotating, setRotating] = React.useState(false)
  const [mappingRows, setMappingRows] = React.useState<{ key: string; path: string }[] | null>(null)
  const [filterRow, setFilterRow] = React.useState<
    { field: string; op: string; value: string } | null | undefined>(undefined)
  const [pollUrl, setPollUrl] = React.useState<string | null>(null)
  const [pollInterval, setPollInterval] = React.useState<string | null>(null)
  const [mc, setMc] = React.useState<{ endpoint: string; project: string; table: string } | null>(null)
  const [fs, setFs] = React.useState<{ app_token: string; table_id: string; view_id: string } | null>(null)
  const [secretOpen, setSecretOpen] = React.useState(false)
  // D5：Connection/DataAsset 引用展示与切换
  const [assets, setAssets] = React.useState<{ id: string; name: string; location: string }[]>([])
  const [connName, setConnName] = React.useState<string | null>(null)
  const [secretJson, setSecretJson] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [newToken, setNewToken] = React.useState<string | null>(null)
  const [delOpen, setDelOpen] = React.useState(false)
  const [delRefs, setDelRefs] = React.useState<{ kind: string; count: number }[] | null>(null)
  const [testOpen, setTestOpen] = React.useState(false)
  const [testPayload, setTestPayload] = React.useState('{"topic":"billing","id":"evt-demo-1"}')

  // 服务端值 → 编辑器初值（仅首次加载填充）
  React.useEffect(() => {
    if (!src.data) return
    const m = (cfg.mapping ?? {}) as Record<string, unknown>
    if (mappingRows === null) {
      setMappingRows(Object.entries(m).map(([key, path]) =>
        ({ key, path: String(path) })))
    }
    if (filterRow === undefined) {
      const f = (cfg.filter ?? {}) as Record<string, unknown>
      setFilterRow(f.field ? { field: String(f.field), op: String(f.op ?? "eq"),
                               value: String(f.value ?? "") } : null)
    }
    if (pollUrl === null) setPollUrl(String(cfg.url ?? ""))
    if (pollInterval === null) setPollInterval(String(cfg.interval_seconds ?? "300"))
    if (src.data.connectionId) {
      connApi.get(src.data.connectionId).then((c) => setConnName(c.name)).catch(() => setConnName(null))
    }
    resApi.list("asset", { pageSize: 200 }).then((r) =>
      setAssets(r.items.map((x) => ({ id: x.id, name: x.name,
        location: String((x as unknown as { location?: string }).location ?? "") }))))
      .catch(() => setAssets([]))
    if (mc === null) setMc({ endpoint: String(cfg.endpoint ?? ""),
                            project: String(cfg.project ?? ""),
                            table: String(cfg.table ?? "") })
    if (fs === null) setFs({ app_token: String(cfg.app_token ?? ""),
                            table_id: String(cfg.table_id ?? ""),
                            view_id: String(cfg.view_id ?? "") })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src.data])

  const saveMapping = async () => {
    const mapping: Record<string, string> = {}
    for (const r of mappingRows ?? []) {
      if (!r.key.trim()) continue
      if (mapping[r.key.trim()]) {
        toast.error(`映射键重复：${r.key.trim()}（保存报 422 的同款校验前置）`)
        return
      }
      mapping[r.key.trim()] = r.path
    }
    setSaving(true)
    try {
      await asApi.sourcePatch(sid, { config: { ...cfg, mapping } })
      toast.success("字段映射已保存")
      src.retry()
    } catch (e) {
      toast.error(`保存失败：${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  const saveFilter = async () => {
    const filter = filterRow && filterRow.field.trim()
      ? { field: filterRow.field.trim(), op: filterRow.op, value: filterRow.value }
      : null
    if (filter && !(FILTER_OPS as readonly string[]).includes(filter.op)) {
      toast.error(`op 只支持 ${FILTER_OPS.join("|")}（fail-closed：未知 op 保存即拒）`)
      return
    }
    setSaving(true)
    try {
      await asApi.sourcePatch(sid, { config: { ...cfg, filter: filter ?? {} } })
      toast.success("过滤条件已保存")
      src.retry()
    } catch (e) {
      toast.error(`保存失败：${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  const savePolling = async () => {
    const interval = Number(pollInterval)
    if (!pollUrl || !/^https?:\/\//.test(pollUrl)) {
      toast.error("拉取 URL 必须为 http(s) 地址")
      return
    }
    if (!Number.isFinite(interval) || interval < 10) {
      toast.error("轮询间隔须为 ≥10 秒的数字")
      return
    }
    setSaving(true)
    try {
      await asApi.sourcePatch(sid, {
        config: { ...cfg, url: pollUrl, interval_seconds: interval },
      })
      toast.success("接收配置已保存")
      src.retry()
    } catch (e) {
      toast.error(`保存失败：${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  const togglePause = async () => {
    const next = src.data?.status === "active" ? "paused" : "active"
    try {
      await asApi.sourcePatch(sid, { status: next })
      toast.success(next === "paused" ? "已暂停接收" : "已恢复接收")
      src.retry()
    } catch (e) {
      toast.error(`${(e as Error).message}`)
    }
  }

  const doDelete = async () => {
    try {
      await asApi.sourceDelete(sid)
      toast.success("数据源已归档")
      navigate("/resources/data")
    } catch (e) {
      const detail = (e as Error & { detail?: { references?: { kind: string; count: number }[] } }).detail
      if (detail?.references) {
        setDelRefs(detail.references)
      } else {
        toast.error(`${(e as Error).message}`)
        setDelOpen(false)
      }
    }
  }

  if (src.error) {
    return (
      <div className="flex flex-col items-center gap-3 p-10 text-sm">
        <span className="text-status-danger">数据源加载失败：{src.error}</span>
        <Button size="sm" variant="outline" onClick={() => src.retry()}>重试</Button>
        <Button size="sm" variant="ghost" onClick={() => navigate("/resources/data")}>返回列表</Button>
      </div>
    )
  }
  if (!src.data) {
    return <div className="p-10 text-sm text-muted-foreground">加载中…</div>
  }

  const KindIcon = KIND_ICON[src.data.kind as keyof typeof KIND_ICON] ?? Webhook
  const isPull = PULL_KINDS.includes(src.data.kind)

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <div className="text-xs text-muted-foreground">
        <button className="inline-flex items-center gap-1 hover:text-foreground"
                onClick={() => navigate("/resources/data")}>
          <ArrowLeft className="size-3" /> 数据接入
        </button>
        <span className="opacity-50"> / </span>
        <b className="text-foreground">{src.data.name}</b>
      </div>

      <header className="flex flex-wrap items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-[10px]"
              style={{ background: "var(--brand-soft)", color: "var(--brand-primary)" }}>
          <KindIcon className="size-5" />
        </span>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold">{src.data.name}</h1>
            <Badge variant="outline"><KindIcon className="size-3" />{KIND_LABEL[src.data.kind]}</Badge>
            <Badge variant={src.data.status === "active" ? "secondary"
              : src.data.status === "error" ? "destructive" : "outline"}>
              {STATUS_LABEL[src.data.status] ?? src.data.status}
            </Badge>
            {src.data.archived && <Badge variant="outline">已归档</Badge>}
          </div>
          <div className="text-[11px] text-(--text-tertiary)">
            {src.data.id} · 限速 {String(cfg.rate_limit_per_min ?? 60)}/min · 体积上限 256KB
          </div>
        </div>
        <span className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={() => void togglePause()}>
            {src.data.status === "active"
              ? <><Pause className="size-3.5" /> 暂停接收</>
              : <><Play className="size-3.5" /> 恢复接收</>}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setTestOpen(true)}>发送测试事件</Button>
          {isPull && (
            <Button size="sm" variant="outline" onClick={async () => {
              try {
                const r = await asApi.pollSource(sid)
                toast.success(`拉取完成：${r.polled} 条，派发 ${r.dispatched} 条`)
                deliveries.retry()
              } catch (e) {
                toast.error(`拉取失败：${(e as Error).message}`)
              }
            }}>立即拉取</Button>
          )}
          <Button size="sm" variant="outline" className="text-(--status-danger-text)"
                  onClick={() => { setDelRefs(null); setDelOpen(true) }}>
            <Trash2 className="size-3.5" /> 删除数据源…
          </Button>
        </span>
      </header>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        {/* ── 左列 ── */}
        <div className="flex flex-col gap-4">
          <Card icon={Copy} title="字段映射"
                extra={<span className="text-[11px] text-muted-foreground">触发输入键 → payload 取值路径</span>}>
            <div className="flex flex-col gap-2">
              {(mappingRows ?? []).map((r, i) => (
                <div key={i} className="grid grid-cols-[200px_24px_1fr_32px] items-center gap-2">
                  <Input aria-label="触发输入键" value={r.key}
                         onChange={(e) => setMappingRows((rows) => (rows ?? []).map(
                           (x, j) => (j === i ? { ...x, key: e.target.value } : x)))} />
                  <span className="text-center text-(--text-tertiary)">←</span>
                  <Input aria-label="payload 取值路径" value={r.path}
                         onChange={(e) => setMappingRows((rows) => (rows ?? []).map(
                           (x, j) => (j === i ? { ...x, path: e.target.value } : x)))} />
                  <Button size="sm" variant="ghost" aria-label="删除行"
                          className="text-(--status-danger-text)"
                          onClick={() => setMappingRows((rows) => (rows ?? []).filter((_, j) => j !== i))}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline"
                        onClick={() => setMappingRows((rows) => [...(rows ?? []), { key: "", path: "" }])}>
                  <Plus className="size-3.5" /> 添加映射行
                </Button>
                <Button size="sm" variant="outline" disabled={saving} onClick={() => void saveMapping()}>
                  保存映射
                </Button>
                <span className="text-[11px] text-muted-foreground">空行保存时忽略；键重复前置拒绝</span>
              </div>
            </div>
          </Card>

          <Card icon={Filter} title="过滤条件"
                extra={<span className="text-[11px] text-muted-foreground">不满足的事件不派发，留「已过滤」证据</span>}>
            {filterRow ? (
              <div className="grid grid-cols-[1fr_120px_1fr_32px] items-center gap-2">
                <Input aria-label="字段" value={filterRow.field}
                       onChange={(e) => setFilterRow({ ...filterRow, field: e.target.value })} />
                <Select value={filterRow.op}
                        onValueChange={(v) => setFilterRow({ ...filterRow, op: v })}>
                  <SelectTrigger aria-label="操作符"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FILTER_OPS.map((op) => <SelectItem key={op} value={op}>{op}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input aria-label="值" value={filterRow.value}
                       onChange={(e) => setFilterRow({ ...filterRow, value: e.target.value })} />
                <Button size="sm" variant="ghost" aria-label="删除条件"
                        className="text-(--status-danger-text)"
                        onClick={() => setFilterRow(null)}>
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">无过滤条件（全部事件进入路由匹配）。</p>
            )}
            <div className="mt-2 flex items-center gap-2">
              {!filterRow && (
                <Button size="sm" variant="outline"
                        onClick={() => setFilterRow({ field: "", op: "eq", value: "" })}>
                  <Plus className="size-3.5" /> 添加条件
                </Button>
              )}
              <Button size="sm" variant="outline" disabled={saving} onClick={() => void saveFilter()}>
                保存过滤
              </Button>
              <span className="text-[11px] text-muted-foreground">未知 op 保存即拒（fail-closed）</span>
            </div>
          </Card>

          <Card icon={isPull ? CloudDownload : Webhook} title="接收配置">
            {src.data.kind === "api_pull" ? (
              <div className="grid gap-2">
                <div className="grid gap-1">
                  <Label htmlFor="ds-d-url">拉取 URL</Label>
                  <Input id="ds-d-url" value={pollUrl ?? ""} onChange={(e) => setPollUrl(e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="grid gap-1">
                    <Label htmlFor="ds-d-interval">间隔（秒）</Label>
                    <Input id="ds-d-interval" inputMode="numeric" value={pollInterval ?? ""}
                           onChange={(e) => setPollInterval(e.target.value)} />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor="ds-d-cursor">游标字段 / 参数名</Label>
                    <Input id="ds-d-cursor" readOnly
                           value={`${String(cfg.cursor_field ?? "id")} / ${String(cfg.cursor_param ?? "after")}`} />
                  </div>
                </div>
                <Button size="sm" variant="outline" className="w-fit" disabled={saving}
                        onClick={() => void savePolling()}>保存接收配置</Button>
              </div>
            ) : src.data.kind === "maxcompute" ? (
              <div className="grid gap-2">
                <div className="grid gap-1">
                  <Label htmlFor="ds-d-endpoint">Endpoint</Label>
                  <Input id="ds-d-endpoint" value={mc?.endpoint ?? ""}
                         onChange={(e) => setMc({ ...(mc ?? { endpoint: "", project: "", table: "" }), endpoint: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="grid gap-1">
                    <Label htmlFor="ds-d-project">Project</Label>
                    <Input id="ds-d-project" value={mc?.project ?? ""}
                           onChange={(e) => setMc({ ...(mc ?? { endpoint: "", project: "", table: "" }), project: e.target.value })} />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor="ds-d-table">Table</Label>
                    <Input id="ds-d-table" value={mc?.table ?? ""}
                           onChange={(e) => setMc({ ...(mc ?? { endpoint: "", project: "", table: "" }), table: e.target.value })} />
                  </div>
                </div>
                <Button size="sm" variant="outline" className="w-fit" disabled={saving}
                        onClick={async () => {
                          setSaving(true)
                          try {
                            await asApi.sourcePatch(sid, { config: { ...cfg, ...(mc ?? {}) } })
                            toast.success("接收配置已保存")
                            src.retry()
                          } catch (e) {
                            toast.error(`保存失败：${(e as Error).message}`)
                          } finally {
                            setSaving(false)
                          }
                        }}>保存接收配置</Button>
              </div>
            ) : src.data.kind === "sls" ? (
              <div className="grid gap-2">
                <div className="grid gap-1">
                  <Label htmlFor="ds-d-endpoint">Endpoint</Label>
                  <Input id="ds-d-endpoint" value={String(cfg.endpoint ?? "")}
                         onChange={(e) => setMc({ endpoint: e.target.value, project: String(cfg.project ?? ""), table: String(cfg.table ?? "") })} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="grid gap-1">
                    <Label htmlFor="ds-d-project">Project</Label>
                    <Input id="ds-d-project" value={String(cfg.project ?? "")} readOnly />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor="ds-d-logstore">Logstore</Label>
                    <Input id="ds-d-logstore" value={String(cfg.logstore ?? "")} readOnly />
                  </div>
                </div>
                <Button size="sm" variant="outline" className="w-fit" disabled={saving}
                        onClick={async () => {
                          setSaving(true)
                          try {
                            await asApi.sourcePatch(sid, { config: { ...cfg, ...(mc ?? {}) } })
                            toast.success("接收配置已保存")
                            src.retry()
                          } catch (e) {
                            toast.error(`保存失败：${(e as Error).message}`)
                          } finally {
                            setSaving(false)
                          }
                        }}>保存接收配置</Button>
                <p className="text-[11px] text-muted-foreground">
                  游标=时间+偏移（ts:offset）；查询语句在 config.query（创建时设置）。
                </p>
              </div>
            ) : src.data.kind === "feishu_bitable" ? (
              <div className="grid gap-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className="grid gap-1">
                    <Label htmlFor="ds-d-apptoken">app_token</Label>
                    <Input id="ds-d-apptoken" value={fs?.app_token ?? ""}
                           onChange={(e) => setFs({ ...(fs ?? { app_token: "", table_id: "", view_id: "" }), app_token: e.target.value })} />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor="ds-d-tableid">table_id</Label>
                    <Input id="ds-d-tableid" value={fs?.table_id ?? ""}
                           onChange={(e) => setFs({ ...(fs ?? { app_token: "", table_id: "", view_id: "" }), table_id: e.target.value })} />
                  </div>
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="ds-d-viewid">view_id（可选）</Label>
                  <Input id="ds-d-viewid" value={fs?.view_id ?? ""}
                         onChange={(e) => setFs({ ...(fs ?? { app_token: "", table_id: "", view_id: "" }), view_id: e.target.value })} />
                </div>
                <Button size="sm" variant="outline" className="w-fit" disabled={saving}
                        onClick={async () => {
                          setSaving(true)
                          try {
                            await asApi.sourcePatch(sid, { config: { ...cfg, ...(fs ?? {}) } })
                            toast.success("接收配置已保存")
                            src.retry()
                          } catch (e) {
                            toast.error(`保存失败：${(e as Error).message}`)
                          } finally {
                            setSaving(false)
                          }
                        }}>保存接收配置</Button>
              </div>
            ) : (
              <div className="grid gap-1.5 text-[12.5px]">
                <div className="flex gap-2">
                  <span className="w-20 shrink-0 text-muted-foreground">接收地址</span>
                  <code className="break-all">POST /api/v2/ingress/webhook/{sid}</code>
                </div>
                <div className="flex gap-2">
                  <span className="w-20 shrink-0 text-muted-foreground">鉴权</span>
                  <span>X-Source-Token 头（SHA-256 校验，恒定时间比较）</span>
                </div>
                <div className="flex gap-2">
                  <span className="w-20 shrink-0 text-muted-foreground">限速</span>
                  <span className="tabular-nums">{String(cfg.rate_limit_per_min ?? 60)} 次/分钟（映射键 rate_limit_per_min 可编辑）</span>
                </div>
              </div>
            )}
          </Card>
        </div>

        {/* ── 右列 ── */}
        <div className="flex flex-col gap-4">
          {src.data.kind === "webhook" && (
            <Card icon={KeyRound} title="Webhook Token">
              <div className="flex items-center gap-2 rounded-lg border px-3 py-2"
                   style={{ borderColor: "var(--border)", background: "var(--surface-muted)" }}>
                <code className="flex-1 break-all text-xs text-muted-foreground">
                  {src.data.has_token ? "whk_••••••••••••••••（已配置）" : "未配置"}
                </code>
                <Button size="sm" variant="outline" onClick={async () => {
                  try {
                    const r = await asApi.sourceRegenerateToken(sid)
                    setNewToken(r.webhook_token)
                  } catch (e) {
                    toast.error(`${(e as Error).message}`)
                  }
                }}>重新生成</Button>
              </div>
              <p className="mt-2 rounded-md px-2.5 py-1.5 text-xs"
                 style={{ background: "var(--status-warning-soft)", color: "var(--status-warning-text)" }}>
                重新生成后旧 token 即刻失效；新 token 仅显示一次，关闭后无法再查看。
              </p>
              <div className="mt-3 border-t pt-3" style={{ borderColor: "var(--border)" }}>
                <p className="mb-1 text-xs font-medium">
                  HMAC 签名密钥：{src.data.has_signing ? "已配置" : "未配置"}
                  {src.data.signing_prev_until
                    ? `（旧密钥双活至 ${src.data.signing_prev_until}）` : ""}
                </p>
                <div className="flex items-center gap-2">
                  <input
                    value={rotateSecret}
                    onChange={(e) => setRotateSecret(e.target.value)}
                    placeholder="新签名密钥（≥16 字符）"
                    className="h-8 flex-1 rounded-md border bg-transparent px-2 text-xs outline-none"
                    style={{ borderColor: "var(--border)" }}
                  />
                  <Button size="sm" variant="outline" disabled={rotateSecret.length < 16 || rotating}
                          onClick={async () => {
                            setRotating(true)
                            try {
                              const r = await asApi.setSigningSecret(sid, rotateSecret)
                              toast.success(r.rotated
                                ? `已轮换；旧密钥双活至 ${r.prev_active_until}`
                                : "签名密钥已配置")
                              setRotateSecret("")
                              src.retry()
                            } catch (e) {
                              toast.error(`${(e as Error).message}`)
                            } finally {
                              setRotating(false)
                            }
                          }}>
                    {src.data.has_signing ? "轮换（双活 24h）" : "配置"}
                  </Button>
                </div>
              </div>
            </Card>
          )}

          {src.data.kind !== "webhook" && src.data.kind !== "test_event" && (
            <Card icon={KeyRound} title="凭据归属">
              {/* 09-17 mpocket 借鉴：凭据正主=Connection（设置→连接），源只引用；
                  源级 secret 为 legacy 兼容路径，徽章+降级入口 */}
              <div className="grid gap-1.5 text-[12.5px]">
                <div className="flex items-center gap-2">
                  <span className="w-24 shrink-0 text-muted-foreground">凭据正主</span>
                  {src.data.connectionId ? (
                    <Button size="sm" variant="outline"
                            onClick={() => navigate("/settings/connections")}>
                      引用 Connection（设置→连接）
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline"
                            onClick={() => navigate("/settings/connections")}>
                      去 设置→连接 配置凭据
                    </Button>
                  )}
                </div>
                {src.data.has_secret && (
                  <div className="flex items-center gap-2">
                    <span className="w-24 shrink-0 text-muted-foreground">源级凭据</span>
                    <Badge variant="outline">legacy</Badge>
                    <code className="text-xs text-muted-foreground">••••••••（已加密存储）</code>
                    <Button size="sm" variant="ghost"
                            onClick={() => { setSecretJson(""); setSecretOpen(true) }}>
                      更新（legacy）
                    </Button>
                  </div>
                )}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                凭据值永不回显；新源请经 Connection 管理凭据（一套凭据接 N 个源，轮换只换一处）；
                源级凭据为兼容路径，服务端信封加密保留。
              </p>
            </Card>
          )}

          {(src.data?.connectionId || src.data?.assetId) && (
            <Card icon={Database} title="连接与数据资产（D5）">
              <div className="grid gap-1.5 text-[12.5px]">
                <div className="flex gap-2">
                  <span className="w-24 shrink-0 text-muted-foreground">Connection</span>
                  <span>{connName ?? (src.data?.connectionId ? src.data.connectionId.slice(0, 8) + "…" : "—（手工配置模式）")}</span>
                </div>
                <div className="flex gap-2">
                  <span className="w-24 shrink-0 text-muted-foreground">数据资产</span>
                  <span>{assets.find((a2) => a2.id === src.data?.assetId)?.name ?? "—"}</span>
                </div>
                <div className="mt-1 grid gap-1">
                  <Label htmlFor="ds-asset-switch">切换表/日志库（已挂载的数据资产）</Label>
                  <Select value={src.data?.assetId ?? ""}
                          onValueChange={async (v) => {
                            try {
                              await asApi.sourcePatch(sid, { asset_id: v })
                              toast.success("已切换数据资产")
                              src.retry()
                            } catch (e) {
                              toast.error(`切换失败：${(e as Error).message}`)
                            }
                          }}>
                    <SelectTrigger id="ds-asset-switch"><SelectValue placeholder="选择数据资产" /></SelectTrigger>
                    <SelectContent>
                      {assets.map((a2) => (
                        <SelectItem key={a2.id} value={a2.id}>{a2.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    新表请先到 设置→连接→目录 挂载为数据资产。
                  </p>
                </div>
              </div>
            </Card>
          )}

          <Card icon={RouteIcon} title={`事件路由（${routes.data?.total ?? 0}）`}>
            <RouteCreateBox sid={sid} onCreated={() => routes.retry()} />
            {routes.error ? (
              <p className="text-xs text-(--status-danger-text)">路由加载失败：{routes.error}</p>
            ) : (routes.data?.items ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">该源暂无路由（事件到达后将被过滤并留证据）。</p>
            ) : (
              <div className="flex flex-col gap-2">
                {(routes.data?.items ?? []).map((r: EventRouteDTO) => (
                  <div key={r.id} className="flex items-center gap-2 border-b pb-2 last:border-b-0 last:pb-0"
                       style={{ borderColor: "var(--border)" }}>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12.5px] font-medium">
                        {r.destination.kind === "automation" ? "自动任务" : "分析任务"} · {r.destination.id.slice(0, 8)}…
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {r.origin === "event_route" ? "route" : "legacy trigger"} · rev {r.revision}
                        {r.dedupe.keyPath ? ` · dedupe ${r.dedupe.keyPath}/${r.dedupe.windowSeconds ?? 86400}s` : ""}
                        {" · "}{r.completionPolicy}
                      </div>
                    </div>
                    <Badge variant={r.archived ? "outline" : r.enabled ? "secondary" : "outline"}>
                      {r.archived ? "已归档" : r.enabled ? "启用" : "停用"}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card icon={History} title="事件流水"
                extra={<span className="text-[11px] text-muted-foreground">摘要 · 详情在事件流水 tab</span>}>
            {/* 09-17 mpocket 借鉴：源详情只放实体维度摘要+跳转；
                run/投递维度全量与重试在 数据页→事件流水 tab（预置 source 过滤） */}
            {deliveries.error ? (
              <p className="text-xs text-(--status-danger-text)">流水加载失败：{deliveries.error}</p>
            ) : (deliveries.data?.items ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">暂无投递记录。</p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                {(["completed", "failed", "dead", "running", "pending"] as const).map((k) => {
                  const n = (deliveries.data?.items ?? []).filter((d: EventDeliveryDTO) => d.status === k).length
                  if (!n) return null
                  return (
                    <Badge key={k} variant="outline"
                           style={k === "completed"
                             ? { borderColor: "var(--status-success)", background: "var(--status-success-soft)", color: "var(--status-success-text)" }
                             : k === "failed" || k === "dead"
                               ? { borderColor: "var(--status-danger)", background: "var(--status-danger-soft)", color: "var(--status-danger-text)" }
                               : { borderColor: "var(--border)", background: "var(--surface-muted)", color: "var(--text-secondary)" }}>
                      {DELIVERY_LABEL[k.toUpperCase()] ?? k} {n}
                    </Badge>
                  )
                })}
                <span className="text-[11px] text-muted-foreground">最近 50 条摘要</span>
              </div>
            )}
            <div className="mt-2 flex items-center gap-2">
              <Button size="sm" variant="outline"
                      onClick={() => navigate(`/resources/data?tab=events&source=${sid}`)}>
                在事件流水 tab 查看（含重试与证据）
              </Button>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              已过滤/已去重不产生投递行——证据来自事件层 route_outcomes（F5 AC-023/024）。
            </p>
          </Card>
        </div>
      </div>

      {/* 重新生成 token 一次性展示 */}
      <Dialog open={newToken !== null} onOpenChange={(v) => { if (!v) setNewToken(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>保存新 Webhook Token</DialogTitle>
            <DialogDescription>调用方式：POST /api/v2/ingress/webhook/{sid}，携带 X-Source-Token 头。</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-3">
            <code className="min-w-0 flex-1 break-all text-xs">{newToken}</code>
            <Button size="sm" variant="outline" aria-label="复制 Token"
                    onClick={() => void navigator.clipboard.writeText(newToken ?? "").then(
                      () => toast.success("已复制到剪贴板"),
                      () => toast.error("复制失败，请手动选中复制"))}>
              <Copy className="size-3.5" /> 复制
            </Button>
          </div>
          <p className="text-sm font-medium" role="alert"
             style={{ color: "var(--status-warning-text)" }}>
            Token 仅显示这一次，关闭后无法再次查看；丢失只能重新生成。请先复制保存。
          </p>
          <DialogFooter><Button onClick={() => setNewToken(null)}>我已保存，关闭</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除（归档语义 + 引用清单） */}
      <Dialog open={delOpen} onOpenChange={setDelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除数据源（归档语义）</DialogTitle>
            <DialogDescription>
              不物理删除：事件与路由流水保持可追溯；归档后列表默认隐藏。
            </DialogDescription>
          </DialogHeader>
          {delRefs ? (
            <div className="text-sm">
              <p className="mb-2 font-medium" style={{ color: "var(--status-danger-text)" }}>
                该源仍被引用，拒绝归档：
              </p>
              <ul className="list-inside list-disc text-xs text-muted-foreground">
                {delRefs.map((r) => (
                  <li key={r.kind}>{r.kind} × {r.count}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">
                请先归档相关路由或等待事件保留期结束。
              </p>
            </div>
          ) : (
            <p className="text-sm">确认归档「{src.data.name}」？暂停接收且列表默认隐藏，可在 includeArchived 视图恢复。</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDelOpen(false)}>取消</Button>
            {!delRefs && (
              <Button className="bg-(--status-danger-text)" onClick={() => void doDelete()}>
                确认归档
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 凭据设置/更新 */}
      <Dialog open={secretOpen} onOpenChange={setSecretOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{src.data.has_secret ? "更新凭据" : "设置凭据"}</DialogTitle>
            <DialogDescription>JSON 形如飞书 {"{app_id, app_secret}"} / MaxCompute {"{access_key_id, access_key_secret}"} / API {"{type, …}"}。更新后旧凭据即刻失效。</DialogDescription>
          </DialogHeader>
          <Textarea rows={3} value={secretJson} onChange={(e) => setSecretJson(e.target.value)}
                    aria-label="凭据 JSON" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setSecretOpen(false)}>取消</Button>
            <Button onClick={async () => {
              let secret: Record<string, unknown>
              try {
                secret = JSON.parse(secretJson) as Record<string, unknown>
              } catch (e) {
                toast.error(`凭据 JSON 不合法：${(e as Error).message}`)
                return
              }
              try {
                await asApi.sourceSetSecret(sid, secret)
                toast.success("凭据已加密保存")
                setSecretOpen(false)
                src.retry()
              } catch (e) {
                toast.error(`${(e as Error).message}`)
              }
            }}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 测试事件 */}
      <Dialog open={testOpen} onOpenChange={setTestOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>发送测试事件</DialogTitle>
            <DialogDescription>payload 为 JSON；走真实 ingest 管线（去重/过滤/路由/派发）。</DialogDescription>
          </DialogHeader>
          <Textarea rows={4} value={testPayload} onChange={(e) => setTestPayload(e.target.value)}
                    aria-label="测试 payload" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setTestOpen(false)}>取消</Button>
            <Button onClick={async () => {
              let payload: Record<string, unknown>
              try {
                payload = JSON.parse(testPayload) as Record<string, unknown>
              } catch (e) {
                toast.error(`payload 不是合法 JSON：${(e as Error).message}`)
                return
              }
              try {
                const r = await asApi.testEvent(sid, payload)
                toast.success(`事件已接收（${r.status}）${r.dispatch_ref ? `，派发 ${String(r.dispatch_ref).slice(0, 8)}` : "，无匹配路由（可查流水证据）"}`)
                setTestOpen(false)
                deliveries.retry()
              } catch (e) {
                toast.error(`后端拒绝：${(e as Error).message}`)
              }
            }}>发送</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
