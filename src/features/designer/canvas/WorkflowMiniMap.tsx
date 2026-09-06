/** WorkflowMiniMap：小地图（可拖可缩）。
 *  MiniMap 颜色走 SVG attribute 语境，var() 不可用——按 resolvedTheme 取 MINIMAP_THEME 具体值
 *  （与 --wf-* token 同源同值，见 theme/workflow-theme.ts）。 */
import { MiniMap } from "@xyflow/react"
import { MINIMAP_THEME, useUiTheme } from "../theme/workflow-theme"

export function WorkflowMiniMap() {
  const ui = useUiTheme()
  const t = MINIMAP_THEME[ui]
  return (
    <MiniMap pannable zoomable
      nodeColor={() => t.node} nodeStrokeColor={() => t.stroke} maskColor={t.mask}
      className="!bottom-16 !left-1/2 !-translate-x-1/2 !rounded-md !border !border-border"
      style={{ width: 180, height: 110, background: t.bg }} />
  )
}
