/** 16 号稿 B4：EventRoute 创建表单（向导步④与源详情页「路由治理」共用，单点防漂移）。
 *
 * 现状真缺口补位：路由创建此前仅 API/脚本可达（as-api 无 createRoute UI），
 * 本组件为全站首个路由创建 UI。destination XOR：automation | analysis_task。
 */
import * as React from "react"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { asApi } from "@/services/as-api"
import { bizApi } from "@/services/wf-api"

export interface RouteFormValue {
  name: string
  destKind: "automation" | "analysis_task"
  destId: string
}

export const EMPTY_ROUTE_FORM: RouteFormValue = {
  name: "", destKind: "automation", destId: "",
}

export function RouteForm({ value, set, idp = "rf" }: {
  value: RouteFormValue
  set: (patch: Partial<RouteFormValue>) => void
  idp?: string
}) {
  const [automations, setAutomations] = React.useState<{ id: string; name: string }[]>([])
  const [tasks, setTasks] = React.useState<{ id: string; name: string }[]>([])
  React.useEffect(() => {
    asApi.automations({}).then((r) => setAutomations(
      ((r.items ?? []) as { id: string; name?: string }[])
        .map((a) => ({ id: a.id, name: a.name ?? a.id })))).catch(() => setAutomations([]))
    bizApi.analysisTasks.list(1, 100).then((r) => setTasks(
      (r.items ?? []).map((t) => ({ id: t.id, name: t.name })))).catch(() => setTasks([]))
  }, [])
  const options = value.destKind === "automation" ? automations : tasks
  return (
    <>
      <div className="grid gap-1">
        <Label htmlFor={`${idp}-rname`}>路由名称</Label>
        <Input id={`${idp}-rname`} value={value.name}
               onChange={(e) => set({ name: e.target.value })}
               placeholder="留空自动建议：源名 → 目的地类型" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1">
          <Label id={`${idp}-dk-label`}>目的地类型（XOR）</Label>
          <Select value={value.destKind}
                  onValueChange={(v) => set({ destKind: v as RouteFormValue["destKind"], destId: "" })}>
            <SelectTrigger id={`${idp}-dk`} aria-labelledby={`${idp}-dk-label`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="automation">自动任务（AutomationDefinition）</SelectItem>
              <SelectItem value="analysis_task">分析批次（AnalysisTask）</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label id={`${idp}-di-label`}>目的地实例</Label>
          <Select value={value.destId} onValueChange={(v) => set({ destId: v })}>
            <SelectTrigger id={`${idp}-di`} aria-labelledby={`${idp}-di-label`}>
              <SelectValue placeholder="选择目的地" />
            </SelectTrigger>
            <SelectContent>
              {options.map((d) => (
                <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </>
  )
}
