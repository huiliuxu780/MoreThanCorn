/** useDesignerDocument：工作流文档编排（加载/归一化/防抖自动保存/撤销重做/开始字段缓存）。
 *  从旧单体 DesignerInner 抽出，行为保持：
 *  - 加载时旧条件数据归一（分支升级 conditions[] + 同步声明 handle 含 else；旧图单出边视为第一分支）；
 *  - 历史上限 50 步，mutate 后 1200ms 防抖 saveDraft；
 *  - 07-SDD form：开始节点 formId → 字段缓存注入（VarCascader/DebugDrawer/OutputVars 消费）。 */
import { useCallback, useEffect, useRef, useState } from "react"
import {
  formsApi, wfApi,
  type NodeDefinition, type ValidationIssue, type WfDefinition,
} from "@/services/wf-api"
import { normCondBranches, setStartFields } from "@/components/wf/controls"
import type { NodeCfgLoose } from "./designer-types"
import { toast } from "./toast"

export interface DesignerDocument {
  def: WfDefinition | null
  setDef: React.Dispatch<React.SetStateAction<WfDefinition | null>>
  defs: NodeDefinition[]
  issues: ValidationIssue[]
  setIssues: React.Dispatch<React.SetStateAction<ValidationIssue[]>>
  savedAt: string
  revision: number
  latestVersion: number | null
  /** 最新 def 引用（事件回调内读取，避免闭包过期） */
  defRef: React.MutableRefObject<WfDefinition | null>
  doSave: (next: WfDefinition) => Promise<void>
  mutate: (next: WfDefinition) => void
  undo: () => void
  redo: () => void
}

export function useDesignerDocument(workflowId: string): DesignerDocument {
  const [def, setDef] = useState<WfDefinition | null>(null)
  const [defs, setDefs] = useState<NodeDefinition[]>([])
  const [issues, setIssues] = useState<ValidationIssue[]>([])
  const [savedAt, setSavedAt] = useState("")
  const [revision, setRevision] = useState(1)
  const [latestVersion, setLatestVersion] = useState<number | null>(null)
  const historyRef = useRef<WfDefinition[]>([])
  const pointerRef = useRef(-1)
  const saveTimer = useRef<number | null>(null)
  const defRef = useRef<WfDefinition | null>(null)
  defRef.current = def

  useEffect(() => {
    let alive = true
    Promise.all([wfApi.get(workflowId), wfApi.nodeDefinitions()]).then(([d, nd]) => {
      if (!alive) return
      /* 旧条件数据归一：分支升级为 conditions[] 结构，并同步声明 handle（含 else） */
      const defn = d.definition as WfDefinition
      defn.graph.nodes = defn.graph.nodes.map((n) => {
        if (n.type !== "condition") return n
        const bs = normCondBranches((n.config as NodeCfgLoose)?.branches)
        return { ...n, config: { ...(n.config as NodeCfgLoose), branches: bs }, branches: [...bs.map((b) => b.handle), "else"] }
      })
      defn.graph.edges = defn.graph.edges.map((e) => {
        if (e.sourceHandle) return e
        const src = defn.graph.nodes.find((n) => n.id === e.source)
        if (src?.type !== "condition") return e
        const first = (src.config as NodeCfgLoose).branches?.[0]?.handle
        return first ? { ...e, sourceHandle: first } : e
      })
      historyRef.current = [JSON.parse(JSON.stringify(defn))]
      pointerRef.current = 0
      setDef(defn); setRevision(d.draftRevision); setDefs(nd); setSavedAt(d.updatedAt)
      wfApi.validate(workflowId).then((r) => alive && setIssues(r.issues))
    })
    wfApi.versions(workflowId).then((vs) => alive && setLatestVersion(vs[0]?.versionNo ?? null)).catch(() => undefined)
    return () => { alive = false }
  }, [workflowId])

  /* 07-SDD form：开始字段缓存注入（模块级缓存 + bump 触发消费方重渲染） */
  const startFormId = (((def?.graph.nodes.find((n) => n.type === "input")?.config) as Record<string, unknown> | undefined)?.formId as string) || ""
  const [, bumpStart] = useState(0)
  useEffect(() => {
    if (!startFormId) { setStartFields(null); bumpStart((x) => x + 1); return }
    formsApi.get(startFormId).then((f) => {
      setStartFields((f.fields ?? []).map((x) => ({ name: x.key ?? (x as unknown as { name?: string }).name ?? "", type: x.dataType ?? x.type })))
      bumpStart((x) => x + 1)
    }).catch(() => { setStartFields(null); bumpStart((x) => x + 1) })
  }, [startFormId])

  const doSave = useCallback(async (next: WfDefinition) => {
    try {
      const res = await wfApi.saveDraft(workflowId, next, revision)
      setRevision((r) => r + 1); setSavedAt(res.savedAt)
      setIssues((await wfApi.validate(workflowId)).issues)
    } catch (e) { toast.error(`保存失败：${(e as Error).message}`) }
  }, [workflowId, revision])

  const mutate = useCallback((next: WfDefinition) => {
    const h = historyRef.current.slice(0, pointerRef.current + 1)
    h.push(JSON.parse(JSON.stringify(next)))
    if (h.length > 50) h.shift()
    historyRef.current = h
    pointerRef.current = h.length - 1
    defRef.current = next
    setDef(next)
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => doSave(next), 1200)
  }, [doSave])

  const applyHistory = useCallback((defn: WfDefinition) => {
    setDef(defn)
    doSave(defn)
  }, [doSave])

  const undo = useCallback(() => {
    if (pointerRef.current > 0) {
      pointerRef.current -= 1
      applyHistory(JSON.parse(JSON.stringify(historyRef.current[pointerRef.current])))
    }
  }, [applyHistory])

  const redo = useCallback(() => {
    if (pointerRef.current < historyRef.current.length - 1) {
      pointerRef.current += 1
      applyHistory(JSON.parse(JSON.stringify(historyRef.current[pointerRef.current])))
    }
  }, [applyHistory])

  return { def, setDef, defs, issues, setIssues, savedAt, revision, latestVersion, defRef, doSave, mutate, undo, redo }
}
