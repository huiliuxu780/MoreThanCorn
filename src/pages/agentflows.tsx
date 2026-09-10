/**
 * AgentFlow 列表（2026-09-10 返工：卡片式，对齐 QoderWake WakerFlow 管理）。
 * 原站事实（/wakers/<id>/workflows 与 /resources/wakerflow）：
 *  - h2 + 副文案「把多个 Waker 的工作步骤编排成可反复运行的流程，用于代码审查、批量处理和交叉验证等复杂任务。」
 *  - 首格「新建 AgentFlow」卡 + 现有 flow 卡（名称 + 描述 + N 个节点 + N 个版本 + ⋯）；
 *  - 每卡 ⋯ 更多操作（打开 / 查看执行记录 / 删除）。
 * 控制面事实：定义/版本/发布；运行事实见详情页（节点 Session 归 AgentScope）。
 */
import * as React from "react"
import { useNavigate } from "react-router-dom"
import { MoreHorizontal, Plus, Trash2, Waypoints } from "lucide-react"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { asApi } from "@/services/as-api"
import { useAsyncData } from "@/hooks/use-async-data"
import { toast } from "sonner"

interface FlowRow {
  id: string
  name: string
  description: string
  version_count: number
  node_count?: number
  active_release_id: string | null
}

export default function AgentFlowsPage() {
  const navigate = useNavigate()
  const list = useAsyncData(() => asApi.flows(), [])
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState("")
  const [desc, setDesc] = React.useState("")
  const [del, setDel] = React.useState<FlowRow | null>(null)

  const rows = (list.data?.items ?? []) as unknown as FlowRow[]

  const create = async () => {
    if (!name.trim()) {
      toast.error("请填写名称")
      return
    }
    try {
      const r = await asApi.createFlow(name.trim(), desc.trim())
      toast.success("AgentFlow 已创建")
      setOpen(false)
      setName("")
      setDesc("")
      navigate(`/agentflows/${r.id}`)
    } catch (e) {
      toast.error(`创建失败：${(e as Error).message}`)
    }
  }

  const remove = async (f: FlowRow) => {
    try {
      await asApi.deleteFlow(f.id)
      toast.success(`已删除「${f.name}」`)
      setDel(null)
      list.retry()
    } catch (e) {
      toast.error(`删除失败：${(e as Error).message}`)
    }
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:p-6">
      <header className="flex flex-wrap items-start gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-[28px] font-semibold leading-9">
            <Waypoints className="size-6" /> AgentFlow 管理
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            把多个 Agent 的工作步骤编排成可反复运行的流程，用于代码审查、批量处理和交叉验证等复杂任务。
          </p>
        </div>
        <Button className="ml-auto" onClick={() => setOpen(true)}>
          <Plus className="size-4" /> 新建 AgentFlow
        </Button>
      </header>

      <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,280px),1fr))]">
        {/* 新建占位卡（原站同构） */}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex min-h-[168px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-surface p-4 text-center transition-colors hover:border-brand/60"
        >
          <span className="flex size-10 items-center justify-center rounded-full border bg-surface-raised">
            <Plus className="size-5" />
          </span>
          <span className="text-sm text-muted-foreground">新建 AgentFlow</span>
        </button>

        {rows.map((f) => (
          <article
            key={f.id}
            className="group relative flex min-h-[168px] flex-col rounded-lg border bg-surface p-4 text-left shadow-sm transition-shadow hover:shadow-md"
          >
            <button
              type="button"
              className="flex min-w-0 flex-1 flex-col items-start gap-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
              onClick={() => navigate(`/agentflows/${f.id}`)}
            >
              <div className="flex w-full items-center gap-2">
                <span className="truncate text-sm font-semibold">{f.name}</span>
                {f.active_release_id ? (
                  <Badge variant="secondary" className="shrink-0">已发布</Badge>
                ) : (
                  <Badge variant="outline" className="shrink-0">未发布</Badge>
                )}
              </div>
              <p className="line-clamp-2 min-h-10 text-xs leading-5 text-muted-foreground">
                {f.description || "（无描述）"}
              </p>
            </button>
            <div className="mt-2 flex items-center gap-3 border-t pt-2 text-[11px] text-muted-foreground">
              <span>{f.node_count ?? 0} 个节点</span>
              <span>{f.version_count ?? 0} 个版本</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="ml-auto size-6 opacity-0 group-hover:opacity-100"
                    aria-label={`${f.name} 更多操作`}
                  >
                    <MoreHorizontal className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => navigate(`/agentflows/${f.id}`)}>打开</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => navigate(`/agentflows/${f.id}?view=runs`)}>查看执行记录</DropdownMenuItem>
                  <DropdownMenuItem className="text-destructive" onSelect={() => setDel(f)}>
                    <Trash2 className="size-3.5" /> 删除
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </article>
        ))}
      </div>

      {!list.loading && rows.length === 0 && (
        <p className="py-6 text-center text-xs text-muted-foreground">
          暂无 AgentFlow，点击「新建 AgentFlow」创建第一个可运行流程。
        </p>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建 AgentFlow</DialogTitle>
            <DialogDescription>创建后在详情页编排节点、创建版本并发布。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1">
              <Label>名称</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：质检交叉复核" />
            </div>
            <div className="grid gap-1">
              <Label>描述（可选）</Label>
              <Textarea rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={() => void create()}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!del} onOpenChange={(o) => !o && setDel(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除「{del?.name}」？</DialogTitle>
            <DialogDescription>
              删除后该 AgentFlow 的定义、版本与发布记录将不可用；历史运行记录只读保留。此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDel(null)}>取消</Button>
            <Button variant="destructive" onClick={() => del && void remove(del)}>删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
