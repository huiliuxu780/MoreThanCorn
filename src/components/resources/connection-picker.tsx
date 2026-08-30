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
import { connApi, type ConnSecret, type ConnectionDTO } from "@/services/resource-api"
import { KINDS } from "@/services/connection-auth"

export const PROTOCOLS = ["http-api", "mysql", "postgresql", "oss", "mcp-http", "llm"] as const

/** 内嵌新建表单的鉴权方式：script 需要 KV/沙箱等高级配置，统一到 Connections 页完成
 *（SDD-12 审计 P0-4：内嵌创建器与主表单共用同一套结构化密钥模型）。 */
const INLINE_KINDS = KINDS.filter((k) => k.value !== "script")

interface InlineForm {
  name: string; protocol: string; kind: string; base_url: string; host: string; port: string
  user: string; database: string; secret: ConnSecret | ""
}

/** 按 kind 渲染密钥输入，与 Connections 页同构（basic=用户名/密码，aksk=AK/SK） */
function InlineSecretFields({ kind, value, onChange }: {
  kind: string; value: ConnSecret | ""; onChange: (v: ConnSecret | "") => void
}) {
  if (kind === "none") return null
  const rec = (typeof value === "object" ? value : {}) as Record<string, string>
  const setRec = (k: string, v: string) => onChange({ ...rec, [k]: v })
  if (kind === "basic") {
    return (
      <div className="grid grid-cols-2 gap-2">
        <div><Label className="text-xs">用户名</Label><Input value={rec.username ?? ""} onChange={(e) => setRec("username", e.target.value)} /></div>
        <div><Label className="text-xs">密码</Label><Input type="password" autoComplete="new-password" value={rec.password ?? ""} onChange={(e) => setRec("password", e.target.value)} /></div>
      </div>
    )
  }
  if (kind === "aksk") {
    return (
      <div className="space-y-2">
        <div><Label className="text-xs">AccessKey</Label><Input className="font-mono text-xs" value={rec.access_key ?? ""} onChange={(e) => setRec("access_key", e.target.value)} /></div>
        <div><Label className="text-xs">SecretKey</Label><Input type="password" autoComplete="new-password" className="font-mono text-xs" value={rec.secret_key ?? ""} onChange={(e) => setRec("secret_key", e.target.value)} /></div>
      </div>
    )
  }
  return <Input type="password" autoComplete="new-password" value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} placeholder="加密存储，不回显" />
}

/** 连接选择器：选择既有 Connection 或内嵌新建（凭证加密不回显；新建即返回稳定 ID）。 */
export function ConnectionPicker({ value, onChange, protocols }: {
  value: string
  onChange: (id: string) => void
  protocols?: string[]
}) {
  const [items, setItems] = useState<ConnectionDTO[]>([])
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<InlineForm>({
    name: "", protocol: "http-api", kind: "api_key", base_url: "", host: "", port: "", user: "", database: "", secret: "",
  })

  const load = () => connApi.list({}).then((r) => setItems(r.items)).catch(() => undefined)
  useEffect(() => { load() }, [])

  // SDD-12：归档/停用连接不可被新绑定；draft 允许选择（启用门禁在连接侧）
  const filtered = items
    .filter((c) => (c.lifecycle ?? c.status) !== "archived" && (c.lifecycle ?? c.status) !== "disabled")
    .filter((c) => !protocols?.length || protocols.includes(c.protocol as typeof PROTOCOLS[number]))

  const create = async () => {
    const endpoint: Record<string, unknown> = form.protocol === "http-api" || form.protocol === "llm" || form.protocol === "mcp-http"
      ? { base_url: form.base_url }
      : form.protocol === "oss" ? { bucket: form.base_url }
      : { host: form.host, port: Number(form.port || (form.protocol === "postgresql" ? 5432 : 3306)), user: form.user, database: form.database }
    try {
      const r = await connApi.create({
        name: form.name, protocol: form.protocol, endpoint, kind: form.kind,
        secret: form.secret === "" ? undefined : form.secret,
      })
      toast.success("Connection 已创建（草稿，可在 Connections 页测试后启用）")
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
              {c.name} · {c.protocol}{c.secretConfigured ? " · 凭证已配置" : ""}{(c.lifecycle ?? c.status) === "draft" ? " · 草稿" : ""}
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
              <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v, secret: "" })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {/* 与 Connections 页同一套结构化密钥模型（审计 P0-4 修复） */}
                  {INLINE_KINDS.map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Credential / Secret</Label>
              <InlineSecretFields kind={form.kind} value={form.secret} onChange={(v) => setForm({ ...form, secret: v })} />
            </div>
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
