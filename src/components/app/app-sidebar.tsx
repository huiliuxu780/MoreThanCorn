import {
  Bot,
  Boxes,
  CalendarClock,
  Check,
  ClipboardList,
  LogIn,
  LogOut,
  Monitor,
  Moon,
  Settings,
  ShieldCheck,
  Sun,
  UserRound,
  Workflow,
} from "lucide-react"
import * as React from "react"
import { NavLink, useLocation, useNavigate } from "react-router-dom"
import { useTheme } from "next-themes"
import { UI_TERMS } from "@/config/ui-terms"
import { currentUsername, rbac, ROLES, type Permission, type Role } from "@/services/rbac"
import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"

export interface NavItem {
  label: string
  to: string
  icon: React.ComponentType<{ className?: string }>
  permission: Permission
  /** 视为选中态的路径前缀（含仍挂载的旧路由，保证旧页面内导航高亮不丢）。 */
  activePrefixes: string[]
}

/**
 * MTC-001：一级导航冻结为五项——任务 / 自主任务 / Agent / 能力与资源 / Workflow。
 * 质量、运行历史、Connections、AI Resources 等不再作为一级入口。
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
    label: UI_TERMS.navigation.resourcesHub,
    to: "/resources",
    icon: Boxes,
    permission: "tool.view",
    activePrefixes: [
      "/resources",
      "/config/ai-resources",
      "/config/data-resources",
      "/config/data-assets",
      "/config/result-rules",
      "/settings/connections",
    ],
  },
  {
    label: UI_TERMS.navigation.workflows,
    to: "/workflows",
    icon: Workflow,
    permission: "agent.view",
    activePrefixes: ["/workflows", "/config/forms"],
  },
]

/** MTC-001R：固定窄轨短标签（产品冻结文案）。 */
const RAIL_SHORT: Record<string, string> = {
  "/tasks": "任务",
  "/autonomous-tasks": "自主",
  "/agents": "Agent",
  "/resources": "资源",
  "/workflows": "流程",
}

export type TopNavKey = "tasks" | "autonomous" | "agents" | "resources" | "workflows" | "settings"

const NAV_KEY_BY_TO: Record<string, TopNavKey> = {
  "/tasks": "tasks",
  "/autonomous-tasks": "autonomous",
  "/agents": "agents",
  "/resources": "resources",
  "/workflows": "workflows",
}

/**
 * MTC-001R：任一路径最多一个一级项 active。
 * - /settings/connections → 能力与资源；其余 /settings/** → 设置；
 * - /operations/** → 任务；/config/forms/** → Workflow。
 */
export function computeActiveNav(pathname: string): TopNavKey | null {
  if (pathname === "/settings" || pathname.startsWith("/settings/")) {
    return pathname.startsWith("/settings/connections") ? "resources" : "settings"
  }
  for (const item of NAV_ITEMS) {
    if (item.activePrefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
      return NAV_KEY_BY_TO[item.to]
    }
  }
  return null
}

const THEME_OPTIONS = [
  { value: "system", label: "跟随系统", icon: Monitor },
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
] as const

