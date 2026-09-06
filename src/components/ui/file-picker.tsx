/** 标准附件选择器（09-07）：隐藏原生 input[type=file] 收口于 ui 层，页面禁止裸 input（check-ui-standard）。 */
import { useRef, type ReactNode } from "react"
import { cn } from "@/lib/utils"

export function FilePicker({ onPick, accept, ariaLabel, className, children }: {
  onPick: (file: File) => void
  accept?: string
  ariaLabel: string
  className?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      className={cn("cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:bg-(--segment-bg)", className)}
      onClick={() => ref.current?.click()}
    >
      {children}
      <input ref={ref} type="file" accept={accept} className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = "" }} />
    </button>
  )
}
