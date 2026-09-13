// @vitest-environment jsdom
// 09-13 审计返工锁定测试（Connections）：
// 1) 列表失败 → 错误态+重试，不再只结束 loading（审计 eng#7）；
// 2) 搜索走服务端 params（防抖后 connections 以 search 调用），不再只过滤当前页
//    （审计 eng#9）；
// 3) 协议 tab 计数来自全量拉取（pageSize=200），后页协议不再消失（审计 eng#10）；
// 4) 行内操作按钮键盘聚焦可见（focus-visible 类，审计 UI#6）。
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

const connections = vi.fn()
vi.mock("@/services/wf-api", () => ({
  pagedApi: { connections: (...a: unknown[]) => connections(...a) },
}))
vi.mock("@/services/resource-api", () => ({
  connApi: {
    list: vi.fn(async () => ({ items: [], total: 0 })),
    test: vi.fn(), update: vi.fn(), rotateSecret: vi.fn(),
    clearSecret: vi.fn(), del: vi.fn(), get: vi.fn(),
  },
}))
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { WfConnectionsContent } from "./wf-connections"

const CONN = (over: Record<string, unknown> = {}) => ({
  id: "c1", name: "订单网关", kind: "api_key", protocol: "http-api",
  endpoint: { base_url: "https://gw" }, status: "active",
  secretConfigured: true, lifecycle: "active", health: "healthy", ...over,
})

function renderPage() {
  return render(
    <MemoryRouter>
      <WfConnectionsContent />
    </MemoryRouter>,
  )
}

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe("Connections 审计返工锁定", () => {
  it("加载失败显示错误态与重试", async () => {
    connections.mockRejectedValue(new Error("gw-down"))
    renderPage()
    await waitFor(() =>
      expect(screen.getByText(/连接加载失败/)).toBeTruthy())
    expect(screen.getByRole("button", { name: /重新加载/ })).toBeTruthy()
  })

  it("搜索防抖后走服务端 search 参数", async () => {
    connections.mockResolvedValue({ items: [CONN()], total: 1 })
    renderPage()
    await waitFor(() => expect(connections).toHaveBeenCalled())
    const input = screen.getByLabelText("搜索 Connection")
    fireEvent.change(input, { target: { value: "订单" } })
    await waitFor(() => {
      const calls = connections.mock.calls.map((c) => c[0]?.search)
      expect(calls).toContain("订单")
    }, { timeout: 2000 })
  })

  it("协议 tab 计数来自全量拉取（后页协议不消失）", async () => {
    connections.mockImplementation(async (p: { pageSize?: number }) => {
      if ((p?.pageSize ?? 0) >= 200) {
        // 全量计数拉取：含当前页没有的 postgresql 协议
        return { items: [CONN(), CONN({ id: "c2", name: "数仓", protocol: "postgresql" })], total: 2 }
      }
      return { items: [CONN()], total: 2 }  // 当前页只有 http-api
    })
    renderPage()
    await waitFor(() =>
      expect(screen.getByText(/PostgreSQL \(1\)/)).toBeTruthy())
  })

  it("行内操作按钮带 focus-visible 可见性类", async () => {
    connections.mockResolvedValue({ items: [CONN()], total: 1 })
    renderPage()
    const edit = await screen.findByRole("button", { name: "编辑" })
    expect(edit.className).toContain("focus-visible:opacity-100")
    expect(edit.className).toContain("group-focus-within:opacity-100")
  })
})
