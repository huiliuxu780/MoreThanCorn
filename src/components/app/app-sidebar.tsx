import { Bot, Boxes, CalendarClock, Check, ClipboardList, LogIn, LogOut, Monitor, Plus, Search, Waypoints, Workflow, Moon, MoonStar, Settings, ShieldCheck, Sun, Sunrise, UserRound } from "lucide-react"
import * as React from "react"
import { NavLink, useLocation, useNavigate } from "react-router-dom"
import { useTheme } from "next-themes"
import { UI_TERMS } from "@/config/ui-terms"
import { currentUsername, rbac, ROLES, type Permission, type Role } from "@/services/rbac"
import { pagedApi } from "@/services/wf-api"
import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { CortexMark } from "@/components/app/logo"
import { avatarFor } from "@/lib/agent-avatar"
import { groupsApi, type GroupView } from "@/services/as-api"
import { GroupAvatarCluster } from "@/features/groups/group-avatar"
import { GroupCreateDialog } from "@/features/groups/group-create-dialog"

export interface NavItem {
  label: string
  to: string
  icon: React.ComponentType<{ className?: string }>
  permission: Permission
  /** 视为选中态的路径前缀（含仍挂载的旧路由，保证旧页面内导航高亮不丢）。 */
  activePrefixes: string[]
}

/**
 * 2026-09-09 换底（任务书 §十三C）：导航复刻 QoderWake 壳——分组 heading +
 * 可折叠侧栏；Group 能力不引入；一级项为我方模块。
 */
export const NAV_ITEMS: NavItem[] = [
  {
    label: UI_TERMS.navigation.tasksWorkbench,
    to: "/tasks",
    icon: CalendarClock,
    permission: "task.view",
    activePrefixes: ["/tasks", "/operations"],
  },
  {
    label: UI_TERMS.navigation.autonomousTasks,
    to: "/autonomous-tasks",
    icon: ClipboardList,
    permission: "task.view",
    activePrefixes: ["/autonomous-tasks"],
  },
  {
    label: UI_TERMS.navigation.agents,
    to: "/agents",
    icon: Bot,
    permission: "agent.view",
    activePrefixes: ["/agents"],
  },
  {
    label: UI_TERMS.navigation.workflows,
    to: "/workflows",
    icon: Workflow,
    permission: "agent.view",
    activePrefixes: ["/workflows", "/config/forms"],
  },
  {
    label: "AgentFlow",
    to: "/agentflows",
    icon: Waypoints,
    permission: "agent.view",
    activePrefixes: ["/agentflows"],
  },
  {
    label: UI_TERMS.navigation.resourcesHub,
    to: "/resources",
    icon: Boxes,
    permission: "tool.view",
    activePrefixes: [
      "/resources",
      "/config/ai-resources",
      "/config/data-resources",
      "/config/data-assets",
    ],
  },
  /* 09-15 合并案（IA 原则）：数据接入不再有独立导航条目——
     唯一入口=能力与资源→数据磁贴（/resources/data） */
]

/** QoderWake 同构分组：工作管理 / 员工资源（无 Group）。 */
export const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  { title: "工作管理", items: NAV_ITEMS.slice(0, 2) },
  { title: "员工资源", items: NAV_ITEMS.slice(2) },
]

export type TopNavKey =
  | "tasks"
  | "autonomous"
  | "agents"
  | "resources"
  | "workflows"
  | "agentflows"
  | "settings"

const NAV_KEY_BY_TO: Record<string, TopNavKey> = {
  "/tasks": "tasks",
  "/autonomous-tasks": "autonomous",
  "/agents": "agents",
  "/resources": "resources",
  "/workflows": "workflows",
  "/agentflows": "agentflows",
}

/** 任一路径最多一个一级项 active；/settings/** → 设置。 */
export function computeActiveNav(pathname: string): TopNavKey | null {
  if (pathname === "/settings" || pathname.startsWith("/settings/")) {
    return "settings"
  }
  for (const item of NAV_ITEMS) {
    if (item.activePrefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
      return NAV_KEY_BY_TO[item.to]
    }
  }
  return null
}

/** 09-06 原站对齐：四套主题（data-theme 机制），与 index.css token 块一一对应。 */
const THEME_OPTIONS = [
  { value: "system", label: "跟随系统", icon: Monitor },
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
  { value: "light-parchment", label: "浅色羊皮纸", icon: Sunrise },
  { value: "dark-parchment", label: "深色羊皮纸", icon: MoonStar },
] as const

