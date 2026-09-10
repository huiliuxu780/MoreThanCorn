/** Agent 自主工作子页（QoderWake /wakers/<id>/triggers 同构）。
 *
 * 原站事实：h2 自主工作 + 副文案 + 右上「新建自动任务」+ 触发类型/状态/排序筛选 +
 * 空态引导；列表即当前 Agent 为执行者的自动任务（executor 过滤）。
 * 数据源：/api/v2/automations?executor=agent:<id>（真实定义）。
 */
import * as React from "react"
import { useNavigate } from "react-router-dom"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Switch, } from "@/components/ui/switch"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { asApi } from "@/services/as-api"
import { toast } from "sonner"

interface AutoRow {
  id: string
  name: string
  target_kind: string
  enabled: boolean
  auto_run_count: number
  last_auto_fire_at: string | null
  triggers: { kind: string; config: Record<string, unknown> }[]
}

const KIND_LABEL: Record<string, string> = {
  schedule: "定时", api: "API", event: "事件", polling: "轮询",
}

export function AgentAutonomousSection({ agentId }: { agentId: string }) {
  const navigate = useNavigate()
  const [rows, setRows] = React.useState<AutoRow[]>([])
  const [triggerKind, setTriggerKind] = React.useState("")
  const [status, setStatus] = React.useState("")
  const [sort, setSort] = React.useState("created_at:desc")

  const reload = React.useCallback(() => {
    const [s, o] = sort.split(":")
    asApi
      .automations({
        executor: `agent:${agentId}`,
        ...(triggerKind ? { triggerKind } : {}),
        ...(status ? { status } : {}),
        sort: s, order: o, pageSize: "50",
      })
      .then((r) => setRows(r.items as unknown as AutoRow[]))
      .catch(() => undefined)
  }, [agentId, triggerKind, status, sort])

  React.useEffect(() => { reload() }, [reload])

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div>
          <h2 className="text-[28px] font-semibold leading-[38px]">自主工作</h2>
          <p className="mt-1 text-sm text-muted-foreground">通过定时、事件或 API 自动开工，并由当前 Agent 响应。</p>
        </div>
        <Button className="ml-auto" onClick={() => navigate("/autonomous-tasks")}>
          <Plus className="size-4" /> 新建自动任务
        </Button>
      </div>

      <section aria-label="筛选" className="flex flex-wrap items-center gap-2">
        <Select value={triggerKind || "__all"} onValueChange={(v) => setTriggerKind(v === "__all" ? "" : v)}>
          <SelectTrigger className="w-32"><SelectValue placeholder="触发类型" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">全部类型</SelectItem>
            <SelectItem value="schedule">定时</SelectItem>
            <SelectItem value="api">API</SelectItem>
            <SelectItem value="event">事件</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status || "__all"} onValueChange={(v) => setStatus(v === "__all" ? "" : v)}>
          <SelectTrigger className="w-32"><SelectValue placeholder="自动任务状态" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">全部状态</SelectItem>
            <SelectItem value="enabled">已启用</SelectItem>
            <SelectItem value="disabled">已停用</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={setSort}>
          <SelectTrigger className="w-36"><SelectValue placeholder="排序" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="created_at:desc">最近创建</SelectItem>
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
            <TableHead>最近触发</TableHead>
            <TableHead>累计自动运行</TableHead>
            <TableHead>状态</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id} className="cursor-pointer" onClick={() => navigate(`/autonomous-tasks/${r.id}`)}>
              <TableCell className="font-medium">{r.name}</TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {r.triggers.map((t) => KIND_LABEL[t.kind] ?? t.kind).join(" / ") || "—"}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {r.last_auto_fire_at ? new Date(r.last_auto_fire_at).toLocaleString() : "—"}
              </TableCell>
              <TableCell>{r.auto_run_count} 次</TableCell>
              <TableCell onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={r.enabled}
                    aria-label="启用"
                    onCheckedChange={async (v) => {
                      try { await asApi.setEnabled(r.id, v); reload() }
                      catch (e) { toast.error(`启停失败：${(e as Error).message}`) }
                    }}
                  />
                  <span className="text-xs">{r.enabled ? "启用" : "停用"}</span>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {!rows.length && (
            <TableRow>
              <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                <p>还没有自动任务</p>
                <p className="mt-1">创建自动任务，按定时、事件或 API 自动唤起该 Agent。</p>
                <Button size="sm" variant="outline" className="mt-3" onClick={() => navigate("/autonomous-tasks")}>
                  新建自动任务
                </Button>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
