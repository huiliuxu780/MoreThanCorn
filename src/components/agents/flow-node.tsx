import {
  Bell,
  Bot,
  Braces,
  FilePlus2,
  Flag,
  GitBranch,
  Inbox,
  Route,
  UserRound,
  Wrench,
  LoaderCircle,
  CircleCheck,
  CircleAlert,
  CircleAlert as ApprovalIcon,
} from "lucide-react"
import { memo } from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"
import type { AgentNodeKind } from "@/domain/types"
import { cn } from "@/lib/utils"

/** sim 风格：Node Type 通过 icon + 小型角色色 chip 区分，节点本体保持中性。 */
export const NODE_KIND_META: Record<
  AgentNodeKind,
  { label: string; icon: React.ComponentType<{ className?: string }>; accent: string; fg: string }
> = {
  input: { label: "Input", icon: Inbox, accent: "#64748b", fg: "#ffffff" },
  llm: { label: "LLM", icon: Bot, accent: "#3b3b3b", fg: "#f8f8f8" },
  tool: { label: "Tool", icon: Wrench, accent: "#0062ff", fg: "#ffffff" },
  transform: { label: "Transform", icon: Braces, accent: "#64748b", fg: "#ffffff" },
  condition: { label: "Condition", icon: GitBranch, accent: "#ff4c00", fg: "#ffffff" },
  router: { label: "Router", icon: Route, accent: "#ff4c00", fg: "#ffffff" },
  "human-interrupt": { label: "Human", icon: UserRound, accent: "#8b5cf6", fg: "#ffffff" },
  "create-record": { label: "Record", icon: FilePlus2, accent: "#188f00", fg: "#ffffff" },
  notification: { label: "Notify", icon: Bell, accent: "#aa00ff", fg: "#ffffff" },
  end: { label: "End", icon: Flag, accent: "#64748b", fg: "#ffffff" },
}

export type NodeRunStatus = "idle" | "running" | "success" | "error" | "waiting-approval"

export interface AgentFlowNodeData {
  kind: AgentNodeKind
  name: string
  description?: string
  rows?: { label: string; value: string }[]
  runStatus?: NodeRunStatus
  branches?: string[]
  [key: string]: unknown
}

function StatusGlyph({ status }: { status?: NodeRunStatus }) {
  if (!status || status === "idle") return null
  if (status === "running") return <LoaderCircle className="size-3.5 animate-spin text-[var(--text-secondary,#525252)]" />
  if (status === "success") return <CircleCheck className="size-3.5 text-emerald-600" />
  if (status === "error") return <CircleAlert className="size-3.5 text-red-500" />
  return <ApprovalIcon className="size-3.5 text-amber-500" />
}

/**
 * sim 风格节点：w-[250px] rounded-2xl 中性卡片 + 1.5px 轮廓；
 * 选中时轮廓加深；handles 为卡片边缘的小凸点。
 */
export const AgentFlowNode = memo(function AgentFlowNode({
  data,
  selected,
}: NodeProps) {
  const nodeData = data as AgentFlowNodeData
  const meta = NODE_KIND_META[nodeData.kind]
  const Icon = meta.icon
  const outline = selected ? "border-[#525252] dark:border-[#cccccc]" : "border-[#d8d8d8] dark:border-[#444444]"
  const ring =
    nodeData.runStatus === "running"
      ? "ring-[1.5px] ring-[#525252] dark:ring-[#cccccc]"
      : nodeData.runStatus === "error"
        ? "ring-[1.5px] ring-red-500"
        : nodeData.runStatus === "waiting-approval"
          ? "ring-[1.5px] ring-amber-500"
          : nodeData.runStatus === "success"
            ? "ring-[1.5px] ring-emerald-500/70"
            : ""

  return (
    <div
      className={cn(
        "w-[250px] cursor-grab rounded-2xl border-[1.5px] bg-white shadow-none transition-colors active:cursor-grabbing dark:bg-[#232323]",
        outline,
        ring,
      )}
    >
      {/* 不可见 RF handles：外移 7px，视觉凸点由边框伪元素表达 */}
      {nodeData.kind !== "input" ? (
        <Handle
          type="target"
          id="target"
          position={Position.Left}
          className="!size-2 !rounded-full !border-none !bg-transparent !opacity-0"
          style={{ left: -7 }}
        />
      ) : null}
      {nodeData.kind !== "end" ? (
        nodeData.branches && nodeData.branches.length > 0 ? (
          nodeData.branches.map((branch, i) => (
            <Handle
              key={branch}
              type="source"
              id={branch}
              position={Position.Right}
              className="!size-2 !rounded-full !border-none !bg-transparent !opacity-0"
              style={{ right: -7, top: `${40 + i * 24}%` }}
            />
          ))
        ) : (
          <Handle
            type="source"
            id="source"
            position={Position.Right}
            className="!size-2 !rounded-full !border-none !bg-transparent !opacity-0"
            style={{ right: -7 }}
          />
        )
      ) : null}

      {/* Header 40px */}
      <div className="flex h-10 items-center justify-between gap-1 px-2">
        <div className="min-w-0 truncate text-[15px] font-medium text-[#1a1a1a] dark:text-[#f0f0f0]">
          {nodeData.name}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <StatusGlyph status={nodeData.runStatus} />
          <span
            className="flex h-5 items-center gap-[3px] rounded-md px-1 text-[11px] font-medium"
            style={{ backgroundColor: meta.accent, color: meta.fg }}
          >
            <Icon className="size-3" />
            {meta.label}
          </span>
        </div>
      </div>

      {/* Body：20px 行，label 左灰 / value 右主色 */}
      {nodeData.rows && nodeData.rows.length > 0 ? (
        <div className="flex flex-col gap-2 p-2 pt-0">
          {nodeData.rows.map((row) => (
            <div key={row.label} className="flex h-5 items-center gap-2 text-sm">
              <span className="truncate text-[#8a8a8a] dark:text-[#9c9c9c]">{row.label}</span>
              <span className="flex-1 truncate text-right text-[#1a1a1a] dark:text-[#e6e6e6]">
                {row.value}
              </span>
            </div>
          ))}
        </div>
      ) : nodeData.description ? (
        <div className="px-2 pb-2 text-xs text-[#8a8a8a] dark:text-[#9c9c9c]">{nodeData.description}</div>
      ) : null}

      {/* 分支行标签 */}
      {nodeData.branches?.map((branch) => (
        <div key={branch} className="flex items-center justify-end gap-1 px-2 pb-1 text-[11px]">
          <span className={branch === "if" || branch === "continue" ? "text-emerald-600" : "text-[#8a8a8a]"}>
            {branch}
          </span>
        </div>
      ))}

      {/* 连接凸点视觉 */}
      <span className={cn("absolute top-1/2 -left-[4px] h-2 w-2 -translate-y-1/2 rounded-full", selected ? "bg-[#525252] dark:bg-[#cccccc]" : "bg-[#d8d8d8] dark:bg-[#444444]")} />
      {nodeData.kind !== "end" ? (
        <span className={cn("absolute top-1/2 -right-[4px] h-2 w-2 -translate-y-1/2 rounded-full", selected ? "bg-[#525252] dark:bg-[#cccccc]" : "bg-[#d8d8d8] dark:bg-[#444444]")} />
      ) : null}
    </div>
  )
})
