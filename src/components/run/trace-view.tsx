/** Run 观测 Trace 视图（SDD design-run-observability）：span 树 + 真时间轴瀑布 + 右栏钻取。
 *  同构 LangSmith：Trace=Run / Span=NodeRun / Leaf=CallRecord。纯标准件（Tabs+CodeMirror）。 */
import { useEffect, useMemo, useState } from "react"
import CodeMirror from "@uiw/react-codemirror"
import { json } from "@codemirror/lang-json"
import { BookOpen, Bot, Box, ChevronDown, ChevronRight, Flag, Server, Wrench, Zap } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

export interface SpanNode {
  id: string
  kind: "run" | "node" | "model" | "tool" | "mcp" | "knowledge" | "agent"
  name: string
  nodeType?: string
  status: string
  startedAt: string | null
  endedAt: string | null
  durationMs: number | null
  attempt?: number
  tokenUsage?: Record<string, unknown>
  input?: unknown
  output?: unknown
  error?: { message?: string } | null
  children: SpanNode[]
}
export interface TraceData { root: SpanNode; totalTokens: number; modelCalls: number }
export interface TraceEvent {
  sequence: number; type: string; nodeId: string | null; nodeRunId: string | null
  channel: string; at: string
}

const KIND_ICON = { run: Flag, node: Box, model: Zap, tool: Wrench, mcp: Server, knowledge: BookOpen, agent: Bot } as const
const KIND_LABEL = { run: "Run", node: "节点", model: "LLM", tool: "Tool", mcp: "MCP", knowledge: "Knowledge", agent: "Agent" } as const

