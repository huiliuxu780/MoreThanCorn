/** DebugRunDrawer：调试配置抽屉（16 §7）。
 *  07-SDD form：调试表单按开始节点 form 渲染（无 form 回退存量四字段 + chatHistory 对话组）。 */
import { useState } from "react"
import { Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { C, getStartFields } from "@/components/wf/controls"
import type { WfDefinition } from "@/services/wf-api"

export function DebugRunDrawer({ def: _def, onClose, onRun }: {
  def: WfDefinition; onClose: () => void; onRun: (vals: Record<string, string>) => void
}) {
  const [vals, setVals] = useState<Record<string, string>>({})
  const [chat, setChat] = useState([{ u: "user: 你好", a: "answer: 你好，有什么可以帮助你的吗？" }])
  return (
    <div className="absolute inset-y-0 right-0 z-20 flex w-[380px] max-w-[92vw] flex-col border-l bg-surface" style={{ borderColor: C.cardBorder }}>
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-[15px] font-semibold" style={{ color: C.ink }}>调试配置</span>
        <button onClick={onClose} title="关闭调试配置"><X className="size-4 text-muted-foreground" /></button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-4">
        {(getStartFields() ?? ["userQuery", "userId", "conversationId", "chatId"].map((n2) => ({ name: n2, type: "string" }))).map((f) => (
          <div key={f.name}>
            <div className="pb-1 text-[13px]" style={{ color: C.ink }}>{f.name}{(f as { required?: boolean }).required ? " *" : ""} <span className="text-[11px]" style={{ color: C.ink3 }}>{f.type}</span></div>
            <Input placeholder="按需填写" value={vals[f.name] ?? ""} onChange={(e) => setVals({ ...vals, [f.name]: e.target.value })} />
          </div>
        ))}
        {!getStartFields() && (
        <div>
          <div className="pb-1 text-[13px]" style={{ color: C.ink }}>chatHistory <span className="text-[11px]" style={{ color: C.ink3 }}>String</span></div>
          {chat.map((c, i) => (
            <div key={i} className="mb-1 rounded-md px-2 py-1 text-xs" style={{ background: "var(--surface-muted)", color: C.ink }}>
              <Input className="mb-1 h-6 border-0 bg-transparent p-0" value={c.u} onChange={(e) => { const n = [...chat]; n[i] = { ...n[i], u: e.target.value }; setChat(n) }} />
              <Input className="h-6 border-0 bg-transparent p-0" value={c.a} onChange={(e) => { const n = [...chat]; n[i] = { ...n[i], a: e.target.value }; setChat(n) }} />
            </div>
          ))}
          <button className="flex items-center gap-1 text-xs" style={{ color: C.primary }} onClick={() => setChat([...chat, { u: "user: ", a: "answer: " }])}>
            <Plus className="size-3" /> 添加一组对话
          </button>
        </div>
        )}
      </div>
      <div className="p-4">
        <Button className="w-full bg-primary text-primary-foreground hover:bg-brand-hover" onClick={() => onRun(vals)}>开始运行</Button>
      </div>
    </div>
  )
}
