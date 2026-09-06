/** DesignerBottomToolbar：底部工具条（16 §4）。
 *  面板开关 / 撤销重做 / 缩略图 / 优化布局 / 适应画布 / 缩放档 / 节点搜索 / 试运行。
 *  Popover 开关状态由入口持有（画布手势开始时统一收起）。 */
import {
  Crosshair, LayoutTemplate, Map as MapIcon, PanelLeftClose, PanelLeftOpen,
  Play, Redo2, Search, Undo2,
} from "lucide-react"
import { useState } from "react"
import { useReactFlow } from "@xyflow/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { C } from "@/components/wf/controls"
import type { WfNode } from "@/services/wf-api"

export type ToolbarPop = null | "zoom" | "search"

function NodeSearch({ nodes, onPick }: { nodes: WfNode[]; onPick: (id: string) => void }) {
  const [q, setQ] = useState("")
  const hits = nodes.filter((n) => n.name.includes(q))
  return (
    <div>
      <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索节点" />
      <div className="pt-1">
        {hits.map((n) => (
          <button key={n.id} className="flex w-full items-center gap-2 rounded px-2 py-1 text-[13px] hover:bg-accent" onClick={() => onPick(n.id)}>
            <span className="size-2 rounded-full" style={{ background: C.primary }} /> {n.name}
          </button>
        ))}
      </div>
    </div>
  )
}

export function DesignerBottomToolbar(props: {
  readOnly: boolean
  paletteOpen: boolean
  onTogglePalette: () => void
  onUndo: () => void
  onRedo: () => void
  showMiniMap: boolean
  onToggleMiniMap: () => void
  onAutoLayout: () => void
  zoom: number
  pop: ToolbarPop
  onPop: (p: ToolbarPop) => void
  graphNodes: WfNode[]
  onSearchPick: (id: string) => void
  running: boolean
  onTryRun: () => void
}) {
  const {
    readOnly, paletteOpen, onTogglePalette, onUndo, onRedo, showMiniMap, onToggleMiniMap,
    onAutoLayout, zoom, pop, onPop, graphNodes, onSearchPick, running, onTryRun,
  } = props
  const rf = useReactFlow()
  return (
    <div className="absolute bottom-4 left-1/2 z-10 flex max-w-[95%] -translate-x-1/2 flex-wrap items-center justify-center gap-1 rounded-lg border bg-surface px-2 py-1.5 shadow-sm" data-testid="wf-bottom-toolbar" style={{ borderColor: C.cardBorder }}>
      {!readOnly && (
        <button className="rounded p-1.5 hover:bg-accent" title="节点面板开关" onClick={onTogglePalette}>
          {paletteOpen ? <PanelLeftClose className="size-4" style={{ color: C.ink2 }} /> : <PanelLeftOpen className="size-4" style={{ color: C.primary }} />}
        </button>
      )}
      {!readOnly && <span className="mx-1 h-4 w-px bg-border" />}
      {!readOnly && (
        <button className="rounded p-1.5 hover:bg-accent" title="撤销 (⌘Z)" onClick={onUndo}><Undo2 className="size-4" style={{ color: C.ink2 }} /></button>
      )}
      {!readOnly && (
        <button className="rounded p-1.5 hover:bg-accent" title="重做 (⌘⇧Z)" onClick={onRedo}><Redo2 className="size-4" style={{ color: C.ink2 }} /></button>
      )}
      <button className="rounded p-1.5 hover:bg-accent" title="缩略图" onClick={onToggleMiniMap}>
        <MapIcon className="size-4" style={{ color: showMiniMap ? C.primary : C.ink2 }} />
      </button>
      {!readOnly && (
        <button className="rounded p-1.5 hover:bg-accent" title="优化布局" onClick={onAutoLayout}>
          <LayoutTemplate className="size-4" style={{ color: C.ink2 }} />
        </button>
      )}
      <button className="rounded p-1.5 hover:bg-accent" title="适应画布" onClick={() => rf.fitView()}>
        <Crosshair className="size-4" style={{ color: C.ink2 }} />
      </button>
      <Popover open={pop === "zoom"} onOpenChange={(o) => onPop(o ? "zoom" : null)}>
        <PopoverTrigger asChild><button className="px-1 text-xs" style={{ color: C.ink2 }}>{Math.round(zoom * 100)}% ⌄</button></PopoverTrigger>
        <PopoverContent className="w-20 p-1">
          {[0.5, 0.75, 1, 1.25, 1.5].map((z) => (
            <button key={z} className="block w-full rounded px-2 py-0.5 text-xs hover:bg-accent" onClick={() => { rf.zoomTo(z); onPop(null) }}>{z * 100}%</button>
          ))}
        </PopoverContent>
      </Popover>
      <Popover open={pop === "search"} onOpenChange={(o) => onPop(o ? "search" : null)}>
        <PopoverTrigger asChild><button className="rounded p-1.5 hover:bg-accent" title="节点搜索"><Search className="size-4" style={{ color: C.ink2 }} /></button></PopoverTrigger>
        <PopoverContent className="w-56 p-2">
          <NodeSearch nodes={graphNodes} onPick={onSearchPick} />
        </PopoverContent>
      </Popover>
      {!readOnly && (
        <Button size="sm" className="rounded-md bg-primary text-primary-foreground hover:bg-brand-hover" disabled={running} onClick={onTryRun}>
          {running ? <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Play className="size-3.5" />} {running ? "运行中" : "试运行"}
        </Button>
      )}
    </div>
  )
}
