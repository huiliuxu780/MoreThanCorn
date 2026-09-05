import { useEffect, useRef, useState } from "react"
import { Menu } from "lucide-react"
import { Outlet, useLocation } from "react-router-dom"
import { toast } from "sonner"
import { UI_TERMS } from "@/config/ui-terms"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Toaster } from "@/components/ui/sonner"
import { AppRail, MobileNavSheet } from "@/components/app/app-sidebar"
import {
  currentRole, currentUsername, initAuth, isAuthenticated, isAuthRequired,
  login, logout, setRole, type Role,
} from "@/services/rbac"
import { Breadcrumbs, type BreadcrumbEntry } from "@/components/app/page"

/** 工作区级路由自带全高 Header，不使用全局面包屑。 */
const WORKSPACE_PATTERNS = [
  /^\/quality\/results\/[^/]+$/,
  /^\/agents\/[^/]+$/,
]

function isWorkspaceRoute(pathname: string): boolean {
  return WORKSPACE_PATTERNS.some((pattern) => pattern.test(pathname))
}

/** 从当前路径推导面包屑（MTC-001 新路由树；遗留挂载页面保留推导）。 */
export function useRouteBreadcrumbs(): BreadcrumbEntry[] {
  const { pathname } = useLocation()
  const resultsQuery = "?tab=&page=1"
  const segments = pathname.split("/").filter(Boolean)

  const crumbs: BreadcrumbEntry[] = [
    { label: UI_TERMS.productName, href: "/tasks" },
  ]

  const first = segments[0]

  if (first === "tasks") {
    crumbs.push({ label: UI_TERMS.navigation.tasksWorkbench })
  } else if (first === "autonomous-tasks") {
    crumbs.push({
      label: UI_TERMS.navigation.autonomousTasks,
      href: segments[1] ? "/autonomous-tasks" : undefined,
    })
    if (segments[1] === "new") crumbs.push({ label: "新建自主任务" })
    else if (segments[1]) {
      crumbs.push({
        label: segments[1],
        href: segments[2] ? `/autonomous-tasks/${segments[1]}` : undefined,
      })
      if (segments[2] === "edit") crumbs.push({ label: "编辑任务" })
      if (segments[2] === "runs" && segments[3]) crumbs.push({ label: `Run ${segments[3]}` })
      if (segments[2] === "batches" && segments[3]) crumbs.push({ label: `批次 ${segments[3]}` })
    }
  } else if (first === "agents") {
    crumbs.push({
      label: UI_TERMS.navigation.agents,
      href: segments[1] ? "/agents" : undefined,
    })
    if (segments[1]) {
      crumbs.push({
        label: "Agent Designer",
        href: segments[2] ? `/agents/${segments[1]}` : undefined,
      })
      if (segments[2] === "runs" && segments[3]) crumbs.push({ label: `Run ${segments[3]}` })
    }
  } else if (first === "resources") {
    crumbs.push({ label: UI_TERMS.navigation.resourcesHub })
  } else if (first === "workflows") {
    crumbs.push({
      label: UI_TERMS.navigation.workflows,
      href: segments[1] ? "/workflows" : undefined,
    })
    if (segments[1]) crumbs.push({ label: "画布" })
  } else if (first === "settings") {
    crumbs.push({
      label: UI_TERMS.navigation.settings,
      href: segments[1] ? "/settings" : undefined,
    })
    if (segments[1] === "connections") crumbs.push({ label: UI_TERMS.navigation.connections })
    else if (segments[1] === "audit") crumbs.push({ label: UI_TERMS.navigation.auditLog })
    else if (segments[1] === "governance") crumbs.push({ label: UI_TERMS.navigation.governance })
  } else if (first === "operations") {
    /* 批次历史/批次详情/Run 详情仍挂载，归属「任务」工作台域 */
    crumbs.push({ label: UI_TERMS.navigation.tasksWorkbench, href: "/tasks" })
    if (segments[1] === "task-runs") {
      crumbs.push({
        label: UI_TERMS.navigation.batchHistory,
        href: segments[2] ? "/operations/task-runs" : undefined,
      })
      if (segments[2]) crumbs.push({ label: `批次 ${segments[2]}` })
    } else if (segments[1] === "runs" && segments[2]) {
      crumbs.push({ label: `Run ${segments[2]}` })
    }
  } else if (first === "quality") {
    /* 遗留挂载：不再是一级入口，面包屑保留可达路径 */
    crumbs.push({ label: UI_TERMS.navigation.qualityCenter })
    if (segments[1] === "overview") {
      crumbs.push({ label: UI_TERMS.navigation.qualityOverview })
    } else if (segments[1] === "results") {
      crumbs.push({
        label: UI_TERMS.navigation.qualityResults,
        href: segments[2] ? `/quality/results${resultsQuery}` : undefined,
      })
      if (segments[2]) crumbs.push({ label: `Interaction ${segments[2]}` })
    } else if (segments[1] === "agent-analysis") {
      crumbs.push({ label: UI_TERMS.navigation.agentAnalysis })
    }
  } else if (first === "config") {
    /* 遗留挂载的子页面：归属新的一级域 */
    if (segments[1] === "forms") {
      crumbs.push({ label: UI_TERMS.navigation.workflows, href: "/workflows" })
      crumbs.push({
        label: UI_TERMS.navigation.forms,
        href: segments[2] ? "/config/forms" : undefined,
      })
      if (segments[2]) crumbs.push({ label: segments[2] === "new" ? "新建表单" : segments[2] })
    } else {
      crumbs.push({ label: UI_TERMS.navigation.resourcesHub, href: "/resources" })
      if (segments[1] === "ai-resources") {
        crumbs.push({
          label: UI_TERMS.navigation.aiResources,
          href: segments[2] ? "/config/ai-resources" : undefined,
        })
        if (segments[2] === "new") crumbs.push({ label: "创建资源" })
        else if (segments[2]) crumbs.push({ label: segments[3] ?? segments[2] })
      } else if (segments[1] === "data-resources") {
        crumbs.push({
          label: UI_TERMS.navigation.dataResources,
          href: segments[2] ? "/config/data-resources" : undefined,
        })
        if (segments[2] === "new") crumbs.push({ label: "创建资源" })
        else if (segments[2]) crumbs.push({ label: segments[3] ?? segments[2] })
      } else if (segments[1] === "data-assets") {
        crumbs.push({
          label: UI_TERMS.navigation.dataAssets,
          href: segments[2] ? "/config/data-assets" : undefined,
        })
        if (segments[2]) crumbs.push({ label: segments[2] })
      } else if (segments[1] === "result-rules") {
        crumbs.push({
          label: UI_TERMS.navigation.resultRules,
          href: segments[2] ? "/config/result-rules" : undefined,
        })
        if (segments[2]) crumbs.push({ label: segments[2] })
      }
    }
  } else if (first === "403") {
    crumbs.push({ label: "无访问权限" })
  }

  return crumbs
}

