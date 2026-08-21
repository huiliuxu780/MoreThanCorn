import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * 轻量表单字段容器：Label + 控件 + 描述 / 错误。
 * 不依赖 react-hook-form 的简单表单使用。
 */
export function FormField({
  label,
  description,
  error,
  required = false,
  children,
  className,
}: {
  label: string
  description?: string
  error?: string
  required?: boolean
  children: React.ReactElement
  className?: string
}) {
  const id = React.useId()
  const child = React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
    id,
    "aria-describedby": description || error ? `${id}-desc` : undefined,
    "aria-invalid": error ? true : undefined,
  })
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {required ? <span className="ml-0.5 text-destructive">*</span> : null}
      </label>
      {child}
      {description || error ? (
        <p
          id={`${id}-desc`}
          className={cn("text-xs", error ? "text-destructive" : "text-muted-foreground")}
        >
          {error ?? description}
        </p>
      ) : null}
    </div>
  )
}

/** 只读 definition row（RBAC §3.4：只读对象用静态文本，不铺 disabled input）。 */
export function DefinitionRow({
  label,
  children,
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("grid grid-cols-[140px_1fr] items-start gap-3 py-2 text-sm", className)}>
      <div className="text-muted-foreground">{label}</div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}
