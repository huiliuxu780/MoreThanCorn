/** Agent 公共配置组件（SDD 02 CommonAgentConfig）：结构化记忆 Schema + 对话体验。
 *  三型共用（autonomous 编辑器 / expert-group 编辑器 / dialogue 配置抽屉）。
 *  R4：原生 select/checkbox 全部换统一组件（Select/Switch）。
 *  R-Archive（SDD 10）：支持 readOnly——旧 Agent 封存后仅展示。 */
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"

const INK2 = "#5A6472"; const INK3 = "#B9C2CF"; const CARD = "#EDF0F4"

export interface MemoryVar { name: string; description?: string; dataType: string; defaultValue?: string; duration: string }

export function MemorySchemaForm({ memories, onChange, readOnly = false }: { memories: MemoryVar[]; onChange: (v: MemoryVar[]) => void; readOnly?: boolean }) {
  const setAt = (i: number, patch: Partial<MemoryVar>) => onChange(memories.map((m, j) => (j === i ? { ...m, ...patch } : m)))
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs" style={{ color: INK2 }}>记忆变量（Schema 声明）</span>
        {!readOnly && (
          <button className="text-[11px]" style={{ color: "#3D6BFF" }}
            onClick={() => onChange([...memories, { name: "", dataType: "STRING", duration: "LONG_TERM" }])}>新增</button>
        )}
      </div>
      {memories.length === 0 && <div className="text-[11px]" style={{ color: INK3 }}>声明后可由 Agent 显式读写；未声明的键写入会被拒绝。</div>}
      {memories.map((m, i) => (
        <div key={i} className="space-y-1 rounded border p-1.5" style={{ borderColor: CARD }}>
          <div className="flex items-center gap-1">
            <Input className="h-6 text-xs" placeholder="变量名" value={m.name} readOnly={readOnly} onChange={(e) => setAt(i, { name: e.target.value })} />
            <Select value={m.dataType} onValueChange={(v) => setAt(i, { dataType: v })} disabled={readOnly}>
              <SelectTrigger className="h-6 w-24 text-[11px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="STRING">STRING</SelectItem>
                <SelectItem value="NUMBER">NUMBER</SelectItem>
                <SelectItem value="BOOLEAN">BOOLEAN</SelectItem>
                <SelectItem value="JSON">JSON</SelectItem>
              </SelectContent>
            </Select>
            {!readOnly && <button onClick={() => onChange(memories.filter((_, j) => j !== i))}><span className="text-neutral-400">×</span></button>}
          </div>
          <Input className="h-6 text-xs" placeholder="描述（会注入提示词）" value={m.description ?? ""} readOnly={readOnly} onChange={(e) => setAt(i, { description: e.target.value })} />
          <Input className="h-6 text-xs" placeholder="默认值（可选）" value={m.defaultValue ?? ""} readOnly={readOnly} onChange={(e) => setAt(i, { defaultValue: e.target.value })} />
        </div>
      ))}
    </div>
  )
}

interface ConversationConfig {
  autoFollowUp?: { enabled?: boolean; count?: number }
  chitchatFallback?: { enabled?: boolean; prompt?: string }
  greeting?: string
}

export function ConversationPanel({ cfg, setCfg, readOnly = false }: { cfg: Record<string, unknown>; setCfg: (v: Record<string, unknown>) => void; readOnly?: boolean }) {
  const conv = (cfg.conversation ?? {}) as ConversationConfig
  const setConv = (patch: Partial<ConversationConfig>) => setCfg({ ...cfg, conversation: { ...conv, ...patch } })
  const fu = conv.autoFollowUp ?? { enabled: false, count: 3 }
  const ch = conv.chitchatFallback ?? { enabled: false, prompt: "" }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs" style={{ color: INK2 }}>
        <span>自动续问（回答后生成后续问题）</span>
        <Switch checked={!!fu.enabled} disabled={readOnly} onCheckedChange={(v) => setConv({ autoFollowUp: { ...fu, enabled: v } })} />
      </div>
      {fu.enabled && (
        <Select value={String(fu.count)} onValueChange={(v) => setConv({ autoFollowUp: { ...fu, count: Number(v) } })} disabled={readOnly}>
          <SelectTrigger className="h-6 w-24 text-[11px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="1">1 条</SelectItem>
            <SelectItem value="2">2 条</SelectItem>
            <SelectItem value="3">3 条</SelectItem>
          </SelectContent>
        </Select>
      )}
      <div className="flex items-center justify-between text-xs" style={{ color: INK2 }}>
        <span>闲聊兜底（无用户问题时友好回应）</span>
        <Switch checked={!!ch.enabled} disabled={readOnly} onCheckedChange={(v) => setConv({ chitchatFallback: { ...ch, enabled: v } })} />
      </div>
      {ch.enabled && (
        <Textarea className="min-h-16 text-xs" readOnly={readOnly}
          placeholder="兜底提示词" value={ch.prompt ?? ""}
          onChange={(e) => setConv({ chitchatFallback: { ...ch, prompt: e.target.value } })} />
      )}
      <div className="space-y-1">
        <span className="text-xs" style={{ color: INK2 }}>开场白（预览首条消息）</span>
        <Input className="h-7 text-xs" placeholder="你好，我是…" value={conv.greeting ?? ""} readOnly={readOnly}
          onChange={(e) => setConv({ greeting: e.target.value })} />
      </div>
    </div>
  )
}
