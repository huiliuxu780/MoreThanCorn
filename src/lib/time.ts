import { format } from "date-fns"
import { ENTERPRISE_CONFIG } from "@/config/enterprise"

/**
 * Implementation Spec §5：UTC 存储、企业时区展示。
 * 原型内 mock 时间已是企业时区字面量，直接格式化。
 */
export function formatDateTime(value?: string, withSeconds = false): string {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return format(date, withSeconds ? "yyyy-MM-dd HH:mm:ss" : "yyyy-MM-dd HH:mm")
}

/** 列表页紧凑时间：08-18 10:32。 */
export function formatCompactDateTime(value?: string): string {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return format(date, "MM-dd HH:mm")
}

/** Implementation Spec §5.3：紧凑 duration。 */
export function formatDuration(input?: string | number): string {
  if (input === undefined || input === null || input === "") return "—"
  if (typeof input === "string") return input
  const ms = input
  if (ms < 1000) return `${ms}ms`
  const totalSeconds = Math.round(ms / 1000)
  if (totalSeconds < 60) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) {
    return seconds > 0 ? `${minutes}m ${String(seconds).padStart(2, "0")}s` : `${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  return restMinutes > 0 ? `${hours}h ${restMinutes}m` : `${hours}h`
}

/** 通话时长：12m 48s。 */
export function formatCallDuration(seconds?: number): string {
  if (seconds === undefined) return ""
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes === 0) return `${rest}s`
  return `${minutes}m ${String(rest).padStart(2, "0")}s`
}

export function formatSeconds(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

export const ENTERPRISE_TIMEZONE_LABEL = ENTERPRISE_CONFIG.timezone
