import { useCallback, useMemo } from "react"
import { useSearchParams } from "react-router-dom"
import type { ListParams } from "@/domain/types"

/**
 * URL Query 为列表状态唯一事实来源（Implementation Spec §4.2）。
 * search / filters / sort / tab 变化时自动回到第一页（§4.3）。
 */
export function useListQuery(defaultPageSize = 20) {
  const [searchParams, setSearchParams] = useSearchParams()

  const params: ListParams = useMemo(
    () => ({
      search: searchParams.get("search") ?? "",
      page: Number(searchParams.get("page") ?? 1) || 1,
      pageSize: Number(searchParams.get("pageSize") ?? defaultPageSize) || defaultPageSize,
      sort: searchParams.get("sort") ?? "",
      filters: searchParams.get("filters") ?? "",
      tab: searchParams.get("tab") ?? "",
    }),
    [searchParams, defaultPageSize],
  )

  const update = useCallback(
    (updates: Partial<ListParams>, resetPage = false) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          const shouldResetPage =
            resetPage ||
            Object.keys(updates).some((key) =>
              ["search", "filters", "sort", "tab", "pageSize"].includes(key),
            )
          for (const [key, value] of Object.entries(updates)) {
            if (value === "" || value === undefined || value === null) {
              next.delete(key)
            } else {
              next.set(key, String(value))
            }
          }
          if (shouldResetPage) {
            next.delete("page")
          }
          return next
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  const queryString = searchParams.toString()

  return { params, update, queryString, searchParams }
}
