import { useEffect, useState, type ComponentType } from "react"
import {
  Bell,
  Check,
  Gauge,
  Info,
  Monitor,
  Moon,
  Palette,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
} from "lucide-react"
import { Link, useSearchParams } from "react-router-dom"
import { useTheme } from "next-themes"
import { PageContainer, PageHeader } from "@/components/app/page"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { UI_TERMS } from "@/config/ui-terms"
import {
  currentRole, currentUsername, initAuth, isAuthenticated,
  permissionsFor, rbac, ROLES,
} from "@/services/rbac"
import { WF_BASE } from "@/services/wf-api"

interface SettingsSection {
  id: string
  label: string
  icon: ComponentType<{ className?: string }>
}

/** MTC-001：系统设置页面框架。七个分区；未实现后端能力的分区明示「暂未开放」。 */
const SECTIONS: SettingsSection[] = [
  { id: "general", label: "通用", icon: SlidersHorizontal },
  { id: "appearance", label: "外观", icon: Palette },
  { id: "notifications", label: "通知", icon: Bell },
  { id: "execution", label: "执行策略", icon: Gauge },
  { id: "security", label: "权限与安全", icon: ShieldCheck },
  { id: "audit", label: "审计", icon: ScrollText },
  { id: "system", label: "系统信息", icon: Info },
]

function NotAvailable({ feature }: { feature: string }) {
  return (
    <div className="rounded-lg border border-dashed bg-card p-8 text-center">
      <Badge variant="neutral" className="mb-3">暂未开放</Badge>
      <p className="text-sm text-muted-foreground">
        「{feature}」该功能尚未启用。当前没有任何隐藏生效的配置。
      </p>
    </div>
  )
}

function AppearanceSection() {
  const { theme, setTheme } = useTheme()
  const options = [
    { value: "system", label: "跟随系统", icon: Monitor, desc: "自动匹配操作系统的浅色 / 深色外观" },
    { value: "light", label: "浅色", icon: Sun, desc: "温暖中性色浅色主题" },
    { value: "dark", label: "深色", icon: Moon, desc: "低亮度深色主题" },
  ]
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold">主题</h2>
        <p className="text-xs text-muted-foreground">
          与左侧导航底部「主题」菜单联动，切换立即生效并在刷新后保持。
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="主题">
        {options.map((o) => {
          const active = theme === o.value
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setTheme(o.value)}
              className={cn(
                "flex flex-col items-start gap-2 rounded-lg border bg-card p-4 text-left transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active ? "border-brand bg-selected" : "hover:border-brand/40",
              )}
            >
              <span className="flex w-full items-center">
                <o.icon className={cn("size-4", active ? "text-selected-foreground" : "text-muted-foreground")} />
                {active ? <Check className="ml-auto size-4 text-selected-foreground" /> : null}
              </span>
              <span className={cn("text-sm font-medium", active && "text-selected-foreground")}>{o.label}</span>
              <span className="text-xs leading-relaxed text-muted-foreground">{o.desc}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function SecuritySection() {
  const authed = isAuthenticated()
  const role = currentRole()
  const roleLabel = ROLES.find((r) => r.value === role)?.label ?? role
  const perms = permissionsFor(role)
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-sm font-semibold">当前身份</h2>
        <p className="text-xs text-muted-foreground">
          身份来源：{authed ? "服务端登录（/api/auth/me）" : "本地开发匿名态（服务端未强制登录）"}
        </p>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-muted-foreground">用户名</dt>
        <dd>{authed ? currentUsername() : "dev（未登录）"}</dd>
        <dt className="text-muted-foreground">角色</dt>
        <dd>{roleLabel}</dd>
      </dl>
      <div>
        <h3 className="text-sm font-semibold">前端权限矩阵</h3>
        <p className="mb-2 text-xs text-muted-foreground">
          前端可见性矩阵；服务端是最终强制点，越权请求会被 403 拒绝。
        </p>
        <div className="flex flex-wrap gap-1.5">
          {perms.map((p) => (
            <Badge key={p} variant="neutral" className="font-mono text-[11px]">{p}</Badge>
          ))}
        </div>
      </div>
      {rbac.can("admin.audit") ? (
        <div>
          <h3 className="text-sm font-semibold">发布治理</h3>
          <p className="mb-2 text-xs text-muted-foreground">Agent / 工具 / 规则的发布流水线治理。</p>
          <Button asChild variant="outline" size="sm">
            <Link to="/settings/governance">进入发布治理</Link>
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function AuditSection() {
  if (!rbac.can("admin.audit")) {
    return (
      <div className="rounded-lg border border-dashed bg-card p-8 text-center">
        <p className="text-sm text-muted-foreground">当前角色无审计查看权限（需要 admin.audit）。</p>
      </div>
    )
  }
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold">审计日志</h2>
        <p className="text-xs text-muted-foreground">平台关键操作的审计记录（登录、发布、配置变更等）。</p>
      </div>
      <Button asChild variant="outline" size="sm">
        <Link to="/settings/audit">进入审计日志</Link>
      </Button>
    </div>
  )
}

function SystemSection() {
  const { theme, resolvedTheme } = useTheme()
  const rows: [string, string][] = [
    ["产品名称", UI_TERMS.productName],
    ["前端版本", `v${__APP_VERSION__}`],
    ["运行环境", import.meta.env.MODE],
    ["API 基地址", WF_BASE],
    ["主题", `${theme ?? "system"}（当前解析：${resolvedTheme ?? "light"}）`],
  ]
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold">系统信息</h2>
        <p className="text-xs text-muted-foreground">当前前端实例的真实运行信息。</p>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="break-all">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export default function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const requested = searchParams.get("section")
  const section = SECTIONS.some((s) => s.id === requested) ? requested! : "general"
  const [, setTick] = useState(0)

  // 首载时 initAuth 可能尚未完成（AppShell 异步）；这里再触发一次以刷新真实身份显示
  useEffect(() => {
    initAuth().finally(() => setTick((t) => t + 1)).catch(() => undefined)
  }, [])

  const select = (id: string) => {
    const next = new URLSearchParams(searchParams)
    next.set("section", id)
    setSearchParams(next, { replace: true })
  }

  const current = SECTIONS.find((s) => s.id === section)!

  return (
    <PageContainer>
      <PageHeader title={UI_TERMS.navigation.settings} description="平台与个人偏好设置。" />
      <div className="mt-4 flex flex-col gap-4 md:flex-row">
        <nav aria-label="设置分区" className="shrink-0 md:w-48">
          <ul className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
            {SECTIONS.map((s) => {
              const active = s.id === section
              return (
                <li key={s.id} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => select(s.id)}
                    aria-current={active ? "true" : undefined}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active
                        ? "bg-selected font-medium text-selected-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                    )}
                  >
                    <s.icon className="size-4" />
                    {s.label}
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>
        <div className="min-w-0 flex-1 rounded-lg border bg-card p-5">
          <div className="mb-4 flex items-center gap-2 border-b pb-3 md:hidden">
            <current.icon className="size-4 text-muted-foreground" />
            <span className="text-sm font-semibold">{current.label}</span>
          </div>
          {section === "general" && <NotAvailable feature="通用" />}
          {section === "appearance" && <AppearanceSection />}
          {section === "notifications" && <NotAvailable feature="通知" />}
          {section === "execution" && <NotAvailable feature="执行策略" />}
          {section === "security" && <SecuritySection />}
          {section === "audit" && <AuditSection />}
          {section === "system" && <SystemSection />}
        </div>
      </div>
    </PageContainer>
  )
}
