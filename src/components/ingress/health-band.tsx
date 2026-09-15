/** 16 号稿 B4：接入健康概览带（数据接入页表格上方常驻）。
 *
 * 治「看不懂」的第二半：每源一行诊断——拉取结果（含失败原因 inline 红字，
 * g061 三列）/ 自动拉取状态（自动·Nmin+下次时刻 / 手动 / 推送型）/ 24h 事件 /
 * 24h 投递三色 / 路由消费（「未配置·事件积压」chip 一键跳详情页路由治理）。
 * 数据源=health-summary 聚合端点（常数查询）。
 */
import { useNavigate } from "react-router-dom"

import { KIND_ICON, KIND_LABEL, PULL_KINDS } from "@/components/ingress/source-kind-fields"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useAsyncData } from "@/hooks/use-async-data"
import { asApi, type SourceHealthRow } from "@/services/as-api"
import { toast } from "sonner"

function fmtNext(row: SourceHealthRow): string {
  if (!row.lastPollAt || !row.intervalSeconds) return ""
  const next = new Date(row.lastPollAt).getTime() + row.intervalSeconds * 1000
  const d = new Date(next)
  return `下次 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

function AutoPill({ row }: { row: SourceHealthRow }) {
  if (row.kind === "webhook") {
    return <Badge variant="outline">推送型 · 无需拉取</Badge>
  }
  if (row.kind === "test_event") {
    return <Badge variant="outline">手动 · 测试</Badge>
  }
  if (row.intervalSeconds > 0) {
    const min = Math.max(1, Math.round(row.intervalSeconds / 60))
    return (
      <span className="grid gap-0.5">
        <Badge variant="outline" style={{ borderColor: "var(--brand-subtle)", background: "var(--brand-soft)", color: "var(--brand-primary)" }}>
          自动 · {min}min
        </Badge>
        <span className="text-[11px] text-muted-foreground">{fmtNext(row)}</span>
      </span>
    )
  }
  return (
    <span className="grid gap-0.5">
      <Badge variant="outline">手动</Badge>
      <span className="text-[11px] text-muted-foreground">interval=0</span>
    </span>
  )
}

export function HealthBand({ onTest }: { onTest?: (id: string) => void }) {
  const navigate = useNavigate()
  const data = useAsyncData(() => asApi.healthSummary(), [])
  if (data.error) {
    return (
      <div role="alert" className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm"
           style={{ borderColor: "var(--status-danger)", color: "var(--status-danger-text)" }}>
        <span>数据源列表加载失败：{data.error}</span>
        <Button size="xs" variant="outline" onClick={() => data.retry()}>重试</Button>
      </div>
    )
  }
  const rows = data.data?.items ?? []
  if (!data.loading && rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
        暂无数据源。创建 Webhook 源后可用「发送测试事件」验证接入链路；
        拉取型源由平台按设定间隔自动拉取，也可在列表中「立即拉取」。
      </p>
    )
  }
  return (
    <div className="overflow-hidden rounded-lg border" style={{ borderColor: "var(--border)" }}>
      <div className="flex items-center gap-2 border-b px-3.5 py-2"
           style={{ borderColor: "var(--border)", background: "var(--surface-muted)" }}>
        <span className="text-[12.5px] font-semibold">接入健康概览</span>
        <span className="text-[11.5px] text-muted-foreground">
          每源一行：拉取结果 / 24h 事件 / 24h 投递 / 路由消费——「未配置」=事件只留 filtered 存证，没人消费
        </span>
      </div>
      {data.loading && !data.data ? (
        <div className="px-3.5 py-6 text-center text-sm text-muted-foreground">加载中…</div>
      ) : (
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b text-left" style={{ borderColor: "var(--border)" }}>
              {["名称", "状态", "自动拉取", "最近拉取", "事件 24h", "投递 24h", "路由", ""].map((h, i) => (
                <th key={i} className="px-3.5 py-2 text-[12px] font-medium text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const Icon = KIND_ICON[r.kind as keyof typeof KIND_ICON]
              return (
                <tr key={r.sourceId} className="border-b last:border-b-0"
                    style={{ borderColor: "var(--border-soft, #EFEFEB)" }}>
                  <td className="px-3.5 py-2.5">
                    <span className="font-medium">{r.name}</span>
                    {Icon && (
                      <Badge variant="outline" className="ml-2">
                        <Icon className="size-3" />{KIND_LABEL[r.kind] ?? r.kind}
                      </Badge>
                    )}
                  </td>
                  <td className="px-3.5 py-2.5">
                    <Badge variant="outline" style={r.status === "error"
                      ? { borderColor: "var(--status-danger)", background: "var(--status-danger-soft)", color: "var(--status-danger-text)" }
                      : { borderColor: "var(--brand-subtle)", background: "var(--brand-soft)", color: "var(--brand-primary)" }}>
                      {r.status === "error" ? "异常" : r.status === "paused" ? "已暂停" : "活跃"}
                    </Badge>
                  </td>
                  <td className="px-3.5 py-2.5"><AutoPill row={r} /></td>
                  <td className="px-3.5 py-2.5 tabular-nums">
                    {r.lastPollAt ? new Date(r.lastPollAt).toLocaleString().slice(5, 16) : "—"}
                    <span className="block text-[11px]"
                          style={r.lastPollOk ? { color: "var(--text-tertiary)" } : { color: "var(--status-danger-text)" }}>
                      {r.lastPollOk ? `成功 ${r.lastPollCount} 条` : `拉取失败：${r.lastPollError}`}
                    </span>
                  </td>
                  <td className="px-3.5 py-2.5 tabular-nums">{r.events24h.toLocaleString()}</td>
                  <td className="px-3.5 py-2.5 tabular-nums text-[12px]">
                    <span style={{ color: "var(--status-success-text)", fontWeight: 600 }}>{r.deliveries24h.completed}</span>
                    {" / "}
                    <span style={{ color: "var(--status-danger-text)", fontWeight: 600 }}>{r.deliveries24h.failed}</span>
                    {" / "}
                    <span className="text-muted-foreground" style={{ fontWeight: 600 }}>{r.deliveries24h.dead}</span>
                  </td>
                  <td className="px-3.5 py-2.5">
                    {r.routeCount > 0 ? (
                      <Badge variant="outline" style={{ borderColor: "var(--brand-subtle)", background: "var(--brand-soft)", color: "var(--brand-primary)" }}>
                        {r.routeCount} 条路由
                      </Badge>
                    ) : (
                      <button type="button"
                              className="rounded-md border px-2 py-0.5 text-[11.5px] font-semibold"
                              style={{ borderColor: "var(--status-warning)", background: "var(--status-warning-soft)", color: "var(--status-warning-text)" }}
                              onClick={() => navigate(`/data-sources/${r.sourceId}`)}>
                        ⚠ 未配置{r.deliveries24h.filtered > 0 ? " · 事件积压" : ""}
                      </button>
                    )}
                  </td>
                  <td className="px-3.5 py-2.5 text-right">
                    <div className="flex justify-end gap-1">
                      {onTest && (
                        <Button size="xs" variant="outline" onClick={() => onTest(r.sourceId)}>发送测试事件</Button>
                      )}
                      {PULL_KINDS.includes(r.kind) && (
                        <Button size="xs" variant="outline" onClick={() => {
                          void asApi.pollSource(r.sourceId).then(
                            (pr) => { toast.success(`拉取完成：${pr.polled} 条，派发 ${pr.dispatched} 条`); data.retry() },
                            (e) => { toast.error(`拉取失败：${(e as Error).message}`); data.retry() })
                        }}>立即拉取</Button>
                      )}
                      <Button size="xs" variant="ghost" onClick={() => navigate(`/data-sources/${r.sourceId}`)}>管理</Button>
                    </div>
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
