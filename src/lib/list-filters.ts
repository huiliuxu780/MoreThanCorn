/**
 * filters query 编解码：`key:value,key2:value2`。
 * Implementation Spec §4.1：列表页统一使用 search / page / pageSize / sort / filters / tab。
 */
export type FilterMap = Record<string, string>

export function parseListFilters(raw?: string): FilterMap {
  const result: FilterMap = {}
  if (!raw) return result
  for (const part of raw.split(",")) {
    const idx = part.indexOf(":")
    if (idx <= 0) continue
    const key = decodeURIComponent(part.slice(0, idx))
    const value = decodeURIComponent(part.slice(idx + 1))
    if (key && value) result[key] = value
  }
  return result
}

export function serializeListFilters(filters: FilterMap): string {
  return Object.entries(filters)
    .filter(([, value]) => value !== "" && value !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}:${encodeURIComponent(value)}`)
    .join(",")
}
