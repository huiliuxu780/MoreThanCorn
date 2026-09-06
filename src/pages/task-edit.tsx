import { useParams } from "react-router-dom"
import { TableSkeleton } from "@/components/app/list-state"
import { PageContainer } from "@/components/app/page"
import {
  AutonomousTaskEditor, formFromTask,
} from "@/features/autonomous/AutonomousTaskEditor"
import { useAsyncData } from "@/hooks/use-async-data"
import { bizApi } from "@/services/wf-api"

/** MTC-004：编辑自主任务 = 统一编辑器 edit 模式（服务端快照回填）。 */
export default function TaskEditPage() {
  const { taskId = "" } = useParams()
  const { data: task, loading } = useAsyncData(() => bizApi.task(taskId), [taskId])
  if (loading || !task) {
    return <PageContainer><TableSkeleton rows={6} columns={4} /></PageContainer>
  }
  return (
    <PageContainer className="max-w-4xl">
      <AutonomousTaskEditor mode="edit" taskId={taskId} initialForm={formFromTask(task)} />
    </PageContainer>
  )
}
