/** 选择器类 x-control：变量 / 工作流 / 工具 / 知识源 / 数据资产 / MCP / Agent。
 *  复用 components/wf/controls 的共享控件与 inspector/data-hooks 的真实注册表数据。 */
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { C, ResourceSelect, VarButton } from "@/components/wf/controls"
import { resApi } from "@/services/resource-api"
import { useAgentList, useMcpTools, useWorkflowList } from "../data-hooks"
import type { FieldControl } from "../inspector-types"

export const VariablePickerControl: FieldControl = ({ fieldKey, label, ctx }) => (
  <div>
    <div className="pb-1 text-xs" style={{ color: C.ink2 }}>{label}</div>
    <VarButton value={(ctx.cfg[fieldKey] as string) ?? ""} nodes={ctx.nodes} edges={ctx.edges}
      selfId={ctx.node.id} defs={ctx.defs} onPick={(v) => ctx.set(fieldKey, v)} />
  </div>
)

export const WorkflowPickerControl: FieldControl = ({ fieldKey, label, ctx }) => {
  const list = useWorkflowList()
  return (
    <div>
      <div className="pb-1 text-xs" style={{ color: C.ink2 }}>{label}</div>
      <Select value={(ctx.cfg[fieldKey] as string) || undefined} onValueChange={(v) => ctx.set(fieldKey, v)}>
        <SelectTrigger className="h-7 w-full text-xs"><SelectValue placeholder="请选择工作流" /></SelectTrigger>
        <SelectContent>{list.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  )
}

export const WorkflowPickerMultiControl: FieldControl = ({ fieldKey, label, ctx }) => {
  const list = useWorkflowList()
  const sel = Array.isArray(ctx.cfg[fieldKey]) ? (ctx.cfg[fieldKey] as string[]) : []
  return (
    <div>
      <div className="pb-1 text-xs" style={{ color: C.ink2 }}>{label}（多选）</div>
      <div className="max-h-36 space-y-0.5 overflow-y-auto rounded border p-1" style={{ borderColor: C.cardBorder }}>
        {list.length === 0 && <div className="px-1 py-1 text-[11px]" style={{ color: C.ink3 }}>暂无工作流</div>}
        {list.map((w) => (
          <label key={w.id} className="flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-xs hover:bg-accent" style={{ color: C.ink }}>
            <Checkbox checked={sel.includes(w.id)}
              onCheckedChange={(v) => ctx.set(fieldKey, v ? [...sel, w.id] : sel.filter((id) => id !== w.id))} />
            <span className="truncate">{w.name}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

function resourcePicker(types: string, placeholder: string, onPicked?: "tool-version"): FieldControl {
  return ({ fieldKey, label, ctx }) => (
    <div>
      <div className="pb-1 text-xs" style={{ color: C.ink2 }}>{label}</div>
      <ResourceSelect types={types} value={(ctx.cfg[fieldKey] as string) ?? ""} placeholder={placeholder}
        onPick={async (m) => {
          if (onPicked === "tool-version") {
            /* tool-picker 契约（后端 registry x-control）：写回最新版本 id */
            let versionId = ""
            try { versionId = ((await resApi.toolVersions(m.id))[0]?.id) ?? "" } catch { /* 忽略 */ }
            ctx.set(fieldKey, versionId || m.id)
          } else {
            ctx.set(fieldKey, m.id)
          }
        }} />
    </div>
  )
}

export const ToolPickerControl = resourcePicker("tool", "选择 Tool（仅 Enabled）", "tool-version")
export const KnowledgePickerControl = resourcePicker("knowledge", "选择 Knowledge Source（仅 Enabled）")
export const AssetPickerControl = resourcePicker("asset", "选择 DataAsset（仅 Enabled）")
export const McpPickerControl = resourcePicker("mcp", "选择 MCP Server（仅 Enabled）")

export const McpToolPickerControl: FieldControl = ({ fieldKey, label, ctx }) => {
  const tools = useMcpTools(ctx.cfg.mcpServerId as string | undefined)
  return (
    <div>
      <div className="pb-1 text-xs" style={{ color: C.ink2 }}>{label}</div>
      <Select value={(ctx.cfg[fieldKey] as string) || undefined} onValueChange={(v) => ctx.set(fieldKey, v)}>
        <SelectTrigger className="h-7 w-full text-xs"><SelectValue placeholder="选择工具" /></SelectTrigger>
        <SelectContent>{tools.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  )
}

export const AgentPickerControl: FieldControl = ({ fieldKey, label, ctx }) => {
  const agents = useAgentList()
  return (
    <div>
      <div className="pb-1 text-xs" style={{ color: C.ink2 }}>{label}</div>
      <Select value={(ctx.cfg[fieldKey] as string) || undefined} onValueChange={(v) => ctx.set(fieldKey, v)}>
        <SelectTrigger className="h-7 w-full text-xs"><SelectValue placeholder="请选择 Agent" /></SelectTrigger>
        <SelectContent>{agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  )
}

export const AgentPickerMultiControl: FieldControl = ({ fieldKey, label, ctx }) => {
  const agents = useAgentList()
  const sel = Array.isArray(ctx.cfg[fieldKey]) ? (ctx.cfg[fieldKey] as string[]) : []
  return (
    <div>
      <div className="pb-1 text-xs" style={{ color: C.ink2 }}>{label}（多选）</div>
      <div className="max-h-36 space-y-0.5 overflow-y-auto rounded border p-1" style={{ borderColor: C.cardBorder }}>
        {agents.length === 0 && <div className="px-1 py-1 text-[11px]" style={{ color: C.ink3 }}>暂无 Agent</div>}
        {agents.map((a) => (
          <label key={a.id} className="flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-xs hover:bg-accent" style={{ color: C.ink }}>
            <Checkbox checked={sel.includes(a.id)}
              onCheckedChange={(v) => ctx.set(fieldKey, v ? [...sel, a.id] : sel.filter((id) => id !== a.id))} />
            <span className="truncate">{a.name}</span>
          </label>
        ))}
      </div>
    </div>
  )
}
