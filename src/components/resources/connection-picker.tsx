import { Plus } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet"
import { connApi, type ConnectionDTO } from "@/services/resource-api"

export const PROTOCOLS = ["http-api", "mysql", "postgresql", "oss", "mcp-http", "llm"] as const

/** 连接选择器：选择既有 Connection 或内嵌新建（凭证加密不回显）。 */
export function ConnectionPicker({ value, onChange, protocols }: {
  value: string
  onChange: (id: string) => void
  protocols?: string[]
}) {
  const [items, setItems] = useState<ConnectionDTO[]>([])
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ name: "", protocol: "http-api", kind: "API Key", base_url: "", host: "", port: "", user: "", database: "", secret: "" })

  const load = () => connApi.list({}).then((r) => setItems(r.items)).catch(() => undefined)
  useEffect(() => { load() }, [])

  const filtered = items.filter((c) => !protocols?.length || protocols.includes(c.protocol as typeof PROTOCOLS[number]))

  const create = async () => {
    const endpoint: Record<string, unknown> = form.protocol === "http-api" || form.protocol === "llm" || form.protocol === "mcp-http"
      ? { base_url: form.base_url }
      : form.protocol === "oss" ? { bucket: form.base_url }
      : { host: form.host, port: Number(form.port || (form.protocol === "postgresql" ? 5432 : 3306)), user: form.user, database: form.database }
    try {
      const r = await connApi.create({ name: form.name, protocol: form.protocol, endpoint, kind: form.kind, secret: form.secret })
      toast.success("Connection 已创建")
      setOpen(false)
      await load()
      onChange(r.id)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger className="flex-1"><SelectValue placeholder="选择 Connection（endpoint + 认证）" /></SelectTrigger>
        <SelectContent>
          {filtered.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name} · {c.protocol}{c.secretConfigured ? " · 凭证已配置" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="outline" size="sm" className="shrink-0"><Plus className="size-3.5" /> 新建</Button>
        </SheetTrigger>
        <SheetContent className="w-[400px] overflow-y-auto">
          <SheetHeader><SheetTitle>新建 Connection</SheetTitle></SheetHeader>
          <div className="mt-4 space-y-3">
            <div><Label className="text-xs">名称 *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label className="text-xs">协议类型</Label>
              <Select value={form.protocol} onValueChange={(v) => setForm({ ...form, protocol: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PROTOCOLS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {(form.protocol === "http-api" || form.protocol === "llm" || form.protocol === "mcp-http") && (
              <div><Label className="text-xs">Base URL</Label><Input className="font-mono text-xs" value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} placeholder="https://…" /></div>
            )}
            {form.protocol === "oss" && (
              <div><Label className="text-xs">Bucket</Label><Input className="font-mono text-xs" value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} placeholder="oss://…" /></div>
            )}
            {(form.protocol === "mysql" || form.protocol === "postgresql") && (
              <div className="space-y-2">
                <div className="grid grid-cols-[1fr_100px] gap-2">
                  <div><Label className="text-xs">Host</Label><Input className="font-mono text-xs" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} /></div>
                  <div><Label className="text-xs">Port</Label><Input className="font-mono text-xs" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} placeholder={form.protocol === "postgresql" ? "5432" : "3306"} /></div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label className="text-xs">用户名</Label><Input className="font-mono text-xs" value={form.user} onChange={(e) => setForm({ ...form, user: e.target.value })} placeholder="rivers" /></div>
                  <div><Label className="text-xs">数据库</Label><Input className="font-mono text-xs" value={form.database} onChange={(e) => setForm({ ...form, database: e.target.value })} placeholder="wf_accept" /></div>
                </div>
              </div>
            )}
            <div><Label className="text-xs">认证方式</Label>
              <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="None">None</SelectItem>
                  <SelectItem value="API Key">API Key</SelectItem>
                  <SelectItem value="Bearer Token">Bearer Token</SelectItem>
                  <SelectItem value="Basic Auth">Basic Auth（AK/SK）</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Credential / Secret</Label><Input type="password" value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} placeholder="加密存储，不回显" /></div>
          </div>
          <SheetFooter className="mt-6">
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button disabled={!form.name.trim()} onClick={create}>保存</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  )
}
