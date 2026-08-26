import { Cpu, 
  BarChart3,
  Bot,
  ChevronDown,
  ClipboardList,
  Database,
  Layers,
  Plug,
  Scale,
  ScrollText,
  SearchCheck,
  ShieldCheck,
  UserRoundSearch,
  Workflow,
} from "lucide-react"
import * as React from "react"
import { NavLink } from "react-router-dom"
import { UI_TERMS } from "@/config/ui-terms"
import { rbac, type Permission } from "@/services/rbac"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"


interface NavItem {
  label: string
  to: string
  icon: React.ComponentType<{ className?: string }>
  permission: Permission
}

interface NavGroup {
  label: string
  items?: NavItem[]
  /** sidebar-03：带子菜单的分组。 */
  subLabel?: string
  subItems?: NavItem[]
}

/** 固定导航（Handoff §2）：不允许新增一级入口。 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: UI_TERMS.navigation.quality,
    subLabel: UI_TERMS.navigation.agentQuality,
    subItems: [
      {
        label: UI_TERMS.navigation.qualityOverview,
        to: "/quality/overview",
        icon: BarChart3,
        permission: "quality.view",
      },
      {
        label: UI_TERMS.navigation.qualityResults,
        to: "/quality/results",
        icon: SearchCheck,
        permission: "quality.view",
      },
      {
        label: UI_TERMS.navigation.agentAnalysis,
        to: "/quality/agent-analysis",
        icon: UserRoundSearch,
        permission: "quality.view",
      },
    ],
  },
  {
    label: UI_TERMS.navigation.config,
    items: [
      {
        label: UI_TERMS.navigation.tasks,
        to: "/config/tasks",
        icon: ClipboardList,
        permission: "task.view",
      },
      {
        label: UI_TERMS.navigation.agents,
        to: "/config/agents",
        icon: Bot,
        permission: "agent.view",
      },
      {
        label: "工作流",
        to: "/config/workflows",
        icon: Workflow,
        permission: "agent.view",
      },
      {
        label: "表单",
        to: "/config/forms",
        icon: ClipboardList,
        permission: "agent.view",
      },
      {
        label: UI_TERMS.navigation.aiResources,
        to: "/config/ai-resources",
        icon: Cpu,
        permission: "tool.view",
      },
      {
        label: UI_TERMS.navigation.dataResources,
        to: "/config/data-resources",
        icon: Database,
        permission: "asset.view",
      },
      {
        label: UI_TERMS.navigation.dataAssets,
        to: "/config/data-assets",
        icon: Layers,
        permission: "asset.view",
      },
      {
        label: UI_TERMS.navigation.resultRules,
        to: "/config/result-rules",
        icon: Scale,
        permission: "rules.view",
      },
    ],
  },
  {
    label: UI_TERMS.navigation.settings,
    items: [
      {
        label: UI_TERMS.navigation.connections,
        to: "/settings/connections",
        icon: Plug,
        permission: "connection.view",
      },
      {
        label: "审计日志",
        to: "/settings/audit",
        icon: ScrollText,
        permission: "admin.audit",
      },
    ],
  },
]

function NavMenuLink({ item }: { item: NavItem }) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild tooltip={item.label}>
        <NavLink to={item.to} className={({ isActive }) => (isActive ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" : "")}>
          <item.icon className="size-4" />
          <span>{item.label}</span>
        </NavLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

/**
 * Application Shell 导航（Design Spec §8.1：shadcn sidebar-03）。
 * “Sidebar with submenus”：智能质检为可折叠分组 + 子菜单。
 */
export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const { state } = useSidebar()
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="h-14 justify-center border-b px-4">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
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
        {NAV_GROUPS.map((group) => {
          const items = (group.items ?? group.subItems ?? []).filter((item) =>
            rbac.can(item.permission),
          )
          if (items.length === 0) return null
          if (group.subItems) {
            return (
              <Collapsible key={group.label} defaultOpen className="group/collapsible">
                <SidebarGroup>
                  <SidebarMenu>
                    <SidebarMenuItem className="hidden group-data-[collapsible=icon]:block">
                      <SidebarMenuButton asChild tooltip={group.label}>
                        <NavLink to={group.subItems![0].to}>
                          <BarChart3 className="size-4" />
                          <span>{group.label}</span>
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  </SidebarMenu>
                  <CollapsibleTrigger asChild>
                    <SidebarGroupLabel className="cursor-pointer hover:bg-sidebar-accent/50">
                      {group.label}
                      <ChevronDown className="ml-auto size-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-180" />
                    </SidebarGroupLabel>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="group-data-[collapsible=icon]:hidden">
                    <SidebarGroupContent>
                      {group.subLabel ? (
                        <div className="px-2 pt-1 pb-1 text-[11px] font-medium text-muted-foreground/80">
                          {group.subLabel}
                        </div>
                      ) : null}
                      <SidebarMenuSub>
                        {group.subItems!.filter((item) => rbac.can(item.permission)).map((item) => (
                          <SidebarMenuSubItem key={item.to}>
                            <SidebarMenuSubButton asChild>
                              <NavLink
                                to={item.to}
                                className={({ isActive }) =>
                                  isActive
                                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                                    : ""
                                }
                              >
                                <item.icon className="size-4" />
                                <span>{item.label}</span>
                              </NavLink>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    </SidebarGroupContent>
                  </CollapsibleContent>
                </SidebarGroup>
              </Collapsible>
            )
          }
          return (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map((item) => (
                    <NavMenuLink key={item.to} item={item} />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )
        })}
      </SidebarContent>
      <SidebarFooter className="border-t p-3">
        <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
            管
          </div>
          {state !== "collapsed" ? (
            <div className="min-w-0 leading-tight">
              <div className="truncate text-sm font-medium">质量管理员</div>
              <div className="truncate text-[11px] text-muted-foreground">企业质量中心</div>
            </div>
          ) : null}
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
