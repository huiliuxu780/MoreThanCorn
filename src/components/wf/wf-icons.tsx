/** 08-26 用户反馈：工作流自有图标组（与 agent 头像库并存）。icon 值："wf:xxx"=图标组；"/avatars/.."=头像图。 */
import {
  Bot, Database, FileText, Gauge, GitBranch, Layers, Network, ShieldCheck, Workflow, Zap,
  type LucideIcon,
} from "lucide-react"

export const WORKFLOW_ICONS: { key: string; label: string; color: string; Icon: LucideIcon }[] = [
  { key: "wf:workflow", label: "流程", color: "#3D6BFF", Icon: Workflow },
  { key: "wf:network", label: "网络", color: "#0062FF", Icon: Network },
  { key: "wf:branch", label: "分支", color: "#FF4C00", Icon: GitBranch },
  { key: "wf:bot", label: "智能", color: "#F97E2B", Icon: Bot },
  { key: "wf:database", label: "数据", color: "#7B61FF", Icon: Database },
  { key: "wf:file", label: "记录", color: "#188F00", Icon: FileText },
  { key: "wf:zap", label: "自动", color: "#E6A23C", Icon: Zap },
  { key: "wf:shield", label: "质检", color: "#0E9F6E", Icon: ShieldCheck },
  { key: "wf:layers", label: "层叠", color: "#AA00FF", Icon: Layers },
  { key: "wf:gauge", label: "度量", color: "#0891B2", Icon: Gauge },
]

export function WfIcon({ icon, className = "size-6 rounded-md", iconCls = "size-3.5" }: {
  icon?: string | null; className?: string; iconCls?: string
}) {
  if (icon && !icon.startsWith("wf:")) {
    return <img src={icon} alt="" className={`${className} object-cover`} />
  }
  const e = WORKFLOW_ICONS.find((w) => w.key === icon) ?? WORKFLOW_ICONS[0]
  return (
    <span className={`flex items-center justify-center ${className}`} style={{ background: e.color }} title={e.label}>
      <e.Icon className={`${iconCls} text-white`} />
    </span>
  )
}
