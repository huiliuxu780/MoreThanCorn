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
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
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

/** 底部「主题」：跟随系统 / 浅色 / 深色，切换立即生效并持久化（next-themes）。 */
function ThemeMenu() {
  const { theme, setTheme } = useTheme()
  const options = [
    { value: "system", label: "跟随系统", icon: Monitor },
    { value: "light", label: "浅色", icon: Sun },
    { value: "dark", label: "深色", icon: Moon },
  ]
  const current = options.find((o) => o.value === theme) ?? options[0]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton tooltip={UI_TERMS.navigation.theme}>
          <current.icon className="size-4" />
          <span>{UI_TERMS.navigation.theme}</span>
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="min-w-40">
        {options.map((o) => (
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
 * 底部「账号」：真实身份字段渲染。
 * /api/auth/me 当前仅提供 username/role(displayName)，无邮箱/部门字段——按任务要求不展示。
 */
function AccountMenu({ authed, needLogin, role, onRoleChange, onLogout, onLoginRequest }: AccountMenuProps) {
  const navigate = useNavigate()
  const username = authed ? currentUsername() : "dev"
  const roleLabel = ROLES.find((r) => r.value === role)?.label ?? role
  const initial = username.slice(0, 1).toUpperCase() || "?"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton tooltip={`${UI_TERMS.navigation.account}：${username}`} className="data-[state=open]:bg-sidebar-accent">
          <span
            aria-hidden
            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground"
          >
            {initial}
          </span>
          <span className="min-w-0 flex-1 truncate text-left">{authed ? username : "开发者（未登录）"}</span>
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="min-w-56">
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

export interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  authed: boolean
  needLogin: boolean
  role: Role
  onRoleChange: (role: Role) => void
  onLogout: () => void
  onLoginRequest: () => void
}

/**
 * MTC-001 应用侧边栏（shadcn Sidebar，collapsible="icon"）：
 * 展开有文字，收起有 Tooltip；底部固定 主题 / 设置 / 账号。
 */
export function AppSidebar({
  authed,
  needLogin,
  role,
  onRoleChange,
  onLogout,
  onLoginRequest,
  ...props
}: AppSidebarProps) {
  const { pathname } = useLocation()
  const { state } = useSidebar()
  const isActive = (item: NavItem) =>
    item.activePrefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`))

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="h-14 justify-center border-b px-4">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-brand-anchor text-white">
            <ShieldCheck className="size-4.5" />
          </div>
          {state !== "collapsed" ? (
            <div className="min-w-0 leading-tight">
              <div className="truncate text-sm font-semibold">{UI_TERMS.productName}</div>
              <div className="truncate text-[11px] text-muted-foreground">
                {UI_TERMS.productSubtitle}
              </div>
            </div>
          ) : null}
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.filter((item) => rbac.can(item.permission)).map((item) => (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton asChild tooltip={item.label} isActive={isActive(item)}>
                    <NavLink to={item.to}>
                      <item.icon className="size-4" />
                      <span>{item.label}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <ThemeMenu />
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip={UI_TERMS.navigation.settings} isActive={pathname.startsWith("/settings")}>
              <NavLink to="/settings">
                <Settings className="size-4" />
                <span>{UI_TERMS.navigation.settings}</span>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <AccountMenu
              authed={authed}
              needLogin={needLogin}
              role={role}
              onRoleChange={onRoleChange}
              onLogout={onLogout}
              onLoginRequest={onLoginRequest}
            />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
