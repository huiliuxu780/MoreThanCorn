/** useWorkflowLock：真实编辑锁（后端 resource_lock；SDD A-16 走 lockApi；E-2.4：Agent 编辑锁 resourceId=agent:{id}）。
 *  R-Archive：封存画布（readOnly+agentMeta）不取锁。 */
import { useCallback, useEffect, useRef, useState } from "react"
import { lockApi } from "@/services/wf-api"

export interface WorkflowLock {
  lockUser: string
  lockByOther: boolean
  forceUnlock: () => Promise<void>
}

export function useWorkflowLock(resourceId: string, enabled: boolean): WorkflowLock {
  const [lockUser, setLockUser] = useState("")
  const [lockByOther, setLockByOther] = useState(false)
  const wsIdRef = useRef(Math.random().toString(36).slice(2, 8))

  useEffect(() => {
    if (!enabled) return
    const wsId = wsIdRef.current
    lockApi.acquire(resourceId, wsId, "质量管理员")
      .then((r) => { setLockUser(r.user ?? ""); setLockByOther(!!r.lockedByOther) })
      .catch(() => undefined)
    return () => { lockApi.release(resourceId, wsId).catch(() => undefined) }
  }, [resourceId, enabled])

  const forceUnlock = useCallback(async () => {
    await lockApi.forceRelease(resourceId).catch(() => undefined)
    const r = await lockApi.acquire(resourceId, wsIdRef.current, "质量管理员").catch(() => null)
    if (r) { setLockUser(r.user ?? ""); setLockByOther(!!r.lockedByOther) }
  }, [resourceId])

  return { lockUser, lockByOther, forceUnlock }
}
