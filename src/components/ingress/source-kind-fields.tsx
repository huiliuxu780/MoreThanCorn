/** 16 号稿 B2：按型源配置字段组 + payload 推导纯函数。
 *
 * 老创建 Dialog 与向导步③共用本组件（单点防漂移）；09-15 自动拉取修正：
 * 所有 PULL_KINDS 都有「自动拉取间隔」字段（watcher 仅 interval>0 自动 tick，
 * 原表单只给 api_pull 写 interval → 其余三型事实手动-only）。
 */
import { CloudDownload, Database, FlaskConical, ScrollText, Table as TableIcon, Webhook } from "lucide-react"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

export type SourceKind =
  | "webhook" | "api_pull" | "maxcompute" | "feishu_bitable" | "sls" | "test_event"

export const KIND_LABEL: Record<string, string> = {
  webhook: "Webhook",
  api_pull: "API（拉取）",
  maxcompute: "MaxCompute",
  feishu_bitable: "飞书多维表格",
  sls: "SLS 日志",
  test_event: "测试事件",
}
export const KIND_ICON = {
  webhook: Webhook, api_pull: CloudDownload, maxcompute: Database,
  feishu_bitable: TableIcon, sls: ScrollText, test_event: FlaskConical,
} as const
/* 与后端 source_adapters.PULL_KINDS 对齐：这四型支持「立即拉取」与自动 tick */
export const PULL_KINDS: readonly string[] = ["api_pull", "feishu_bitable", "maxcompute", "sls"]
export const FILTER_OPS = ["eq", "ne", "contains", "gt", "lt"] as const

