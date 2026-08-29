/** Module Agent 发布对话框（SDD 10 R2/R4）：生成不可变版本 → 部署环境 → Runtime Provider 绑定 → 灰度。
 *  Provider 选择在 Release 时绑定（不写入 AgentSpec）。Provider 必选且 enabled。 */
import { useEffect, useState } from "react"

import { agentApi } from "@/services/wf-api"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "sonner"

interface ProviderOpt { id: string; name: string; kind: string; status: string; healthStatus: string | null }

export function ModulePublishDialog({ agentId, open, onClose, onPublished }: {
  agentId: string; open: boolean; onClose: () => void; onPublished?: () => void
}) {
  const [note, setNote] = useState("")
  const [issues, setIssues] = useState<{ code: string; message: string }[]>([])
  const [pending, setPending] = useState<{ versionId: string; versionNo: number; artifactHash: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [env, setEnv] = useState<"sandbox" | "prod">("sandbox")
  const [providerId, setProviderId] = useState("")
  const [providers, setProviders] = useState<ProviderOpt[]>([])
  const [canary, setCanary] = useState(0)

  useEffect(() => {
    if (open) {
      setNote(""); setIssues([]); setPending(null); setCanary(0)
      agentApi.providers().then((r) => {
        const enabled = r.items.filter((p) => p.status === "enabled")
        setProviders(enabled)
        if (!providerId && enabled[0]) setProviderId(enabled[0].id)
      }).catch(() => undefined)
    }
  }, [open])  // eslint-disable-line react-hooks/exhaustive-deps

  const makeVersion = async () => {
    setBusy(true); setIssues([])
    try {
      const r = await agentApi.createVersion(agentId, note)
      if ("detail" in r) {
        setIssues(r.detail.issues ?? [{ code: r.detail.code ?? "FAILED", message: r.detail.message ?? "发布校验未通过" }])
        return
      }
      setPending(r)
    } catch (e) {
      toast.error((e as Error).message)
    } finally { setBusy(false) }
  }

  const doRelease = async () => {
    if (!pending) return
    if (!providerId) { toast.error("请选择 Runtime Provider"); return }
    setBusy(true)
    try {
      await agentApi.release(agentId, pending.versionId, env, canary, providerId)
      toast.success(`V${pending.versionNo} 已发布到${env === "sandbox" ? "沙箱" : "线上"}${canary > 0 ? `（灰度 ${canary}%）` : ""}`)
      onPublished?.(); onClose()
    } catch (e) {
      const d = (e as Error).message
      if (d.includes("{")) { try { setIssues(JSON.parse(d.slice(d.indexOf("{"))).issues ?? []) } catch { toast.error(d) } }
      else toast.error(d.replace(/^\d+:\s*/, "").replace(/^"|"$/g, ""))
    } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{pending ? "部署版本（绑定 Runtime Provider）" : "发布新版本"}</DialogTitle></DialogHeader>
        {!pending ? (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">版本描述（可选）</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="如：接入质检 Module v1" />
            </div>
            <p className="text-[11px] leading-5 text-muted-foreground">
              发布将冻结 Module + AgentSpec + 输入/输出 Schema + 依赖（工具/模型/主数据），生成不可变版本与 artifactHash。
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
              <div>版本：<b>V{pending.versionNo}</b></div>
              <div className="pt-1 break-all text-muted-foreground">artifactHash：{pending.artifactHash.slice(0, 24)}…</div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">部署环境</Label>
                <Select value={env} onValueChange={(v) => setEnv(v as "sandbox" | "prod")}>
                  <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sandbox">沙箱</SelectItem>
                    <SelectItem value="prod">线上</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">灰度比例（0=全量）</Label>
                <Input type="number" min={0} max={100} value={canary}
                  onChange={(e) => setCanary(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Runtime Provider（必选）</Label>
              <Select value={providerId} onValueChange={setProviderId}>
                <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {providers.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}（{p.kind} · {p.healthStatus ?? "未探测"}）</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">同一版本可另发一条灰度 Release 绑定另一 Provider（如 DSH 实验通道）。</p>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          {!pending ? (
            <Button className="bg-black text-white hover:bg-neutral-800" disabled={busy} onClick={makeVersion}>
              {busy ? "校验中…" : "生成版本"}
            </Button>
          ) : (
            <Button className="bg-black text-white hover:bg-neutral-800" disabled={busy || !providerId} onClick={doRelease}>
              {canary > 0 ? `灰度发布 ${canary}%` : "发布"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
