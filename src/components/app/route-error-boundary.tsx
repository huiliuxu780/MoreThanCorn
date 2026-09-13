import * as React from "react"
import { Button } from "@/components/ui/button"

interface Props {
  children: React.ReactNode
}
interface State {
  error: Error | null
  errorId: string
}

/**
 * 路由级 Error Boundary（09-13 审计修复 eng#14）。
 *
 * 页面渲染异常或懒加载 chunk 失效时局部兜底：不再整页白屏，提供
 * 重试（重置 boundary）/刷新（chunk 失效时拉新资源）与短错误编号
 * （console 有完整堆栈，编号用于把用户报告对回开发日志）。
 */
export class RouteErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, errorId: "" }

  static getDerivedStateFromError(error: Error): State {
    return { error, errorId: Math.random().toString(36).slice(2, 8).toUpperCase() }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[RouteErrorBoundary ${this.state.errorId}]`, error, info.componentStack)
  }

  render() {
    const { error, errorId } = this.state
    if (!error) return this.props.children
    const chunkLoad = /Loading chunk|dynamically imported module|Importing a module script failed|Failed to fetch/i
      .test(error.message)
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-10 text-center" role="alert">
        <div className="text-sm font-medium">
          {chunkLoad ? "页面资源已过期" : "页面渲染出错"}
        </div>
        <p className="max-w-md text-xs text-muted-foreground">
          {chunkLoad
            ? "应用可能刚发布了新版本，当前标签页持有的是旧资源。刷新即可加载最新页面。"
            : error.message.slice(0, 200)}
        </p>
        <p className="text-xs text-muted-foreground">错误编号：{errorId}</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline"
                  onClick={() => this.setState({ error: null, errorId: "" })}>
            重试
          </Button>
          <Button size="sm" onClick={() => window.location.reload()}>刷新页面</Button>
        </div>
      </div>
    )
  }
}
