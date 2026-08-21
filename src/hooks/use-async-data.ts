import { useCallback, useEffect, useRef, useState } from "react"

interface AsyncDataState<T> {
  data: T | null
  loading: boolean
  error: string | null
}

/**
 * 轻量数据加载 hook：Loading / Error / Retry 统一形态。
 * mock service 模拟 server-side 行为，页面 API 保持 server-side 参数形态。
 */
export function useAsyncData<T>(
  loader: () => Promise<T>,
  deps: unknown[],
): AsyncDataState<T> & { retry: () => void } {
  const [state, setState] = useState<AsyncDataState<T>>({
    data: null,
    loading: true,
    error: null,
  })
  const [nonce, setNonce] = useState(0)
  const loaderRef = useRef(loader)
  loaderRef.current = loader

  useEffect(() => {
    let cancelled = false
    setState((prev) => ({ ...prev, loading: true, error: null }))
    loaderRef
      .current()
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: null })
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setState({
            data: null,
            loading: false,
            error: err instanceof Error ? err.message : "加载失败",
          })
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  const retry = useCallback(() => setNonce((n) => n + 1), [])

  return { ...state, retry }
}
