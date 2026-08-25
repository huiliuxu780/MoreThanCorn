/** 07-SDD §6.2：工作流设计器共享控件（自 wf-designer.tsx 抽取）。 */
import { useEffect, useMemo, useState } from "react"
import { CheckCircle2, ChevronDown, ChevronRight, Settings } from "lucide-react"

import { registrySystemVariables, wfApi, type NodeDefinition, type WfEdge, type WfNode } from "@/services/wf-api"
import { resApi } from "@/services/resource-api"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

export const C = {
  canvas: "#EEF1F6",
  dot: "#D9DEE7",
  primary: "#3D6BFF",
  orange: "#F97E2B",
  tagBg: "#FFF4EA",
  ink: "#1F2329",
  ink2: "#5A6472",
  ink3: "#B9C2CF",
  chipBg: "#F1F3F7",
  chipInk: "#7A8699",
  cardBorder: "#EDF0F4",
  danger: "#F56C6C",
}

/* Design Spec §8.5：黑白灰中性基底，禁止彩虹画布；icon 区分类型，颜色仅用于状态 */
export const NEUTRAL = "#1F2329"
export function TypeChip({ t }: { t: string }) {
  return (
    <span className="rounded px-1 text-[10px] leading-4" style={{ background: C.chipBg, color: C.chipInk }}>
      {t}.
    </span>
  )
}
/* ============ 变量级联（16 §6；SDD A-04：可达祖先 + 注册表 io + 按 id；C-5：系统变量组） ============ */
let SYS_VARS_CACHE: { name: string; label: string }[] | null = null
function loadSystemVars(): Promise<{ name: string; label: string }[]> {
  if (SYS_VARS_CACHE) return Promise.resolve(SYS_VARS_CACHE)
  return registrySystemVariables()
    .then((j) => { SYS_VARS_CACHE = j.items ?? []; return SYS_VARS_CACHE! })
    .catch(() => [] as { name: string; label: string }[])
}

export function parseIoOutputs(def: NodeDefinition | undefined): { name: string; type: string }[] | null {
  const io = (def?.io ?? {}) as { outputs?: unknown }
  if (!Array.isArray(io.outputs)) return null  // 动态输出（如 tool from-tool-version）
  return io.outputs.map((s) => {
    const [name, type] = String(s).split(":")
    return { name, type: type || "string" }
  })
}

export function VarCascader({ nodes, edges, selfId, defs, onPick }: {
  nodes: WfNode[]; edges: WfEdge[]; selfId: string; defs: NodeDefinition[]; onPick: (v: string, type?: string) => void
}) {
  const [sysVars, setSysVars] = useState<{ name: string; label: string }[]>(SYS_VARS_CACHE ?? [])
  useEffect(() => { if (!SYS_VARS_CACHE) loadSystemVars().then(setSysVars) }, [])
  // 与后端校验器 _ancestors 同构：只有控制流可达的祖先输出可见（调研 11 §5.2）
  const ancestors = useMemo(() => {
    const parents: Record<string, string[]> = {}
    for (const e of edges) (parents[e.target] ??= []).push(e.source)
    const memo: Record<string, Set<string>> = {}
    const reach = (nid: string, seen: Set<string>): Set<string> => {
      if (memo[nid]) return memo[nid]
      const acc = new Set<string>()
      for (const p of parents[nid] ?? []) {
        if (seen.has(p)) continue
        acc.add(p)
        for (const x of reach(p, new Set([...seen, nid]))) acc.add(x)
      }
      memo[nid] = acc
      return acc
    }
    return reach(selfId, new Set([selfId]))
  }, [edges, selfId])
  const startNode = nodes.find((n) => n.type === "input")
  const ancNodes = nodes.filter((n) => ancestors.has(n.id) && n.type !== "input" && n.type !== "end")
  const firstId = "system"
  const [group, setGroup] = useState<string>(firstId)
  const gid = group || firstId
  const itemsFor = (id: string): { name: string; type: string; label?: string }[] => {
    if (id === "system") return sysVars.map((v) => ({ name: v.name, type: "string", label: v.label }))
    const node = nodes.find((n) => n.id === id)
    if (!node) return []
    return parseIoOutputs(defs.find((d) => d.type_key === node.type)) ?? []
  }
  const dynHint = (id: string) => {
    const node = nodes.find((n) => n.id === id)
    const io = (defs.find((d) => d.type_key === node?.type)?.io ?? {}) as { outputs?: unknown }
    return typeof io.outputs === "string" && io.outputs
  }
  const nameOf = (id: string) => (id === "system" ? "系统变量" : id === startNode?.id ? "开始" : nodes.find((n) => n.id === id)?.name ?? id)
  return (
    <div className="flex text-xs">
      <div className="w-28 border-r py-1" style={{ borderColor: C.cardBorder }}>
        {["system", ...(startNode ? [startNode.id] : []), ...ancNodes.map((n) => n.id)].map((id) => (
          <button key={id} className={`flex w-full items-center justify-between px-2 py-1 hover:bg-neutral-50 ${gid === id ? "bg-neutral-100" : ""}`} onClick={() => setGroup(id)}>
            {nameOf(id)} <ChevronRight className="size-3 text-neutral-400" />
          </button>
        ))}
        {!startNode && ancNodes.length === 0 && <div className="px-2 py-1 text-neutral-400">无可引用上游</div>}
      </div>
      <div className="w-40 py-1">
        {itemsFor(gid).map((it) => (
          <button key={it.name} className="flex w-full items-center gap-1 px-2 py-1 hover:bg-neutral-50"
            onClick={() => onPick(`{{${gid === "system" ? "system" : gid}.outputs.${it.name}}}`, it.type)}
            title={it.label}>
            {it.label ?? it.name} <TypeChip t={it.type === "array" ? "Arr" : it.type === "object" ? "Obj" : "Str"} />
          </button>
        ))}
        {dynHint(gid) && <div className="px-2 py-1 text-neutral-400">输出由资源配置决定</div>}
        {itemsFor(gid).length === 0 && !dynHint(gid) && <div className="px-2 py-1 text-neutral-400">无输出</div>}
      </div>
    </div>
  )
}