/** 主题菜单内容（跟随系统 / 浅色 / 深色），触发器由调用方提供。 */
function ThemeMenu({ trigger, side = "right" }: { trigger: React.ReactNode; side?: "right" | "top" }) {
  const { theme, setTheme } = useTheme()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent side={side} align="start" sideOffset={8} className="min-w-40">
        {THEME_OPTIONS.map((o) => (
          <DropdownMenuItem key={o.value} onSelect={() => setTheme(o.value)}>
            <o.icon className="size-4" />
            {o.label}
            {theme === o.value ? <Check className="ml-auto size-4" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
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

/**
 * 账号菜单：真实身份字段渲染。
 * /api/auth/me 当前仅提供 username/role(displayName)，无邮箱/部门字段——按任务要求不展示。
 */
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

/** 窄轨单项：图标 + 11px 短标签纵向排列。 */
function RailLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <NavLink
      to={item.to}
      title={item.label}
      data-active={active || undefined}
      className={cn(
        "mx-1.5 flex flex-col items-center gap-1 rounded-lg py-2 text-[11px] transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/60",
      )}
    >
      <item.icon className="size-4.5" />
      <span className="max-w-full truncate px-0.5">{RAIL_SHORT[item.to] ?? item.label}</span>
    </NavLink>
  )
}

function RailBottomButton({
  active,
  title,
  children,
  ...props
}: React.ComponentProps<"button"> & { active?: boolean; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      data-active={active || undefined}
      className={cn(
        "mx-1.5 flex flex-col items-center gap-1 rounded-lg py-2 text-[11px] transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/60",
      )}
      {...props}
    >
      {children}
    </button>
  )
}

/**
 * MTC-001R：桌面固定 80px 单层窄轨（≥768px 恒显，不可展开/收起）。
 * 底部固定 主题 / 设置 / 账号，菜单向右展开。
 */
export function AppRail(props: AppNavProps) {
  const { pathname } = useLocation()
  const active = computeActiveNav(pathname)
  const { theme } = useTheme()
  const ThemeIcon = THEME_OPTIONS.find((o) => o.value === theme)?.icon ?? Monitor
  const username = props.authed ? currentUsername() : "dev"
  const initial = username.slice(0, 1).toUpperCase() || "?"

  return (
    <aside
      className="sticky top-0 hidden h-dvh w-20 shrink-0 flex-col items-stretch overflow-y-auto border-r bg-sidebar py-3 md:flex"
      data-testid="app-rail"
    >
      <div className="mb-2 flex justify-center">
        <div className="flex size-9 items-center justify-center rounded-lg bg-brand text-primary-foreground">
          <ShieldCheck className="size-4.5" />
        </div>
      </div>
      {NAV_ITEMS.filter((item) => rbac.can(item.permission)).map((item) => (
        <RailLink key={item.to} item={item} active={active === NAV_KEY_BY_TO[item.to]} />
      ))}
      <div className="mt-auto flex flex-col border-t pt-2" style={{ borderColor: "var(--sidebar-border)" }}>
        <ThemeMenu
          trigger={
            <RailBottomButton title={UI_TERMS.navigation.theme}>
              <ThemeIcon className="size-4.5" />
              <span>{UI_TERMS.navigation.theme}</span>
            </RailBottomButton>
          }
        />
        <NavLink
          to="/settings"
          title={UI_TERMS.navigation.settings}
          data-active={active === "settings" || undefined}
          className={cn(
            "mx-1.5 flex flex-col items-center gap-1 rounded-lg py-2 text-[11px] transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            active === "settings"
              ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
              : "text-muted-foreground hover:bg-sidebar-accent/60",
          )}
        >
          <Settings className="size-4.5" />
          <span>{UI_TERMS.navigation.settings}</span>
        </NavLink>
        <AccountMenu
          {...props}
          trigger={
            <RailBottomButton title={`${UI_TERMS.navigation.account}：${username}`}>
              <span
                aria-hidden
                className="flex size-6 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground"
              >
                {initial}
              </span>
              <span className="max-w-full truncate px-0.5">{UI_TERMS.navigation.account}</span>
            </RailBottomButton>
          }
        />
      </div>
    </aside>
  )
}

/** MTC-001R：<768px 移动端 Sheet 导航（不永久占用窄屏宽度）。 */
export function MobileNavSheet({ open, onOpenChange, ...props }: AppNavProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { pathname } = useLocation()
  const active = computeActiveNav(pathname)
  const { theme } = useTheme()
  const ThemeIcon = THEME_OPTIONS.find((o) => o.value === theme)?.icon ?? Monitor
  const username = props.authed ? currentUsername() : "dev"
  const initial = username.slice(0, 1).toUpperCase() || "?"
  const close = () => onOpenChange(false)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-72 gap-0 overflow-y-auto p-0">
        <SheetHeader className="border-b px-4 py-3 text-left">
          <SheetTitle className="flex items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-brand text-primary-foreground">
              <ShieldCheck className="size-4" />
            </span>
            <span className="text-sm font-semibold">{UI_TERMS.productName}</span>
          </SheetTitle>
          <SheetDescription className="sr-only">主导航</SheetDescription>
        </SheetHeader>
        <nav aria-label="主导航" className="p-2">
          {NAV_ITEMS.filter((item) => rbac.can(item.permission)).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={close}
              data-active={active === NAV_KEY_BY_TO[item.to] || undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                active === NAV_KEY_BY_TO[item.to]
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/60",
              )}
            >
              <item.icon className="size-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t p-2" style={{ borderColor: "var(--sidebar-border)" }}>
          <ThemeMenu
            side="right"
            trigger={
              <button
                type="button"
                className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ThemeIcon className="size-4" />
                {UI_TERMS.navigation.theme}
              </button>
            }
          />
          <NavLink
            to="/settings"
            onClick={close}
            data-active={active === "settings" || undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
              active === "settings"
                ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/60",
            )}
          >
            <Settings className="size-4" />
            {UI_TERMS.navigation.settings}
          </NavLink>
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
