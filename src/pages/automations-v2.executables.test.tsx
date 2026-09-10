// @vitest-environment jsdom
// 审计返工 P0-1（2026-09-10 二轮）：自动任务创建弹窗的可执行对象组件测试。
// 1) 默认执行者=第一个 executable Agent，草稿（executable=false）不进入选择器数据；
// 2) 无可执行 Agent 时：空态+发布引导可见，保存按钮禁用（空列表不能提交）；
// 3) 切换 workflow/agentflow 后空态各自可见。
// 选择器过滤语义的完整矩阵在 src/lib/executable-targets.test.ts；
// 后端同语义 422 在 server/tests/test_audit_executability.py。
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

// Radix Select 在 jsdom 缺失的 pointer capture API
beforeAllShims()
function beforeAllShims() {
  if (typeof Element !== "undefined") {
    Element.prototype.hasPointerCapture ??= () => false
    Element.prototype.setPointerCapture ??= () => undefined
    Element.prototype.releasePointerCapture ??= () => undefined
  }
}

const agentList = vi.fn()
const wfList = vi.fn()
const flowsList = vi.fn()

vi.mock("@/services/wf-api", () => ({
  agentApi: { list: (...args: unknown[]) => agentList(...args) },
  wfApi: { list: (...args: unknown[]) => wfList(...args) },
}))
vi.mock("@/services/as-api", () => ({
  asApi: {
    automations: vi.fn(async () => ({ items: [], total: 0 })),
    flows: (...args: unknown[]) => flowsList(...args),
    sources: vi.fn(async () => ({ items: [] })),
    createAutomation: vi.fn(async () => ({ id: "should-not-be-called" })),
    setEnabled: vi.fn(async () => ({})),
  },
}))
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import AutomationsPage from "./automations-v2"

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/autonomous-tasks"]}>
      <AutomationsPage />
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("自动任务创建弹窗：可执行对象", () => {
  it("默认执行者=第一个 executable Agent；草稿不出现在触发器", async () => {
    agentList.mockResolvedValue({
      items: [
        { id: "draft-1", name: "数据分析师", executable: false, archived: false },
        { id: "prod-1", name: "业务分析-通话打标", executable: true, archived: false },
      ],
      total: 2,
    })
    wfList.mockResolvedValue({ items: [{ id: "w-draft", name: "草稿WF", status: "draft" }], total: 1 })
    flowsList.mockResolvedValue({ items: [{ id: "f-1", name: "无发布流程", active_release_id: null }] })
    renderPage()
    fireEvent.click(await screen.findByRole("button", { name: /新建自动任务/ }))
    await waitFor(() => expect(screen.getByText("执行对象 *")).toBeTruthy())
    // 默认预选第一个 executable（触发器显示其名）；草稿名不出现
    await waitFor(() => expect(screen.getByText("业务分析-通话打标")).toBeTruthy())
    expect(screen.queryByText("数据分析师")).toBeNull()
    // Agent 目标未填执行指令 → 保存禁用（不能提交不完整目标）
    const save = screen.getByRole("button", { name: "保存" })
    expect((save as HTMLButtonElement).disabled).toBe(true)
  })

  it("无可执行 Agent：空态+发布引导可见，保存禁用", async () => {
    agentList.mockResolvedValue({
      items: [{ id: "draft-1", name: "数据分析师", executable: false, archived: false }],
      total: 1,
    })
    wfList.mockResolvedValue({ items: [], total: 0 })
    flowsList.mockResolvedValue({ items: [] })
    renderPage()
    fireEvent.click(await screen.findByRole("button", { name: /新建自动任务/ }))
    const empty = await screen.findByTestId("empty-exec-agent")
    expect(empty.textContent).toContain("暂无可执行 Agent")
    expect(empty.textContent).toContain("active prod Release")
    // 草稿对象不得被回填为默认值
    expect(screen.queryByText("数据分析师")).toBeNull()
    // 填了名称也不能提交（无执行对象）；名称输入 = 弹窗第一个 textbox
    const nameInput = screen.getAllByRole("textbox")[0]
    fireEvent.change(nameInput, { target: { value: "测试自动任务" } })
    const save = screen.getByRole("button", { name: "保存" })
    expect((save as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByText("Agent 管理")).toBeTruthy() // 发布引导链接
  })

  it("Workflow / AgentFlow 空列表分别显示空态引导", async () => {
    agentList.mockResolvedValue({ items: [], total: 0 })
    wfList.mockResolvedValue({ items: [{ id: "w-draft", name: "草稿WF", status: "draft" }], total: 1 })
    flowsList.mockResolvedValue({ items: [{ id: "f-1", name: "无发布流程", active_release_id: null }] })
    renderPage()
    fireEvent.click(await screen.findByRole("button", { name: /新建自动任务/ }))
    await screen.findByTestId("empty-exec-agent")
    fireEvent.click(screen.getByText("运行 Workflow"))
    const wfEmpty = await screen.findByTestId("empty-exec-workflow")
    expect(wfEmpty.textContent).toContain("暂无已发布 Workflow")
    expect(screen.queryByText("草稿WF")).toBeNull()
    fireEvent.click(screen.getByText("运行 AgentFlow"))
    const flowEmpty = await screen.findByTestId("empty-exec-agentflow")
    expect(flowEmpty.textContent).toContain("暂无有 active Release 的 AgentFlow")
    expect(screen.queryByText("无发布流程")).toBeNull()
  })
})