const fmtMs = (ms: number | null | undefined) => (ms == null ? "—" : ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`)
const fmtTok = (t: number) => (t >= 1000 ? `${(t / 1000).toFixed(1)}k` : String(t))
const tokOf = (s: SpanNode) => {
  const d = (s.tokenUsage ?? {}) as Record<string, number>
  return d.total || (d.prompt || 0) + (d.completion || 0) || 0
}
/* 业务轨 NodeRun 可能无 started/duration：回退取子 span（调用记录）聚合值，保证瀑布可读 */
const dispStart = (s: SpanNode): string | null => s.startedAt ?? (s.children.length ? dispStart(s.children[0]) : null)
const dispDur = (s: SpanNode): number => s.durationMs ?? (s.children.length ? Math.max(...s.children.map(dispDur)) : 0)
const statusColor = (st: string) =>
  st === "success" || st === "succeeded" ? "#34C759" :
  st === "failed" || st === "error" ? "#F56C6C" :
  st === "skipped" ? "#B9C2CF" : "#5A6472"
const barColor = (st: string) =>
  st === "success" || st === "succeeded" ? "bg-emerald-400" :
  st === "failed" || st === "error" ? "bg-red-400" :
  st === "skipped" ? "bg-neutral-300" : "bg-neutral-400"

function JsonView({ value }: { value: unknown }) {
  const text = useMemo(() => JSON.stringify(value ?? null, null, 2), [value])
  const [full, setFull] = useState(false)
  const long = text.length > 4000
  const shown = long && !full ? `${text.slice(0, 4000)}\n…（已截断）` : text
  return (
    <div className="space-y-1">
      {long && (
        <button className="text-xs text-blue-600" onClick={() => setFull((v) => !v)}>
          {full ? "收起" : `展开全部 ${text.length} 字符`}
        </button>
      )}
      <CodeMirror value={shown} readOnly height="280px" extensions={[json()]}
        basicSetup={{ lineNumbers: true, foldGutter: true }}
        theme="light" style={{ fontSize: 11, border: "1px solid #EDF0F4", borderRadius: 6 }} />
    </div>
  )
}

function SpanDetail({ span, events }: { span: SpanNode; events: TraceEvent[] }) {
  const Icon = KIND_ICON[span.kind] ?? Box
  const spanEvents = events.filter((e) => e.nodeRunId === span.id)
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2.5" style={{ borderColor: "#EDF0F4" }}>
        <span className="flex size-6 items-center justify-center rounded-md bg-[#1F2329]"><Icon className="size-3.5 text-white" /></span>
        <span className="truncate text-sm font-medium text-[#1F2329]">{span.name}</span>
        <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-[#5A6472]">{KIND_LABEL[span.kind]}</span>
        {span.attempt != null && span.attempt > 1 && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-600">attempt {span.attempt}</span>}
        <span className="ml-auto text-xs tabular-nums text-[#5A6472]">{fmtMs(span.durationMs)}</span>
        <span className="size-2 rounded-full" style={{ background: statusColor(span.status) }} />
      </div>
      <Tabs defaultValue="output" className="min-h-0 flex-1">
        <TabsList className="h-8 w-full justify-start rounded-none border-b bg-transparent px-2" style={{ borderColor: "#EDF0F4" }}>
          <TabsTrigger value="input" className="h-7 text-xs">Input</TabsTrigger>
          <TabsTrigger value="output" className="h-7 text-xs">Output</TabsTrigger>
          <TabsTrigger value="events" className="h-7 text-xs">Events（{spanEvents.length}）</TabsTrigger>
          <TabsTrigger value="meta" className="h-7 text-xs">Metadata</TabsTrigger>
        </TabsList>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <TabsContent value="input" className="m-0"><JsonView value={span.input} /></TabsContent>
          <TabsContent value="output" className="m-0">
            {span.error ? (
              <pre className="overflow-x-auto rounded-md bg-red-50 p-3 text-[11px] leading-5 text-red-600">{JSON.stringify(span.error, null, 2)}</pre>
            ) : <JsonView value={span.output} />}
          </TabsContent>
          <TabsContent value="events" className="m-0 space-y-1">
            {spanEvents.length === 0 && <p className="text-xs text-[#B9C2CF]">该 span 无事件</p>}
            {spanEvents.map((e) => (
              <div key={e.sequence} className="flex items-center gap-2 rounded border px-2 py-1 text-[11px]" style={{ borderColor: "#EDF0F4" }}>
                <span className="w-8 text-right text-[#B9C2CF]">#{e.sequence}</span>
                <span className="rounded bg-neutral-100 px-1 font-mono text-[#1F2329]">{e.type}</span>
                <span className="rounded px-1 text-[10px]" style={{ background: e.channel === "CONTENT" ? "#EFF6FF" : "#F1F3F7", color: "#5A6472" }}>{e.channel}</span>
                <span className="ml-auto text-[#B9C2CF]">{new Date(e.at).toLocaleTimeString()}</span>
              </div>
            ))}
          </TabsContent>
          <TabsContent value="meta" className="m-0">
            <div className="grid grid-cols-[110px_1fr] gap-y-1.5 text-xs">
              {([["kind", KIND_LABEL[span.kind]], ["status", span.status],
                 ["开始", span.startedAt ? new Date(span.startedAt).toLocaleTimeString(undefined, { hour12: false, fractionalSecondDigits: 3 } as Intl.DateTimeFormatOptions) : "—"],
                 ["结束", span.endedAt ? new Date(span.endedAt).toLocaleTimeString(undefined, { hour12: false, fractionalSecondDigits: 3 } as Intl.DateTimeFormatOptions) : "—"],
                 ["耗时", fmtMs(span.durationMs)], ["tokens", String(tokOf(span))],
                 ...((span.nodeType ? [["节点类型", span.nodeType]] : []) as string[][]),
              ] as string[][]).map(([k, v]) => (
                <div key={k} className="contents">
                  <span className="text-[#B9C2CF]">{k}</span><span className="font-mono text-[#1F2329]">{v}</span>
                </div>
              ))}
            </div>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  )
}

export function TraceView({ trace, events, focusSpanId }: {
  trace: TraceData
  events: TraceEvent[]
  focusSpanId?: string | null
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [selectedId, setSelectedId] = useState<string>(trace.root.id)
  useEffect(() => {
    if (focusSpanId) setSelectedId(focusSpanId)
  }, [focusSpanId])

  const runStart = trace.root.startedAt ? Date.parse(trace.root.startedAt) : 0
  const runEnd = trace.root.endedAt ? Date.parse(trace.root.endedAt) : Date.now()
  const total = Math.max(trace.root.durationMs ?? 0, runEnd - runStart, 1)

  const flat = useMemo(() => {
    const acc: { span: SpanNode; depth: number }[] = []
    const walk = (s: SpanNode, depth: number) => {
      acc.push({ span: s, depth })
      if (!collapsed[s.id]) s.children.forEach((c) => walk(c, depth + 1))
    }
    walk(trace.root, 0)
    return acc
  }, [trace, collapsed])

  const selected = useMemo(() => flat.find((f) => f.span.id === selectedId)?.span
    ?? (function find(s: SpanNode): SpanNode | null {
      if (s.id === selectedId) return s
      for (const c of s.children) { const r = find(c); if (r) return r }
      return null
    })(trace.root), [flat, selectedId, trace])

  const ticks = [0, 0.25, 0.5, 0.75, 1]
  return (
    <div className="grid min-h-0 flex-1 grid-cols-2 divide-x rounded-lg border bg-white" style={{ borderColor: "#EDF0F4" }}>
      {/* 左：span 树 + 真时间轴瀑布 */}
      <div className="flex min-h-0 flex-col">
        <div className="flex border-b px-3 py-1.5 text-[10px] text-[#B9C2CF]" style={{ borderColor: "#EDF0F4" }}>
          <span className="w-1/2">Span</span>
          <span className="relative flex-1">
            {ticks.map((t) => (
              <span key={t} className="absolute -translate-x-1/2 tabular-nums" style={{ left: `${t * 100}%` }}>{fmtMs(Math.round(total * t))}</span>
            ))}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {flat.map(({ span, depth }) => {
            const Icon = KIND_ICON[span.kind] ?? Box
            const st0 = dispStart(span)
            const left = st0 ? Math.min(100, Math.max(0, ((Date.parse(st0) - runStart) / total) * 100)) : 0
            const width = Math.max(0.6, Math.min(100 - left, (dispDur(span) / total) * 100))
            const tok = tokOf(span)
            return (
              <div key={span.id}
                className={`flex cursor-pointer items-center gap-1 px-2 py-1 text-xs hover:bg-neutral-50 ${selectedId === span.id ? "bg-blue-50/70" : ""} ${span.status === "failed" || span.status === "error" ? "bg-red-50/40" : ""}`}
                onClick={() => setSelectedId(span.id)}>
                <div className="flex w-1/2 min-w-0 items-center gap-1" style={{ paddingLeft: depth * 14 }}>
                  {span.children.length > 0 ? (
                    <button onClick={(e) => { e.stopPropagation(); setCollapsed((s) => ({ ...s, [span.id]: !s[span.id] })) }}>
                      {collapsed[span.id] ? <ChevronRight className="size-3 text-neutral-400" /> : <ChevronDown className="size-3 text-neutral-400" />}
                    </button>
                  ) : <span className="w-3" />}
                  <Icon className="size-3.5 shrink-0 text-[#5A6472]" />
                  <span className="truncate text-[#1F2329]">{span.name}</span>
                  {span.nodeType && <span className="shrink-0 truncate text-[10px] text-[#B9C2CF]">{span.nodeType}</span>}
                  {tok > 0 && <span className="shrink-0 rounded bg-neutral-100 px-1 text-[10px] tabular-nums text-[#5A6472]">{fmtTok(tok)} tok</span>}
                  <span className="ml-auto shrink-0 tabular-nums text-[#5A6472]">{fmtMs(dispDur(span))}</span>
                  <span className="size-2 shrink-0 rounded-full" style={{ background: statusColor(span.status) }} />
                </div>
                <div className="relative h-4 flex-1">
                  <div className={`absolute top-1 h-2 rounded ${barColor(span.status)}`} style={{ left: `${left}%`, width: `${width}%` }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>
      {/* 右：选中 span 钻取 */}
      <div className="min-h-0">
        {selected ? <SpanDetail span={selected} events={events} /> : <p className="p-4 text-xs text-[#B9C2CF]">选择左侧 span 查看明细</p>}
      </div>
    </div>
  )
}
