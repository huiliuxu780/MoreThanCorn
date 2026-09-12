import type { ReactNode } from "react"
import { Maximize2, ZoomIn, ZoomOut } from "lucide-react"
import { useState } from "react"

/**
 * 脚本编排画布投影（16号稿 §9）：服务端 ast 固化的 meta.projection 渲染为只读阶段卡。
 * 运行态通过 statusOf 叠加节点状态；所有卡片可点击跳回脚本对应行（不做反向编辑）。
 *
 * 视觉对齐 wake 原站实测台账（2026-09-12）：阶段卡 264px/padding 16-12/radius 8、
 * worker/askUser 灰底内卡（249,249,249/6px/8-10px）+ 19px 圆头像 + 12px 灰名字、
 * askUser 带金色 icon、画布不渲染 log、parallel 不分组框、点阵背景、左下缩放控件。
 * 有意差异（设计决策登记）：运行态状态 chip 叠加；无铅笔编辑钮（我方画布只读，编辑走脚本视图）。
 */

export interface ProjectionItem {
  type: "worker" | "ask_user"
  label: string
  line: number
  waker?: string | null
}

export interface ProjectionPhase {
  type: "phase"
  title: string
  detail?: string
  line: number
  items: ProjectionItem[]
}

function statusTone(status: string): { bg: string; fg: string } {
  if (status === "succeeded") return { bg: "var(--status-success-soft)", fg: "var(--status-success)" }
  if (status === "failed") return { bg: "var(--status-danger-soft)", fg: "var(--status-danger)" }
  if (status === "running" || status === "waiting")
    return { bg: "var(--status-running-soft)", fg: "var(--status-running)" }
  return { bg: "var(--fill-tertiary)", fg: "var(--text-tertiary)" }
}

function ItemCard({
  item,
  statusOf,
  onJump,
  resolveAgent,
}: {
  item: ProjectionItem
  statusOf?: (label: string) => string | undefined
  onJump?: (line: number) => void
  resolveAgent?: (wakerId: string) => { name: string; avatar: string } | undefined
}) {
  const st = statusOf?.(item.label)
  const tone = st ? statusTone(st) : null
  const agent = item.type === "worker" && item.waker ? resolveAgent?.(item.waker) : undefined
  return (
    <button
      type="button"
      onClick={() => onJump?.(item.line)}
      className="block w-full cursor-pointer rounded-md px-2.5 py-2 text-left transition-colors hover:brightness-[0.98]"
      style={{
        background: "var(--fill-secondary, rgb(249,249,249))",
        borderRadius: "6px",
        border: st === "failed" ? "1px solid var(--status-danger)" : "1px solid transparent",
      }}
    >
      <span className="block truncate text-[13px] leading-6 font-medium text-foreground">
        {item.label}
      </span>
      {item.type === "ask_user" ? (
        <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
          <span aria-hidden>💰</span> 用户决策
        </span>
      ) : (
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5">
          {agent ? (
            <>
              <img
                src={agent.avatar}
                alt=""
                className="size-[19px] shrink-0 rounded-full object-cover"
              />
              <span className="truncate text-xs text-muted-foreground">{agent.name}</span>
            </>
          ) : (
            <span className="truncate text-xs text-muted-foreground">执行</span>
          )}
        </span>
      )}
      {st && (
        <span
          className="absolute right-1.5 top-1.5 rounded px-1 py-0.5 text-[10px] font-medium"
          style={{ background: tone?.bg, color: tone?.fg }}
        >
          {st}
        </span>
      )}
    </button>
  )
}

export function ScriptProjection({
  projection,
  statusOf,
  onJump,
  resolveAgent,
  emptyHint = "保存脚本后自动生成画布投影",
}: {
  projection: ProjectionPhase[]
  statusOf?: (label: string) => string | undefined
  onJump?: (line: number) => void
  resolveAgent?: (wakerId: string) => { name: string; avatar: string } | undefined
  emptyHint?: ReactNode
}) {
  const [zoom, setZoom] = useState(1)
  const zoomGroup = (
    <div className="absolute bottom-4 left-4 z-10 flex flex-col items-center gap-1 rounded-md border bg-surface p-1 shadow-sm">
      <button
        type="button"
        aria-label="适应"
        className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={() => setZoom(1)}
      >
        <Maximize2 className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label="缩小"
        className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.1).toFixed(1)))}
      >
        <ZoomOut className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label="放大"
        className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={() => setZoom((z) => Math.min(1.6, +(z + 0.1).toFixed(1)))}
      >
        <ZoomIn className="size-3.5" />
      </button>
    </div>
  )
  return (
    <div
      className="relative min-h-0 flex-1 overflow-auto"
      style={{
        background:
          "radial-gradient(circle, rgba(0,0,0,0.07) 1px, transparent 1px) 0 0 / 16px 16px var(--surface-muted, #fafafa)",
      }}
    >
      {projection.length === 0 ? (
        <div className="mx-auto max-w-md rounded-lg border border-dashed bg-surface p-8 text-center text-sm text-muted-foreground">
          {emptyHint}
        </div>
      ) : (
        <div
          className="flex min-h-full w-max items-start gap-3 p-6"
          style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}
        >
          {projection.map((ph, i) => (
            <div key={`${ph.title}-${i}`} className="flex items-start gap-3">
              {i > 0 && (
                <span
                  aria-hidden
                  className="mt-[104px] h-px w-6 shrink-0"
                  style={{ background: "var(--border)" }}
                />
              )}
              <div
                className="w-[264px] shrink-0 border bg-surface p-4 pl-3 shadow-sm transition-colors hover:border-brand/70"
                style={{ borderColor: "var(--border)", borderRadius: "8px" }}
                onClick={() => onJump?.(ph.line)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    onJump?.(ph.line)
                  }
                }}
                title={`跳到脚本第 ${ph.line} 行`}
              >
                <div className="text-xs leading-[18px]" style={{ color: "var(--text-tertiary)" }}>
                  阶段 {String(i + 1).padStart(2, "0")}
                </div>
                <div className="mt-0.5 truncate text-sm leading-[18px] font-medium text-foreground">
                  {ph.title}
                </div>
                {ph.detail && (
                  <p className="mt-1 line-clamp-2 text-xs leading-[18px] text-muted-foreground">
                    {ph.detail}
                  </p>
                )}
                <div className="mt-2 space-y-2">
                  {ph.items.map((it, j) => (
                    <div key={`${it.label}-${j}`} className="relative">
                      <ItemCard
                        item={it}
                        statusOf={statusOf}
                        onJump={onJump}
                        resolveAgent={resolveAgent}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {projection.length > 0 && zoomGroup}
    </div>
  )
}
