/** WorkflowMetaDialog：工作流基础信息编辑（名称/简介/图标；图标=WORKFLOW_ICONS + 头像库）。
 *  08-26 用户反馈形态保留；保存走 wfApi.updateMeta（真接口）。 */
import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { WORKFLOW_ICONS, WfIcon } from "@/components/wf/wf-icons"
import { avatarFor, AVATARS } from "@/pages/wf-agents-list"
import { C } from "@/components/wf/controls"
import { wfApi } from "@/services/wf-api"
import { toast } from "../toast"

export function WorkflowMetaDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workflowId: string
  initial: { name: string; description: string; icon: string | null }
  onSaved: (meta: { name: string; description: string; icon: string | null }) => void
}) {
  const { open, onOpenChange, workflowId, initial, onSaved } = props
  const [metaName, setMetaName] = useState(initial.name)
  const [metaDesc, setMetaDesc] = useState(initial.description)
  const [metaIcon, setMetaIcon] = useState<string | null>(initial.icon)
  const [avatarOpen, setAvatarOpen] = useState(false)
  // open 变化时重置为最新初值（Dialog 复用同一实例）
  const [lastOpen, setLastOpen] = useState(open)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) { setMetaName(initial.name); setMetaDesc(initial.description); setMetaIcon(initial.icon) }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>工作流基础信息</DialogTitle></DialogHeader>
        <div className="flex gap-3">
          <div className="flex-1 space-y-2">
            <Input value={metaName} placeholder="名称" onChange={(e) => setMetaName(e.target.value)} />
            <Textarea className="min-h-24 text-xs" value={metaDesc} placeholder="简介" onChange={(e) => setMetaDesc(e.target.value)} />
          </div>
          <button className="shrink-0 overflow-hidden rounded-lg border bg-popover p-1" style={{ borderColor: C.cardBorder }} title="选择图标" onClick={() => setAvatarOpen(true)}>
            <WfIcon icon={metaIcon} className="size-20 rounded-md" iconCls="size-8" />
          </button>
        </div>
        <Dialog open={avatarOpen} onOpenChange={setAvatarOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>选择图标</DialogTitle></DialogHeader>
            <div className="grid grid-cols-6 gap-3">
              {WORKFLOW_ICONS.map((w) => (
                <button key={w.key} className={`flex aspect-square w-full items-center justify-center rounded-lg ${metaIcon === w.key ? "ring-2 ring-ring" : ""}`}
                  style={{ background: w.color }} title={w.label}
                  onClick={() => { setMetaIcon(w.key); setAvatarOpen(false) }}>
                  <w.Icon className="size-6 text-white" />
                </button>
              ))}
            </div>
            <div className="pb-1 pt-2 text-xs text-muted-foreground">或使用头像库</div>
            <div className="grid grid-cols-6 gap-3">
              {AVATARS.map((src) => (
                <button key={src} className={`aspect-square w-full overflow-hidden rounded-lg ${(metaIcon ?? avatarFor(workflowId)) === src ? "ring-2 ring-ring" : ""}`}
                  onClick={() => { setMetaIcon(src); setAvatarOpen(false) }}>
                  <img src={src} alt="" className="size-full object-cover" />
                </button>
              ))}
            </div>
          </DialogContent>
        </Dialog>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={async () => {
            try {
              await wfApi.updateMeta(workflowId, { name: metaName, description: metaDesc, icon: metaIcon })
              onSaved({ name: metaName, description: metaDesc, icon: metaIcon })
              toast.success("已保存")
              onOpenChange(false)
            } catch (e) { toast.error((e as Error).message) }
          }}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
