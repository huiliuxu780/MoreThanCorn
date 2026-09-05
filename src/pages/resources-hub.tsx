import type * as React from "react"
import {
  ChevronRight,
  ClipboardList,
  Cpu,
  Database,
  Layers,
  Plug,
  Scale,
} from "lucide-react"
import { Link } from "react-router-dom"
import { PageContainer, PageHeader } from "@/components/app/page"
import { UI_TERMS } from "@/config/ui-terms"
import { rbac, type Permission } from "@/services/rbac"

interface HubCard {
  title: string
  description: string
  to: string
  icon: React.ComponentType<{ className?: string }>
  permission: Permission
}

/**
 * MTC-001：能力与资源 Hub（一级入口 /resources）。
 * 首期聚合现有资源管理页面为真实可达的卡片；
 * 统一资源模型 / 绑定关系 / 全量 Hub 由 MTC-011、MTC-012 交付。
 */
const HUB_CARDS: HubCard[] = [
  {
    title: UI_TERMS.navigation.aiResources,
    description: "模型、Provider、API Tool 等 AI 能力的注册与治理",
    to: "/config/ai-resources",
    icon: Cpu,
    permission: "tool.view",
  },
  {
    title: UI_TERMS.navigation.dataResources,
    description: "业务数据源与数据接入配置",
    to: "/config/data-resources",
    icon: Database,
    permission: "asset.view",
  },
  {
    title: UI_TERMS.navigation.connections,
    description: "外部系统连接与凭据（含 Trigger 通道）",
    to: "/settings/connections",
    icon: Plug,
    permission: "connection.view",
  },
  {
    title: UI_TERMS.navigation.dataAssets,
    description: "任务输入契约与字段定义",
    to: "/config/data-assets",
    icon: Layers,
    permission: "asset.view",
  },
  {
    title: UI_TERMS.navigation.resultRules,
    description: "质量结果判定规则集",
    to: "/config/result-rules",
    icon: Scale,
    permission: "rules.view",
  },
  {
    title: UI_TERMS.navigation.forms,
    description: "Workflow 输入表单",
    to: "/config/forms",
    icon: ClipboardList,
    permission: "agent.view",
  },
]

export default function ResourcesHubPage() {
  const cards = HUB_CARDS.filter((c) => rbac.can(c.permission))
  return (
    <PageContainer>
      <PageHeader
        title={UI_TERMS.navigation.resourcesHub}
        description="Agent 与任务可使用的能力、数据与连接。选择一类资源进入管理。"
      />
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <Link
            key={card.to}
            to={card.to}
            className="group flex items-start gap-3 rounded-lg border bg-card p-4 transition-colors hover:border-brand/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-muted text-muted-foreground">
              <card.icon className="size-4.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1 text-sm font-medium">
                {card.title}
                <ChevronRight className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </span>
              <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                {card.description}
              </span>
            </span>
          </Link>
        ))}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        本页聚合平台当前可用的能力与资源入口；统一资源模型与资源绑定管理将随后续版本开放。
      </p>
    </PageContainer>
  )
}
