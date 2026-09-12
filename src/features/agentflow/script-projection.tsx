import type { ReactNode } from "react"

/**
 * 脚本编排画布投影（16号稿 §9）：服务端 ast 固化的 meta.projection 渲染为只读阶段卡。
 * 运行态通过 statusOf 叠加节点状态；所有卡片可点击跳回脚本对应行（不做反向编辑）。
 */

export interface ProjectionItem {
  type: "worker" | "ask_user" | "log" | "parallel"
  label: string
  line: number
  items?: ProjectionItem[]
}

export interface ProjectionPhase {
  type: "phase"
  title: string
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

const KIND_TEXT: Record<string, string> = {
  worker: "执行",
  ask_user: "用户决策",
  parallel: "并行",
}

function ItemCard({
  item,
  statusOf,
  onJump,
}: {
  item: ProjectionItem
  statusOf?: (label: string) => string | undefined
  onJump?: (line: number) => void
}) {
  if (item.type === "log") {
    return (
      <button
        type="button"
        onClick={() => onJump?.(item.line)}
        className="block w-full truncate text-left text-[11px] text-muted-foreground hover:underline"
      >
        · log
      </button>
    )
  }
  const st = statusOf?.(item.label)
  const tone = st ? statusTone(st) : null
  return (
    <button
      type="button"
      onClick={() => onJump?.(item.line)}
      className="block w-full rounded-md border bg-background px-2 py-1.5 text-left transition-colors hover:border-brand/60"
      style={{ borderColor: st === "failed" ? "var(--status-danger)" : "var(--border)" }}
    >
      <span className="block truncate text-xs font-medium">{item.label}</span>
      <span className="mt-1 flex items-center gap-1">
        <span className="text-[10px] text-muted-foreground">{KIND_TEXT[item.type] ?? item.type}</span>
        {st && (
          <span
            className="ml-auto rounded px-1 py-0.5 text-[10px] font-medium"
            style={{ background: tone?.bg, color: tone?.fg }}
          >
            {st}
          </span>
        )}
      </span>
    </button>
  )
}

export function ScriptProjection({
  projection,
  statusOf,
  onJump,
  emptyHint = "保存脚本后自动生成画布投影",
}: {
  projection: ProjectionPhase[]
  statusOf?: (label: string) => string | undefined
  onJump?: (line: number) => void
  emptyHint?: ReactNode
}) {
  return (
    <div
      className="flex min-h-0 flex-1 items-start gap-4 overflow-auto p-6"
      style={{ background: "var(--surface-muted)" }}
    >
      {projection.length === 0 ? (
        <div className="mx-auto max-w-md rounded-lg border border-dashed bg-surface p-8 text-center text-sm text-muted-foreground">
          {emptyHint}
        </div>
      ) : (
        projection.map((ph, i) => (
          <div key={`${ph.title}-${i}`} className="flex items-start gap-3">
            {i > 0 && (
              <span className="mt-20 shrink-0 text-muted-foreground" aria-hidden>
                →
              </span>
            )}
            <div
              className="w-[240px] shrink-0 rounded-lg border bg-surface p-3 shadow-sm"
              style={{ borderColor: "var(--border)", borderRadius: "8px" }}
            >
              <div className="text-[11px] font-medium" style={{ color: "var(--text-tertiary)" }}>
                阶段 {String(i + 1).padStart(2, "0")}
              </div>
              <button
                type="button"
                className="mt-0.5 block w-full truncate text-left text-sm font-medium hover:underline"
                onClick={() => onJump?.(ph.line)}
                title={`跳到脚本第 ${ph.line} 行`}
              >
                {ph.title}
              </button>
              <div className="mt-2 space-y-2">
                {ph.items.map((it, j) =>
                  it.type === "parallel" ? (
                    <div
                      key={`${it.label}-${j}`}
                      className="rounded-md border border-dashed p-2"
                      style={{ borderColor: "var(--border)" }}
                    >
                      <button
                        type="button"
                        className="text-[11px] text-muted-foreground hover:underline"
                        onClick={() => onJump?.(it.line)}
                      >
                        {it.label}
                      </button>
                      <div className="mt-1.5 space-y-1.5">
                        {(it.items ?? []).map((w, k) => (
                          <ItemCard key={`${w.label}-${k}`} item={w} statusOf={statusOf} onJump={onJump} />
                        ))}
                      </div>
                    </div>
                  ) : (
                    <ItemCard key={`${it.label}-${j}`} item={it} statusOf={statusOf} onJump={onJump} />
                  ),
                )}
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  )
}
