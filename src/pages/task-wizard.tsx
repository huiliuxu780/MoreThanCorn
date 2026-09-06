import { PageContainer } from "@/components/app/page"
import { AutonomousTaskEditor } from "@/features/autonomous/AutonomousTaskEditor"

/** MTC-004：新建自主任务 = 统一编辑器 create 模式。 */
export default function TaskWizardPage() {
  return (
    <PageContainer className="max-w-4xl">
      <AutonomousTaskEditor mode="create" />
    </PageContainer>
  )
}
