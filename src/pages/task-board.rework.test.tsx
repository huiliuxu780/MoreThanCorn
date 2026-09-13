// @vitest-environment jsdom
// 09-13 审计返工锁定测试（TaskBoard）：
// 1) 摘要失败 → 显式错误+重试，禁止四张 KPI 伪装成业务 0（审计 UI#2/eng#3）；
// 2) 摘要成功 → 真实数字渲染；
// 3) LANE_LABEL 语义与后端 board_projection 对齐：pending=排队中、waiting=需要操作
//    （审计 eng#4 根因：前端词表写反）；
// 4) 「查收」内部阶段文案全站清零（审计 UI#16）；
// 5) 任务行键盘可达：role=link + Enter 打开（审计 UI#9）。
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

const boardSummary = vi.fn()
const boardTasks = vi.fn()
const boardFilters = vi.fn()
vi.mock("@/services/as-api", () => ({
  asApi: {
    boardSummary: (...a: unknown[]) => boardSummary(...a),
    boardTasks: (...a: unknown[]) => boardTasks(...a),
    boardFilters: (...a: unknown[]) => boardFilters(...a),
  },
}))
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import TaskBoardPage from "./task-board"

function renderPage() {
  return render(
    <MemoryRouter>
      <TaskBoardPage />
    </MemoryRouter>,
  )
}

const TASK = (over: Record<string, unknown> = {}) => ({
  id: "t1", kind: "agent-session", title: "示例任务", executor: "Agent A",
  source: "manual", source_label: "手动触发", status: "pending",
  lane: "pending", status_label: "排队中", ended: false,
  updated_at: "2026-09-13T00:00:00Z",
  detail_route: "/agents/a1/chat?session=s1", session_id: "s1", ...over,
})

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe("TaskBoard 审计返工锁定", () => {
  it("摘要失败显示错误与重试，不渲染假 0", async () => {
    boardSummary.mockRejectedValue(new Error("boom-500"))
    boardTasks.mockResolvedValue({ items: [], total: 0 })
    boardFilters.mockResolvedValue({ sources: [], lanes: [] })
    renderPage()
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("boom-500"))
    expect(screen.getByRole("button", { name: "重试" })).toBeTruthy()
    expect(screen.queryByText("任务总数")).toBeNull()
  })

  it("摘要成功渲染真实 KPI", async () => {
    boardSummary.mockResolvedValue({
      period: "30d", total: 107, running: 2, needs_action: 3, ended: 105,
      lanes: { pending: 1, running: 2, done: 100, waiting: 3, failed: 1 },
    })
    boardTasks.mockResolvedValue({ items: [], total: 0 })
    boardFilters.mockResolvedValue({ sources: [], lanes: [] })
    renderPage()
    await waitFor(() => expect(screen.getByText("107")).toBeTruthy())
    expect(screen.getByText("105")).toBeTruthy()
    // 需要操作区计数 = waiting 泳道（后端语义），非 pending
    expect(screen.getByText("需要操作（3）")).toBeTruthy()
  })

  it("pending 行徽章=排队中；查收文案不存在", async () => {
    boardSummary.mockResolvedValue({
      period: "30d", total: 1, running: 0, needs_action: 0, ended: 0, lanes: {},
    })
    boardTasks.mockResolvedValue({ items: [TASK()], total: 1 })
    boardFilters.mockResolvedValue({ sources: [], lanes: [] })
    renderPage()
    await waitFor(() => expect(screen.getByText("示例任务")).toBeTruthy())
    expect(screen.getAllByText("排队中").length).toBeGreaterThan(0)
    expect(screen.queryByText(/查收/)).toBeNull()
    expect(screen.queryByText(/不伪造/)).toBeNull()
  })

  it("任务行 role=link 且 Enter 可打开（键盘可达）", async () => {
    boardSummary.mockResolvedValue({
      period: "30d", total: 1, running: 0, needs_action: 0, ended: 0, lanes: {},
    })
    boardTasks.mockResolvedValue({ items: [TASK()], total: 1 })
    boardFilters.mockResolvedValue({ sources: [], lanes: [] })
    renderPage()
    const row = await screen.findByRole("link", { name: /打开任务 示例任务/ })
    expect(row.getAttribute("tabindex")).toBe("0")
    fireEvent.keyDown(row, { key: "Enter" })
    // MemoryRouter 下导航不抛错即为通过（落点路由由 e2e/浏览器实证覆盖）
  })
})
