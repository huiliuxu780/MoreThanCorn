/** 09-07 Agent 工作区壳（原站 /wakers/{id} 二级侧栏 IA 同构 + 发布治理组）。
 *  2026-09-10 最终清零轮 §八 返工：
 *  - 删除横跨二级栏与内容区的全宽 hero（Agent 完整身份只在概览展示一次）；
 *  - 二级栏 240px、自 y=0 起（顶部仅紧凑返回+头像+名称）；
 *  - 主内容自带独立 48px 页头（子页标题 + 版本/环境 chip + 对话/更多操作）；
 *  - 切换子页时宽度/padding/滚动容器不变（同一 Shell）。 */
import type * as React from "react"
import { useNavigate } from "react-router-dom"
import {
  ArrowLeft, BookMarked, ClipboardList, Copy, Database, FileText, GitBranch, Home,
  MessageCircleMore, MoreHorizontal, Plug, Settings2, ShieldCheck, Sparkles,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { avatarFor } from "@/lib/agent-avatar"
import type { AgentInfo } from "@/services/wf-api"

export type WorkspaceSection =
  | "home" | "board" | "autonomous" | "memory" | "skills" | "connectors" | "workflows" | "knowledge"
  | "config" | "governance" | "profile"

const NAV: { group?: string; key: WorkspaceSection; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "home", label: "概览", icon: Home },
  { group: "工作", key: "board", label: "任务看板", icon: ClipboardList },
  { key: "autonomous", label: "自主工作", icon: Sparkles },
  { group: "记忆与学习", key: "memory", label: "记忆", icon: BookMarked },
  { group: "能力与资源", key: "skills", label: "Skill", icon: Sparkles },
  { key: "connectors", label: "连接器", icon: Plug },
  { key: "workflows", label: "AgentFlow", icon: GitBranch },
  { key: "knowledge", label: "知识库", icon: Database },
  { group: "权限与管理", key: "config", label: "配置", icon: Settings2 },
  { key: "governance", label: "发布治理", icon: ShieldCheck },
  { key: "profile", label: "Agent 档案", icon: FileText },
]

const SECTION_LABEL: Record<WorkspaceSection, string> = Object.fromEntries(
  NAV.map((n) => [n.key, n.label]),
) as Record<WorkspaceSection, string>

export function AgentWorkspaceShell({ agent, section, versionChip, envChips, archived, children }: {
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
    <div className="flex h-full min-h-0 min-w-0 flex-1 overflow-hidden" data-testid="agent-workspace-shell">
      {/* 二级侧栏：240px，自 y=0 起（无全宽 hero 占位）；独立滚动 */}
      <nav aria-label="Agent 详情导航" className="flex w-[240px] shrink-0 flex-col overflow-hidden border-r bg-surface">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            aria-label="返回 Agent 列表"
            onClick={() => navigate("/agents")}
          >
            <ArrowLeft className="size-3.5" />
          </Button>
          <img src={avatarFor(agent.id, agent.avatar)} alt="" className="size-6 shrink-0 rounded-full object-cover" />
          <span className="min-w-0 truncate text-sm font-medium">{agent.name}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          <div className="flex flex-col gap-3">
            {NAV.map((item) => (
              <div key={item.key} className="flex flex-col gap-1">
                {item.group ? (
                  <div className="px-2 py-1 text-[11px] leading-[13px] text-(--text-tertiary)">{item.group}</div>
                ) : null}
                <button
                  type="button"
                  onClick={() => navigate(`/agents/${agent.id}/${item.key}`)}
                  className={`flex h-8 w-full items-center gap-2 rounded px-3 text-[13px] leading-5 transition-colors ${
                    section === item.key
                      ? "bg-(--detail-menu-active) font-medium text-[#FAFAF8]"
                      : "text-muted-foreground hover:bg-(--fill-tertiary) hover:text-foreground"}`}
                >
                  <item.icon className="size-4" /> {item.label}
                </button>
              </div>
            ))}
          </div>
        </div>
      </nav>

      {/* 主内容：独立 48px 页头 + 滚动区（子页切换不变结构） */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
          <h1 className="truncate text-sm font-semibold">{SECTION_LABEL[section]}</h1>
          {archived && (
            <span className="shrink-0 rounded-md bg-(--segment-bg) px-1.5 py-0.5 text-[11px] text-(--text-tertiary)">
              已封存 · 只读
            </span>
          )}
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
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto bg-background p-4">{children}</main>
      </div>
    </div>
  )
}
