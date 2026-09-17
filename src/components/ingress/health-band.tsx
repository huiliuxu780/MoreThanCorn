import { useState } from "react"
/** 16 号稿 B4：接入健康概览带（数据接入页表格上方常驻）。
 *
 * 治「看不懂」的第二半：每源一行诊断——拉取结果（含失败原因 inline 红字，
 * g061 三列）/ 自动拉取状态（自动·Nmin+下次时刻 / 手动 / 推送型）/ 24h 事件 /
 * 24h 投递三色 / 路由消费（「未配置·事件积压」chip 一键跳详情页路由治理）。
 * 数据源=health-summary 聚合端点（常数查询）。
 */
import { useNavigate } from "react-router-dom"

import { KIND_ICON, KIND_LABEL, PULL_KINDS } from "@/components/ingress/source-kind-fields"
import { CloudDownload, Pause, Play, Send, Settings2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
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
  /* 09-17 用户指认：立即拉取/暂停 需二次确认；行操作 icon+tooltip 同规格 */
  const [confirm, setConfirm] = useState<null | {
    kind: "pull" | "toggle"; id: string; name: string; status: string
  }>(null)
  const [busy, setBusy] = useState(false)
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
                      : r.status === "paused"
                        ? { borderColor: "var(--border)", background: "var(--surface-muted)", color: "var(--text-secondary)" }
                        : { borderColor: "var(--status-success)", background: "var(--status-success-soft)", color: "var(--status-success-text)" }}>
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
                              onClick={() => navigate(`/resources/data/source/${r.sourceId}`)}>
                        ⚠ 未配置{r.deliveries24h.filtered > 0 ? " · 事件积压" : ""}
                      </button>
                    )}
                  </td>
                  <td className="px-3.5 py-2.5 text-right">
                    <div className="flex justify-end gap-1">
                      {onTest && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button size="xs" variant="outline" aria-label="发送测试事件"
                                    onClick={() => onTest(r.sourceId)}>
                              <Send className="size-3" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>发送测试事件</TooltipContent>
                        </Tooltip>
                      )}
                      {PULL_KINDS.includes(r.kind) && (
                        <>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button size="xs" variant="outline" aria-label="立即拉取"
                                      onClick={() => setConfirm({ kind: "pull", id: r.sourceId, name: r.name, status: r.status })}>
                                <CloudDownload className="size-3" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>立即拉取</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button size="xs" variant="outline"
                                      aria-label={r.status === "paused" ? "恢复接收" : "暂停接收"}
                                      onClick={() => setConfirm({ kind: "toggle", id: r.sourceId, name: r.name, status: r.status })}>
                                {r.status === "paused"
                                  ? <Play className="size-3" /> : <Pause className="size-3" />}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{r.status === "paused" ? "恢复接收" : "暂停接收"}</TooltipContent>
                          </Tooltip>
                        </>
                      )}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button size="xs" variant="ghost" aria-label="管理"
                                  onClick={() => navigate(`/resources/data/source/${r.sourceId}`)}>
                            <Settings2 className="size-3" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>管理</TooltipContent>
                      </Tooltip>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm?.kind === "pull" ? "立即拉取确认"
                : confirm?.status === "paused" ? "恢复接收确认" : "暂停接收确认"}
            </DialogTitle>
            <DialogDescription>
              {confirm?.kind === "pull"
                ? `将对「${confirm?.name}」立即执行一次拉取（单 tick 最多 5 页、页大小封顶 200）。继续？`
                : confirm?.status === "paused"
                  ? `恢复后「${confirm?.name}」将按设定间隔自动拉取。继续？`
                  : `暂停后「${confirm?.name}」不再自动拉取（进行中批次不受影响）。继续？`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>取消</Button>
            <Button disabled={busy} onClick={async () => {
              if (!confirm) return
              setBusy(true)
              try {
                if (confirm.kind === "pull") {
                  const pr = await asApi.pollSource(confirm.id)
                  toast.success(`拉取完成：${pr.polled} 条，派发 ${pr.dispatched} 条`)
                } else {
                  await asApi.sourcePatch(confirm.id, {
                    status: confirm.status === "paused" ? "active" : "paused",
                  })
                  toast.success(confirm.status === "paused" ? "已恢复接收" : "已暂停接收")
                }
                setConfirm(null)
                data.retry()
              } catch (e) {
                toast.error(`${(e as Error).message}`)
              } finally {
                setBusy(false)
              }
            }}>确认</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
