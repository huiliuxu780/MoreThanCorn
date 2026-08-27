/**
 * 发布治理（09-SDD P2-08）：Workflow/Rules/Task/Definition 版本发布申请队列。
 * 审批门禁、Canary、发布、回滚与版本 Diff 的统一操作面（真数据 /api/governance）。
 */
import { useCallback, useEffect, useState } from "react"
import { RefreshCw } from "lucide-react"

import { PageContainer, PageHeader } from "@/components/app/page"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  ACTION_LABEL,
  RESOURCE_TYPE_LABEL,
  STATE_LABEL,
  allowedActions,
  diffRows,
  governanceApi,
  summarizeDiff,
  type GovernanceResourceType,
  type ReleaseAction,
  type ReleaseRequest,
  type ReleaseState,
  type VersionDiff,
} from "@/services/governance"

const STATE_TONE: Record<ReleaseState, string> = {
  pending: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  approved: "bg-blue-500/15 text-blue-600 border-blue-500/30",
  rejected: "bg-red-500/15 text-red-600 border-red-500/30",
  released: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
  rolled_back: "bg-zinc-500/15 text-zinc-600 border-zinc-500/30",
}

const ACTION_TONE: Record<ReleaseAction, "default" | "secondary" | "destructive" | "outline"> = {
  approve: "default",
  reject: "destructive",
  release: "default",
  promote: "secondary",
  rollback: "outline",
}

