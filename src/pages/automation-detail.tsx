/**
 * 自动任务详情（2026-09-09 换底）：运行概览 / 触发条件 / 运行历史 / 手动运行 /
 * API key / 启停。历史=trigger log + 运行时 Schedule sessions（手动不计自动统计）。
 */
import * as React from "react"
import { useNavigate, useParams } from "react-router-dom"
import { KeyRound, Play } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Switch } from "@/components/ui/switch"
import { asApi } from "@/services/as-api"
import { useAsyncData } from "@/hooks/use-async-data"
import { toast } from "sonner"

interface HistoryRow {
  id: string
  source: string
  status: string
  session_id: string | null
  workflow_run_id: string | null
  agentflow_run_id: string | null
  error: string
  created_at: string
}

export default function AutomationDetailPage() {
  const { taskId = "" } = useParams()
  const navigate = useNavigate()
  const detail = useAsyncData(() => asApi.automation(taskId), [taskId])
  const hist = useAsyncData(() => asApi.history(taskId), [taskId])
  const [key, setKey] = React.useState<string | null>(null)

  const d = (detail.data ?? {}) as Record<string, unknown>
  const triggers = (d.triggers ?? []) as { id: string; kind: string; config: Record<string, unknown> }[]
  const items = (hist.data?.items ?? []) as HistoryRow[]

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/autonomous-tasks")}>
          返回
        </Button>
        <h1 className="text-xl font-semibold">{String(d.name ?? "")}</h1>
        <div className="ml-auto flex items-center gap-2">
          <Switch
            checked={Boolean(d.enabled)}
            onCheckedChange={async (v) => {
              try {
                await asApi.setEnabled(taskId, v)
                detail.retry()
              } catch (e) {
                toast.error(`启停失败：${(e as Error).message}`)
              }
            }}
            aria-label="启用"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              try {
                const r = await asApi.runNow(taskId)
                toast.success(`已发起手动运行（${String(r.status)}），不计入自动统计`)
                hist.retry()
              } catch (e) {
                toast.error(`手动运行失败：${(e as Error).message}`)
              }
            }}
          >
            <Play className="size-4" /> 手动运行
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              try {
                const r = await asApi.createApiKey(taskId)
                setKey(r.key)
                toast.success("API key 已生成（仅显示一次）")
              } catch (e) {
                toast.error(`生成失败：${(e as Error).message}`)
              }
            }}
          >
            <KeyRound className="size-4" /> API key
          </Button>
        </div>
      </header>

      {key && (
        <p className="rounded-md border bg-muted/40 p-3 text-xs">
           invoke：POST /api/v2/external/automations/{String((d as { id?: string }).id)}/… 使用
          key id + Bearer；幂等请带 Idempotency-Key 头。key：
          <code className="ml-1 break-all">{key}</code>
        </p>
      )}

      <section className="grid gap-3 md:grid-cols-4">
        {[
          { label: "累计自动运行", value: String(hist.data?.auto_run_count ?? d.auto_run_count ?? 0) },
          { label: "最近自动触发", value: hist.data?.last_auto_fire_at ? new Date(String(hist.data.last_auto_fire_at)).toLocaleString() : "—" },
          { label: "执行方式", value: String(d.target_kind ?? "") },
          { label: "Session 策略", value: String(d.session_policy ?? "") },
        ].map((m) => (
          <div key={m.label} className="rounded-md border p-3">
            <div className="text-sm font-medium">{m.value}</div>
            <div className="text-xs text-muted-foreground">{m.label}</div>
          </div>
        ))}
      </section>

      <section aria-label="触发条件" className="rounded-md border p-3">
        <h2 className="mb-2 text-sm font-medium">触发条件（最多 5 个）</h2>
        <ul className="flex flex-wrap gap-2">
          {triggers.map((t) => (
            <li key={t.id}>
              <Badge variant="outline">
                {t.kind}
                {t.kind === "schedule" ? ` · ${String((t.config as Record<string, string>).cron ?? "")}` : ""}
              </Badge>
            </li>
          ))}
          {!triggers.length && <li className="text-xs text-muted-foreground">未配置触发（仅手动）</li>}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">
          执行指令：{String(d.prompt_template ?? "") || "—"}；暂停/最大次数/截止只阻止新自动触发，不取消已运行执行。
        </p>
      </section>

      <section aria-label="运行历史">
        <h2 className="mb-2 text-sm font-medium">运行历史</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>来源</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>执行引用</TableHead>
              <TableHead>时间</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((h) => (
              <TableRow key={h.id}>
                <TableCell>{h.source === "manual" ? "手动" : h.source}</TableCell>
                <TableCell>
                  <Badge variant={h.status === "failed" ? "destructive" : "secondary"}>{h.status}</Badge>
                </TableCell>
                <TableCell className="text-xs">
                  {h.session_id ? (
                    <button
                      type="button"
                      className="underline"
                      onClick={() => navigate(`/agents/${String(d.agent_id)}/chat?session=${h.session_id}`)}
                    >
                      Session {h.session_id.slice(0, 8)}
                    </button>
                  ) : h.workflow_run_id ? (
                    `Workflow ${h.workflow_run_id.slice(0, 8)}`
                  ) : h.agentflow_run_id ? (
                    `AgentFlow ${h.agentflow_run_id.slice(0, 8)}`
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {new Date(h.created_at).toLocaleString()}
                </TableCell>
              </TableRow>
            ))}
            {!items.length && (
              <TableRow>
                <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                  暂无运行记录
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </section>
    </div>
  )
}
