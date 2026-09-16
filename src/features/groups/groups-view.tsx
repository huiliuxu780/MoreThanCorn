/** 管理页 Group 视图（台账 §2 逐值）：网格 auto-fill minmax(310px) gap12；
 * 虚线大 tile 312x127 居首格；群卡 312x127 白底边三级圆6 pad 16/12/12：
 * 48 mint 头像簇 + 名 16/650（双击=重命名弹窗）+ footer 虚线分隔：
 * 创建对话任务 h28 12 二级色 + ⋯28（菜单=重命名/删除危险色）。
 * 整页空态复刻 DS-010。 */
import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Flag, MoreHorizontal, Plus, Users } from "lucide-react"
import { toast } from "sonner"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { groupsApi, type GroupView } from "@/services/as-api"
import { GroupAvatarCluster } from "./group-avatar"
import { GroupCreateDialog } from "./group-create-dialog"
import { GroupRenameDialog } from "./group-rename-dialog"

export function GroupsView({ refreshKey }: { refreshKey?: number }) {
  const nav = useNavigate()
  const [items, setItems] = useState<GroupView[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<GroupView | null>(null)

  const load = () => {
    setLoading(true)
    groupsApi.list()
      .then((r) => setItems(r.items))
      .catch((e) => toast.error(e instanceof Error ? e.message : "加载失败"))
      .finally(() => setLoading(false))
  }
  useEffect(load, [refreshKey])

  const openChat = async (g: GroupView) => {
    try {
      let sid = g.activeSessionId
      if (!sid) {
        const s = await groupsApi.open(g.id)
        sid = s.id
      }
      nav(`/conversations/groups/${g.id}/conv_${sid}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "开聊失败")
    }
  }

  const remove = async (g: GroupView) => {
    try {
      const r = await groupsApi.remove(g.id)
      toast.success(r.archived ? "已归档（存在会话流水）" : "已删除")
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "删除失败")
    }
  }

  if (!loading && items.length === 0) {
    return (
      <>
        <div className="mt-6 flex flex-col items-center gap-3 rounded-[8px] border border-dashed border-(--border) py-16">
          <span className="flex h-12 w-12 items-center justify-center rounded-[8px] border border-dashed border-(--border)">
            <Users size={20} className="text-(--text-tertiary)" />
          </span>
          <span className="text-[15px] font-medium">暂无 Group</span>
          <span className="text-[13px] text-(--text-tertiary)">
            创建Group后，可以在这里集中管理Group。
          </span>
          <button
            className="mt-2 inline-flex h-8 items-center gap-2 rounded-[4px] bg-(--text-primary) px-3 text-[13px] font-medium text-(--background)"
            onClick={() => setCreateOpen(true)}
          >
            <Plus size={14} /> 新建 Group
          </button>
        </div>
        <GroupCreateDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={load} />
      </>
    )
  }

  return (
    <>
      <div
        className="mt-6 grid gap-3"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, max(310px, 25% - 9px)), 1fr))" }}
      >
        <button
          className="flex h-[127px] items-center justify-center gap-2 rounded-[6px] border border-dashed border-(--border) bg-(--surface-raised) text-[16px] text-(--text-secondary)"
          onClick={() => setCreateOpen(true)}
        >
          <Plus size={16} /> 新建 Group
        </button>
        {items.map((g) => (
          <div
            key={g.id}
            className="flex h-[127px] flex-col rounded-[6px] border border-(--border) bg-(--surface-raised) px-3 pb-3 pt-4"
          >
            <div className="flex min-h-0 flex-1 items-center gap-3">
              <GroupAvatarCluster memberIds={g.members.map((m) => m.agentId)} variant="mgmt" />
              <button
                onClick={() => openChat(g)}
                onDoubleClick={() => setRenameTarget(g)}
                className="min-w-0 flex-1 truncate text-left text-[16px] font-[650]"
                title={`${g.name}，双击编辑名称`}
              >
                {g.name}
              </button>
            </div>
            <div className="flex items-center justify-between border-t border-dashed border-(--border) pt-1.5">
              <button
                className="inline-flex h-7 items-center gap-1 rounded-[4px] px-1 text-[12px] text-(--text-secondary) hover:bg-(--surface-muted)"
                onClick={() => openChat(g)}
              >
                <Flag size={13} /> 创建对话任务
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button aria-label={`${g.name} 的更多操作`} className="flex h-7 w-7 items-center justify-center rounded-[4px] text-(--text-secondary) hover:bg-(--surface-muted)">
                    <MoreHorizontal size={14} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setRenameTarget(g)}>重命名</DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-(--danger, #FF4D4F)"
                    onClick={() => remove(g)}
                  >
                    删除
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        ))}
      </div>
      <GroupCreateDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={load} />
      <GroupRenameDialog
        group={renameTarget}
        open={renameTarget != null}
        onOpenChange={(v) => !v && setRenameTarget(null)}
        onRenamed={load}
      />
    </>
  )
}
