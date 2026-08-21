import { PanelLeft } from "lucide-react"
import { Outlet, useLocation } from "react-router-dom"
import { UI_TERMS } from "@/config/ui-terms"
import { Toaster } from "@/components/ui/sonner"
import { Separator } from "@/components/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app/app-sidebar"
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
export function AppShell() {
  const { pathname } = useLocation()
  const workspace = isWorkspaceRoute(pathname)
  const breadcrumbs = useRouteBreadcrumbs()

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="min-h-dvh">
        {!workspace ? (
          <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/75">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="h-4" />
            <Breadcrumbs items={breadcrumbs} />
            <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
              <PanelLeft className="hidden size-4" aria-hidden />
            </div>
          </header>
        ) : null}
        <div className="flex min-h-0 flex-1 flex-col">
          <Outlet />
        </div>
        <Toaster position="bottom-right" richColors />
      </SidebarInset>
    </SidebarProvider>
  )
}