/* ============ 条件规则构建器（SDD design-condition-rule-builder；调研 11 §3.14） ============ */
export interface CondCondition {
  variable: string; variableType: string; operator: string
  valueMode: "LITERAL" | "VARIABLE"; value: string; valueRef: string
}
export interface CondBranch { handle: string; logic: "AND" | "OR"; conditions: CondCondition[]; title?: string }

export const OP_LABEL: Record<string, string> = {
  eq: "等于", neq: "不等于", contains: "包含", not_contains: "不包含",
  starts_with: "开头是", ends_with: "结尾是", empty: "为空", not_empty: "不为空",
  gt: "大于", gte: "大于等于", lt: "小于", lte: "小于等于",
  in: "在列表中", not_in: "不在列表中", exists: "存在", not_exists: "不存在",
  is_null: "为空(null)", is_not_null: "非空(null)",
}
export const OPS_BY_TYPE: Record<string, string[]> = {
  string: ["eq", "neq", "contains", "not_contains", "starts_with", "ends_with", "empty", "not_empty"],
  number: ["eq", "neq", "gt", "gte", "lt", "lte", "empty", "not_empty", "in", "not_in"],
  boolean: ["eq", "not_empty"],
  array: ["contains", "not_contains", "empty", "not_empty", "exists", "not_exists"],
  object: ["empty", "not_empty", "exists", "not_exists", "is_null", "is_not_null"],
}
export const NO_VALUE_OPS = new Set(["empty", "not_empty"])

/** 旧格式（分支顶层 variable/operator/value）归一为 conditions[]；空分支保留为空。 */
export function normCondBranches(raw: unknown): CondBranch[] {
  const bs = Array.isArray(raw) ? raw : []
  return bs.map((b, i) => {
    const x = b as Record<string, any>
    const conds: CondCondition[] = Array.isArray(x?.conditions)
      ? x.conditions.map((c: any) => ({
          variable: c?.variable ?? "", variableType: c?.variableType || "string",
          operator: c?.operator || "eq",
          valueMode: c?.valueMode === "VARIABLE" ? "VARIABLE" as const : "LITERAL" as const,
          value: String(c?.value ?? ""), valueRef: c?.valueRef ?? "",
        }))
      : (x?.variable || x?.operator)
          ? [{ variable: x.variable ?? "", variableType: "string", operator: x.operator || "eq",
               valueMode: "LITERAL" as const, value: String(x.value ?? ""), valueRef: "" }]
          : []
    return { handle: x?.handle || `b${i + 1}`, logic: x?.logic === "OR" ? "OR" as const : "AND" as const, conditions: conds }
  })
}

/** 条件节点出边 handle 集 = 各分支 handle + else 兜底 */
export function condHandlesOf(n: WfNode): string[] {
  return [...normCondBranches((n.config as Record<string, any>)?.branches).map((b) => b.handle), "else"]
}

/** {{nodeId.outputs.x}} → “节点名.x”，抽屉与卡片展示真实变量路径 */
export function describeVar(ref: string, nodes?: WfNode[]): string {
  const m = /^\{\{(.+?)\.outputs\.(.+?)\}\}$/.exec(ref)
  if (!m) return ref || "选择变量"
  const nm = m[1] === "system" ? "系统" : nodes?.find((n) => n.id === m[1])?.name ?? m[1]
  return `${nm}.${m[2]}`
}

