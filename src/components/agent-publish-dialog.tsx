/** Agent 发布对话框（SDD 02 §7）：生成不可变版本 → 部署到沙箱/线上。
 * 校验失败展示后端 issues；发布成功展示 artifactHash。 */
import { useEffect, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { agentApi, type AgentVersionInfo } from "@/services/wf-api"

/** 头部版本徽标数据：最新版本 + 各环境部署的版本号。 */
export function useAgentVersionState(agentId: string | undefined) {
  const [latest, setLatest] = useState<AgentVersionInfo | null>(null)
  const [envs, setEnvs] = useState<{ sandbox: number | null; prod: number | null }>({ sandbox: null, prod: null })
  const refresh = () => {
    if (!agentId) return
    agentApi.versions(agentId).then((vs) => setLatest(vs[0] ?? null)).catch(() => undefined)
    agentApi.releases(agentId).then((rels) => {
      const sb = rels.find((r) => r.environment === "sandbox" && r.status === "active")
      const pd = rels.find((r) => r.environment === "prod" && r.status === "active")
      setEnvs({ sandbox: sb?.versionNo ?? null, prod: pd?.versionNo ?? null })
    }).catch(() => undefined)
  }
  useEffect(() => { refresh() }, [agentId])  // eslint-disable-line react-hooks/exhaustive-deps
  return { latest, envs, refresh }
}

export function AgentPublishDialog({ agentId, open, onClose, onPublished }: {
  agentId: string; open: boolean; onClose: () => void; onPublished?: () => void
}) {
  const [note, setNote] = useState("")
  const [issues, setIssues] = useState<{ code: string; message: string }[]>([])
  const [pendingVersion, setPendingVersion] = useState<{ versionId: string; versionNo: number; artifactHash: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) { setNote(""); setIssues([]); setPendingVersion(null) }
  }, [open])

  const makeVersion = async () => {
    setBusy(true); setIssues([])
    try {
      const r = await agentApi.createVersion(agentId, note) as any
      if (r?.detail) {  // 409：校验失败
        setIssues(r.detail.issues ?? [{ code: r.detail.code ?? "FAILED", message: r.detail.message ?? "发布校验未通过" }])
        return
      }
      setPendingVersion(r)
    } catch (e) {
      toast.error((e as Error).message)
    } finally { setBusy(false) }
  }

  const doRelease = async (env: "sandbox" | "prod") => {
    if (!pendingVersion) return
    setBusy(true)
    try {
      await agentApi.release(agentId, pendingVersion.versionId, env)
      toast.success(`V${pendingVersion.versionNo} 已发布到${env === "sandbox" ? "沙箱" : "线上"}`)
      onPublished?.()
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
    } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{pendingVersion ? "部署版本" : "发布新版本"}</DialogTitle></DialogHeader>
        {!pendingVersion ? (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">版本描述（可选）</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="如：修复路由兜底" />
            </div>
            <p className="text-[11px] leading-5 text-muted-foreground">
              发布将冻结当前配置（含画布图与资源依赖版本），生成不可变版本与 artifactHash；此后继续编辑不影响该版本。
            </p>
            {issues.length > 0 && (
              <div className="space-y-1 rounded-md border border-red-200 bg-red-50 p-2">
                <div className="text-xs font-medium text-red-600">发布前校验未通过</div>
                {issues.map((i, k) => <div key={k} className="text-[11px] text-red-500">· {i.message}</div>)}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-md border p-2 text-xs">
              <div>版本：<b>V{pendingVersion.versionNo}</b></div>
              <div className="pt-1 break-all text-muted-foreground">artifactHash：{pendingVersion.artifactHash.slice(0, 24)}…</div>
            </div>
            <p className="text-[11px] text-muted-foreground">选择部署环境（回滚 = 把旧版本重新部署一次）：</p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          {!pendingVersion ? (
            <Button className="bg-black text-white hover:bg-neutral-800" disabled={busy} onClick={makeVersion}>
              {busy ? "校验中…" : "生成版本"}
            </Button>
          ) : (
            <>
              <Button variant="outline" disabled={busy} onClick={() => doRelease("sandbox")}>发布到沙箱</Button>
              <Button className="bg-black text-white hover:bg-neutral-800" disabled={busy} onClick={() => doRelease("prod")}>发布到线上</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
