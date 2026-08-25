import { useState } from "react"
import { PanelLeft, ShieldCheck } from "lucide-react"
import { Outlet, useLocation } from "react-router-dom"
import { UI_TERMS } from "@/config/ui-terms"
import { Toaster } from "@/components/ui/sonner"
import { NAV_GROUPS } from "@/components/app/app-sidebar"
import { rbac, ROLES, currentRole, setRole, type Role } from "@/services/rbac"
import { NavLink } from "react-router-dom"
import { Breadcrumbs, type BreadcrumbEntry } from "@/components/app/page"

/** 工作区级路由自带全高 Header，不使用全局顶栏。 */
const WORKSPACE_PATTERNS = [
  /^\/quality\/results\/[^/]+$/,
  /^\/config\/agents\/[^/]+$/,
]

function isWorkspaceRoute(pathname: string): boolean {
  return WORKSPACE_PATTERNS.some((pattern) => pattern.test(pathname))
}

/** 从当前路径推导面包屑（列表 → 详情层级）。 */
export function useRouteBreadcrumbs(): BreadcrumbEntry[] {
  const { pathname } = useLocation()
  const resultsQuery = "?tab=&page=1"
  const segments = pathname.split("/").filter(Boolean)

  const crumbs: BreadcrumbEntry[] = [
    { label: UI_TERMS.productName, href: "/quality/overview" },
  ]

  if (segments[0] === "quality") {
    crumbs.push({ label: UI_TERMS.navigation.quality })
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
  } else if (segments[0] === "config") {
    crumbs.push({ label: UI_TERMS.navigation.config })
    if (segments[1] === "tasks") {
      crumbs.push({
        label: UI_TERMS.navigation.tasks,
        href: segments[2] ? "/config/tasks" : undefined,
      })
      if (segments[2] === "new") crumbs.push({ label: "新建分析任务" })
      else if (segments[2]) {
        crumbs.push({
          label: segments[2],
          href: segments[3] ? `/config/tasks/${segments[2]}` : undefined,
        })
        if (segments[3] === "edit") crumbs.push({ label: "编辑任务" })
        if (segments[3] === "runs" && segments[4]) {
          crumbs.push({ label: `Run ${segments[4]}` })
        }
      }
    } else if (segments[1] === "agents") {
      crumbs.push({
        label: UI_TERMS.navigation.agents,
        href: segments[2] ? "/config/agents" : undefined,
      })
      if (segments[2]) crumbs.push({ label: "Agent Designer" })
    } else if (segments[1] === "tools") {
      crumbs.push({
        label: UI_TERMS.navigation.tools,
        href: segments[2] ? "/config/tools" : undefined,
      })
      if (segments[2] === "new") crumbs.push({ label: "创建 API Tool" })
      else if (segments[2]) crumbs.push({ label: segments[2] })
    } else if (segments[1] === "ai-resources") {
      crumbs.push({
        label: "AI Resources",
        href: segments[2] ? "/config/ai-resources" : undefined,
      })
      if (segments[2] === "new") crumbs.push({ label: "创建资源" })
      else if (segments[2]) crumbs.push({ label: segments[3] ?? segments[2] })
    } else if (segments[1] === "data-resources") {
      crumbs.push({
        label: "Data Resources",
        href: segments[2] ? "/config/data-resources" : undefined,
      })
      if (segments[2] === "new") crumbs.push({ label: "创建资源" })
      else if (segments[2]) crumbs.push({ label: segments[3] ?? segments[2] })
    } else if (segments[1] === "data-assets") {
      crumbs.push({
        label: UI_TERMS.navigation.dataAssets,
        href: segments[2] ? "/config/data-assets" : undefined,
      })
      if (segments[2] === "new") crumbs.push({ label: "创建数据资产" })
      else if (segments[2]) crumbs.push({ label: segments[2] })
    } else if (segments[1] === "result-rules") {
      crumbs.push({
        label: UI_TERMS.navigation.resultRules,
        href: segments[2] ? "/config/result-rules" : undefined,
      })
      if (segments[2]) crumbs.push({ label: segments[2] })
    }
  } else if (segments[0] === "settings") {
    crumbs.push({ label: UI_TERMS.navigation.settings })
    if (segments[1] === "connections") {
      crumbs.push({ label: UI_TERMS.navigation.connections })
    }
  } else if (segments[0] === "403") {
    crumbs.push({ label: "无访问权限" })
  }

  return crumbs
}

/**
 * Application Shell（Design Spec §8.1 冻结：shadcn sidebar-03）。
 * 固定左侧导航 + 顶部面包屑 Header + 内容区。
 */


/** 单层窄轨导航（shadcn studio dashboard-sidebar-04 同构：icon+label 竖排，组间分隔线）。 */
const RAIL_SHORT: Record<string, string> = {
  Connections: "连接",
  数据定义: "数据",
  结果规则: "规则",
  坐席分析: "坐席",
  分析任务: "任务",
  "AI Resources": "AI资源",
  "Data Resources": "数据资源",
}

function AppRail() {
  return (
    <aside className="flex w-20 shrink-0 flex-col items-stretch border-r bg-sidebar py-3" data-testid="app-rail">
      <div className="mb-2 flex justify-center">
        <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <ShieldCheck className="size-4.5" />
        </div>
      </div>
      {NAV_GROUPS.map((group, gi) => {
        const items = (group.items ?? group.subItems ?? []).filter((i) => rbac.can(i.permission))
        if (items.length === 0) return null
        return (
          <div key={group.label} className={gi > 0 ? "mt-2 border-t pt-2" : ""} style={{ borderColor: "var(--sidebar-border)" }}>
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                title={item.label}
                className={({ isActive }) =>
                  `mx-1.5 flex flex-col items-center gap-1 rounded-lg py-2 text-[11px] transition-colors ${
                    isActive ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent/60"
                  }`
                }
              >
                <item.icon className="size-4.5" />
                <span className="max-w-full truncate px-0.5">{RAIL_SHORT[item.label] ?? item.label}</span>
              </NavLink>
            ))}
          </div>
        )
      })}
    </aside>
  )
}

export function AppShell() {
  const { pathname } = useLocation()
  const workspace = isWorkspaceRoute(pathname)
  const breadcrumbs = useRouteBreadcrumbs()
  const [role, setRoleState] = useState<Role>(currentRole())
  const setRoleAndReload = (r: Role) => { setRole(r); setRoleState(r) }

  return (
    <div className="flex min-h-svh w-full">
      <AppRail />
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/75">
          {!workspace && <Breadcrumbs items={breadcrumbs} />}
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            {/* D-4：角色切换（原型阶段权限来源；真鉴权矩阵见 rbac.ts） */}
            <label className="flex items-center gap-1">
              <ShieldCheck className="size-3.5" aria-hidden />
              <select
                className="h-7 rounded-md border bg-background px-1.5 text-xs"
                value={role}
                onChange={(e) => setRoleAndReload(e.target.value as Role)}
                title="当前角色（RBAC）"
              >
                {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </label>
            <PanelLeft className="hidden size-4" aria-hidden />
          </div>
        </header>
        <div className="flex min-h-0 flex-1 flex-col">
          <Outlet />
        </div>
        <Toaster position="bottom-right" richColors />
      </div>
    </div>
  )
}
