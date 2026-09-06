/** 设计器内 Toast（16 §9：顶居中，语义色边+软底，2.5s 自隐）。
 *  Theme-R：颜色全部由 status token 派生，双主题成立。 */
import { useEffect, useState } from "react"
import { CheckCircle2, CircleAlert } from "lucide-react"

let toastFn: ((kind: "error" | "success", msg: string) => void) | null = null

export const toast = {
  error: (msg: string, _opts?: unknown) => toastFn?.("error", msg),
  success: (msg: string, _opts?: unknown) => toastFn?.("success", msg),
}

export function ToastHost() {
  const [t, setT] = useState<{ kind: "error" | "success"; msg: string; key: number } | null>(null)
  useEffect(() => {
    toastFn = (kind, msg) => setT({ kind, msg, key: Date.now() })
    return () => { toastFn = null }
  }, [])
  useEffect(() => {
    if (!t) return
    const h = window.setTimeout(() => setT(null), 2500)
    return () => window.clearTimeout(h)
  }, [t])
  if (!t) return null
  const err = t.kind === "error"
  return (
    <div className="pointer-events-none fixed left-1/2 top-4 z-[100] -translate-x-1/2">
      <div className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs shadow-sm"
        style={{
          borderColor: err ? "var(--status-danger)" : "var(--status-success)",
          background: err ? "var(--status-danger-soft)" : "var(--status-success-soft)",
          color: err ? "var(--status-danger)" : "var(--status-success)",
        }}>
        {err ? <CircleAlert className="size-3.5" /> : <CheckCircle2 className="size-3.5" />} {t.msg}
      </div>
    </div>
  )
}
