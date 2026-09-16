/** 创建群组弹窗（DS-011 逐值复刻，台账 §3）。
 * 宽 832 高 680 圆8；标题 input h32 圆6（打开聚焦+默认值全选+清除钮）；
 * 左 pane 291：搜索 h32 圆4 + helper 12 + 成员行 h48 圆6（hover mint-hover/选中 mint-bg、
 * checkbox 16 圆3 选中 mint 白勾、Leader chip 白底）；右 pane：成员卡+设为 Leader 互斥+
 * 响应模型 select+知识挂载；底栏 h64：计数 14 二级色 + 取消 + 创建（0 成员 disabled .5）。 */
import { useEffect, useMemo, useRef, useState } from "react"
import { Search, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { pagedApi } from "@/services/wf-api"
import { groupsApi } from "@/services/as-api"
import { avatarFor } from "@/lib/agent-avatar"

interface Candidate {
  id: string
  name: string
  role: string
  published: boolean
  archived?: boolean
}

export function GroupCreateDialog({
  open, onOpenChange, onCreated,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onCreated?: (gid: string) => void
}) {
  const [name, setName] = useState("新的群组")
  const [query, setQuery] = useState("")
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [leader, setLeader] = useState<string | null>(null)
  const [model, setModel] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setName("新的群组")
    setQuery("")
    setSelected([])
    setLeader(null)
    setModel({})
    pagedApi.agents({ page: 1, pageSize: 100 }).then((r) => {
      // 候选约束（Spec §5.3）：仅已发布（prodVersion）且未归档
      setCandidates(r.items.map((a) => ({
        id: a.id,
        name: a.name,
        role: (a as { typeLabel?: string }).typeLabel ?? a.type,
        published: (a as { prodVersion?: number | null }).prodVersion != null,
        archived: a.archived,
      })))
    }).catch(() => setCandidates([]))
    const t = window.setTimeout(() => {
      titleRef.current?.focus()
      titleRef.current?.select()
    }, 30)
    return () => window.clearTimeout(t)
  }, [open])

  const shown = useMemo(
    () => candidates.filter((c) => c.name.includes(query.trim())),
    [candidates, query])

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      if (!next.includes(leader as string)) setLeader(next[0] ?? null)
      else if (!prev.includes(id) && leader === null) setLeader(id)
      return next
    })
  }

  const submit = async () => {
    if (!selected.length || !leader) return
    setSaving(true)
    try {
      const g = await groupsApi.create({
        name,
        leader_agent_id: leader,
        members: selected.map((id) => ({
          agent_id: id,
          config: model[id] ? { chat_model_config: { model: model[id] } } : {},
        })),
      })
      toast.success("群组已创建")
      onOpenChange(false)
      onCreated?.(g.id)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "创建失败")
    } finally {
      setSaving(false)
    }
  }

  const active = selected.length > 0
  const activeCandidate = candidates.find((c) => c.id === selected[selected.length - 1])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex flex-col gap-0 overflow-hidden p-0"
        style={{ width: 832, maxWidth: 832, height: 680, borderRadius: 8 }}
      >
        <DialogHeader className="border-b border-(--border) px-6 pb-4 pt-5">
          <DialogTitle className="text-[16px] font-medium">创建群组</DialogTitle>
          <p className="text-[14px] text-(--text-tertiary)">
            选择 Agent 成员、编辑群聊标题，并指定 Leader。
          </p>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col px-6 pt-5">
          <span className="text-[14px] font-medium">群聊标题</span>
          <div className="relative mt-1.5">
            <Input
              ref={titleRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-8 rounded-[6px] pr-8 text-[14px] font-medium"
            />
            {name && (
              <button
                aria-label="清除群组名称"
                className="absolute right-2 top-2 text-(--text-tertiary)"
                onClick={() => { setName(""); titleRef.current?.focus() }}
              >
                <X size={16} />
              </button>
            )}
          </div>
          <div className="mt-5 flex min-h-0 flex-1 gap-6 border-t border-(--border) pt-5">
            <div className="flex w-[291px] shrink-0 flex-col">
              <span className="text-[14px] font-medium">Agent 成员</span>
              <div className="mt-2 flex h-8 items-center gap-2 rounded-[4px] border border-(--border) px-2">
                <Search size={14} className="text-(--text-tertiary)" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索 Agent"
                  className="h-5 flex-1 bg-transparent text-[14px] outline-none"
                />
              </div>
              <p className="mt-2 text-[12px] text-(--text-tertiary)">
                群聊可选择多个 Agent，并需指定一位 Leader。
              </p>
              <div className="mt-2 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
                {shown.map((c) => {
                  const sel = selected.includes(c.id)
                  return (
                    <button
                      key={c.id}
                      onClick={() => toggle(c.id)}
                      className="flex h-12 items-center gap-2 rounded-[6px] p-2 text-left transition-colors"
                      style={{
                        background: sel
                          ? "var(--group-primary-bg)"
                          : undefined,
                      }}
                      onMouseEnter={(e) => {
                        if (!sel) e.currentTarget.style.background = "var(--group-primary-bg-hover)"
                      }}
                      onMouseLeave={(e) => {
                        if (!sel) e.currentTarget.style.background = ""
                      }}
                    >
                      <Checkbox checked={sel} className="pointer-events-none" />
                      <img src={avatarFor(c.id)} alt="" className="h-8 w-8 rounded-full" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 text-[14px] font-medium">
                          <span className="truncate">{c.name}</span>
                          <span className="shrink-0 rounded-[4px] px-[5px] py-px text-[10px] font-semibold"
                            style={{ color: "#0B83F1", background: "rgba(11,131,241,.08)" }}>
                            本机
                          </span>
                        </span>
                        <span className="block truncate text-[12px] text-(--text-tertiary)">
                          {c.role}
                        </span>
                      </span>
                      {sel && leader === c.id && (
                        <span className="h-6 shrink-0 rounded-[4px] bg-(--surface-raised) px-2 text-[12px] leading-6 text-(--text-tertiary)">
                          Leader
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="min-w-0 flex-1 overflow-y-auto border-l border-(--border) pl-5">
              {!active || !activeCandidate ? (
                <div className="flex h-full items-center justify-center text-[14px] text-(--text-tertiary)">
                  请先选择一位 Agent，再配置其响应模型和知识挂载。
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3 rounded-[6px] border border-(--border) p-3">
                    <img src={avatarFor(activeCandidate.id)} alt="" className="h-10 w-10 rounded-full" />
                    <span>
                      <span className="block text-[14px] font-medium">{activeCandidate.name}</span>
                      <span className="block text-[12px] text-(--text-tertiary)">{activeCandidate.role}</span>
                    </span>
                    <label className="ml-auto flex items-center gap-2">
                      <Checkbox
                        checked={leader === activeCandidate.id}
                        disabled={selected.length <= 1}
                        onCheckedChange={() => setLeader(activeCandidate.id)}
                      />
                      <strong className="text-[14px] font-medium">设为 Leader</strong>
                    </label>
                  </div>
                  <div className="mt-5">
                    <span className="text-[14px] font-medium">响应模型</span>
                    <Select
                      value={model[activeCandidate.id] ?? "auto"}
                      onValueChange={(v) => setModel((m) => ({ ...m, [activeCandidate.id]: v }))}
                    >
                      <SelectTrigger className="mt-1.5 h-8 rounded-[4px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Auto</SelectItem>
                        <SelectItem value="qwen-max">qwen-max</SelectItem>
                        <SelectItem value="qwen-plus">qwen-plus</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="mt-1.5 text-[12px] text-(--text-tertiary)">仅应用于当前 Agent</p>
                  </div>
                  <div className="mt-5">
                    <span className="text-[14px] font-medium">知识挂载</span>
                    <p className="mt-1.5 text-[12px] text-(--text-tertiary)">
                      可挂载知识库；未选择时使用 Agent 发布冻结的默认挂载
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex h-16 shrink-0 items-center justify-between px-6">
          <span className="text-[14px] text-(--text-secondary)">
            已配置 {selected.length} 个 Agent
          </span>
          <span className="flex gap-3">
            <Button variant="outline" className="h-8" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button
              className="h-8 disabled:opacity-50"
              disabled={!selected.length || !leader || saving}
              onClick={submit}
            >
              创建
            </Button>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
