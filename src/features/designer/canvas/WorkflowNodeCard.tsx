/** WorkflowNodeCard：画布节点卡（16 §3 复刻 + 08-26 用户反馈形态）。
 *  含摘要行（普通/条件分支）、运行态边框、快捷添加（+）、单节点试运行结果控制台。
 *  Theme-R：卡片表面=bg-surface，选中/悬浮=品牌绿 token，运行结果控制台=--wf-console 双主题恒定深色。 */
import { useState } from "react"
import {
  Check, ChevronDown, ChevronRight, CircleAlert, MoreHorizontal, Play, Plus, X,
} from "lucide-react"
import { Handle, Position, type NodeProps } from "@xyflow/react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { C, NEUTRAL, TypeChip, condHandlesOf, getStartFields, normCondBranches } from "@/components/wf/controls"
import type { WfNode } from "@/services/wf-api"
import type { NodeCfgLoose, NodeFamily, WfNodeData } from "../designer-types"
import { TypeIcon } from "../node-meta"
import { PaletteGroups } from "../palette/NodePalette"

/* ---- 摘要行（07-SDD §2.6-5：画布卡 subtitle 回显关键配置） ---- */

function SummaryRows({ n }: { n: WfNode }) {
  const cfg = n.config as Record<string, unknown>
  const rows: { label: string; body: React.ReactNode }[] = []
  const un = <span style={{ color: C.ink3 }}>未配置</span>
  if (n.type === "input") {
    // 08-26 用户反馈：选了表单后开始卡输入=表单字段（无表单回退六件套）
    const sf = getStartFields()
    const list = sf && sf.length ? sf : ["userQuery", "chatHistory", "userId", "conversationId", "chatId", "reference"].map((n2) => ({ name: n2, type: "string" }))
    rows.push({
      label: "输入",
      body: (
        <span className="flex flex-wrap gap-1">
          {list.map((k) => (
            <span key={k.name} className="text-xs" style={{ color: C.ink }}>{k.name} <TypeChip t={k.type === "array" ? "Arr" : k.type === "number" ? "Num" : k.type === "boolean" ? "Bool" : "Str"} /></span>
          ))}
        </span>
      ),
    })
  }
  if (n.type === "llm") {
    rows.push({ label: "输入", body: (n.inputs?.length ? <span className="text-xs">{n.inputs.map((i) => i.name).join("、")}</span> : un) })
    const model = (cfg.modelRef as { modelId?: string })?.modelId
    rows.push({ label: "模型", body: model ? <span className="text-xs">{model}</span> : un })
    rows.push({ label: "提示词", body: cfg.prompt ? <span className="max-w-40 truncate text-xs">{String(cfg.prompt)}</span> : un })
    const llmCfg = (n.config ?? {}) as { outputFormat?: string; outputSchema?: Record<string, unknown> }
    const schemaKeys = llmCfg.outputFormat === "JSON" && llmCfg.outputSchema ? Object.keys(llmCfg.outputSchema) : []
    rows.push({ label: "输出", body: <span className="flex flex-wrap gap-1 text-xs">output <TypeChip t="Str" /> thought <TypeChip t="Str" /> answer <TypeChip t="Str" />{schemaKeys.map((k) => <span key={k}>{k} <TypeChip t="Json" /></span>)}</span> })
  }
  if (n.type === "tool") {
    rows.push({ label: "工具", body: cfg.toolVersionId ? <span className="text-xs">已绑定</span> : un })
  }
  if (n.type === "knowledge-retrieval") {
    rows.push({ label: "知识库", body: cfg.knowledgeSourceId ? <span className="text-xs">已绑定</span> : un })
    rows.push({ label: "查询", body: cfg.query ? <span className="max-w-40 truncate text-xs">{String(cfg.query)}</span> : un })
  }
  if (n.type === "mcp-call") {
    rows.push({ label: "MCP", body: cfg.mcpServerId ? <span className="text-xs">已绑定</span> : un })
    rows.push({ label: "工具", body: cfg.toolName ? <span className="text-xs">{String(cfg.toolName)}</span> : un })
  }
  if (n.type === "transform") rows.push({ label: "表达式", body: cfg.template ? <span className="text-xs">已配置</span> : un })
  if (n.type === "end") {
    rows.push({ label: "输出", body: <span className="text-xs">output <TypeChip t="Str" /></span> })
  }
  return (
    <div className="mt-2 space-y-1.5 overflow-hidden">
      {rows.map((r) => (
        <div key={r.label} className="flex items-start gap-2 text-xs">
          <span className="w-11 shrink-0" style={{ color: C.ink3 }}>{r.label}</span>
          <div className="min-w-0 flex-1 overflow-hidden" style={{ color: C.ink }}>{r.body}</div>
        </div>
      ))}
    </div>
  )
}

