/** NodePalette：左侧固定节点面板（07-SDD 08-26 决策：可折叠+搜索，替代底部 Popover）。
 *  PaletteGroups 为分组节点列表共用组件（左面板与节点卡快捷+共用，杜绝手搓两份）。
 *  Theme-R：面板表面=bg-surface，hover=bg-accent。 */
import { useState } from "react"
import { PanelLeftClose, PanelLeftOpen } from "lucide-react"
import { Input } from "@/components/ui/input"
import { C, NEUTRAL } from "@/components/wf/controls"
import type { NodeDefinition } from "@/services/wf-api"
import type { NodeFamily } from "../designer-types"
import { TypeIcon } from "../node-meta"

export function PaletteGroups({ families, onPick }: { families: NodeFamily[]; onPick: (t: string) => void }) {
  return (
    <>
      {families.map(([fam, list]) => (
        <div key={fam} className="py-1">
          <div className="px-1 pb-1 text-[11px] font-medium" style={{ color: C.ink2 }}>{fam}</div>
          {list.map((d) => (
            <button key={d.type_key} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-accent" style={{ color: C.ink }}
              onClick={() => onPick(d.type_key)}>
              <span className="flex size-4 shrink-0 items-center justify-center rounded" style={{ background: NEUTRAL }}>
                <TypeIcon type={d.type_key} className="size-2.5 text-background" />
              </span>
              {d.label}
            </button>
          ))}
        </div>
      ))}
    </>
  )
}

export function NodePalette({ families, onAdd, open, onToggle }: {
  families: NodeFamily[]; onAdd: (typeKey: string) => void
  open: boolean; onToggle: () => void
}) {
  const [kw, setQ] = useState("")
  if (!open) {
    return (
      <div className="flex w-10 shrink-0 flex-col items-center gap-1 border-r bg-surface py-2" style={{ borderColor: C.cardBorder }}>
        <button className="rounded p-1.5 hover:bg-accent" onClick={onToggle} title="展开节点面板">
          <PanelLeftOpen className="size-4" style={{ color: C.ink2 }} />
        </button>
      </div>
    )
  }
  const q = kw.trim()
  const fs = q
    ? families.map(([f, list]) => [f, list.filter((d) => d.label.includes(q) || f.includes(q) || d.type_key.includes(q))] as [string, NodeDefinition[]])
        .filter(([, l]) => l.length > 0)
    : families
  return (
    <div className="flex w-[224px] shrink-0 flex-col border-r bg-surface" style={{ borderColor: C.cardBorder }} data-testid="wf-palette">
      <div className="flex items-center gap-1 border-b p-2" style={{ borderColor: C.cardBorder }}>
        <Input className="h-7 flex-1 text-xs" placeholder="搜索节点" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="rounded p-1 hover:bg-accent" onClick={onToggle} title="折叠节点面板">
          <PanelLeftClose className="size-4" style={{ color: C.ink2 }} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {fs.length === 0 && <div className="px-1 py-2 text-[11px]" style={{ color: C.ink3 }}>无匹配节点</div>}
        <PaletteGroups families={fs} onPick={onAdd} />
      </div>
    </div>
  )
}