/* 06-master-spec §2.2：可 # 唤起变量的文本编辑区（prompt-editor / expression-editor 共用） */
export function PromptArea({ value, onChange, nodes, edges, selfId, defs, placeholder, minH = "min-h-20", mono = false }: {
  value: string; onChange: (v: string) => void; nodes: WfNode[]; edges: WfEdge[]; selfId: string
  defs: NodeDefinition[]; placeholder?: string; minH?: string; mono?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <Textarea
        className={`${minH} text-xs ${mono ? "font-mono" : ""}`}
        placeholder={placeholder ?? "请输入"}
        value={value}
        onChange={(e) => { onChange(e.target.value); if (e.target.value.endsWith("#")) setOpen(true) }}
      />
      {open && (
        <div className="absolute left-0 top-full z-30 rounded-md border bg-white shadow-lg" style={{ borderColor: C.cardBorder }}>
          <VarCascader nodes={nodes} edges={edges} selfId={selfId} defs={defs}
            onPick={(v) => { onChange(value.replace(/#$/, "") + v); setOpen(false) }} />
        </div>
      )}
      <p className="pt-1 text-[11px]" style={{ color: C.ink3 }}>输入 “#” 唤起变量选择器，支持插入变量</p>
    </div>
  )
}

/* 06-master-spec §2.1：variable-picker 控件（⚙ 按钮 + 级联） */
export function VarButton({ value, nodes, edges, selfId, defs, onPick }: {
  value: string; nodes: WfNode[]; edges: WfEdge[]; selfId: string; defs: NodeDefinition[]; onPick: (v: string) => void
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="flex w-full items-center justify-between rounded-md border bg-white px-2 py-1.5 text-left text-xs"
          style={{ borderColor: value ? C.cardBorder : C.danger, color: value ? C.primary : C.ink3 }}>
          <span className="truncate">{value ? describeVar(value, nodes) : "选择变量"}</span>
          <Settings className="size-3 text-neutral-400" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start"><VarCascader nodes={nodes} edges={edges} selfId={selfId} defs={defs} onPick={onPick} /></PopoverContent>
    </Popover>
  )
}

/* ============ 配置抽屉（16 §6） ============ */
export function ResourceSelect({ types, value, onPick, placeholder }: {
  types: string
  value?: string
  onPick: (item: { id: string; name: string; metadata: Record<string, unknown> }) => void
  placeholder: string
}) {
  const [items, setItems] = useState<{ id: string; name: string; metadata: Record<string, unknown> }[]>([])
  useEffect(() => {
    resApi.registry(types).then((r) =>
      // 同名资源行（测试残留）在选择器里显示重复项 → 按名去重（保留首条）
      setItems(r.items.filter((m, i, arr) => arr.findIndex((x) => x.name === m.name) === i)))
      .catch(() => undefined)
  }, [types])
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="flex w-full items-center gap-2 rounded-md border bg-white px-2 py-1.5 text-left text-xs" style={{ borderColor: C.cardBorder, color: C.ink }}>
          <span className="flex-1 truncate">{items.find((i) => i.id === value)?.name ?? placeholder}</span>
          <ChevronDown className="size-3.5 text-neutral-400" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-1" align="start">
        {items.length === 0 && <div className="px-2 py-1.5 text-xs" style={{ color: C.ink3 }}>暂无 Enabled 资源</div>}
        {items.map((m) => (
          <button key={m.id} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-neutral-50" style={{ color: C.ink }} onClick={() => onPick(m)}>
            <span className="flex-1 truncate text-left">{m.name}</span>
            {value === m.id && <CheckCircle2 className="size-3.5" style={{ color: C.primary }} />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

export function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-b py-3" style={{ borderColor: C.cardBorder }}>
      <button className="flex items-center gap-1 text-[13px] font-medium" style={{ color: C.ink }} onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />} {title}
      </button>
      {open && <div className="pt-2">{children}</div>}
    </div>
  )
}
export function WorkflowPicker({ value, onPick }: { value: string; onPick: (v: string) => void }) {
  const [list, setList] = useState<{ id: string; name: string }[]>([])
  useEffect(() => { wfApi.list({ pageSize: 100 }).then((r) => setList(r.items as { id: string; name: string }[])).catch(() => undefined) }, [])
  return (
    <Section title="工作流">
      <Select value={value || undefined} onValueChange={(v) => onPick(v)}>
        <SelectTrigger className="h-8 w-full text-xs"><SelectValue placeholder="请选择工作流资源" /></SelectTrigger>
        <SelectContent>
          {list.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </Section>
  )
}
