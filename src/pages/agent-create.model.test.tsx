// @vitest-environment jsdom
// 审计返工 P0-2（2026-09-10 二轮）：Agent 创建页模型选择守卫测试。
// 1) 模型 API 失败 → 不得静默使用未知默认值：创建按钮禁用 + 配置引导可见；
// 2) 模型列表为空 → 同上（不创建不可运行 Agent）；
// 3) 有模型但未选择 → 创建按钮仍禁用（无 models[0] 静默绑定）。
// 真实选择→payload→持久化→发布快照链由 scripts/evid_model_selection.mjs（10/10）在真浏览器+真后端验证。
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

const modelsFn = vi.fn()

vi.mock("@/services/wf-api", () => ({
  wfApi: { models: (...args: unknown[]) => modelsFn(...args) },
  agentApi: {
    modules: vi.fn(async () => ({ items: [] })),
    create: vi.fn(async () => ({ id: "should-not-be-called", name: "x" })),
    update: vi.fn(async () => ({})),
  },
  skillUpload: vi.fn(async () => ({ name: "s" })),
}))
vi.mock("@/services/resource-api", () => ({
  resApi: { registry: vi.fn(async () => ({ items: [] })) },
}))
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import AgentCreatePage from "./agent-create"

function renderCreatePage() {
  return render(
    <MemoryRouter initialEntries={["/agents/new?template=preset-frontend"]}>
      <AgentCreatePage />
    </MemoryRouter>,
  )
}

const findCreateButton = () =>
  screen.findAllByRole("button").then((bs) =>
    bs.find((b) => {
      const t = (b.textContent || "").trim()
      return t === "创建" || t.startsWith("创建中")
    }) ?? null,
  )

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("Agent 创建页模型守卫", () => {
  it("模型 API 失败：创建禁用 + 配置引导，不静默使用默认模型", async () => {
    modelsFn.mockRejectedValue(new Error("registry unavailable"))
    renderCreatePage()
    await waitFor(() => expect(screen.getByText(/尚无可用模型/)).toBeTruthy())
    const btn = await findCreateButton()
    expect(btn).toBeTruthy()
    expect((btn as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/设置·连接 或 资源·模型/)).toBeTruthy()
  })

  it("模型列表为空：创建禁用 + 引导（不创建不可运行 Agent）", async () => {
    modelsFn.mockResolvedValue([])
    renderCreatePage()
    await waitFor(() => expect(screen.getByText(/尚无可用模型/)).toBeTruthy())
    const btn = await findCreateButton()
    expect((btn as HTMLButtonElement).disabled).toBe(true)
  })

  it("有模型但未选择：填完名称后创建按钮仍禁用（无 models[0] 静默绑定）", async () => {
    modelsFn.mockResolvedValue([{ modelKey: "qwen3.8-max" }, { modelKey: "qwen-max" }])
    renderCreatePage()
    await waitFor(() => expect(screen.getByText("请选择模型")).toBeTruthy())
    // 填名称+描述（描述由模板预填），排除其它必填项干扰，单独验证模型守卫
    const nameInput = screen.getByPlaceholderText("请输入 Agent 名称")
    fireEvent.change(nameInput, { target: { value: "守卫测试 Agent" } })
    const btn = await findCreateButton()
    expect((btn as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByText(/尚无可用模型/)).toBeNull()
  })
})
