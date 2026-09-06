/** condition-builder x-control：条件分支规则构建器（SDD design-condition-rule-builder；调研 11 §3.14）。
 *  branches 写入即同步节点声明 handle（含 else 兜底，校验器 R7 依赖）；
 *  删除分支经 ctx.onRemoveBranchEdges 联动移除画布出边。 */
import { useState } from "react"
import { GripVertical, Plus, Trash2, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  C, OP_LABEL, OPS_BY_TYPE, NO_VALUE_OPS, VarCascader, describeVar,
  normCondBranches, type CondBranch, type CondCondition,
} from "@/components/wf/controls"
import type { WfNode } from "@/services/wf-api"
import type { FieldControl } from "../inspector-types"

const EMPTY_COND: CondCondition = {
  variable: "", variableType: "string", operator: "eq", valueMode: "LITERAL", value: "", valueRef: "",
}

export const ConditionBuilderControl: FieldControl = ({ ctx }) => {
  const [dragBr, setDragBr] = useState<number | null>(null)
  const branches = normCondBranches(ctx.cfg.branches)

  const commit = (bs: CondBranch[]) =>
    ctx.onChange({ ...ctx.node, config: { ...ctx.cfg, branches: bs }, branches: [...bs.map((b) => b.handle), "else"] })
  const patchBranch = (bi: number, patch: Partial<CondBranch>) => {
    const bs = [...branches]
    bs[bi] = { ...bs[bi], ...patch }
    commit(bs)
  }
  const patchCond = (bi: number, ci: number, patch: Partial<CondCondition>) => {
    const bs = [...branches]
    const conds = [...bs[bi].conditions]
    conds[ci] = { ...conds[ci], ...patch }
    bs[bi] = { ...bs[bi], conditions: conds }
    commit(bs)
  }
  /** 变量级联回填：左值带类型推断（操作符不兼容时重置），右值写引用。 */
  const pickVariable = (bi: number, ci: number, v: string, t?: string) => {
    const vt = t && OPS_BY_TYPE[t] ? t : "string"
    const ops = OPS_BY_TYPE[vt]
    const cur = branches[bi]?.conditions[ci]
    patchCond(bi, ci, {
      variable: v, variableType: vt,
      ...(cur && !ops.includes(cur.operator) ? { operator: ops[0], value: "", valueRef: "" } : {}),
    })
  }
  const addBranch = () => {
    const used = branches.map((b) => b.handle)
    let n = branches.length + 1
    while (used.includes(`b${n}`)) n++
    commit([...branches, { handle: `b${n}`, logic: "AND", conditions: [] }])
  }
  const removeBranch = (bi: number) => {
    const removed = branches[bi].handle
    const bs = branches.filter((_, j) => j !== bi)
    const nextNode: WfNode = { ...ctx.node, config: { ...ctx.cfg, branches: bs }, branches: [...bs.map((b) => b.handle), "else"] }
    if (ctx.onRemoveBranchEdges) ctx.onRemoveBranchEdges(ctx.node.id, [removed], nextNode)
    else ctx.onChange(nextNode)
  }
  const dropBranch = (to: number) => {
    if (dragBr === null || dragBr === to) { setDragBr(null); return }
    const bs = [...branches]
    const [m] = bs.splice(dragBr, 1)
    bs.splice(to, 0, m)
    setDragBr(null)
    commit(bs)
  }

  return (
    <div>
      {branches.map((b, bi) => (
        <div key={b.handle} className={`mb-2 rounded-md p-2 ${dragBr === bi ? "opacity-60" : ""}`} style={{ background: "var(--surface-muted)" }}
          onDragOver={(e) => e.preventDefault()} onDrop={() => dropBranch(bi)}>
          <div className="flex items-center gap-1 pb-1.5">
            <span className="cursor-grab text-muted-foreground" draggable onDragStart={() => setDragBr(bi)} title="拖拽排序">
              <GripVertical className="size-3.5" />
            </span>
            <span className="text-xs font-medium" style={{ color: C.ink }}>{bi === 0 ? "如果" : `否则如果 ${bi}`}</span>
            <Input className="h-5 min-w-0 flex-1 text-[11px]" value={(b as CondBranch & { title?: string }).title ?? ""}
              placeholder="分支名（画布标签跟随）"
              onChange={(e) => patchBranch(bi, { title: e.target.value } as Partial<CondBranch>)} />
            <ToggleGroup type="single" size="sm" value={b.logic} title="组内多条件的连接方式"
              onValueChange={(v) => v && patchBranch(bi, { logic: v as "AND" | "OR" })}>
              <ToggleGroupItem value="AND" className="h-5 px-1.5 text-[10px]">且</ToggleGroupItem>
              <ToggleGroupItem value="OR" className="h-5 px-1.5 text-[10px]">或</ToggleGroupItem>
            </ToggleGroup>
            <button title="删除分支" onClick={() => removeBranch(bi)}><Trash2 className="size-3 text-muted-foreground hover:text-status-danger" /></button>
          </div>
          {b.conditions.map((c, ci) => (
            <div key={ci} className="mb-1.5 rounded border bg-popover p-1.5" style={{ borderColor: C.cardBorder }}>
              <div className="flex items-center gap-1">
                <Popover>
                  <PopoverTrigger asChild>
                    <button className="min-w-0 flex-1 truncate rounded border px-1.5 py-1 text-left text-xs"
                      style={{ borderColor: c.variable ? C.cardBorder : C.danger, color: c.variable ? C.ink : C.ink3 }}>
                      {c.variable ? describeVar(c.variable, ctx.nodes) : "选择变量"}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start">
                    <VarCascader nodes={ctx.nodes} edges={ctx.edges} selfId={ctx.node.id} defs={ctx.defs}
                      onPick={(v, t) => pickVariable(bi, ci, v, t)} />
                  </PopoverContent>
                </Popover>
                <button title="删除条件" onClick={() => patchBranch(bi, { conditions: b.conditions.filter((_, j) => j !== ci) })}>
                  <X className="size-3 text-muted-foreground" />
                </button>
              </div>
              <div className="flex items-center gap-1 pt-1">
                <Select value={c.operator} onValueChange={(v) => patchCond(bi, ci, { operator: v })}>
                  <SelectTrigger className="h-6 w-24 shrink-0 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(OPS_BY_TYPE[c.variableType] ?? OPS_BY_TYPE.string).map((op) => (
                      <SelectItem key={op} value={op}>{OP_LABEL[op]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!NO_VALUE_OPS.has(c.operator) && (c.valueMode === "VARIABLE" ? (
                  <div className="flex min-w-0 flex-1 items-center gap-1">
                    <Popover>
                      <PopoverTrigger asChild>
                        <button className="min-w-0 flex-1 truncate rounded border px-1.5 py-1 text-left text-xs"
                          style={{ borderColor: C.cardBorder, color: c.valueRef ? C.primary : C.ink3 }}>
                          {c.valueRef ? describeVar(c.valueRef, ctx.nodes) : "选择变量"}
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="start">
                        <VarCascader nodes={ctx.nodes} edges={ctx.edges} selfId={ctx.node.id} defs={ctx.defs}
                          onPick={(v) => patchCond(bi, ci, { valueMode: "VARIABLE", valueRef: v })} />
                      </PopoverContent>
                    </Popover>
                    <button title="改为字面量" onClick={() => patchCond(bi, ci, { valueMode: "LITERAL", valueRef: "" })}>
                      <X className="size-3 text-muted-foreground" />
                    </button>
                  </div>
                ) : c.variableType === "boolean" ? (
                  <Select value={c.value || undefined} onValueChange={(v) => patchCond(bi, ci, { value: v })}>
                    <SelectTrigger className="h-6 flex-1 text-xs"><SelectValue placeholder="选择" /></SelectTrigger>
                    <SelectContent><SelectItem value="true">true</SelectItem><SelectItem value="false">false</SelectItem></SelectContent>
                  </Select>
                ) : (
                  <div className="flex min-w-0 flex-1 items-center gap-1">
                    <Input className="h-6 min-w-0 flex-1 text-xs" placeholder={c.variableType === "number" ? "数值" : "比较值"}
                      type={c.variableType === "number" ? "number" : "text"}
                      value={c.value} onChange={(e) => patchCond(bi, ci, { value: e.target.value })} />
                    <Popover>
                      <PopoverTrigger asChild>
                        <button className="shrink-0 rounded border px-1 py-0.5 text-[10px]" style={{ borderColor: C.cardBorder, color: C.primary }}
                          title="引用变量">引用</button>
                      </PopoverTrigger>
                      <PopoverContent align="start">
                        <VarCascader nodes={ctx.nodes} edges={ctx.edges} selfId={ctx.node.id} defs={ctx.defs}
                          onPick={(v) => patchCond(bi, ci, { valueMode: "VARIABLE", valueRef: v })} />
                      </PopoverContent>
                    </Popover>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <button className="flex items-center gap-1 pt-0.5 text-xs" style={{ color: C.primary }}
            onClick={() => patchBranch(bi, { conditions: [...b.conditions, { ...EMPTY_COND }] })}>
            <Plus className="size-3" /> 添加条件
          </button>
        </div>
      ))}
      <button className="flex items-center gap-1 text-xs" style={{ color: C.primary }} onClick={addBranch}>
        <Plus className="size-3" /> 添加分支
      </button>
      <div className="mt-2 flex items-center justify-between rounded-md px-2 py-1.5" style={{ background: "var(--surface-muted)" }}>
        <span className="text-xs" style={{ color: C.ink2 }}>否则（Else）</span>
        <span className="text-[10px]" style={{ color: C.ink3 }}>兜底分支 · 不可删除</span>
      </div>
    </div>
  )
}
