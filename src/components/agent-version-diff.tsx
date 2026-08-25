/** E-2.2：Agent 版本对比——任选两版本（或草稿 vs 版本），definition JSON 行级 diff（增绿删红）。 */
import { useEffect, useMemo, useState } from "react"

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { agentApi } from "@/services/wf-api"

type VersionOption = { versionId: string; versionNo: number }

interface DiffLine { kind: "same" | "add" | "del"; text: string }

/** 经典 LCS 行 diff（definition 体量小，O(mn) 足够）。 */
function diffLines(a: string[], b: string[]): DiffLine[] {
  const m = a.length, n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out: DiffLine[] = []
  let i = 0, j = 0
  while (i < m && j < n) {
    if (a[i] === b[j]) { out.push({ kind: "same", text: a[i] }); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ kind: "del", text: a[i] }); i++ }
    else { out.push({ kind: "add", text: b[j] }); j++ }
  }
  while (i < m) out.push({ kind: "del", text: a[i++] })
  while (j < n) out.push({ kind: "add", text: b[j++] })
  return out
}

async function loadDefinition(agentId: string, ref: string, versions: VersionOption[]): Promise<Record<string, unknown> | null> {
  try {
    if (ref === "draft") return (await agentApi.draftDefinition(agentId)).definition
    const v = versions.find((x) => x.versionId === ref)
    if (!v) return null
    return (await agentApi.versionDetail(agentId, ref)).definition as Record<string, unknown>
  } catch {
    return null
  }
}

export function AgentVersionDiffDialog({ agentId, open, onClose, versions, defaultLeft, defaultRight }: {
  agentId: string; open: boolean; onClose: () => void
  versions: VersionOption[]
  defaultLeft?: string; defaultRight?: string
}) {
  const [left, setLeft] = useState("draft")
  const [right, setRight] = useState("")
  const [leftDef, setLeftDef] = useState<Record<string, unknown> | null>(null)
  const [rightDef, setRightDef] = useState<Record<string, unknown> | null>(null)

  useEffect(() => {
    if (!open) return
    const sorted = [...versions].sort((a, b) => b.versionNo - a.versionNo)
    setLeft(defaultLeft ?? "draft")
    setRight(defaultRight ?? (sorted[0]?.versionId ?? "draft"))
  }, [open, defaultLeft, defaultRight, versions])

  useEffect(() => {
    if (!open || !agentId) return
    setLeftDef(null); setRightDef(null)
    loadDefinition(agentId, left, versions).then(setLeftDef)
    loadDefinition(agentId, right, versions).then(setRightDef)
  }, [open, agentId, left, right, versions])

  const diff = useMemo(() => {
    if (!leftDef || !rightDef) return null
    const a = JSON.stringify(leftDef, null, 2).split("\n")
    const b = JSON.stringify(rightDef, null, 2).split("\n")
    return diffLines(a, b)
  }, [leftDef, rightDef])

  const adds = diff?.filter((d) => d.kind === "add").length ?? 0
  const dels = diff?.filter((d) => d.kind === "del").length ?? 0
  const label = (ref: string) => ref === "draft" ? "当前草稿" : `V${versions.find((v) => v.versionId === ref)?.versionNo ?? "?"}`

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>版本对比{diff ? <span className="pl-2 text-xs font-normal text-muted-foreground">+{adds} / −{dels} 行</span> : null}</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-2 text-xs">
          <Select value={left} onValueChange={setLeft}>
            <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">当前草稿</SelectItem>
              {versions.map((v) => <SelectItem key={v.versionId} value={v.versionId}>V{v.versionNo}</SelectItem>)}
            </SelectContent>
          </Select>
          <span className="text-muted-foreground">→</span>
          <Select value={right} onValueChange={setRight}>
            <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">当前草稿</SelectItem>
              {versions.map((v) => <SelectItem key={v.versionId} value={v.versionId}>V{v.versionNo}</SelectItem>)}
            </SelectContent>
          </Select>
          <span className="ml-auto text-muted-foreground">{label(left)} 与 {label(right)} 的 definition 差异</span>
        </div>
        <div className="max-h-[55vh] overflow-auto rounded-md border bg-neutral-50 font-mono text-[11px] leading-5">
          {!diff ? (
            <div className="p-4 text-muted-foreground">加载定义中…</div>
          ) : diff.every((d) => d.kind === "same") ? (
            <div className="p-4 text-muted-foreground">两个定义完全一致</div>
          ) : (
            diff.map((d, i) => (
              <div
                key={i}
                className={d.kind === "add" ? "bg-emerald-50 text-emerald-700" : d.kind === "del" ? "bg-red-50 text-red-600 line-through decoration-red-300" : "text-neutral-600"}
              >
                <span className="inline-block w-5 select-none pl-1 text-center opacity-60">{d.kind === "add" ? "+" : d.kind === "del" ? "−" : ""}</span>
                {d.text || " "}
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
