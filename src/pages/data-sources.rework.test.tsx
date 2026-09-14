// @vitest-environment jsdom
// 09-13 审计返工锁定测试（DataSources）：
// 1) P0：轮询类型出现 URL/间隔/游标字段；缺 URL 拒绝提交；合法输入按后端
//    tick_poll_source 真实消费的 config 形状提交（原表单只发 {mapping} 必然 422）；
// 2) P0：映射方向文案 = 「触发输入键 → payload 取值路径」（与 _apply_mapping 一致）；
// 3) 列表失败 → 错误态+重试，不再伪装「暂无数据源」（审计 eng#8）；
// 4) webhook token 一次性交付：复制按钮 + 丢失后果强提醒（审计 UI#12）。
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

// Radix Select jsdom pointer capture shims（同 automations-v2 测试）
if (typeof Element !== "undefined") {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => undefined
  Element.prototype.releasePointerCapture ??= () => undefined
}
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof globalThis.ResizeObserver
}

const sources = vi.fn()
const createSource = vi.fn()
const testEvent = vi.fn()
const pollSource = vi.fn()
vi.mock("@/services/as-api", () => ({
  asApi: {
    sources: (...a: unknown[]) => sources(...a),
    createSource: (...a: unknown[]) => createSource(...a),
    testEvent: (...a: unknown[]) => testEvent(...a),
    pollSource: (...a: unknown[]) => pollSource(...a),
  },
}))
const toastError = vi.fn()
const toastSuccess = vi.fn()
vi.mock("sonner", () => ({
  toast: { error: (...a: unknown[]) => toastError(...a),
           success: (...a: unknown[]) => toastSuccess(...a) },
}))
vi.mock("@/hooks/use-async-data", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/use-async-data")>(
    "@/hooks/use-async-data")
  return actual
})

import DataSourcesPage from "./data-sources"

afterEach(() => { cleanup(); vi.clearAllMocks() })

async function openCreate() {
  fireEvent.click(await screen.findByRole("button", { name: /新建数据源/ }))
  await screen.findByRole("dialog")
}

async function pickKind(label: string) {
  const trigger = screen.getByRole("combobox")
  // Radix Select jsdom：需要 pointerType=mouse 的 pointerdown 才开面板
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" })
  fireEvent.click(await screen.findByRole("option", { name: new RegExp(label) }))
}

describe("DataSources 审计返工锁定", () => {
  it("轮询表单补全 config 字段并按后端契约提交", async () => {
    sources.mockResolvedValue({ items: [] })
    createSource.mockResolvedValue({ id: "src-1" })
    render(<MemoryRouter><DataSourcesPage /></MemoryRouter>)
    await openCreate()
    await pickKind("API（拉取）")
    // P0：轮询专属字段必须出现
    await waitFor(() => expect(document.querySelector("#ds-url")).toBeTruthy())
    expect(document.querySelector("#ds-interval")).toBeTruthy()
    expect(document.querySelector("#ds-cursor-field")).toBeTruthy()
    expect(document.querySelector("#ds-cursor-param")).toBeTruthy()
    // 映射方向文案（P0：与后端 key→path 语义一致）
    expect(screen.getByText(/触发输入键 → payload/)).toBeTruthy()

    fireEvent.change(document.querySelector("#ds-name")!, { target: { value: "轮询源A" } })
    // 缺 URL → 拒绝提交
    fireEvent.click(screen.getByRole("button", { name: "保存" }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(
      expect.stringContaining("http(s)://")))
    expect(createSource).not.toHaveBeenCalled()
    // 合法输入 → 按 tick_poll_source 消费的形状提交
    fireEvent.change(document.querySelector("#ds-url")!,
                       { target: { value: "https://example.internal/api/tickets" } })
    fireEvent.change(document.querySelector("#ds-interval")!, { target: { value: "120" } })
    fireEvent.click(screen.getByRole("button", { name: "保存" }))
    await waitFor(() => expect(createSource).toHaveBeenCalledTimes(1))
    const body = createSource.mock.calls[0][0]
    expect(body.kind).toBe("api_pull")
    expect(body.config.url).toBe("https://example.internal/api/tickets")
    expect(body.config.interval_seconds).toBe(120)
    expect(body.config.cursor_field).toBe("id")
    expect(body.config.cursor_param).toBe("after")
    expect(body.config.mapping).toEqual({ value: "body.text" })
  })

  it("列表失败显示错误态与重试，不再伪装暂无数据源", async () => {
    sources.mockRejectedValue(new Error("net-down"))
    render(<MemoryRouter><DataSourcesPage /></MemoryRouter>)
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("net-down"))
    expect(screen.getByRole("button", { name: /重试/ })).toBeTruthy()
    expect(screen.queryByText(/暂无数据源/)).toBeNull()
  })

  it("webhook token 一次性交付：复制按钮+丢失强提醒", async () => {
    sources.mockResolvedValue({ items: [] })
    createSource.mockResolvedValue({ id: "src-2", webhook_token: "tok_abc123" })
    render(<MemoryRouter><DataSourcesPage /></MemoryRouter>)
    await openCreate()
    fireEvent.change(document.querySelector("#ds-name")!, { target: { value: "钩子源" } })
    fireEvent.click(screen.getByRole("button", { name: "保存" }))
    await waitFor(() =>
      expect(screen.getByText(/保存 Webhook Token/)).toBeTruthy())
    expect(screen.getByText("tok_abc123")).toBeTruthy()
    expect(screen.getByRole("button", { name: /复制/ })).toBeTruthy()
    expect(screen.getByRole("alert").textContent).toContain("仅显示这一次")
  })
})
