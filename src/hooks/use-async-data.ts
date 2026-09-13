import { useCallback, useEffect, useRef, useState } from "react"

interface AsyncDataState<T> {
  data: T | null
  loading: boolean
  error: string | null
}

/**
 * 轻量数据加载 hook：Loading / Error / Retry 统一形态。
 * mock service 模拟 server-side 行为，页面 API 保持 server-side 参数形态。
 *
 * 09-13 审计修复（eng#12）：deps 变化/卸载时真正 abort 在途请求（原来只拦
 * setState，底层 fetch 继续跑）。loader 可选接收 { signal }——传入
 * as-api/wf-api 的 req init 即可全链路取消；不接收 signal 的旧 loader 行为不变。
 */
export function useAsyncData<T>(
  loader: (opts?: { signal: AbortSignal }) => Promise<T>,
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
    const controller = new AbortController()
    let cancelled = false
    setState((prev) => ({ ...prev, loading: true, error: null }))
    Promise.resolve(loaderRef.current({ signal: controller.signal }))
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: null })
      })
      .catch((err: unknown) => {
        // 主动取消（切页/卸载/deps 变化）不视为业务错误
        if (cancelled || controller.signal.aborted) return
        setState({
          data: null,
          loading: false,
          error: err instanceof Error ? err.message : "加载失败",
        })
      })
    return () => {
      cancelled = true
      controller.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  const retry = useCallback(() => setNonce((n) => n + 1), [])

  return { ...state, retry }
}