/* 条件节点摘要行：每分支一行，右侧各挂一个 source handle（调研 11 §3.14：分支=出边 handle） */
function ConditionRows({ n, onQuickAdd, palette }: { n: WfNode; onQuickAdd?: (h: string | null, t: string) => void; palette?: NodeFamily[] }) {
  const bs = normCondBranches((n.config as NodeCfgLoose)?.branches)
  const rows = [
    ...bs.map((b, i) => ({
      handle: b.handle,
      label: i === 0 ? "如果" : `否则如果 ${i}`,
      desc: b.conditions.length === 0 ? "未配置条件"
        : `${b.conditions.length} 个条件 · ${b.logic === "OR" ? "或" : "且"}`,
    })),
    { handle: "else", label: "否则", desc: "默认分支" },
  ]
  return (
    <div className="mt-2 space-y-2">
      {rows.map((r) => (
        <div key={r.handle} className="relative flex items-center gap-2 pr-3 text-xs">
          <span className="w-14 shrink-0 truncate" style={{ color: C.ink3 }}>{r.label}</span>
          <span className="min-w-0 flex-1 truncate" style={{ color: C.ink }}>{r.desc}</span>
          <Handle id={r.handle} type="source" position={Position.Right}
            style={{ width: 12, height: 12, background: r.handle === "else" ? "var(--text-secondary)" : C.primary, border: "2px solid var(--surface)", borderRadius: 6 }} />
          {onQuickAdd && palette && (
            <span className="shrink-0">
              <QuickAddButton palette={palette} onPick={(t) => onQuickAdd(r.handle, t)} />
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

/* ---- 节点尾部“+”快捷添加（08-26：点击后选节点并自动连线） ---- */

export function QuickAddButton({ palette, onPick }: { palette: NodeFamily[]; onPick: (t: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex size-6 items-center justify-center rounded-full border-2 bg-popover shadow-md transition-transform hover:scale-110" style={{ borderColor: C.primary }} title="快捷添加节点">
          <Plus className="size-3.5" style={{ color: C.primary }} />
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="max-h-80 w-64 overflow-y-auto p-2">
        <PaletteGroups families={palette} onPick={(t) => { onPick(t); setOpen(false) }} />
      </PopoverContent>
    </Popover>
  )
}

/* ---- 试运行结果控制台（quickservice 深色面板形态；--wf-console 双主题恒定深色） ---- */

export function NodeRunResult({ run }: { run: NonNullable<WfNodeData["run"]> }) {
  const [open, setOpen] = useState(false)
  const ok = run.status === "success"
  const skipped = run.status === "skipped"
  const KV = ({ title, obj }: { title: string; obj: unknown }) => {
    const o = (obj ?? {}) as Record<string, unknown>
    return (
      <div>
        <div className="pb-0.5 text-[10px] text-neutral-300">{title}</div>
        <div className="whitespace-pre-wrap break-all rounded p-2 font-mono text-[10px] leading-4" style={{ background: "var(--wf-console-inset)" }}>
          {Object.entries(o).length === 0 && <span className="text-neutral-400">∅</span>}
          {Object.entries(o).map(([k, v]) => (
            <div key={k}>
              <span style={{ color: "var(--status-success)" }}>{k}:</span>{" "}
              <span className="break-all text-neutral-200">{typeof v === "string" ? `"${v}"` : JSON.stringify(v)}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }
  return (
    <div className="nodrag mt-1.5 overflow-hidden rounded-md" style={{ background: "var(--wf-console)" }}>
      <button className="flex w-full items-center gap-2 px-2.5 py-1.5" onClick={() => setOpen((v) => !v)}>
        <span className="flex size-3.5 items-center justify-center rounded-full"
          style={{ background: ok ? "var(--status-success)" : skipped ? "var(--text-secondary)" : "var(--status-danger)" }}>
          {ok ? <Check className="size-2.5 text-white" /> : <X className="size-2.5 text-white" />}
        </span>
        <span className="text-xs text-white">{ok ? "运行成功" : skipped ? "已跳过" : "运行失败"}</span>
        {run.durationMs != null && <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white">{run.durationMs}ms</span>}
        {!!run.tokens && <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white">{run.tokens} tokens</span>}
        <ChevronDown className={`ml-auto size-3.5 text-white transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="space-y-1.5 px-2.5 pb-2">
          {run.error && <div className="rounded p-2 font-mono text-[10px] text-red-300" style={{ background: "var(--wf-console-inset)" }}>{run.error}</div>}
          <KV title="输入" obj={run.input} />
          <KV title="输出" obj={run.output} />
        </div>
      )}
    </div>
  )
}

/* ---- 节点卡本体 ---- */

export function WfNodeCard({ data, selected }: NodeProps) {
  const d = data as WfNodeData
  const n = d.wf
  const [collapsed, setCollapsed] = useState(false)
  const rs = d.run?.status
  // 08-26 用户反馈：运行状态边框参考 reactflow NodeStatusIndicator（呼吸环/状态色边框，--status-* 驱动）
  const stCls =
    rs === "running" ? "node-st-running" :
    rs === "success" ? "node-st-success" :
    rs === "failed" ? "node-st-failed" :
    rs === "skipped" ? "node-st-skipped" : ""
  const ring = selected ? "ring-[1.5px] ring-[var(--brand-primary)]" : ""
  // 08-26 用户反馈：悬浮边框+阴影效果（品牌绿 token 派生）
  const hoverFx = selected ? "" : "border-border hover:border-[var(--brand-primary)] hover:shadow-[0_4px_16px_color-mix(in_srgb,var(--brand-primary)_18%,transparent)]"
  const isBranch = ["condition", "decision-class", "workflow-select"].includes(n.type)
  return (
    <div className="group w-[300px]">
    <div className="relative">
    <div className={`relative w-full overflow-hidden rounded-[8px] border bg-surface p-3 shadow-sm transition-all ${hoverFx} ${ring} ${stCls}`} data-testid="wf-node-card" style={{ borderColor: selected ? C.primary : undefined }}>
      {n.type !== "input" && <Handle type="target" position={Position.Left} style={{ width: 12, height: 12, background: "var(--surface)", border: `2px solid ${C.primary}`, borderRadius: 6 }} />}
      {n.type !== "end" && n.type !== "condition" && <Handle type="source" position={Position.Right} style={{ width: 12, height: 12, background: C.primary, border: "2px solid var(--surface)", borderRadius: 6 }} />}
      {n.type === "condition" && collapsed && condHandlesOf(n).map((h, i, arr) => (
        <Handle key={h} id={h} type="source" position={Position.Right}
          style={{ width: 12, height: 12, background: h === "else" ? "var(--text-secondary)" : C.primary, border: "2px solid var(--surface)", borderRadius: 6, top: `${((i + 1) / (arr.length + 1)) * 100}%` }} />
      ))}
      <div className="flex items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md" style={{ background: NEUTRAL }}>
          <TypeIcon type={n.type} className="size-3.5 text-background" />
        </span>
        <span className="flex-1 truncate text-sm font-medium" style={{ color: C.ink }}>{n.name}</span>
        {/* 06-master-spec §2.4：节点卡错误红点+计数 */}
        {d.issues.length > 0 && (
          <span className="flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px]" style={{ background: "var(--status-danger-soft)", color: C.danger }}
            title={d.issues.map((i) => i.message).join("；")}>
            <CircleAlert className="size-3" />{d.issues.length}
          </span>
        )}
        {rs === "running" && <span className="size-3 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />}
        {selected && (
          <>
            <button className="flex size-5 items-center justify-center rounded-full border bg-popover" style={{ borderColor: C.cardBorder }} onClick={() => d.onRunNode?.(n.id)} title="运行此节点">
              <Play className="size-2.5" style={{ color: C.ink }} />
            </button>
            <Popover>
              <PopoverTrigger asChild>
                <button className="flex size-5 items-center justify-center rounded-full border bg-popover" style={{ borderColor: C.cardBorder }} title="更多">
                  <MoreHorizontal className="size-2.5 text-muted-foreground" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-28 p-1">
                <button className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-accent" style={{ color: C.ink }} onClick={() => d.onTestNode?.(n.id)}>
                  单测此节点
                </button>
                <button className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-accent" style={{ color: C.danger }} onClick={() => d.onDelete?.(n.id)}>
                  删除节点
                </button>
              </PopoverContent>
            </Popover>
          </>
        )}
        <button onClick={() => setCollapsed((v) => !v)} className="text-muted-foreground hover:text-foreground">
          {collapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
        </button>
      </div>
      {(n.type === "loop" || n.type === "wait-review" || n.type === "workflow-fixed") && (
        <div className="mt-1 truncate text-[10px]" style={{ color: C.ink3 }}>
          {n.type === "loop" && String(((n.config as Record<string, unknown>)?.iteratorRef) || "未配置循环源")}
          {n.type === "wait-review" && `恢复方式：${((n.config as Record<string, unknown>)?.resumeMode) ?? "human"}`}
          {n.type === "workflow-fixed" && `版本策略：${((n.config as Record<string, unknown>)?.versionPolicy) ?? "latest"}`}
        </div>
      )}
      {!collapsed && (n.type === "condition" ? <ConditionRows n={n} onQuickAdd={d.onQuickAdd} palette={d.palette} /> : <SummaryRows n={n} />)}
    </div>
    {!isBranch && d.onQuickAdd && d.palette && (
      <span className={`absolute -right-2 -top-2 z-10 transition-opacity ${selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
        <QuickAddButton palette={d.palette} onPick={(t) => d.onQuickAdd?.(null, t)} />
      </span>
    )}
    </div>
    {d.run && d.run.status !== "running" && <NodeRunResult run={d.run} />}
    </div>
  )
}

export const nodeTypes = { wf: WfNodeCard }
