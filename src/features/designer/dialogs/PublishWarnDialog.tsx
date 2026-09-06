/** PublishWarnDialog：发布软警告（16 §9：发布前未试运行，建议先验证）。 */
import { CircleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { C } from "@/components/wf/controls"

export function PublishWarnDialog({ open, onOpenChange, onTryRun, onPublish }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onTryRun: () => void
  onPublish: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-xl">
        <DialogHeader className="flex-row items-start gap-2 space-y-0">
          <CircleAlert className="mt-0.5 size-5 shrink-0" style={{ color: C.orange }} />
          <div className="space-y-1.5">
            <DialogTitle>发布前未试运行</DialogTitle>
            <DialogDescription>发布前未进行试运行，建议确认工作流正常运行后再发布。</DialogDescription>
          </div>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => { onOpenChange(false); onTryRun() }}>试运行</Button>
          <Button className="bg-primary text-primary-foreground hover:bg-brand-hover" onClick={onPublish}>继续发布</Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
