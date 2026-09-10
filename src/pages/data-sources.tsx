/**
 * 数据接入（2026-09-09 换底 §五-G）：webhook/polling/test_event 数据源管理。
 * 事件管线：接收→去重→过滤→映射→自动任务派发；死信/重试状态见事件表。
 */
import * as React from "react"
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
import { Textarea } from "@/components/ui/textarea"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { asApi } from "@/services/as-api"
import { useAsyncData } from "@/hooks/use-async-data"
import { toast } from "sonner"

interface SourceRow {
  id: string
  name: string
  kind: string
  status: string
  last_poll_at: string | null
}

export default function DataSourcesPage() {
  const list = useAsyncData(() => asApi.sources(), [])
  const [open, setOpen] = React.useState(false)
  const [form, setForm] = React.useState({ name: "", kind: "webhook", mapping: '{"topic":"topic"}' })
  const [token, setToken] = React.useState<string | null>(null)
  const [testPayload, setTestPayload] = React.useState('{"topic":"billing","id":"evt-demo-1"}')
  const [testTarget, setTestTarget] = React.useState<string | null>(null)
  const [creating, setCreating] = React.useState(false)

  const rows = (list.data?.items ?? []) as unknown as SourceRow[]

  const create = async () => {
    if (!form.name.trim()) {
      toast.error("请填写名称")
      return
    }
    let mapping: Record<string, unknown> = {}
    try {
      mapping = JSON.parse(form.mapping || "{}")
    } catch {
      toast.error("映射 JSON 不合法")
      return
    }
    setCreating(true)
    try {
      const r = await asApi.createSource({ name: form.name, kind: form.kind, config: { mapping } })
      if (r.webhook_token) setToken(String(r.webhook_token))
      toast.success("数据源已创建")
      setOpen(false)
      setForm({ name: "", kind: "webhook", mapping: '{"topic":"topic"}' })
      list.retry()
    } catch (e) {
      toast.error(`创建失败：${(e as Error).message}`)
    } finally {
      setCreating(false)
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

      {token && (
        <p className="rounded-md border bg-muted/40 p-3 text-xs">
          Webhook token（仅显示一次）：
          <code className="ml-1 break-all">{token}</code>
          ；调用：POST /api/v2/ingress/webhook/{`{source_id}`} 带 X-Source-Token 头。
        </p>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建数据源</DialogTitle>
            <DialogDescription>webhook 需 token 鉴权；polling 由平台调度拉取。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1">
              <Label>名称</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid gap-1">
              <Label>类型</Label>
              <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="webhook">Webhook</SelectItem>
                  <SelectItem value="polling">轮询</SelectItem>
                  <SelectItem value="test_event">测试事件</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label>字段映射 JSON（payload 路径 → 触发输入键）</Label>
              <Textarea rows={3} value={form.mapping} onChange={(e) => setForm({ ...form, mapping: e.target.value })} />
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

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>名称</TableHead>
            <TableHead>类型</TableHead>
            <TableHead>状态</TableHead>
            <TableHead>最近拉取</TableHead>
            <TableHead>测试事件</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((s) => (
            <TableRow key={s.id}>
              <TableCell className="font-medium">{s.name}</TableCell>
              <TableCell>
                <Badge variant="outline">{s.kind}</Badge>
              </TableCell>
              <TableCell>{s.status}</TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {s.last_poll_at ? new Date(s.last_poll_at).toLocaleString() : "—"}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => setTestTarget(s.id)}>
                    发送测试事件
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {!rows.length && (
            <TableRow>
              <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                暂无数据源（事件/轮询触发按已注册 capability 条件展示）
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {testTarget && (
        <div className="rounded-md border p-3">
          <Label>测试 payload</Label>
          <Textarea rows={3} value={testPayload} onChange={(e) => setTestPayload(e.target.value)} />
          <Button
            className="mt-2"
            size="sm"
            onClick={async () => {
              try {
                const r = await asApi.testEvent(testTarget, JSON.parse(testPayload))
                toast.success(`事件 ${String(r.status)}${r.dispatch_ref ? ` → 派发 ${String(r.dispatch_ref).slice(0, 8)}` : ""}`)
                setTestTarget(null)
              } catch (e) {
                toast.error(`发送失败：${(e as Error).message}`)
              }
            }}
          >
            发送
          </Button>
        </div>
      )}
    </div>
  )
}
