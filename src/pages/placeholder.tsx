import { Construction } from "lucide-react"
import { PageContainer, PageHeader } from "@/components/app/page"

/** Phase A 路由骨架占位：route 可进入、标题正确，内容在后续 Phase 实现。 */
export function PagePlaceholder({
  title,
  description,
  phase,
}: {
  title: string
  description?: string
  phase?: string
}) {
  return (
    <PageContainer wide>
      <PageHeader title={title} description={description} />
      <div className="mt-6 flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-24 text-center">
        <Construction className="size-8 text-muted-foreground/60" />
        <div className="text-sm font-medium">页面骨架已就绪</div>
        <p className="max-w-md text-xs text-muted-foreground">
          {phase
            ? `该页面将在 ${phase} 按冻结 Design Spec 实现。`
            : "该页面将在后续 Phase 按冻结 Design Spec 实现。"}
        </p>
      </div>
    </PageContainer>
  )
}
