/** Agent 档案子页（QoderWake /wakers/<id>/settings「Waker 档案」同构）。
 *
 * 原站事实：h2 Waker 档案 + 副文案 + 个人简介 + 「修改角色源文件」三份源文件
 * （identity.md 职责与边界 / persona.md 人格沟通 / bible.md 执行流程）+ 角色管理
 * （删除 Waker）。我方映射：identity=description+rolePrompt、persona=工作风格、
 * bible=发布治理（版本/环境），删除=归档（历史只读保留，不物理删除）。
 */
import * as React from "react"
import { useNavigate } from "react-router-dom"
import { FileText, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { agentApi, type AgentInfo } from "@/services/wf-api"

export interface MountRow { kind: string; name?: string; ref?: string; status?: string; valid?: boolean; version?: string | null }

export function AgentProfileSection({ agent, archived }: { agent: AgentInfo; archived?: boolean }) {
  const navigate = useNavigate()
  const [detailOpen, setDetailOpen] = React.useState(false)
  const [delOpen, setDelOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [mounts, setMounts] = React.useState<MountRow[]>([])

  React.useEffect(() => {
    agentApi
      .mountsHealth(agent.id)
      .then((r) => setMounts((r.items as MountRow[]) ?? []))
      .catch(() => setMounts([]))
  }, [agent.id])

  const rolePrompt = String(
    (agent.config as Record<string, unknown>)?.rolePrompt ?? "",
  )
  const archive = async () => {
    setBusy(true)
    try {
      await agentApi.update(agent.id, { archived: true })
      toast.success("已归档；历史数据保留，仅支持历史查询")
      setDelOpen(false)
      navigate("/agents")
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const sources = [
    { key: "identity.md", hint: "职责与边界 · 『我负责什么』的主要来源", content: agent.description || rolePrompt || "—" },
    {
      key: "persona.md",
      hint: "人格、沟通方式与反模式 · 『我工作的原则』的主要来源",
      content: `类型：${agent.typeLabel}\n能力挂载：${mounts.filter((m) => String(m.kind).toUpperCase() === "SKILL").length} 个 Skill、${mounts.filter((m) => String(m.kind).toUpperCase() === "MCP").length} 个连接器`,
    },
    {
      key: "bible.md",
      hint: "执行流程、审批规则与完成标准 · 『工作原则』的来源",
      content: `发布治理：${agent.status}\n环境指针：沙箱 V${(agent.config as Record<string, unknown>)?.__sandboxVersion ?? "—"} / 线上 V${(agent.config as Record<string, unknown>)?.__prodVersion ?? "—"}`,
    },
  ]

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[28px] font-semibold leading-[38px]">Agent 档案</h2>
        <p className="mt-1 text-sm text-muted-foreground">查看并管理此 Agent 的资料。</p>
      </div>

      <section className="rounded-lg border bg-surface p-4">
        <h3 className="text-sm font-semibold">个人简介</h3>
        <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
          {agent.description || "（尚未填写职责描述）"}
        </p>
      </section>

      <section className="rounded-lg border bg-surface p-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">角色源文件</h3>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => navigate(`/agents/${agent.id}/config`)} disabled={archived}>
            修改角色源文件
          </Button>
        </div>
        <div className="mt-3 space-y-2">
          {sources.map((s) => (
            <div key={s.key} className="rounded-md border px-3 py-2 text-sm">
              <div className="flex items-center gap-2">
                <FileText className="size-3.5 text-muted-foreground" />
                <span className="font-mono text-xs font-medium">{s.key}</span>
                <span className="text-[11px] text-muted-foreground">{s.hint}</span>
                <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setDetailOpen(true)}>
                  查看
                </Button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border bg-surface p-4">
        <h3 className="text-sm font-semibold">能力挂载（真实冻结清单）</h3>
        {mounts.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">暂无挂载（Skill / 连接器 / 知识库 / 工具）。</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {mounts.map((m, i) => (
              <Badge key={i} variant={m.valid === false ? "outline" : "secondary"}>
                {m.kind}·{String(m.name ?? m.ref ?? "").slice(0, 20)}
                {m.valid === false ? "（无效）" : ""}
              </Badge>
            ))}
          </div>
        )}
      </section>

      {!archived && (
        <section className="rounded-lg border border-destructive/40 bg-surface p-4">
          <h3 className="text-sm font-semibold text-destructive">角色管理</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            归档后该 Agent 退出产品运行面（列表/选择器/新建任务不再出现），历史运行与版本只读保留。
          </p>
          <Button variant="outline" size="sm" className="mt-2 text-destructive" onClick={() => setDelOpen(true)}>
            <Trash2 className="size-3.5" /> 归档 Agent
          </Button>
        </section>
      )}

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>角色源文件内容</DialogTitle>
            <DialogDescription>identity.md / persona.md / bible.md 对应的平台真实字段。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {sources.map((s) => (
              <div key={s.key}>
                <div className="font-mono text-xs font-medium">{s.key}</div>
                <pre className="mt-1 whitespace-pre-wrap break-words rounded-md border bg-surface-muted p-2 text-xs">
                  {s.content}
                </pre>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={delOpen} onOpenChange={setDelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>归档这个 Agent？</DialogTitle>
            <DialogDescription>
              归档后停止出现在产品运行面；历史版本、运行与产物只读保留。此操作不可撤销（如需复用请新建）。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDelOpen(false)}>取消</Button>
            <Button variant="destructive" disabled={busy} onClick={() => void archive()}>
              {busy ? "归档中…" : "归档"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
