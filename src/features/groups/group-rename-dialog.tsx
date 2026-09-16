/** 重命名群组小弹窗（台账 §2 实测：w384 圆12 内衬24；input h32 圆6 边二级；
 * footer 右对齐 gap8 距 input 24；保存=有改动才启用 disabled .5）。
 * 双入口：管理卡双击名 / ⋯→重命名。文案我方「重命名群组」（台账 §5-6 登记）。 */
import { useEffect, useState } from "react"
import { X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { groupsApi, type GroupView } from "@/services/as-api"

export function GroupRenameDialog({
  group, open, onOpenChange, onRenamed,
}: {
  group: GroupView | null
  open: boolean
  onOpenChange: (v: boolean) => void
  onRenamed?: () => void
}) {
  const [value, setValue] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open && group) setValue(group.name)
  }, [open, group])

  const dirty = group != null && value.trim() !== "" && value.trim() !== group.name

  const submit = async () => {
    if (!group || !dirty) return
    setSaving(true)
    try {
      await groupsApi.patch(group.id, { revision: group.revision, name: value.trim() })
      toast.success("已重命名")
      onOpenChange(false)
      onRenamed?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "重命名失败")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="p-6"
        style={{ width: 384, maxWidth: 384, borderRadius: 12 }}
      >
        <DialogTitle className="text-[14px] font-medium">重命名群组</DialogTitle>
        <button
          aria-label="Close"
          className="absolute right-3 top-3 rounded-[4px] p-1 text-(--text-tertiary) hover:bg-(--surface-muted)"
          onClick={() => onOpenChange(false)}
        >
          <X size={14} />
        </button>
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="输入群组名称"
          className="mt-0 h-8 rounded-[6px] text-[14px]"
          onKeyDown={(e) => { if (e.key === "Enter" && dirty) submit() }}
          autoFocus
        />
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" className="h-8 px-3 text-[13px]" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            className="h-8 px-3 text-[13px] disabled:opacity-50"
            disabled={!dirty || saving}
            onClick={submit}
          >
            保存
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
