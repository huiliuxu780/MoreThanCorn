import { useEffect, useState, type ComponentType } from "react"
import {
  ArrowLeft,
  Check,
  Info,
  Monitor,
  Moon,
  Palette,
  ScrollText,
  ShieldCheck,
  Sun,
  Sunrise,
  MoonStar,
} from "lucide-react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { useTheme } from "next-themes"
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
// 2026-09-10 §八：删除「暂未开放」空壳分区（通用/通知/执行策略）——无真实实现的
// 入口不得伪装成已开放；保留全部真实分区。
const SECTIONS: SettingsSection[] = [
  { id: "appearance", label: "外观", icon: Palette },
  // 09-14 用户拍板（冗余整合）：连接与目录并入「数据接入」单入口三 tab；
  // /settings/connections 路由重定向到 /data-sources?tab=connections
  { id: "security", label: "权限与安全", icon: ShieldCheck },
  { id: "audit", label: "审计", icon: ScrollText },
  { id: "system", label: "系统信息", icon: Info },
]

function AppearanceSection() {
  const { theme, setTheme } = useTheme()
  const options = [
    { value: "system", label: "跟随系统", icon: Monitor, desc: "自动匹配操作系统的浅色 / 深色外观" },
    { value: "light", label: "浅色", icon: Sun, desc: "极白中性浅色主题（低饱和薄荷绿品牌色）" },
    { value: "dark", label: "深色", icon: Moon, desc: "极黑中性深色主题（低饱和薄荷绿品牌色）" },
    { value: "light-parchment", label: "浅色羊皮纸", icon: Sunrise, desc: "暖白羊皮纸浅色主题（品牌色与浅色同源）" },
    { value: "dark-parchment", label: "深色羊皮纸", icon: MoonStar, desc: "暖黑羊皮纸深色主题（品牌色与深色同源）" },
  ]
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold">主题</h2>
        <p className="text-xs text-muted-foreground">
          与左侧导航底部「主题」菜单联动，切换立即生效并在刷新后保持。
        </p>
      </div>
      {/* 09-07：五主题一行收齐（3 列会把羊皮纸两张挤到第二行留空位） */}
      <div className="grid gap-3 md:grid-cols-5" role="radiogroup" aria-label="主题">
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

export default function SettingsPage({ fixedSection }: { fixedSection?: string }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const requested = searchParams.get("section")
  const section = fixedSection
    ?? (SECTIONS.some((s) => s.id === requested) ? requested! : "appearance")
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

  // 2026-09-10 P0-F：QoderWake 同构——独立 240px 二级侧栏（y=0 全高，返回+分区 nav），
  // 主内容自侧栏右侧开始；不再是 PageContainer 内的普通 nav。
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 overflow-hidden">
      <aside
        aria-label="通用"
        className="hidden w-60 shrink-0 flex-col border-r md:flex"
        data-testid="settings-sidebar"
      >
        <div className="flex h-12 shrink-0 items-center px-3">
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => navigate("/tasks")}>
            <ArrowLeft className="size-4" /> 返回
          </Button>
        </div>
        <nav aria-label="设置分区" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          <ul className="flex flex-col gap-1">
            {SECTIONS.map((s) => {
              const active = s.id === section
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => select(s.id)}
                    aria-current={active ? "true" : undefined}
                    className={cn(
                      "flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active
                        ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                        : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
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
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="max-w-3xl space-y-5 p-6 md:p-10">
          <header>
            <h1 className="text-[28px] font-semibold leading-9">{current.label}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {current.id === "appearance" && "语言、主题等全局生效的个人偏好。"}

              {current.id === "security" && "当前身份与前端权限矩阵。"}
              {current.id === "audit" && "平台关键操作的审计记录。"}
              {current.id === "system" && "当前前端实例的真实运行信息。"}
            </p>
          </header>
          {section === "appearance" && <AppearanceSection />}

          {section === "security" && <SecuritySection />}
          {section === "audit" && <AuditSection />}
          {section === "system" && <SystemSection />}
        </div>
      </main>
    </div>
  )
}
