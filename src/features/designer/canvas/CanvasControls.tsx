/** CanvasControls：画布左下角缩放控件（适应画布/放大/缩小/百分比）。 */
import { Crosshair, ZoomIn, ZoomOut } from "lucide-react"
import { Panel, useReactFlow } from "@xyflow/react"
import { C } from "@/components/wf/controls"

export function CanvasControls({ zoom }: { zoom: number }) {
  const rf = useReactFlow()
  return (
    <Panel position="bottom-left" className="!bottom-4 !left-4 flex items-center gap-1 rounded-lg border bg-surface px-1.5 py-1 shadow-sm" style={{ borderColor: C.cardBorder }}>
      <button className="rounded p-1 hover:bg-accent" title="适应画布" onClick={() => rf.fitView({ padding: 0.25, maxZoom: 0.9 })}><Crosshair className="size-4" style={{ color: C.ink2 }} /></button>
      <button className="rounded p-1 hover:bg-accent" title="放大" onClick={() => rf.zoomIn()}><ZoomIn className="size-4" style={{ color: C.ink2 }} /></button>
      <button className="rounded p-1 hover:bg-accent" title="缩小" onClick={() => rf.zoomOut()}><ZoomOut className="size-4" style={{ color: C.ink2 }} /></button>
      <span className="px-1 text-[11px]" style={{ color: C.ink3 }}>{Math.round(zoom * 100)}%</span>
    </Panel>
  )
}