/**
 * Application Shell（MTC-001R）：
 * 桌面 ≥768px 固定 80px 单层窄轨（图标+短标签，不可展开/收起）；
 * <768px 使用 Sheet 抽屉导航。顶部仅面包屑，无侧栏 toggle。
 * 身份与主题入口收敛在窄轨底部（主题 / 设置 / 账号）。
 */
export function AppShell() {
  const { pathname } = useLocation()
  const workspace = isWorkspaceRoute(pathname)
  const breadcrumbs = useRouteBreadcrumbs()
  const [role, setRoleState] = useState<Role>(currentRole())
  // 09 P0-B4：服务端身份（登录态）优先于本地角色切换
  const [authed, setAuthed] = useState(isAuthenticated())
  const [needLogin, setNeedLogin] = useState(false)
  const [loginOpen, setLoginOpen] = useState(false)
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [loggingIn, setLoggingIn] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const burgerRef = useRef<HTMLButtonElement>(null)

  const handleMobileNavChange = (open: boolean) => {
    setMobileNavOpen(open)
    // MTC-001R：Sheet 关闭后焦点回到触发器（Radix 在自定义触发下不保证）
    if (!open) requestAnimationFrame(() => burgerRef.current?.focus())
  }

  useEffect(() => {
    initAuth().then(() => {
      setAuthed(isAuthenticated())
      setNeedLogin(isAuthRequired())
      setRoleState(currentRole())
    }).catch(() => undefined)
  }, [])

  const setRoleAndReload = (r: Role) => { setRole(r); setRoleState(r) }

  const handleLogout = () => {
    logout()
    setAuthed(false)
    setRoleState(currentRole())
    toast.success("已登出")
  }

  const doLogin = async () => {
    setLoggingIn(true)
    try {
      const r = await login(username.trim(), password)
      toast.success(`已登录：${currentUsername()}（${r}）`)
      setLoginOpen(false)
      setAuthed(true)
      setNeedLogin(false)
      setRoleState(currentRole())
    } catch (e) {
      toast.error(`登录失败：${(e as Error).message}`)
    } finally {
      setLoggingIn(false)
    }
  }

  const navProps = {
    authed,
    needLogin,
    role,
    onRoleChange: setRoleAndReload,
    onLogout: handleLogout,
    onLoginRequest: () => setLoginOpen(true),
  }

  return (
    <div className="flex min-h-svh w-full">
      <AppRail {...navProps} />
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/75">
          <Button
            ref={burgerRef}
            variant="ghost"
            size="icon"
            className="size-8 md:hidden"
            aria-label="打开导航"
            onClick={() => setMobileNavOpen(true)}
          >
            <Menu className="size-4.5" />
          </Button>
          {!workspace && <Breadcrumbs items={breadcrumbs} />}
        </header>
        <div className="flex min-h-0 flex-1 flex-col">
          <Outlet />
        </div>
        <Toaster position="bottom-right" richColors />
      </div>

      <MobileNavSheet open={mobileNavOpen} onOpenChange={handleMobileNavChange} {...navProps} />

      {/* 登录对话框（09 P0-10） */}
      <Dialog open={loginOpen || (needLogin && !authed)} onOpenChange={(o) => setLoginOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>登录</DialogTitle>
            <DialogDescription>服务端已启用身份鉴权，请使用账号登录后继续。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input placeholder="用户名" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
            <Input type="password" placeholder="密码" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </div>
          <DialogFooter>
            <Button disabled={loggingIn || !username.trim() || !password} onClick={doLogin}>
              {loggingIn ? "登录中…" : "登录"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