function ThemeSubMenu() {
  const { theme, setTheme } = useTheme()
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Sun className="size-4" />
        {UI_TERMS.navigation.theme}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent sideOffset={8} className="min-w-40">
        {THEME_OPTIONS.map((o) => (
          <DropdownMenuItem key={o.value} onSelect={() => setTheme(o.value)}>
            <o.icon className="size-4" />
            {o.label}
            {theme === o.value ? <Check className="ml-auto size-4" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

export interface AccountMenuProps {
  authed: boolean
  needLogin: boolean
  role: Role
  onRoleChange: (role: Role) => void
  onLogout: () => void
  onLoginRequest: () => void
}

function AccountMenu({
  trigger,
  side = "right",
  authed,
  needLogin,
  role,
  onRoleChange,
  onLogout,
  onLoginRequest,
}: AccountMenuProps & { trigger: React.ReactNode; side?: "right" | "top" }) {
  const navigate = useNavigate()
  const username = authed ? currentUsername() : "dev"
  const roleLabel = ROLES.find((r) => r.value === role)?.label ?? role
  const initial = username.slice(0, 1).toUpperCase() || "?"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent side={side} align="start" sideOffset={8} className="min-w-56">
        <DropdownMenuLabel className="flex items-center gap-2 font-normal">
          <span
            aria-hidden
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground"
          >
            {initial}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{username}</span>
            <span className="block truncate text-xs text-muted-foreground">{roleLabel}</span>
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <ThemeSubMenu />
        <DropdownMenuItem onSelect={() => navigate("/settings")}>
          <Settings className="size-4" />
          {UI_TERMS.navigation.settings}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>
          <UserRound className="size-4" />
          个人资料
          <span className="ml-auto text-xs text-muted-foreground">暂未开放</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate("/settings?section=appearance")}>
          <Sun className="size-4" />
          我的偏好
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate("/settings?section=security")}>
          <ShieldCheck className="size-4" />
          我的权限
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {authed ? (
          <DropdownMenuItem onSelect={onLogout}>
            <LogOut className="size-4" />
            退出登录
          </DropdownMenuItem>
        ) : needLogin ? (
          <DropdownMenuItem onSelect={onLoginRequest}>
            <LogIn className="size-4" />
            登录
          </DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              开发身份 · 本地角色切换
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup value={role} onValueChange={(v) => onRoleChange(v as Role)}>
              {ROLES.map((r) => (
                <DropdownMenuRadioItem key={r.value} value={r.value}>
                  {r.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export type AppNavProps = AccountMenuProps

/** 侧栏单项：图标+文字横排（09-15 固定宽拍板后无收起态）。 */
function SideLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <NavLink
      to={item.to}
      title={item.label}
      data-active={active || undefined}
      className={cn(
        "flex h-8 items-center gap-2 px-2 rounded text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
      )}
    >
      <item.icon className="size-4 shrink-0" />
      <span className="truncate">{item.label}</span>
    </NavLink>
  )
}

/** 原站员工与群组区（Group Spec §5.1，09-15 恢复 09-09 移除的 Group tablist）：
 * tablist Agent(n)|Group(n) 选中 2px 黑下划线 + 虚线新建钮（随 tab 切文案）+
 * 搜索 + 对象卡列表（群卡=32 头像簇+名 13/600+成员名串 12 三级色）。 */
function AgentListSection() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [agents, setAgents] = React.useState<
    { id: string; name: string; description?: string; avatar?: string | null; archived?: boolean }[]
  >([])
  const [q, setQ] = React.useState("")
  React.useEffect(() => {
    // 09-13 审计修复：原生 fetch 收口到服务层（统一基址/鉴权/超时/错误解析）
    let alive = true
    pagedApi.agents({ page: 1, pageSize: 50 })
      .then((d) => {
        if (alive)
          setAgents(
            (d.items ?? [])
              .map((a) => a as typeof a & { description?: string })
              .filter((a) => !a.archived)
              .map((a) => ({ id: a.id, name: a.name, description: a.description,
                             avatar: a.avatar, archived: a.archived })),
          )
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])
  const filtered = agents.filter((a) => a.name.toLowerCase().includes(q.toLowerCase()))
  const [tab, setTab] = React.useState<"agents" | "groups">("agents")
  const [groups, setGroups] = React.useState<GroupView[]>([])
  const [createOpen, setCreateOpen] = React.useState(false)
  const searchRef = React.useRef<HTMLInputElement>(null)
  React.useEffect(() => {
    let alive = true
    groupsApi.list().then((r) => { if (alive) setGroups(r.items) }).catch(() => undefined)
    return () => { alive = false }
  }, [])
  const filteredGroups = groups.filter((g) => g.name.includes(q.trim()))

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t pt-2" style={{ borderColor: "var(--sidebar-border)" }}>
      <div
        className="flex items-center border-b px-3"
        style={{ borderColor: "var(--border)" }}
        role="tablist"
        aria-label="员工与群组"
      >
        {(["agents", "groups"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`w-24 border-b-2 px-1 py-2 text-xs font-medium transition-colors ${
              tab === t
                ? "border-(--text-primary) text-(--text-primary)"
                : "border-transparent text-(--text-secondary) hover:text-(--text-primary)"
            }`}
          >
            {t === "agents" ? `Agent（${agents.length}）` : `Group（${groups.length}）`}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 px-3 pt-3">
        <button
          type="button"
          className="flex h-8 flex-auto items-center justify-center gap-2 rounded-[6px] border border-dashed px-2 text-[13px] transition-colors hover:bg-(--surface-raised) hover:text-(--text-primary)"
          style={{ borderColor: "var(--border)", color: "var(--text-tertiary)" }}
          onClick={() => (tab === "agents" ? navigate("/agents/new") : setCreateOpen(true))}
        >
          <Plus size={14} />
          <span className="truncate">{tab === "agents" ? "新建 Agent" : "新建 Group"}</span>
        </button>
        <button
          type="button"
          aria-label="搜索"
          className="mr-1 shrink-0 text-(--text-tertiary)"
          onClick={() => searchRef.current?.focus()}
        >
          <Search size={15} />
        </button>
      </div>
      <div className="px-2 pb-1 pt-2">
        <input
          ref={searchRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={tab === "agents" ? "搜索 Agent" : "搜索群组"}
          className="w-full rounded-md border bg-transparent px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>
      {/* §八：填满剩余空间并独立滚动（删除 max-h-64 限制） */}
      {tab === "agents" && (
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
        {filtered.map((a) => {
          const activeAgent = pathname === `/agents/${a.id}` || pathname.startsWith(`/agents/${a.id}/`)
          return (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => navigate(`/agents/${a.id}`)}
                title={a.name}
                className={cn(
                  "flex min-h-14 w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                  activeAgent
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent",
                )}
              >
                <img
                  src={avatarFor(a.id, a.avatar)}
                  alt=""
                  className="mt-0.5 size-8 shrink-0 rounded-full object-cover"
                />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium">{a.name}</span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {a.description || "—"}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
        {!filtered.length && (
          <li className="px-2 py-3 text-center text-[10px] text-muted-foreground">暂无 Agent</li>
        )}
      </ul>
      )}
      {tab === "groups" && (
        <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 pb-2 pt-1">
          {filteredGroups.map((g) => (
            <li key={g.id}>
              <button
                type="button"
                onClick={() => navigate(`/groups/${g.id}`)}
                title={g.name}
                className="flex h-14 w-full items-center gap-2 rounded-[6px] px-1.5 text-left transition-colors hover:bg-(--surface-muted)"
              >
                <GroupAvatarCluster memberIds={g.members.map((m) => m.agentId)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-(--text-primary)">
                    {g.name}
                  </span>
                  <span className="block truncate text-xs text-(--text-tertiary)">
                    {g.members.map((m) => m.agentName).join("、")}
                  </span>
                </span>
              </button>
            </li>
          ))}
          {!filteredGroups.length && (
            <li className="px-2 py-3 text-center text-[10px] text-muted-foreground">暂无 Group</li>
          )}
        </ul>
      )}
      <GroupCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}

/**
 * 2026-09-09 换底：QoderWake 同构应用壳侧栏——分组 heading、活跃 Agent 列表区、底部用户区。
 * 09-15 用户拍板：**固定 208px 宽、取消折叠**（翻覆 09-10 可折叠壳拍板：宽度永远可预期，
 * 代价=失去 240 展开态与 64 窄轨；长 Agent 名/描述以 truncate 处理）。
 */
export function AppSidebar(props: AppNavProps) {
  const { pathname } = useLocation()
  const navigateTo = useNavigate()
  const active = computeActiveNav(pathname)
  const username = props.authed ? currentUsername() : "dev"
  const initial = username.slice(0, 1).toUpperCase() || "?"

  return (
    <aside
      className="sticky top-0 hidden h-dvh w-52 shrink-0 flex-col border-r bg-sidebar md:flex"
      data-testid="app-sidebar"
    >
      {/* 品牌区 48px（导航自 y=48 起）；09-15 固定宽后无折叠按钮。 */}
      <div className="flex h-12 shrink-0 items-center gap-2 px-3">
        <CortexMark className="size-6 shrink-0" />
        <strong className="min-w-0 flex-1 truncate text-sm font-semibold">{UI_TERMS.productName}</strong>
      </div>
      <nav aria-label="工作台导航" className="shrink-0 overflow-y-auto pb-2 px-3">
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter((i) => rbac.can(i.permission))
          if (!items.length) return null
          return (
            <div key={group.title} className="mb-3">
              <h2 className="pb-1 text-[10px] font-normal text-muted-foreground">
                {group.title}
              </h2>
              <div className="flex flex-col gap-1">
                {items.map((item) => (
                  <SideLink
                    key={item.to}
                    item={item}
                    active={active === NAV_KEY_BY_TO[item.to]}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </nav>
      <AgentListSection />
      {/* §八：齿轮 = 唯一全局设置菜单触发器（点击先弹菜单，不直接跳页）。
          QoderWake 同构（实测）：收起态 footer 仅图标按钮（28×28/pad6/radius4/图标16，
          column 间距12，footer padding 12px 0，不显示头像与账号文字）；展开态
          头像 28px + 名称/团队版 + 图标按钮。 */}
      <div
        className="shrink-0 border-t p-1.5"
        style={{ borderColor: "var(--sidebar-border)" }}
      >
        <div className="flex items-center gap-1">
          <span
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-sm text-muted-foreground"
            title={`${UI_TERMS.navigation.account}：${username}`}
          >
            <span
              aria-hidden
              className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground"
            >
              {initial}
            </span>
            <span className="min-w-0 truncate">
              <span className="block truncate text-sm font-medium">{username}</span>
              <span className="block truncate text-[11px] text-muted-foreground">团队版</span>
            </span>
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                title="设置"
                aria-label="设置菜单"
                className="flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-sidebar-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Settings className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" sideOffset={8} className="min-w-56">
              <ThemeSubMenu />
              <DropdownMenuItem onSelect={() => navigateTo("/settings")}>
                <Settings className="size-4" />
                {UI_TERMS.navigation.settings}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {props.authed ? (
                <DropdownMenuItem onSelect={props.onLogout}>
                  <LogOut className="size-4" />
                  退出登录
                </DropdownMenuItem>
              ) : props.needLogin ? (
                <DropdownMenuItem onSelect={props.onLoginRequest}>
                  <LogIn className="size-4" />
                  登录
                </DropdownMenuItem>
              ) : (
                <>
                  <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                    开发身份 · 本地角色切换
                  </DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={props.role} onValueChange={(v) => props.onRoleChange(v as Role)}>
                    {ROLES.map((r) => (
                      <DropdownMenuRadioItem key={r.value} value={r.value}>
                        {r.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </aside>
  )
}

/** 兼容旧引用：AppRail 即新侧栏。 */
export const AppRail = AppSidebar

/** <768px 移动端 Sheet 导航（分组同构）。 */
export function MobileNavSheet({ open, onOpenChange, ...props }: AppNavProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { pathname } = useLocation()
  const active = computeActiveNav(pathname)
  const username = props.authed ? currentUsername() : "dev"
  const initial = username.slice(0, 1).toUpperCase() || "?"
  const close = () => onOpenChange(false)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-72 gap-0 overflow-y-auto p-0">
        <SheetHeader className="border-b px-4 py-3 text-left">
          <SheetTitle className="flex items-center gap-2.5">
            <CortexMark className="size-8 shrink-0" />
            <span className="text-sm font-semibold">{UI_TERMS.productName}</span>
          </SheetTitle>
          <SheetDescription className="sr-only">主导航</SheetDescription>
        </SheetHeader>
        <nav aria-label="主导航" className="p-2">
          {NAV_GROUPS.map((group) => (
            <div key={group.title} className="mb-3">
              <h2 className="px-3 pb-1 text-xs font-medium text-muted-foreground">{group.title}</h2>
              {group.items.filter((item) => rbac.can(item.permission)).map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={close}
                  data-active={active === NAV_KEY_BY_TO[item.to] || undefined}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                    active === NAV_KEY_BY_TO[item.to]
                      ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                      : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  )}
                >
                  <item.icon className="size-4" />
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="border-t p-2" style={{ borderColor: "var(--sidebar-border)" }}>
          <AccountMenu
            {...props}
            side="right"
            trigger={
              <button
                type="button"
                className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span
                  aria-hidden
                  className="flex size-6 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground"
                >
                  {initial}
                </span>
                {UI_TERMS.navigation.account}
                <span className="ml-auto truncate text-xs">{username}</span>
              </button>
            }
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}
