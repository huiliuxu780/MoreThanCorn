/** Agent 工作区路由页（09-07 重构）：二级侧栏九子页 + 对话入口。
 *  R-Archive 语义延续：旧三类封存 Agent 全子页只读、无对话入口；module 型可编辑。
 *  404（历史 workflow id 误入）回落旧设计器，保持兼容。 */
import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"

import { AgentWorkspaceShell, type WorkspaceSection } from "@/features/agents/AgentWorkspaceShell"
import { useAgentVersionState } from "@/components/agent-publish-dialog"
import { Label } from "@/components/ui/label"
import { agentApi, type AgentInfo } from "@/services/wf-api"
import WfDesignerPage from "@/features/designer/DesignerPage"
import ModuleAgentConfigPage from "./module-agent-config"
import { CustomAgentConfig } from "./agent-workspace/custom-config"
import { avatarFor } from "@/lib/agent-avatar"
import { AgentHomeSection } from "./agent-workspace/home"
import { AgentMemorySection } from "./agent-workspace/memory"
import { AgentSkillsSection } from "./agent-workspace/skills"
import { AgentConnectorsSection } from "./agent-workspace/connectors"
import { AgentMountsSection } from "./agent-workspace/mounts"
import { AgentGovernanceSection } from "./agent-workspace/governance"
import { AgentTaskBoardSection } from "./agent-workspace/board"
import { AgentAutonomousSection } from "./agent-workspace/autonomous"
import { AgentProfileSection } from "./agent-workspace/profile"

const INK2 = "#5A6472"; const INK3 = "#B9C2CF"

interface AgentDraftConfig {
  rolePrompt?: string
  modelRef?: { modelId?: string; diversity?: string; historyTurns?: number; toolCallModelId?: string }
  conversation?: { autoFollowUp?: { enabled?: boolean; count?: number }; chitchatFallback?: { enabled?: boolean } }
  [key: string]: unknown
}

/** 旧 Agent（autonomous）只读详情（R-Archive：封存后仅展示）。 */
function ArchivedAutonomousView({ agent }: { agent: AgentInfo }) {
  const cfg = (agent.config ?? {}) as AgentDraftConfig
  const conv = cfg.conversation ?? {}
  const modelRef = cfg.modelRef ?? {}
  return (
    <div className="max-w-3xl space-y-4" data-testid="archived-agent-view">
      <div className="space-y-2">
        <Label className="text-xs">基本信息</Label>
        <div className="flex items-start gap-3">
          <img src={avatarFor(agent.id, agent.avatar)} alt="agent头像" className="size-20 rounded-md object-cover" />
          <div className="flex-1 space-y-1">
            <div className="text-sm font-medium">{agent.name}</div>
            <div className="whitespace-pre-wrap text-xs text-muted-foreground">{agent.description || "（无描述）"}</div>
          </div>
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">角色能力描述</Label>
        <div className="min-h-10 whitespace-pre-wrap rounded border bg-(--segment-bg) p-2 text-xs">
          {cfg.rolePrompt || "（空）"}
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">模型</Label>
        <div className="rounded border px-2 py-1.5 text-xs">
          {modelRef.modelId || "（未选择）"}
          <span className="pl-2 text-[11px]" style={{ color: INK3 }}>
            {`多样性 ${modelRef.diversity ?? "balanced"} · 历史轮次 ${modelRef.historyTurns ?? 5} · 自动续问 ${conv.autoFollowUp?.enabled ? "开" : "关"}`}
          </span>
        </div>
      </div>
      <div className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-600">
        该旧版 Agent 已封存，仅支持历史查询；配置与运行入口不再开放。
      </div>
    </div>
  )
}

const SECTIONS: WorkspaceSection[] = ["home", "board", "autonomous", "memory", "skills", "connectors", "workflows", "knowledge", "config", "governance", "profile"]

export default function WfAgentEditorPage() {
  const { agentId = "", section: sectionParam } = useParams()
  const section: WorkspaceSection = SECTIONS.includes(sectionParam as WorkspaceSection)
    ? (sectionParam as WorkspaceSection) : "home"
  const [agent, setAgent] = useState<AgentInfo | null>(null)
  const [legacy, setLegacy] = useState(false)
  const vs = useAgentVersionState(agent && agent.type === "autonomous" ? agent.id : undefined)
  useEffect(() => {
    setAgent(null); setLegacy(false)
    agentApi.get(agentId).then(setAgent).catch((e) => { if (String((e as Error).message).startsWith("404")) setLegacy(true) })
  }, [agentId])
  if (legacy) return <WfDesignerPage workflowId={agentId} />
  if (!agent) return <div className="p-8 text-sm" style={{ color: INK2 }}>加载中…</div>

  // 2026-09-10 P0-B/E：只读判定 = 已归档 或 旧三类封存类型；custom Agent 是
  // 一等可执行公民（AgentScope 统一入口），不再因 type!=="module" 被整体只读。
  const LEGACY_READONLY_TYPES = new Set(["autonomous", "dialogue", "expert-group"])
  const archived = Boolean(agent.archived) || LEGACY_READONLY_TYPES.has(agent.type)

  const content = (() => {
    switch (section) {
      case "home": return <AgentHomeSection agent={agent} />
      case "board": return <AgentTaskBoardSection agentId={agent.id} />
      case "autonomous": return <AgentAutonomousSection agentId={agent.id} />
      case "profile": return <AgentProfileSection agent={agent} archived={archived} />
      case "memory": return <AgentMemorySection agentId={agent.id} readOnly={archived} />
      case "skills": return <AgentSkillsSection agentId={agent.id} readOnly={archived} />
      case "connectors": return <AgentConnectorsSection agent={agent} readOnly={archived} />
      case "workflows": return <AgentMountsSection agent={agent} kind="workflows" readOnly={archived} />
      case "knowledge": return <AgentMountsSection agent={agent} kind="knowledges" readOnly={archived} />
      case "governance": return <AgentGovernanceSection agentId={agent.id} archived={archived} />
      case "config":
        if (agent.type === "custom") return <CustomAgentConfig agent={agent} />
        if (agent.type === "module") return <ModuleAgentConfigPage agent={agent} />
        if (agent.type === "dialogue" || agent.type === "expert-group") {
          return (
            <div className="h-[70vh] min-h-0">
              <WfDesignerPage workflowId={agent.workflowId ?? agentId} agentId={agent.id}
                agentMeta={{ name: agent.name, typeLabel: agent.typeLabel, agentType: agent.type }}
                avatar={avatarFor(agent.id, agent.avatar)} readOnly />
            </div>
          )
        }
        return <ArchivedAutonomousView agent={agent} />
    }
  })()

  return (
    <AgentWorkspaceShell
      agent={agent}
      section={section}
      archived={archived}
      versionChip={agent.type === "autonomous" ? (
        <span className="rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground">
          {vs.latest ? `V${vs.latest.versionNo}` : "草稿"}
        </span>
      ) : undefined}
      envChips={agent.type === "autonomous" ? (
        <>
          {vs.envs.sandbox != null && <span className="rounded bg-brand-soft px-1.5 py-0.5 text-[11px] text-selected-foreground">沙箱 V{vs.envs.sandbox}</span>}
          {vs.envs.prod != null && <span className="rounded bg-brand-soft px-1.5 py-0.5 text-[11px] text-selected-foreground">线上 V{vs.envs.prod}</span>}
        </>
      ) : undefined}
    >
      {content}
    </AgentWorkspaceShell>
  )
}
