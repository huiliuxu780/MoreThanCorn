/** useRunSession：试运行会话（校验 → 启动 → SSE 驱动画布状态）。
 *  08-26 语义保留：进行中禁止重复点击；校验失败提示「请先配置节点」。
 *  返工修复：校验失败时旧实现泄漏 running=true 导致试运行按钮永久禁用——现统一复位。 */
import { useCallback, useRef, useState } from "react"
import { runApi, wfApi, type ValidationIssue } from "@/services/wf-api"
import { toast } from "../toast"
import { subscribeRun, type RunStateMap } from "./NodeRunState"

export interface RunSession {
  runState: RunStateMap
  setRunState: React.Dispatch<React.SetStateAction<RunStateMap>>
  running: boolean
  lastRunId: string | null
  /** 启动试运行；issues 回传校验结果，返回值供入口决定是否关抽屉。 */
  startRealRun: (input: Record<string, unknown>) => Promise<"started" | "invalid" | "error">
}

export function useRunSession(opts: {
  workflowId: string
  onIssues: (issues: ValidationIssue[]) => void
}): RunSession {
  const { workflowId, onIssues } = opts
  const [runState, setRunState] = useState<RunStateMap>({})
  const [running, setRunning] = useState(false)
  const [lastRunId, setLastRunId] = useState<string | null>(null)
  const runningRef = useRef(false)

  const stop = useCallback(() => { runningRef.current = false; setRunning(false) }, [])

  const startRealRun = useCallback(async (input: Record<string, unknown>) => {
    if (runningRef.current) return "error"
    runningRef.current = true
    setRunning(true)
    const rep = await wfApi.validate(workflowId)
    onIssues(rep.issues)
    if (!rep.ok) {
      toast.error("请先配置节点")
      stop()
      return "invalid"
    }
    try {
      const r = await runApi.start(workflowId, input)
      setRunState({})
      setLastRunId(r.runId)
      subscribeRun(r.runId, setRunState, {
        onCompleted: () => { toast.success("运行成功"); stop() },
        onFailed: (err) => { toast.error(`运行失败：${err}`); stop() },
      })
      return "started"
    } catch (e) {
      toast.error((e as Error).message)
      stop()
      return "error"
    }
  }, [workflowId, onIssues, stop])

  return { runState, setRunState, running, lastRunId, startRealRun }
}
