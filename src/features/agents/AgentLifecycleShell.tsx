import type * as React from "react"
import { FlaskConical, Rocket } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { avatarFor } from "@/pages/wf-agents-list"
import type { AgentInfo } from "@/services/wf-api"

/** MTC-005：Agent 详情三段生命周期导航（搭建 / 发布 / 观测）+ Hero 身份头。 */
export function AgentLifecycleShell({ agent, role, versionChip, envChips, build, release, observe, onTest, onPublish }: {
  agent: AgentInfo
  role?: string | null
  versionChip?: React.ReactNode
  envChips?: React.ReactNode
  build: React.ReactNode
  release: React.ReactNode
  observe: React.ReactNode
  onTest?: () => void
  onPublish?: () => void
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b bg-surface px-4 py-3">
        <img src={avatarFor(agent.id, agent.avatar)} alt="" className="size-10 rounded-lg object-cover" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-[15px] font-semibold">{agent.name}</span>
            <span className="rounded-md border px-1.5 py-0.5 text-[11px] text-muted-foreground">
              {role ?? agent.typeLabel}
            </span>
          </div>
          <div className="truncate text-xs text-muted-foreground">{agent.description || "—"}</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {versionChip}
          {envChips}
          {onTest ? (
            <Button variant="outline" size="sm" onClick={onTest}>
              <FlaskConical className="size-3.5" /> 测试
            </Button>
          ) : null}
          {onPublish ? (
            <Button size="sm" onClick={onPublish}>
              <Rocket className="size-3.5" /> 发布
            </Button>
          ) : null}
        </div>
      </div>
      <Tabs defaultValue="build" className="min-h-0 flex-1">
        <TabsList className="mx-4 mt-3">
          <TabsTrigger value="build">搭建</TabsTrigger>
          <TabsTrigger value="release">发布</TabsTrigger>
          <TabsTrigger value="observe">观测</TabsTrigger>
        </TabsList>
        <TabsContent value="build" className="min-h-0 flex-1 overflow-y-auto p-4">{build}</TabsContent>
        <TabsContent value="release" className="min-h-0 flex-1 overflow-y-auto p-4">{release}</TabsContent>
        <TabsContent value="observe" className="min-h-0 flex-1 overflow-y-auto p-4">{observe}</TabsContent>
      </Tabs>
    </div>
  )
}
