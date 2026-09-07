/** 09-07 Agent 工作区壳（原站 /wakers/{id} 二级侧栏 IA 同构 + 发布治理组）。
 * 度量来源：.tmp-docs/agent-cap/measurements.md §2/§5（侧栏 w207/项 h32 r4 13px/组标签 11px；
 * hero name 15/600；hover==选中同底+字重 500 沿用 09-06 结论）。 */
import type * as React from "react"
import { useNavigate } from "react-router-dom"
import {
  ArrowLeft, BookMarked, ClipboardList, Copy, Database, GitBranch, Home,
  MessageCircleMore, MoreHorizontal, Plug, Settings2, ShieldCheck, Sparkles,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { avatarFor } from "@/lib/agent-avatar"
import type { AgentInfo } from "@/services/wf-api"

export type WorkspaceSection =
  | "home" | "board" | "memory" | "skills" | "connectors" | "workflows" | "knowledge" | "config" | "governance"

const NAV: { group?: string; key: WorkspaceSection; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "home", label: "概览", icon: Home },
  { group: "工作", key: "board", label: "任务看板", icon: ClipboardList },
  { group: "记忆与学习", key: "memory", label: "记忆", icon: BookMarked },
  { group: "能力与资源", key: "skills", label: "Skill", icon: Sparkles },
  { key: "connectors", label: "连接器", icon: Plug },
  { key: "workflows", label: "Wakerflow", icon: GitBranch },
  { key: "knowledge", label: "知识库", icon: Database },
  { group: "权限与管理", key: "config", label: "配置", icon: Settings2 },
  { key: "governance", label: "发布治理", icon: ShieldCheck },
]

export function AgentWorkspaceShell({ agent, role, section, versionChip, envChips, archived, children }: {
  agent: AgentInfo
  role?: string | null
  section: WorkspaceSection
  versionChip?: React.ReactNode
  envChips?: React.ReactNode
  archived?: boolean
  children: React.ReactNode
}) {
  const navigate = useNavigate()
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* hero 顶栏 */}
      <div className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-3 border-b bg-surface px-4">
        <img src={avatarFor(agent.id, agent.avatar)} alt="" className="size-8 rounded-full object-cover" />
        <span className="truncate text-[15px] font-semibold">{agent.name}</span>
        <span className="shrink-0 rounded-lg border px-1.5 py-0.5 text-xs font-medium leading-[14px] text-(--chip-fg)"
          style={{ borderColor: "var(--chip-border)" }}>
          {role ?? agent.typeLabel}
        </span>
        {archived && (
          <span className="shrink-0 rounded-md bg-(--segment-bg) px-1.5 py-0.5 text-[11px] text-(--text-tertiary)">
            已封存 · 只读
          </span>
        )}
        <span className="min-w-0 truncate text-xs text-muted-foreground">{agent.description || "—"}</span>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {versionChip}
          {envChips}
          {!archived && (
            <Button variant="outline" size="sm" onClick={() => navigate(`/agents/${agent.id}/chat`)}>
              <MessageCircleMore className="size-3.5" /> 对话
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8" aria-label="更多操作">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => navigator.clipboard.writeText(agent.id)}>
                <Copy className="size-3.5" /> 复制 ID
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        {/* 二级侧栏（原站 w207 / 项 h32 / 组标签 11px） */}
        <nav aria-label="Agent 详情导航" className="w-[240px] shrink-0 overflow-y-auto border-r bg-surface px-4 py-2">
          <Button variant="ghost" size="sm" className="gap-1 px-0 text-[14px] font-medium text-muted-foreground" onClick={() => navigate("/agents")}>
            <ArrowLeft className="size-3.5" /> 返回
          </Button>
          <div className="my-2 border-t border-dashed" style={{ borderColor: "var(--border)" }} />
          <div className="flex flex-col gap-3">
          {NAV.map((item) => (
            <div key={item.key} className="flex flex-col gap-1">
              {item.group ? (
                <div className="py-1 text-[11px] leading-[13px] text-(--text-tertiary)">{item.group}</div>
              ) : null}
              <button
                type="button"
                onClick={() => navigate(`/agents/${agent.id}/${item.key}`)}
                className={`flex h-8 w-full items-center gap-2 rounded text-[13px] leading-5 transition-colors ${
                  section === item.key
                    ? "bg-(--detail-menu-active) font-medium text-[#FAFAF8]"
                    : "px-4 text-muted-foreground hover:bg-(--fill-tertiary) hover:text-foreground"}`}
              >
                <item.icon className="size-4" /> {item.label}
              </button>
            </div>
          ))}
          </div>
        </nav>
        <main className="min-w-0 flex-1 overflow-y-auto bg-background p-4">{children}</main>
      </div>
    </div>
  )
}
