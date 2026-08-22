/** Models 管理页：Provider + 模型 CRUD（真实 LLM 联调入口）。 */
import { useEffect, useState } from "react"
import { Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { PageContainer, PageHeader } from "@/components/app/page"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { WF_BASE } from "@/services/wf-api"

interface Provider { id: string; name: string; baseUrl: string }
interface ModelRow { modelKey: string; displayName: string; provider: string; capabilities: string[] }

async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const r = await fetch(`${WF_BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!r.ok) {
    const b = await r.json().catch(() => null)
    throw new Error(typeof b?.detail === "string" ? b.detail : `${r.status}`)
  }
  return r.json() as Promise<T>
}

export default function WfModelsPage() {
  const [providers, setProviders] = useState<Provider[]>([])
  const [models, setModels] = useState<ModelRow[]>([])
  const [pOpen, setPOpen] = useState(false)
  const [mOpen, setMOpen] = useState(false)
  const [pName, setPName] = useState("")
  const [pUrl, setPUrl] = useState("")
  const [mKey, setMKey] = useState("")
  const [mProv, setMProv] = useState("")

  const load = () => {
    api<Provider[]>("/api/model-providers").then(setProviders).catch(() => undefined)
    api<ModelRow[]>("/api/registry/models").then(setModels).catch(() => undefined)
  }
  useEffect(load, [])

  return (
    <PageContainer wide className="space-y-4">
      <PageHeader
        title="Models"
        description="模型与 Provider 管理；配置 http(s) base_url 后走 OpenAI 兼容协议，否则 mock 回落"
        actions={
          <>
            <Button variant="outline" onClick={() => setPOpen(true)}><Plus className="size-4" /> Provider</Button>
            <Button className="bg-black text-white hover:bg-neutral-800" onClick={() => setMOpen(true)}><Plus className="size-4" /> 模型</Button>
          </>
        }
      />
      <div className="space-y-2">
        {providers.map((p) => (
          <div key={p.id} className="group flex items-center gap-3 rounded-lg border bg-white px-4 py-2 text-sm">
            <span className="font-medium">{p.name}</span>
            <Badge variant="outline" className="font-mono text-[10px]">{p.baseUrl.startsWith("http") ? "OpenAI 兼容" : "mock"}</Badge>
            <span className="text-xs text-muted-foreground">{p.baseUrl}</span>
            <button className="ml-auto rounded p-1 opacity-0 transition-opacity hover:bg-neutral-100 group-hover:opacity-100"
              onClick={async () => {
                if (!window.confirm(`删除 Provider「${p.name}」？`)) return
                try { await api(`/api/model-providers/${p.id}`, "DELETE"); toast.success("已删除"); load() }
                catch (e) { toast.error((e as Error).message) }
              }}><Trash2 className="size-3.5 text-neutral-400" /></button>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {models.map((m) => (
          <div key={m.modelKey} className="group flex flex-col rounded-lg border bg-white p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium">{m.displayName}</span>
              <span className="text-xs text-muted-foreground">{m.provider}</span>
            </div>
            <div className="flex gap-1 pt-2">
              {m.capabilities.map((c) => <Badge key={c} variant="secondary" className="text-[10px]">{c}</Badge>)}
            </div>
          </div>
        ))}
      </div>

      <Dialog open={pOpen} onOpenChange={setPOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>新增 Provider</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">名称</Label><Input value={pName} onChange={(e) => setPName(e.target.value)} /></div>
            <div><Label className="text-xs">Base URL（OpenAI 兼容，留空=mock）</Label><Input value={pUrl} onChange={(e) => setPUrl(e.target.value)} placeholder="https://api.example.com/v1" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPOpen(false)}>取消</Button>
            <Button className="bg-black text-white hover:bg-neutral-800" disabled={!pName.trim()}
              onClick={async () => { try { await api("/api/model-providers", "POST", { name: pName, baseUrl: pUrl }); setPOpen(false); load() } catch (e) { toast.error((e as Error).message) } }}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={mOpen} onOpenChange={setMOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>新增模型</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">Provider</Label>
              <select className="w-full rounded-md border p-2 text-sm" value={mProv} onChange={(e) => setMProv(e.target.value)}>
                <option value="">请选择</option>
                {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select></div>
            <div><Label className="text-xs">Model Key</Label><Input value={mKey} onChange={(e) => setMKey(e.target.value)} placeholder="qwen-max" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMOpen(false)}>取消</Button>
            <Button className="bg-black text-white hover:bg-neutral-800" disabled={!mKey.trim() || !mProv}
              onClick={async () => { try { await api("/api/models", "POST", { providerId: mProv, modelKey: mKey }); setMOpen(false); load() } catch (e) { toast.error((e as Error).message) } }}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
