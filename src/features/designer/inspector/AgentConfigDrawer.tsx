/** AgentConfigDrawer：旧 Agent 画布的配置抽屉（R-Archive：仅只读挂载，保存/头像编辑已移除）。
 *  含知识兜底多选（A-11 真注册表）与专家组成员池（SDD D-1）。
 *  Theme-R：表面色全部 token 化。 */
import { useEffect, useState } from "react"
import { FolderOpen, PanelLeftClose, PanelLeftOpen, X } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ConversationPanel, MemorySchemaForm } from "@/components/agent-common-config"
import { avatarFor } from "@/pages/wf-agents-list"
import { C } from "@/components/wf/controls"
import { agentApi } from "@/services/wf-api"
import { resApi } from "@/services/resource-api"
import type { NodeCfgLoose } from "../designer-types"

function KnowledgeFallbackPicker({ ids, onChange }: { ids: string[]; onChange: (v: string[]) => void }) {
  const [items, setItems] = useState<{ id: string; name: string }[]>([])
  const [open, setOpen] = useState(false)
  useEffect(() => { resApi.registry("knowledge").then((r) => setItems(r.items)).catch(() => setItems([])) }, [])
  const nameOf = (id: string) => items.find((i) => i.id === id)?.name ?? id
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium" style={{ color: C.ink }}>| Agent 知识兜底</span>
        <button className="text-xs" style={{ color: C.primary }} onClick={() => setOpen(!open)}>{open ? "收起" : "添加知识"}</button>
      </div>
      {ids.length === 0 && !open && (
        <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-lg border" style={{ borderColor: C.cardBorder, background: "var(--surface-muted)" }}>
          <FolderOpen className="size-8 text-muted-foreground" />
          <span className="px-4 text-center text-xs" style={{ color: C.ink3 }}>添加知识文件，让Agent具备知识信息大脑</span>
        </div>
      )}
      {ids.map((id) => (
        <div key={id} className="flex items-center gap-1 text-xs">
          <span className="flex-1 truncate rounded border px-1 py-0.5" style={{ borderColor: C.cardBorder }}>{nameOf(id)}</span>
          <button onClick={() => onChange(ids.filter((x) => x !== id))}><X className="size-3 text-muted-foreground" /></button>
        </div>
      ))}
      {open && (
        <div className="max-h-40 space-y-0.5 overflow-y-auto rounded border p-1" style={{ borderColor: C.cardBorder }}>
          {items.length === 0 && <div className="px-1 py-1 text-[11px]" style={{ color: C.ink3 }}>暂无 Enabled 知识资源</div>}
          {items.map((it) => (
            <label key={it.id} className="flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-xs hover:bg-accent">
              <Checkbox checked={ids.includes(it.id)}
                onCheckedChange={(v) => onChange(v ? [...ids, it.id] : ids.filter((x) => x !== it.id))} />
              <span className="truncate">{it.name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

function MemberPoolPicker({ ids, onChange, selfId, readOnly = false }: { ids: string[]; onChange: (v: string[]) => void; selfId: string; readOnly?: boolean }) {
  const [all, setAll] = useState<{ id: string; name: string }[]>([])
  const [open, setOpen] = useState(false)
  useEffect(() => {
    agentApi.list({ pageSize: 100 }).then((r) => setAll(r.items.filter((a) => a.id !== selfId))).catch(() => undefined)
  }, [selfId])
  const nameOf = (id: string) => all.find((a) => a.id === id)?.name ?? id
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium" style={{ color: C.ink }}>| 成员 Agent</span>
        {!readOnly && (
          <button className="text-xs" style={{ color: C.primary }} onClick={() => setOpen(!open)}>{open ? "收起" : "添加成员"}</button>
        )}
      </div>
      {ids.length === 0 && !open && (
        <p className="text-[11px]" style={{ color: C.ink3 }}>添加后，画布中「Agent选择/执行」节点可从成员池选择。</p>
      )}
      {ids.map((id) => (
        <div key={id} className="flex items-center gap-1 text-xs">
          <span className="flex-1 truncate rounded border px-1 py-0.5" style={{ borderColor: C.cardBorder }}>{nameOf(id)}</span>
          {!readOnly && <button onClick={() => onChange(ids.filter((x) => x !== id))}><X className="size-3 text-muted-foreground" /></button>}
        </div>
      ))}
      {open && (
        <div className="max-h-40 space-y-0.5 overflow-y-auto rounded border p-1" style={{ borderColor: C.cardBorder }}>
          {all.length === 0 && <div className="px-1 py-1 text-[11px]" style={{ color: C.ink3 }}>暂无可添加的 Agent</div>}
          {all.map((a) => (
            <label key={a.id} className="flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-xs hover:bg-accent">
              <Checkbox checked={ids.includes(a.id)}
                onCheckedChange={(v) => onChange(v ? [...ids, a.id] : ids.filter((x) => x !== a.id))} />
              <span className="truncate">{a.name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

export function AgentConfigDrawer({ agentId, inline, avatar, onClose, readOnly = false }: {
  agentId: string; onClose?: () => void; inline?: boolean; avatar?: string; readOnly?: boolean
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [agent, setAgent] = useState<{ name: string; description: string; config: NodeCfgLoose; workflowId?: string | null; configRevision: number; avatar?: string | null; type?: string } | null>(null)
  useEffect(() => {
    agentApi.get(agentId).then(setAgent)
  }, [agentId])
  if (!agent) return null
  const cfg = agent.config ?? {}
  const setCfg = (k: string, v: unknown) => setAgent({ ...agent, config: { ...cfg, [k]: v } })
  if (collapsed) {
    return (
      <div className="flex h-full w-10 shrink-0 flex-col items-center border-r bg-surface py-2" style={{ borderColor: C.cardBorder }}>
        <button className="rounded p-1 hover:bg-accent" title="展开配置" onClick={() => setCollapsed(false)}>
          <PanelLeftOpen className="size-4" style={{ color: C.ink2 }} />
        </button>
      </div>
    )
  }
  return (
    <div className={inline ? "flex h-full w-[360px] max-w-[92vw] shrink-0 flex-col border-r bg-surface" : "absolute inset-y-0 right-0 z-20 flex w-[360px] max-w-[92vw] flex-col border-l bg-surface"} style={{ borderColor: C.cardBorder }}>
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-[15px] font-semibold" style={{ color: C.ink }}>Agent 配置信息</span>
        <span className="flex items-center gap-2">
          <button className="rounded p-1 hover:bg-accent" title="收起配置" onClick={() => setCollapsed(true)}>
            <PanelLeftClose className="size-4" style={{ color: C.ink2 }} />
          </button>
          {!inline && <button onClick={onClose}><X className="size-4 text-muted-foreground" /></button>}
        </span>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <div className="space-y-2">
          <span className="text-[13px] font-medium" style={{ color: C.ink }}>| 基本信息</span>
          <div className="flex items-start gap-3">
            <div className="flex-1 space-y-3">
              <div className="relative">
                <Input value={agent.name} maxLength={20} placeholder="请输入Agent名称" className="pr-12" readOnly={readOnly}
                  onChange={(e) => setAgent({ ...agent, name: e.target.value })} />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px]" style={{ color: C.ink3 }}>{agent.name.length}/20</span>
              </div>
              <div className="relative">
                <Textarea value={agent.description} maxLength={20000} placeholder="请输入该Agent描述介绍文案（仅在管理平台展示）" className="min-h-24 pb-6" readOnly={readOnly}
                  onChange={(e) => setAgent({ ...agent, description: e.target.value })} />
                <span className="absolute bottom-2 right-2 text-[11px]" style={{ color: C.ink3 }}>{(agent.description ?? "").length}/20000</span>
              </div>
            </div>
            <button className="shrink-0 overflow-hidden rounded-lg border bg-popover p-1" style={{ borderColor: C.cardBorder }} title="头像"
              disabled>
              {/* 头像优先级：本次会话新选 > 已保存头像 > 按 id 哈希回落（与列表/头部一致） */}
              <img src={avatar ?? avatarFor(agentId ?? "", agent.avatar)} alt="agent头像" className="size-24 rounded-md object-cover" />
            </button>
          </div>
        </div>
        <KnowledgeFallbackPicker ids={cfg.knowledges ?? []} onChange={(v) => setCfg("knowledges", v)} />
        {agent.type === "expert-group" && (
          <MemberPoolPicker ids={(cfg.members ?? []) as string[]} onChange={(v) => setCfg("members", v)} selfId={agentId} readOnly={readOnly} />
        )}
        <div className="space-y-2">
          <span className="text-[13px] font-medium" style={{ color: C.ink }}>| Agent 记忆</span>
          <MemorySchemaForm memories={cfg.memoriesSchema ?? []} onChange={(v) => setCfg("memoriesSchema", v)} readOnly={readOnly} />
        </div>
        <div className="space-y-2">
          <span className="text-[13px] font-medium" style={{ color: C.ink }}>| 对话体验</span>
          <ConversationPanel cfg={cfg} setCfg={(v) => setAgent({ ...agent, config: v })} readOnly={readOnly} />
        </div>
        {readOnly && (
          <div className="rounded px-3 py-2 text-xs" style={{ background: "var(--status-warning-soft)", color: "var(--status-warning)" }}>
            该旧版 Agent 已封存，仅支持历史查询；配置编辑不再开放。
          </div>
        )}
      </div>
    </div>
  )
}
