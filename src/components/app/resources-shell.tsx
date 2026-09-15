import { useEffect, useState } from "react"
import { NavLink, Outlet, useLocation } from "react-router-dom"
import { BookOpen, Database, Sparkles, Cpu, Wrench } from "lucide-react"

import { PageContainer, PageHeader } from "@/components/app/page"
import { cn } from "@/lib/utils"
import { UI_TERMS } from "@/config/ui-terms"
import { pagedApi } from "@/services/wf-api"
import { resApi } from "@/services/resource-api"

/** docs/v2-design/10 §3：壳磁贴行常驻计数（原 Hub 门厅计数职能接管）。 */
interface ShellCounts {
  skills: number | null
  providers: number | null
  models: number | null
  tools: number | null
  mcp: number | null
  knowledge: number | null
  datasources: number | null
  assets: number | null
}

const EMPTY: ShellCounts = {
  skills: null, providers: null, models: null, tools: null,
  mcp: null, knowledge: null, datasources: null, assets: null,
}

const n = (v: number | null) => (v == null ? "—" : String(v))

export function useShellCounts(): ShellCounts {
  const [c, setC] = useState<ShellCounts>(EMPTY)
  useEffect(() => {
    const safe = <T,>(p: Promise<T>): Promise<T | null> => p.catch(() => null)
    void Promise.all([
      safe(resApi.list("skill", { page: 1, pageSize: 1 })),
      safe(pagedApi.providers({ page: 1, pageSize: 1 })),
      safe(pagedApi.models({ page: 1, pageSize: 1 })),
      safe(pagedApi.tools({ page: 1, pageSize: 1 })),
      safe(resApi.list("mcp", { page: 1, pageSize: 1 })),
      safe(resApi.list("knowledge", { page: 1, pageSize: 1 })),
      safe(resApi.list("datasource", { page: 1, pageSize: 1 })),
      safe(resApi.list("asset", { page: 1, pageSize: 1 })),
    ]).then(([sk, pv, md, tl, mcp, kn, ds, as]) => {
      setC({
        skills: sk?.total ?? null, providers: pv?.total ?? null, models: md?.total ?? null,
        tools: tl?.total ?? null, mcp: mcp?.total ?? null, knowledge: kn?.total ?? null,
        datasources: ds?.total ?? null, assets: as?.total ?? null,
      })
    })
  }, [])
  return c
}

/**
 * docs/v2-design/10 §3：能力与资源持久壳——页头 + 五磁贴 + 内容槽。
 * 磁贴 = NavLink（路由切换）；选中态中性（surface-muted 底 + 图标块 raised），
 * 交互三态见 §6（hover 边框加深 / pressed translate-y-px / 切换 slot-in）。
 */
export function ResourcesShell() {
  const c = useShellCounts()
  const { pathname } = useLocation()

  const tiles = [
    {
      to: "/resources/skills", icon: Sparkles, label: UI_TERMS.navigation.skills,
      count: `${n(c.skills)} · SKILL.md 能力包`,
    },
    {
      to: "/resources/models", icon: Cpu, label: UI_TERMS.navigation.modelAccess,
      count: `渠道 ${n(c.providers)} · 模型 ${n(c.models)}`,
    },
    {
      to: "/resources/tools", icon: Wrench, label: UI_TERMS.navigation.toolsMcp,
      count: `Tool ${n(c.tools)} · MCP ${n(c.mcp)}`,
    },
    {
      to: "/resources/knowledge", icon: BookOpen, label: UI_TERMS.navigation.knowledgeBase,
      count: `${n(c.knowledge)}`,
    },
    {
      to: "/resources/data", icon: Database, label: UI_TERMS.navigation.dataAssetsHub,
      count: `源 ${n(c.datasources)} · 资产 ${n(c.assets)}`,
    },
  ]

  return (
    <PageContainer wide className="space-y-4">
      <PageHeader
        title={UI_TERMS.navigation.resourcesHub}
        description="统一管理平台能力与数据；Agent / Workflow / 分析任务可复用的基础设施；数据页=接入健康/资产/事件流水三镜头"
      />
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5" role="navigation" aria-label="资源分类">
        {tiles.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) => cn(
              "flex items-center gap-3 rounded-lg border p-3 transition-colors",
              "hover:border-muted-foreground/40 active:translate-y-px",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
              isActive ? "border-border bg-surface-muted" : "bg-surface",
            )}
          >
            <span className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground",
              pathname === t.to ? "border bg-surface-raised" : "bg-surface-muted",
            )}>
              <t.icon className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{t.label}</span>
              <span className="block truncate text-xs tabular-nums text-muted-foreground">{t.count}</span>
            </span>
          </NavLink>
        ))}
      </div>
      <div key={pathname} className="slot-in min-h-[60vh]">
        <Outlet />
      </div>
    </PageContainer>
  )
}
