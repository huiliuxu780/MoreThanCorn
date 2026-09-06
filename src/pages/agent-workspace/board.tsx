/** 任务看板子页：run 级列表+事件查看（复用 AgentRunsPanel）。 */
import { AgentRunsPanel } from "@/components/agent-ops-panels"

export function AgentBoardSection({ agentId }: { agentId: string }) {
  return <AgentRunsPanel agentId={agentId} />
}