export interface SourceFormState {
  name: string
  kind: SourceKind
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

export const EMPTY_SOURCE_FORM: SourceFormState = {
  name: "", kind: "webhook", endpoint: "", project: "", table: "",
  appToken: "", tableId: "", viewId: "", logstore: "", slsQuery: "",
  connId: "", tablePick: "", pageSize: "100", secretJson: "",
  url: "", interval: "300", cursorField: "id", cursorParam: "after",
  mapping: '{"value":"body.text"}', filter: "",
}

export interface CatalogState {
  conns: { id: string; name: string; protocol: string }[]
  items: { name: string; kind: string }[]
  err: string | null
  load: (cid: string) => void
}

/** 按型渲染配置字段（名称/类型选择由调用方布局）。idp=控件 id 前缀防多实例冲突。 */
export function SourceKindFields({ form, set, cat, idp = "ds" }: {
  form: SourceFormState
  set: (patch: Partial<SourceFormState>) => void
  cat: CatalogState
  idp?: string
}) {
  const pull = PULL_KINDS.includes(form.kind)
  return (
    <>
      {form.kind === "api_pull" && (
        <>
          <div className="grid gap-1">
            <Label htmlFor={`${idp}-url`}>拉取 URL（返回 JSON 数组或 {`{items:[…]}`}）</Label>
            <Input id={`${idp}-url`} placeholder="https://example.internal/api/tickets"
                   value={form.url} onChange={(e) => set({ url: e.target.value })} />
          </div>
          <div className="grid grid-cols-4 gap-2">
            <div className="grid gap-1">
              <Label htmlFor={`${idp}-interval`}>自动拉取间隔（秒）</Label>
              <Input id={`${idp}-interval`} inputMode="numeric" value={form.interval}
                     onChange={(e) => set({ interval: e.target.value })} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor={`${idp}-cursor-field`}>游标字段</Label>
              <Input id={`${idp}-cursor-field`} value={form.cursorField}
                     onChange={(e) => set({ cursorField: e.target.value })} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor={`${idp}-cursor-param`}>游标参数名</Label>
              <Input id={`${idp}-cursor-param`} value={form.cursorParam}
                     onChange={(e) => set({ cursorParam: e.target.value })} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor={`${idp}-pagesize`}>页大小</Label>
              <Input id={`${idp}-pagesize`} inputMode="numeric" value={form.pageSize}
                     onChange={(e) => set({ pageSize: e.target.value })} />
            </div>
          </div>
        </>
      )}
      {(form.kind === "maxcompute" || form.kind === "sls") && (
        <div className="grid gap-1">
          <Label id={`${idp}-conn-label`}>Connection（凭据与端点，可选）</Label>
          <Select value={form.connId} onValueChange={(v) => { set({ connId: v, tablePick: "" }); cat.load(v) }}>
            <SelectTrigger id={`${idp}-conn`} aria-labelledby={`${idp}-conn-label`}>
              <SelectValue placeholder="选择连接后从目录选表；不选则手工配置" />
            </SelectTrigger>
            <SelectContent>
              {cat.conns.filter((c) => c.protocol === form.kind).map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {(form.kind === "maxcompute" || form.kind === "sls") && form.connId && (
        <div className="grid gap-1">
          <Label id={`${idp}-pick-label`}>{form.kind === "sls" ? "Logstore（目录发现）" : "表（目录发现）"}</Label>
          <Select value={form.tablePick} onValueChange={(v) => set({ tablePick: v })}>
            <SelectTrigger id={`${idp}-pick`} aria-labelledby={`${idp}-pick-label`}>
              <SelectValue placeholder={cat.err ? "目录发现失败" : "选择表/日志库"} />
            </SelectTrigger>
            <SelectContent>
              {cat.items.map((it) => (
                <SelectItem key={it.name} value={it.name}>{it.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {cat.err && (
            <p className="text-xs" style={{ color: "var(--status-danger-text)" }}>{cat.err}</p>
          )}
        </div>
      )}
      {form.kind === "maxcompute" && !form.connId && (
        <>
          <div className="grid gap-1">
            <Label htmlFor={`${idp}-endpoint`}>Endpoint</Label>
            <Input id={`${idp}-endpoint`} placeholder="https://service.cn-shanghai.maxcompute.aliyun.com/api"
                   value={form.endpoint} onChange={(e) => set({ endpoint: e.target.value })} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="grid gap-1">
              <Label htmlFor={`${idp}-project`}>Project</Label>
              <Input id={`${idp}-project`} value={form.project}
                     onChange={(e) => set({ project: e.target.value })} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor={`${idp}-table`}>Table</Label>
              <Input id={`${idp}-table`} value={form.table}
                     onChange={(e) => set({ table: e.target.value })} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor={`${idp}-pagesize`}>页大小</Label>
              <Input id={`${idp}-pagesize`} inputMode="numeric" value={form.pageSize}
                     onChange={(e) => set({ pageSize: e.target.value })} />
            </div>
          </div>
        </>
      )}
      {form.kind === "sls" && !form.connId && (
        <>
          <div className="grid gap-1">
            <Label htmlFor={`${idp}-endpoint`}>Endpoint</Label>
            <Input id={`${idp}-endpoint`} placeholder="cn-shanghai.log.aliyuncs.com"
                   value={form.endpoint} onChange={(e) => set({ endpoint: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label htmlFor={`${idp}-project`}>Project</Label>
              <Input id={`${idp}-project`} value={form.project}
                     onChange={(e) => set({ project: e.target.value })} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor={`${idp}-logstore`}>Logstore</Label>
              <Input id={`${idp}-logstore`} value={form.logstore}
                     onChange={(e) => set({ logstore: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label htmlFor={`${idp}-slsquery`}>查询语句（可选）</Label>
              <Input id={`${idp}-slsquery`} placeholder="* 或 status: 500"
                     value={form.slsQuery} onChange={(e) => set({ slsQuery: e.target.value })} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor={`${idp}-pagesize`}>页大小</Label>
              <Input id={`${idp}-pagesize`} inputMode="numeric" value={form.pageSize}
                     onChange={(e) => set({ pageSize: e.target.value })} />
            </div>
          </div>
        </>
      )}
      {form.kind === "feishu_bitable" && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label htmlFor={`${idp}-apptoken`}>app_token（多维表格 token）</Label>
              <Input id={`${idp}-apptoken`} value={form.appToken}
                     onChange={(e) => set({ appToken: e.target.value })} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor={`${idp}-tableid`}>table_id（数据表）</Label>
              <Input id={`${idp}-tableid`} value={form.tableId}
                     onChange={(e) => set({ tableId: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label htmlFor={`${idp}-viewid`}>view_id（可选）</Label>
              <Input id={`${idp}-viewid`} value={form.viewId}
                     onChange={(e) => set({ viewId: e.target.value })} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor={`${idp}-pagesize`}>页大小</Label>
              <Input id={`${idp}-pagesize`} inputMode="numeric" value={form.pageSize}
                     onChange={(e) => set({ pageSize: e.target.value })} />
            </div>
          </div>
        </>
      )}
      {/* 09-15 自动拉取修正：maxcompute/sls/多维表格 补间隔字段（api_pull 已在上方四宫格） */}
      {pull && form.kind !== "api_pull" && (
        <div className="grid gap-1">
          <Label htmlFor={`${idp}-interval`}>自动拉取间隔（秒）</Label>
          <Input id={`${idp}-interval`} inputMode="numeric" value={form.interval}
                 onChange={(e) => set({ interval: e.target.value })} />
          <p className="text-xs text-muted-foreground">
            0=仅手动：watcher 不会自动拉取（不推荐）；默认 300 秒。
          </p>
        </div>
      )}
      {form.kind !== "webhook" && form.kind !== "test_event" && !form.connId && (
        <div className="grid gap-1">
          <Label htmlFor={`${idp}-secret`}>凭据 JSON（加密存储，永不回显；选 Connection 后由连接承载）</Label>
          <Textarea id={`${idp}-secret`} rows={2} placeholder={
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
        <Label htmlFor={`${idp}-mapping`}>字段映射 JSON（触发输入键 → payload 取值路径）</Label>
        <Textarea id={`${idp}-mapping`} rows={3} value={form.mapping}
                  onChange={(e) => set({ mapping: e.target.value })} />
        <p className="text-xs text-muted-foreground">
          例：{"{\"value\":\"body.text\"}"} 表示把 payload 的 body.text 作为触发输入 value。
        </p>
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`${idp}-filter`}>过滤条件 JSON（可选）</Label>
        <Input id={`${idp}-filter`} placeholder='{"field":"type","op":"eq","value":"ticket"}'
               value={form.filter} onChange={(e) => set({ filter: e.target.value })} />
        <p className="text-xs text-muted-foreground">op 支持 {FILTER_OPS.join(" / ")}；不满足条件的事件不派发并留 filtered 证据。</p>
      </div>
    </>
  )
}

export interface SourcePayload {
  config: Record<string, unknown>
  secret?: Record<string, unknown>
}

/** 表单→创建体纯函数（老 Dialog 与向导 apply 共用；错误返回字符串由调用方 toast）。 */
export function deriveSourcePayload(form: SourceFormState):
  { error?: string; payload?: SourcePayload } {
  let mapping: Record<string, string> | undefined
  try {
    const parsed = JSON.parse(form.mapping || "{}") as unknown
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { error: "字段映射必须是 JSON 对象：{触发输入键: payload 路径}" }
    }
    const bad = Object.entries(parsed as Record<string, unknown>).find(([, v]) => typeof v !== "string")
    if (bad) return { error: `字段映射的值必须是 payload 路径字符串（键「${bad[0]}」不是）` }
    mapping = parsed as Record<string, string>
  } catch (e) {
    return { error: `字段映射 JSON 不合法：${(e as Error).message}` }
  }
  let filter: Record<string, unknown> | undefined
  if (form.filter.trim()) {
    try {
      const parsed = JSON.parse(form.filter) as { field?: string; op?: string; value?: unknown }
      if (!parsed.field || !parsed.op) return { error: '过滤条件需要 {"field","op","value"} 三个键' }
      if (!(FILTER_OPS as readonly string[]).includes(parsed.op)) {
        return { error: `过滤 op 只支持 ${FILTER_OPS.join("|")}（未知 op 会被拒绝而非放行）` }
      }
      filter = { field: parsed.field, op: parsed.op, value: parsed.value }
    } catch (e) {
      return { error: `过滤条件 JSON 不合法：${(e as Error).message}` }
    }
  }
  const interval = Number(form.interval)
  if (PULL_KINDS.includes(form.kind) && (!Number.isFinite(interval) || interval < 0)) {
    return { error: "自动拉取间隔须为 ≥0 的数字（0=仅手动）" }
  }
  if (form.kind === "api_pull") {
    if (!/^https?:\/\//.test(form.url.trim())) return { error: "API 拉取源必须填写 http(s):// 地址" }
    if (!Number.isFinite(interval) || interval < 10) return { error: "拉取间隔须为 ≥10 秒的数字" }
  }
  const config: Record<string, unknown> = {}
  if (mapping && Object.keys(mapping).length) config.mapping = mapping
  if (filter) config.filter = filter
  if (PULL_KINDS.includes(form.kind)) config.interval_seconds = interval
  if (form.kind === "api_pull") {
    config.url = form.url.trim()
    config.interval_seconds = interval
    config.cursor_field = form.cursorField.trim() || "id"
    config.cursor_param = form.cursorParam.trim() || "after"
    config.page_size = Number(form.pageSize) || 100
  }
  if (form.kind === "maxcompute") {
    if (form.connId) {
      if (!form.tablePick) return { error: "请从目录选择表" }
      config.table = form.tablePick
    } else if (!form.endpoint.trim() || !form.project.trim() || !form.table.trim()) {
      return { error: "MaxCompute 源需要 endpoint / project / table（或选择 Connection）" }
    }
    config.endpoint = form.endpoint.trim()
    config.project = form.project.trim()
    config.table = form.table.trim()
    config.page_size = Number(form.pageSize) || 100
  }
  if (form.kind === "feishu_bitable") {
    if (!form.appToken.trim() || !form.tableId.trim()) {
      return { error: "飞书多维表格源需要 app_token 与 table_id" }
    }
    config.app_token = form.appToken.trim()
    config.table_id = form.tableId.trim()
    if (form.viewId.trim()) config.view_id = form.viewId.trim()
    config.page_size = Number(form.pageSize) || 100
  }
  if (form.kind === "sls") {
    if (form.connId) {
      if (!form.tablePick) return { error: "请从目录选择 logstore" }
      config.logstore = form.tablePick
    } else if (!form.endpoint.trim() || !form.project.trim() || !form.logstore.trim()) {
      return { error: "SLS 源需要 endpoint / project / logstore（或选择 Connection）" }
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
      return { error: `凭据 JSON 不合法：${(e as Error).message}` }
    }
  }
  return { payload: { config, ...(secret ? { secret } : {}) } }
}
