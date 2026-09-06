/** ScheduleDialog：定时任务抽屉（cron + 时区创建、启停、删除；真 scheduleApi）。 */
import { useCallback, useEffect, useState } from "react"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { C } from "@/components/wf/controls"
import { scheduleApi, type ScheduleInfo } from "@/services/wf-api"
import { toast } from "../toast"

export function ScheduleDialog({ workflowId, onClose }: { workflowId: string; onClose: () => void }) {
  const [list, setList] = useState<ScheduleInfo[]>([])
  const [cron, setCron] = useState("0 9 * * *")
  const [tz, setTz] = useState("Asia/Shanghai")
  const load = useCallback(() => { scheduleApi.list(workflowId).then(setList) }, [workflowId])
  useEffect(() => { load() }, [load])
  return (
    <div className="absolute inset-y-0 right-0 z-20 flex w-[380px] max-w-[92vw] flex-col border-l bg-surface" style={{ borderColor: C.cardBorder }}>
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-[15px] font-semibold" style={{ color: C.ink }}>定时任务</span>
        <button onClick={onClose} title="关闭定时任务"><X className="size-4 text-muted-foreground" /></button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto px-4">
        <div className="space-y-2 rounded-md p-2" style={{ background: "var(--surface-muted)" }}>
          <div className="text-xs" style={{ color: C.ink2 }}>Cron 表达式</div>
          <Input className="h-7 text-xs" value={cron} onChange={(e) => setCron(e.target.value)} />
          <div className="text-xs" style={{ color: C.ink2 }}>时区</div>
          <Input className="h-7 text-xs" value={tz} onChange={(e) => setTz(e.target.value)} />
          <Button size="sm" className="bg-primary text-primary-foreground hover:bg-brand-hover"
            onClick={async () => { try { await scheduleApi.create(workflowId, cron, tz); load() } catch (e) { toast.error((e as Error).message) } }}>
            创建定时任务
          </Button>
        </div>
        {list.map((sc) => (
          <div key={sc.id} className="rounded-md border p-2 text-xs" style={{ borderColor: C.cardBorder }}>
            <div className="flex items-center gap-2">
              <span className="font-medium" style={{ color: C.ink }}>{sc.cron}</span>
              <span style={{ color: C.ink3 }}>{sc.timezone}</span>
              <span style={{ color: sc.enabled ? "var(--status-success)" : C.ink3 }}>
                {sc.enabled ? "启用" : "停用"}
              </span>
              <div className="ml-auto flex gap-1">
                <Button variant="outline" size="sm" className="h-6 text-[11px]"
                  onClick={async () => { await (sc.enabled ? scheduleApi.disable(sc.id) : scheduleApi.enable(sc.id)); load() }}>
                  {sc.enabled ? "停用" : "启用"}
                </Button>
                <Button variant="outline" size="sm" className="h-6 text-[11px]"
                  onClick={async () => { await scheduleApi.remove(sc.id); load() }}>删除</Button>
              </div>
            </div>
            <div className="pt-1" style={{ color: C.ink3 }}>
              下次执行：{sc.nextRunAt ? new Date(sc.nextRunAt).toLocaleString() : "—"}
              {sc.lastRanAt ? ` · 上次：${new Date(sc.lastRanAt).toLocaleString()}` : ""}
            </div>
          </div>
        ))}
        {list.length === 0 && <div className="py-8 text-center text-xs" style={{ color: C.ink3 }}>暂无定时任务</div>}
      </div>
    </div>
  )
}