export default function ReleaseGovernancePage() {
  const [items, setItems] = useState<ReleaseRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [busyId, setBusyId] = useState<string>("")
  const [diff, setDiff] = useState<VersionDiff | null>(null)
  // 新建发布申请表单
  const [form, setForm] = useState({ resourceType: "workflow" as GovernanceResourceType, resourceId: "", toVersionNo: 1, canary: false, note: "" })
  const [creating, setCreating] = useState(false)

  const refresh = useCallback(() => {
    setLoading(true)
    setError("")
    governanceApi.list()
      .then((r) => setItems(r.items ?? []))
      .catch((e) => setError(String(e?.message ?? e)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const runAction = async (rr: ReleaseRequest, action: ReleaseAction) => {
    setBusyId(rr.id)
    setError("")
    try {
      if (action === "approve") await governanceApi.approve(rr.id)
      else if (action === "reject") await governanceApi.reject(rr.id, "前端驳回")
      else if (action === "release") await governanceApi.release(rr.id)
      else if (action === "promote") await governanceApi.promote(rr.id)
      else if (action === "rollback") await governanceApi.rollback(rr.id)
      refresh()
    } catch (e) {
      setError(String((e as Error)?.message ?? e))
    } finally {
      setBusyId("")
    }
  }

  const openDiff = async (rr: ReleaseRequest) => {
    setError("")
    if (rr.fromVersionNo == null) { setError("首次发布无前置版本，无可比对基线"); return }
    try {
      setDiff(await governanceApi.diff(rr.resourceType, rr.resourceId, rr.fromVersionNo, rr.toVersionNo))
    } catch (e) {
      setError(String((e as Error)?.message ?? e))
    }
  }

  const createRequest = async () => {
    setCreating(true)
    setError("")
    try {
      await governanceApi.create({
        resourceType: form.resourceType, resourceId: form.resourceId,
        toVersionNo: form.toVersionNo, canary: form.canary, note: form.note,
      })
      setForm({ resourceType: "workflow", resourceId: "", toVersionNo: 1, canary: false, note: "" })
      refresh()
    } catch (e) {
      setError(String((e as Error)?.message ?? e))
    } finally {
      setCreating(false)
    }
  }

  return (
    <PageContainer className="space-y-4">
      <PageHeader
        title="发布治理"
        description="版本发布申请：审批门禁 · 职责分离 · Canary · 发布 / 回滚 · 变更审计（09-SDD P2-08）"
      />

      {/* 新建发布申请 */}
      <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-card p-3">
        <div className="w-36">
          <p className="mb-1 text-xs text-muted-foreground">资源类型</p>
          <Select value={form.resourceType} onValueChange={(v) => setForm((f) => ({ ...f, resourceType: v as GovernanceResourceType }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(RESOURCE_TYPE_LABEL) as GovernanceResourceType[]).map((t) => (
                <SelectItem key={t} value={t}>{RESOURCE_TYPE_LABEL[t]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-48 flex-1">
          <p className="mb-1 text-xs text-muted-foreground">资源 ID</p>
          <Input value={form.resourceId} placeholder="目标资源 ID" onChange={(e) => setForm((f) => ({ ...f, resourceId: e.target.value }))} />
        </div>
        <div className="w-28">
          <p className="mb-1 text-xs text-muted-foreground">目标版本</p>
          <Input type="number" min={1} value={form.toVersionNo} onChange={(e) => setForm((f) => ({ ...f, toVersionNo: Number(e.target.value) }))} />
        </div>
        <div className="flex items-center gap-2 pb-2">
          <Switch checked={form.canary} onCheckedChange={(v) => setForm((f) => ({ ...f, canary: v }))} />
          <span className="text-xs text-muted-foreground">Canary</span>
        </div>
        <Button size="sm" disabled={creating || !form.resourceId || form.toVersionNo < 1} onClick={createRequest}>
          提交发布申请
        </Button>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">发布申请队列</h2>
        <Button variant="ghost" size="sm" onClick={refresh}><RefreshCw className="size-4" />刷新</Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">加载中…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">暂无发布申请</p>
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>资源</TableHead>
                <TableHead>版本</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>Canary</TableHead>
                <TableHead>申请人</TableHead>
                <TableHead>审批人</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((rr) => {
                const actions = allowedActions(rr.state, rr.canary, rr.canaryPromoted)
                return (
                  <TableRow key={rr.id}>
                    <TableCell className="text-xs">
                      <span className="font-medium">{RESOURCE_TYPE_LABEL[rr.resourceType]}</span>
                      <span className="ml-1 font-mono text-muted-foreground">{rr.resourceId.slice(0, 8)}</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs font-mono">
                      v{rr.fromVersionNo ?? "–"} → v{rr.toVersionNo}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={STATE_TONE[rr.state]}>{STATE_LABEL[rr.state]}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {rr.canary ? (rr.canaryPromoted ? "已全量" : "灰度中") : "—"}
                    </TableCell>
                    <TableCell className="text-xs">{rr.requestedBy}</TableCell>
                    <TableCell className="text-xs">{rr.approvedBy ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="outline" size="sm" onClick={() => openDiff(rr)}>Diff</Button>
                        {actions.map((a) => (
                          <Button key={a} size="sm" variant={ACTION_TONE[a]} disabled={busyId === rr.id}
                            onClick={() => runAction(rr, a)}>
                            {ACTION_LABEL[a]}
                          </Button>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Diff 对话框 */}
      <Dialog open={diff != null} onOpenChange={(o) => { if (!o) setDiff(null) }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              版本 Diff：v{diff?.from} → v{diff?.to}
              {diff ? (() => { const s = summarizeDiff(diff); return (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  新增 {s.added} · 删除 {s.removed} · 变更 {s.changed}
                </span>
              ) })() : null}
            </DialogTitle>
          </DialogHeader>
          {diff && !diff.hasChanges ? (
            <p className="text-sm text-muted-foreground">两个版本完全一致，无差异。</p>
          ) : diff ? (
            <div className="max-h-96 space-y-1 overflow-auto">
              {diffRows(diff).map((r) => (
                <div key={`${r.kind}-${r.path}`} className="rounded border px-2 py-1 text-xs">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={
                      r.kind === "added" ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-600"
                        : r.kind === "removed" ? "border-red-500/30 bg-red-500/15 text-red-600"
                          : "border-blue-500/30 bg-blue-500/15 text-blue-600"
                    }>
                      {r.kind === "added" ? "新增" : r.kind === "removed" ? "删除" : "变更"}
                    </Badge>
                    <span className="font-mono">{r.path}</span>
                  </div>
                  {r.kind === "changed" ? (
                    <div className="mt-1 font-mono text-muted-foreground">
                      <div>- {JSON.stringify(r.from)}</div>
                      <div>+ {JSON.stringify(r.to)}</div>
                    </div>
                  ) : (
                    <div className="mt-1 font-mono text-muted-foreground">{JSON.stringify(r.from ?? r.to)}</div>
                  )}
                </div>
              ))}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
