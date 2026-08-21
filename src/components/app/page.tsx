import type * as React from "react"
import { Link } from "react-router-dom"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { cn } from "@/lib/utils"

/** 页面内容容器：限制最大宽度、统一留白。 */
export function PageContainer({
  children,
  className,
  wide = false,
}: {
  children: React.ReactNode
  className?: string
  wide?: boolean
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-5 py-5",
        wide ? "max-w-[1600px]" : "max-w-[1400px]",
        className,
      )}
    >
      {children}
    </div>
  )
}

export interface BreadcrumbEntry {
  label: string
  href?: string
}

/** 面包屑：列表 → 详情层级。 */
export function Breadcrumbs({ items }: { items: BreadcrumbEntry[] }) {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        {items.map((item, index) => {
          const isLast = index === items.length - 1
          return (
            <span key={`${item.label}-${index}`} className="flex items-center gap-2">
              <BreadcrumbItem>
                {isLast || !item.href ? (
                  <BreadcrumbPage className="max-w-52 truncate">
                    {item.label}
                  </BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link to={item.href}>{item.label}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {!isLast && <BreadcrumbSeparator />}
            </span>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}

/**
 * 统一 Page Header（Design Spec §2.1）：
 * Page Title + Optional Description/Status + Primary Action。
 */
export function PageHeader({
  title,
  description,
  status,
  actions,
  className,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  status?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-3",
        className,
      )}
    >
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
          {status}
        </div>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </div>
  )
}

/** 内容区块标题：用 spacing / heading 分区，避免 Card 套 Card。 */
export function SectionHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-2",
        className,
      )}
    >
      <div className="space-y-0.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {description ? (
          <p className="text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  )
}
