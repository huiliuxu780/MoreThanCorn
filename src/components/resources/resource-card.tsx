import { BookOpen, Bot, Cpu, Database, Layers, MoreHorizontal, Server, Workflow, Wrench } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import type { ResourceDTO } from "@/services/resource-api"

export const TYPE_ICON = {
  model: Cpu, tool: Wrench, mcp: Server, knowledge: BookOpen,
  datasource: Database, asset: Layers, workflow: Workflow, agent: Bot,
} as const

export const TYPE_LABEL: Record<string, string> = {
  model: "Model", tool: "Tool", mcp: "MCP Server", knowledge: "Knowledge Source",
  datasource: "Datasource", asset: "Data Asset", workflow: "Workflow", agent: "Agent",
}

/** 生命周期 × 健康度双轨徽章：健康异常优先；metadata.lifecycleLabel 可覆盖文案（workflow/agent 的 已发布/草稿）。 */
export function ResourceStatusBadge({ dto }: { dto: ResourceDTO }) {
  const label = dto.metadata?.lifecycleLabel as string | undefined
  if (label) return <Badge variant={(dto.metadata?.lifecycleTone as "success" | "warning" | "neutral") ?? "neutral"}>{label}</Badge>
  if (dto.status === "disabled") return <Badge variant="neutral" className="b-dot">Disabled</Badge>
  if (dto.health === "error") return <Badge variant="danger">Error</Badge>
  if (dto.health === "degraded") return <Badge variant="warning">Degraded</Badge>
  return <Badge variant="success">Enabled</Badge>
}

function MetaBadges({ dto }: { dto: ResourceDTO }) {
  const m = dto.metadata
  const items: { text: string; mono?: boolean; outline?: boolean }[] = []
  switch (dto.type) {
    case "model":
      items.push({ text: String(m.modelKey ?? ""), mono: true, outline: true })
      ;(m.capabilities as string[] ?? []).slice(0, 2).forEach((c) => items.push({ text: c }))
      break
    case "tool":
      items.push({ text: String(m.kind ?? ""), outline: true })
      items.push({ text: `v${m.version ?? 1}` })
      break
    case "mcp":
      items.push({ text: String(m.transport ?? ""), mono: true, outline: true })
      items.push({ text: `${m.tools ?? 0} tools` })
      break
    case "knowledge":
      items.push({ text: `${m.slices ?? 0} 切片` })
      if (m.embedding) items.push({ text: String(m.embedding) })
      break
    case "datasource":
      items.push({ text: String(m.dsType ?? ""), outline: true })
      if (m.location) items.push({ text: String(m.location), mono: true })
      break
    case "asset":
      items.push({ text: String(m.datasource ?? "内联数据") })
      if (m.recordMeaning) items.push({ text: String(m.recordMeaning) })
      break
    case "workflow":
      if (m.currentVersion) items.push({ text: `v${m.currentVersion}`, outline: true })
      items.push({ text: `${m.nodeCount ?? 0} 节点` })
      break
    case "agent":
      if (m.typeLabel) items.push({ text: String(m.typeLabel) })
      break
  }
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
      {items.filter((i) => i.text).map((i, idx) => (
        <Badge key={idx} variant={i.outline ? "outline" : "secondary"} className={cn("text-[10px]", i.mono && "font-mono")}>
          {i.text}
        </Badge>
      ))}
    </div>
  )
}

export type ResourceAction = "edit" | "test" | "toggle" | "delete"

const ACTION_LABEL: Record<ResourceAction, string> = { edit: "编辑", test: "测试", toggle: "停用", delete: "删除" }

export function ResourceCard({ dto, highlighted, actions, onOpen, onAction }: {
  dto: ResourceDTO
  highlighted?: boolean
  /** 菜单动作裁剪，默认全部（按类型自动隐藏不适用项见调用方） */
  actions?: ResourceAction[]
  onOpen: () => void
  onAction: (action: ResourceAction) => void
}) {
  const Icon = TYPE_ICON[dto.type as keyof typeof TYPE_ICON] ?? Cpu
  const disabled = dto.status === "disabled"
  const menuActions = actions ?? (["edit", "test", "toggle", "delete"] as ResourceAction[])
  return (
    <div
      className={cn(
        "group flex min-h-40 cursor-pointer flex-col rounded-lg border bg-card p-3.5 transition-colors hover:border-muted-foreground/40",
        disabled && "opacity-70",
        highlighted && "ring-2 ring-foreground/30",
      )}
      onClick={onOpen}
      data-testid={`resource-card-${dto.id}`}
    >
      <div className="flex items-start gap-2.5">
        <div className="flex size-8.5 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{dto.name}</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {TYPE_LABEL[dto.type]}
            {dto.type === "model" && dto.metadata.provider ? ` · ${dto.metadata.provider}` : ""}
            {dto.type === "tool" ? ` · ${dto.metadata.kind}` : ""}
            {dto.type === "mcp" ? ` · ${dto.metadata.transport}` : ""}
            {dto.type === "workflow" && dto.metadata.lifecycleLabel ? ` · ${dto.metadata.lifecycleLabel}` : ""}
            {dto.type === "agent" && dto.metadata.typeLabel ? ` · ${dto.metadata.typeLabel}` : ""}
          </div>
        </div>
        <ResourceStatusBadge dto={dto} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-6.5 opacity-0 group-hover:opacity-100"
              onClick={(e) => e.stopPropagation()}>
              <MoreHorizontal className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onClick={onOpen}>查看详情</DropdownMenuItem>
            {menuActions.includes("edit") && <DropdownMenuItem onClick={() => onAction("edit")}>{ACTION_LABEL.edit}</DropdownMenuItem>}
            {menuActions.includes("test") && <DropdownMenuItem onClick={() => onAction("test")}>{ACTION_LABEL.test}</DropdownMenuItem>}
            {(menuActions.includes("test") || menuActions.includes("toggle")) && <DropdownMenuSeparator />}
            {menuActions.includes("toggle") && <DropdownMenuItem onClick={() => onAction("toggle")}>{disabled ? "启用" : ACTION_LABEL.toggle}</DropdownMenuItem>}
            {menuActions.includes("delete") && <DropdownMenuItem className="text-destructive" onClick={() => onAction("delete")}>{ACTION_LABEL.delete}</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <p className="mt-2 line-clamp-2 min-h-9 text-xs text-muted-foreground">
        {dto.description || "暂无描述"}
      </p>
      <MetaBadges dto={dto} />
      <div className="mt-auto flex items-center justify-between border-t border-dashed pt-2.5 text-[11px] text-muted-foreground" style={{ marginTop: "auto", paddingTop: 10 }}>
        <span className="flex min-w-0 items-center gap-1">
          <Workflow className="size-3" />
          <span className="truncate">
            {dto.usage.refCount > 0 ? `被 ${dto.usage.refCount} 处引用` : "无引用"}
            {dto.usage.calls7d > 0 ? ` · 7 日 ${dto.usage.calls7d.toLocaleString()} 次` : ""}
          </span>
        </span>
        <span>{dto.updatedAt ? dto.updatedAt.slice(0, 10) : ""}</span>
      </div>
    </div>
  )
}
