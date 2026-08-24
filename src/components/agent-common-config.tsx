/** Agent 公共配置组件（SDD 02 CommonAgentConfig）：结构化记忆 Schema + 对话体验。
 *  三型共用（autonomous 编辑器 / expert-group 编辑器 / dialogue 配置抽屉）。 */
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

const INK2 = "#5A6472"; const INK3 = "#B9C2CF"; const CARD = "#EDF0F4"

export interface MemoryVar { name: string; description?: string; dataType: string; defaultValue?: string; duration: string }

export function MemorySchemaForm({ memories, onChange }: { memories: MemoryVar[]; onChange: (v: MemoryVar[]) => void }) {
  const setAt = (i: number, patch: Partial<MemoryVar>) => onChange(memories.map((m, j) => (j === i ? { ...m, ...patch } : m)))
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs" style={{ color: INK2 }}>记忆变量（Schema 声明）</span>
        <button className="text-[11px]" style={{ color: "#3D6BFF" }}
          onClick={() => onChange([...memories, { name: "", dataType: "STRING", duration: "LONG_TERM" }])}>新增</button>
      </div>
      {memories.length === 0 && <div className="text-[11px]" style={{ color: INK3 }}>声明后可由 Agent 显式读写；未声明的键写入会被拒绝。</div>}
      {memories.map((m, i) => (
        <div key={i} className="space-y-1 rounded border p-1.5" style={{ borderColor: CARD }}>
          <div className="flex gap-1">
            <Input className="h-6 text-xs" placeholder="变量名" value={m.name} onChange={(e) => setAt(i, { name: e.target.value })} />
            <select className="h-6 rounded border text-[11px]" style={{ borderColor: CARD }} value={m.dataType} onChange={(e) => setAt(i, { dataType: e.target.value })}>
              <option>STRING</option><option>NUMBER</option><option>BOOLEAN</option><option>JSON</option>
            </select>
            <select className="h-6 rounded border text-[11px]" style={{ borderColor: CARD }} value={m.duration} onChange={(e) => setAt(i, { duration: e.target.value })}>
              <option value="SESSION">单次会话</option><option value="LONG_TERM">长期</option>
            </select>
            <button onClick={() => onChange(memories.filter((_, j) => j !== i))}><span className="text-neutral-400">×</span></button>
          </div>
          <Input className="h-6 text-xs" placeholder="描述" value={m.description ?? ""} onChange={(e) => setAt(i, { description: e.target.value })} />
          <Input className="h-6 text-xs" placeholder="默认值（可选）" value={m.defaultValue ?? ""} onChange={(e) => setAt(i, { defaultValue: e.target.value })} />
        </div>
      ))}
    </div>
  )
}

export function ConversationPanel({ cfg, setCfg }: { cfg: Record<string, any>; setCfg: (v: Record<string, any>) => void }) {
  const conv = cfg.conversation ?? {}
  const setConv = (patch: Record<string, any>) => setCfg({ ...cfg, conversation: { ...conv, ...patch } })
  const fu = conv.autoFollowUp ?? { enabled: false, count: 3 }
  const ch = conv.chitchatFallback ?? { enabled: false, prompt: "" }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs" style={{ color: INK2 }}>
        <span>自动续问（回答后生成后续问题）</span>
        <input type="checkbox" checked={!!fu.enabled} onChange={(e) => setConv({ autoFollowUp: { ...fu, enabled: e.target.checked } })} />
      </div>
      {fu.enabled && (
        <select className="h-6 w-24 rounded border text-[11px]" style={{ borderColor: CARD }} value={fu.count}
          onChange={(e) => setConv({ autoFollowUp: { ...fu, count: Number(e.target.value) } })}>
          <option value={1}>1 条</option><option value={2}>2 条</option><option value={3}>3 条</option>
        </select>
      )}
      <div className="flex items-center justify-between text-xs" style={{ color: INK2 }}>
        <span>闲聊兜底（无用户问题时友好回应）</span>
        <input type="checkbox" checked={!!ch.enabled} onChange={(e) => setConv({ chitchatFallback: { ...ch, enabled: e.target.checked } })} />
      </div>
      {ch.enabled && (
        <Textarea className="min-h-16 text-xs" placeholder="兜底提示词" value={ch.prompt ?? ""}
          onChange={(e) => setConv({ chitchatFallback: { ...ch, prompt: e.target.value } })} />
      )}
    </div>
  )
}
