/** 07-SDD §3/§4：节点抽屉增强分区（健壮性/输出变量/Schema 编辑器）。
 *  MTC-007R：原 loop/wait-review/data-read/tool 参数/输入映射/候选多选等专项分区已迁往
 *  features/designer/inspector（schema 目录 + x-control 注册表的单一配置路径），本文件只保留
 *  与节点类型无关的统一分区。 */
import { Plus, X } from "lucide-react"

import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { NodeDefinition, WfNode } from "@/services/wf-api"

import { C, Section, parseIoOutputs } from "./controls"

/* ---------- 健壮性分区（07-SDD §3.2 execution 块） ---------- */
export function RobustnessSection({ node, onChange }: { node: WfNode; onChange: (n: WfNode) => void }) {
  const ex = (node.execution ?? {}) as Record<string, unknown>
  const setEx = (k: string, v: unknown) => onChange({ ...node, execution: { ...node.execution, [k]: v } } as WfNode)
  const onError = (ex.onError as string) || "fail"
  return (
    <Section title="健壮性" defaultOpen={false}>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <div className="pb-1" style={{ color: C.ink2 }}>超时 ms</div>
          <Input type="number" className="h-7 text-xs" value={String(ex.timeoutMs ?? 60000)}
            onChange={(e) => setEx("timeoutMs", Number(e.target.value) || 60000)} />
        </div>
        <div>
          <div className="pb-1" style={{ color: C.ink2 }}>重试次数</div>
          <Input type="number" className="h-7 text-xs" value={String(ex.retries ?? 0)}
            onChange={(e) => setEx("retries", Math.max(0, Math.min(3, Number(e.target.value) || 0)))} />
        </div>
        <div>
          <div className="pb-1" style={{ color: C.ink2 }}>间隔 ms</div>
          <Input type="number" className="h-7 text-xs" value={String(ex.retryIntervalMs ?? 1000)}
            onChange={(e) => setEx("retryIntervalMs", Number(e.target.value) || 1000)} />
        </div>
      </div>
      <div className="pb-1 pt-2 text-xs" style={{ color: C.ink2 }}>失败策略</div>
      <ToggleGroup type="single" size="sm" value={onError} onValueChange={(v) => v && setEx("onError", v)}>
        <ToggleGroupItem value="fail" className="h-6 px-2 text-[10px]">停止</ToggleGroupItem>
        <ToggleGroupItem value="skip" className="h-6 px-2 text-[10px]">跳过</ToggleGroupItem>
        <ToggleGroupItem value="branch" className="h-6 px-2 text-[10px]">走错误分支</ToggleGroupItem>
      </ToggleGroup>
      <p className="pt-1 text-[11px]" style={{ color: C.ink3 }}>
        仅 retryable（5xx/timeout/连接错误）触发重试；走错误分支需画布拉出 error 出口边，下游可引 {"{{节点.error.message}}"}。
      </p>
    </Section>
  )
}

/* ---------- 输出变量统一区（07-SDD §2.6-4） ---------- */
export function OutputVarsSection({ def }: { def: NodeDefinition | undefined }) {
  const outs = parseIoOutputs(def)
  return (
    <Section title="输出变量" defaultOpen={false}>
      {outs ? (
        <div className="space-y-1 text-xs">
          {outs.map((o) => (
            <div key={o.name} className="flex items-center gap-2">
              <span style={{ color: C.ink }}>{o.name}</span>
              <span className="rounded px-1 text-[10px]" style={{ background: C.chipBg, color: C.chipInk }}>
                {o.type === "array" ? "Arr" : o.type === "object" ? "Obj" : o.type === "number" ? "Num" : "Str"}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[11px]" style={{ color: C.ink3 }}>输出由资源配置决定</p>
      )}
    </Section>
  )
}

/* ---------- llm JSON Schema 编辑器（07-SDD §4.3） ---------- */
export function OutputSchemaEditor({ value, onChange }: {
  value: Record<string, { type?: string; description?: string }> | undefined
  onChange: (v: Record<string, { type?: string; description?: string }>) => void
}) {
  const schema = value ?? {}
  const keys = Object.keys(schema)
  const setRow = (k: string, patch: { type?: string; description?: string }) =>
    onChange({ ...schema, [k]: { ...schema[k], ...patch } })
  return (
    <div className="space-y-1 pt-1">
      {keys.map((k) => (
        <div key={k} className="flex items-center gap-1 text-xs">
          <Input key={k} className="h-6 flex-1 font-mono text-xs" defaultValue={k} placeholder="field_key"
            title="字段名（回车/失焦生效）"
            onBlur={(e) => {
              const nk = e.target.value.trim()
              if (!nk || nk === k || schema[nk]) return
              const next: typeof schema = {}
              for (const [ok, ov] of Object.entries(schema)) next[ok === k ? nk : ok] = ov
              onChange(next)
            }} />
          <Select value={schema[k]?.type ?? "string"} onValueChange={(v) => setRow(k, { type: v })}>
            <SelectTrigger className="h-6 w-24 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {["string", "number", "boolean", "object", "array", "enum"].map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input className="h-6 flex-1 text-xs" placeholder="描述" value={schema[k]?.description ?? ""}
            onChange={(e) => setRow(k, { description: e.target.value })} />
          <button onClick={() => { const n = { ...schema }; delete n[k]; onChange(n) }}><X className="size-3 text-muted-foreground" /></button>
        </div>
      ))}
      <button className="flex items-center gap-1 text-xs" style={{ color: C.primary }}
        onClick={() => onChange({ ...schema, [`field_${keys.length + 1}`]: { type: "string", description: "" } })}>
        <Plus className="size-3" /> 添加字段
      </button>
      <p className="text-[11px]" style={{ color: C.ink3 }}>支持 object 嵌套/array items/enum（后端按 schema 校验输出）。</p>
    </div>
  )
}
