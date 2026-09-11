/** 深度思考真折叠卡（09-11 批8：beUI line-clamp 式 collapsible 对短思考「收起=展开」观感失效
 *  且无 icon → 换真 show/hide 折叠 + 深度思考 icon（Sparkles）+ 流式流光标题）。 */
import * as React from "react"
import { ChevronDown, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"

export function ThinkingShimmer({ children }: { children: React.ReactNode }) {
  return <span className="animate-pulse">{children}</span>
}

export function ThinkingCollapse({
  loading = false,
  content,
  defaultOpen = false,
  maxHeight = 160,
}: {
  loading?: boolean
  content: string
  defaultOpen?: boolean
  maxHeight?: number
}) {
  const [open, setOpen] = React.useState(defaultOpen || loading)
  const ref = React.useRef<HTMLDivElement>(null)
  // 流式期间贴底跟随
  React.useEffect(() => {
    if (loading && open && ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [content, loading, open])
  return (
    <div className="w-full rounded-lg border bg-(--segment-bg)">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Sparkles
          className={cn("size-3.5 shrink-0", loading ? "animate-pulse text-(--status-running)" : "text-(--status-success)")}
          aria-hidden
        />
        <span className={cn(loading && "animate-pulse")}>
          {loading ? "深度思考…" : "深度思考"}
        </span>
        <ChevronDown
          className={cn("ml-auto size-3.5 shrink-0 transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>
      {open && (
        <div
          ref={ref}
          className="overflow-y-auto border-t px-2.5 py-2 whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground"
          style={{ maxHeight }}
        >
          {content || "…"}
        </div>
      )}
    </div>
  )
}
