// @vitest-environment jsdom
// P0-C 前端时序测试（任务书 §五）：可控慢速事件源下断言——
// 1) REPLY_END 前至少三次不同的正文 DOM 增长；
// 2) 用户消息先于助手增量出现（乐观回显）；
// 3) 重连重放同 id 事件不重复；
// 4) 完成合并不闪空（采样器全程非空）；
// 5) 工具卡随 START/DELTA/END 逐步变化。
// 慢速 mock 只证明前端时序；真实 AgentScope SSE 事件契约由 E2E（test_p0_e2e_live_stack
// + 浏览器 E2E）验证。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"

// ---- 可控事件源 ----
type Handler = (ev: Record<string, unknown>) => void
let streamHandler: Handler | null = null
let streamDone: (() => void) | null = null

vi.mock("@/services/as-api", () => {
  const asApi = {
    listSessions: vi.fn(async () => ({ items: [] })),
    openSession: vi.fn(async () => ({ session_id: "sess-1" })),
    turn: vi.fn(async () => ({ status: "started" })),
    messages: vi.fn(async () => ({
      messages: [
        { id: "u1", role: "user", content: [{ type: "text", text: "持久化用户消息" }], created_at: new Date().toISOString() },
        { id: "a1", role: "assistant", content: [{ type: "text", text: "持久化回复正文" }], created_at: new Date().toISOString(), finished_reason: "completed" },
      ],
    })),
    status: vi.fn(async () => ({ status: "idle" })),
    interrupt: vi.fn(async () => ({})),
    streamUrl: vi.fn(async () => ({ url: "http://test/stream" })),
    runtimeView: vi.fn(async () => ({ published: { release_id: "r1", version_id: "v1", digest: "d" }, running: null, editing: null })),
    deleteSession: vi.fn(async () => ({ deleted: true, session_id: "sess-1", runtime_error: null })),
    confirm: vi.fn(async () => ({})),
  }
  return {
    asApi,
    openRuntimeStream: (
      _url: string,
      onEvent: Handler,
      onDone?: () => void,
      _ctrl?: AbortController,
    ) => {
      streamHandler = onEvent
      streamDone = onDone ?? null
      return new AbortController()
    },
  }
})

vi.mock("@/services/wf-api", () => ({
  wfApi: {
    models: vi.fn(async () => [{ modelKey: "qwen-test" }]),
  },
  agentApi: {
    get: vi.fn(async () => ({
      id: "agent-1",
      name: "测试 Agent",
      type: "custom",
      typeLabel: "自定义",
      status: "published",
      workflowId: null,
      config: { modelRef: { modelId: "qwen-test" } },
      configRevision: 1,
      description: "测试职责描述",
      avatar: null,
    })),
  },
}))

import AgentChatPage from "./agent-chat"
import { asApi } from "@/services/as-api"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const push = (ev: Record<string, unknown>) => streamHandler?.(ev)

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/agents/agent-1/chat?session=sess-1"]}>
      <Routes>
        <Route path="/agents/:agentId/chat" element={<AgentChatPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.mocked(asApi.status).mockResolvedValue({ status: "idle" })
  vi.mocked(asApi.messages).mockResolvedValue({
    messages: [
      { id: "u1", role: "user", content: [{ type: "text", text: "持久化用户消息" }] },
      {
        id: "a1",
        role: "assistant",
        content: [{ type: "text", text: "持久化回复正文" }],
        finished_reason: "completed",
      },
    ],
  })
})

afterEach(() => {
  cleanup()
  streamHandler = null
  streamDone = null
  vi.clearAllMocks()
})

describe("对话页流式时序", () => {
  it("REPLY_END 前正文 DOM 至少三次增长 + 用户消息先出现 + 完成不闪空", async () => {
    renderPage()
    await waitFor(() => expect(screen.getByRole("textbox")).toBeTruthy())

    // 采样器：记录消息流区域是否曾为空（闪空检测）
    const feedEmptySamples: boolean[] = []
    const sampler = window.setInterval(() => {
      const live = document.querySelector('[data-testid="live-text"]')
      const persisted = [...document.querySelectorAll("div")].some((d) =>
        d.textContent === "持久化回复正文",
      )
      feedEmptySamples.push(!live && !persisted)
    }, 10)

    // 发送（乐观回显）
    const box = screen.getByRole("textbox")
    fireEvent.change(box, { target: { value: "你好世界" } })
    fireEvent.keyDown(box, { key: "Enter" })
    // 乐观回显：用户消息立即上屏（标题栏与消息泡同文案，取全部匹配）
    await waitFor(() => expect(screen.getAllByText("你好世界").length).toBeGreaterThan(0))
    expect(asApi.turn).toHaveBeenCalled()

    // 慢速事件源：4 个正文增量，间隔 40ms
    const growths: number[] = []
    push({ id: "e1", type: "REPLY_START", session_id: "sess-1", reply_id: "r1", name: "测试 Agent" })
    for (let i = 1; i <= 4; i++) {
      push({ id: `t${i}`, type: "TEXT_BLOCK_DELTA", delta: `增量${i}段` })
      await sleep(40)
      const el = document.querySelector('[data-testid="live-text"]')
      growths.push(el?.textContent?.length ?? 0)
    }
    const distinct = new Set(growths)
    expect(distinct.size).toBeGreaterThanOrEqual(3) // §五：≥3 次不同增长
    expect(growths[3]).toBeGreaterThan(growths[0])

    // 工具卡生命周期
    push({ id: "tc1", type: "TOOL_CALL_START", tool_call_id: "tool-1", tool_call_name: "Bash" })
    await waitFor(() => expect(screen.getAllByText("调用中").length).toBeGreaterThan(0))
    push({ id: "tc2", type: "TOOL_CALL_DELTA", tool_call_id: "tool-1", delta: '{"command":"ls"}' })
    push({ id: "tc3", type: "TOOL_CALL_END", tool_call_id: "tool-1" })
    await waitFor(() => expect(screen.getAllByText("调用中").length).toBeGreaterThan(0))
    push({ id: "tr1", type: "TOOL_RESULT_START", tool_call_id: "tool-1", tool_call_name: "Bash" })
    push({ id: "tr2", type: "TOOL_RESULT_TEXT_DELTA", tool_call_id: "tool-1", delta: "ok" })
    push({ id: "tr3", type: "TOOL_RESULT_END", tool_call_id: "tool-1", state: "success" })
    await waitFor(() => expect(screen.getAllByText("已完成").length).toBeGreaterThan(0))

    // REPLY_END → 平滑合并（持久化正文出现，live 清空，全程不闪空）
    push({ id: "e9", type: "REPLY_END", session_id: "sess-1", reply_id: "r1", finished_reason: "completed" })
    await waitFor(() => expect(screen.getByText("持久化回复正文")).toBeTruthy())
    await waitFor(() => expect(document.querySelector('[data-testid="live-text"]')).toBeNull())
    window.clearInterval(sampler)
    // 合并窗口内不允许出现“既无 live 又无持久化”的空帧
    expect(feedEmptySamples.filter(Boolean).length).toBeLessThanOrEqual(2)
  })

  it("重连重放同 id 事件不重复", async () => {
    renderPage()
    await waitFor(() => expect(screen.getByRole("textbox")).toBeTruthy())
    push({ id: "e1", type: "REPLY_START", session_id: "sess-1", reply_id: "r1", name: "测试 Agent" })
    push({ id: "t1", type: "TEXT_BLOCK_DELTA", delta: "甲" })
    push({ id: "t2", type: "TEXT_BLOCK_DELTA", delta: "乙" })
    await waitFor(() => {
      const el = document.querySelector('[data-testid="live-text"]')
      expect(el?.textContent).toBe("甲乙")
    })
    // 断线 → 重连 → 运行时重放同 id 事件
    streamDone?.()
    push({ id: "t1", type: "TEXT_BLOCK_DELTA", delta: "甲" })
    push({ id: "t2", type: "TEXT_BLOCK_DELTA", delta: "乙" })
    push({ id: "t3", type: "TEXT_BLOCK_DELTA", delta: "丙" })
    await waitFor(() => {
      const el = document.querySelector('[data-testid="live-text"]')
      expect(el?.textContent).toBe("甲乙丙") // 不出现 甲乙甲乙丙
    })
  })

  it("未识别事件进入可观测台账而非静默丢弃", async () => {
    renderPage()
    await waitFor(() => expect(screen.getByRole("textbox")).toBeTruthy())
    push({ id: "x1", type: "SOME_FUTURE_EVENT", foo: 1 })
    await waitFor(() => expect(screen.getByText(/未识别事件 1 条/)).toBeTruthy())
  })

  it("重挂时运行已结束：读回持久化消息后退出 running", async () => {
    renderPage()
    await waitFor(() => expect(streamHandler).not.toBeNull())
    push({ id: "e1", type: "REPLY_START", session_id: "sess-1", reply_id: "r1" })
    push({ id: "t1", type: "TEXT_BLOCK_DELTA", delta: "断线前残片" })
    await waitFor(() => expect(screen.getByRole("button", { name: "停止" })).toBeTruthy())

    streamDone?.()

    await waitFor(
      () => {
        expect(document.querySelector('[data-testid="live-text"]')).toBeNull()
        expect(screen.queryByRole("button", { name: "停止" })).toBeNull()
        expect(screen.getByText("持久化回复正文")).toBeTruthy()
      },
      { timeout: 2500 },
    )
  })

  it("重挂时运行停在 HITL：恢复等待确认而不是误报 completed", async () => {
    vi.mocked(asApi.status)
      .mockResolvedValueOnce({ status: "idle" })
      .mockResolvedValue({ status: "awaiting_permission" })
    vi.mocked(asApi.messages).mockResolvedValue({
      messages: [
        { id: "u1", role: "user", content: [{ type: "text", text: "执行工具" }] },
        {
          id: "a1",
          role: "assistant",
          content: [
            { type: "tool_call", id: "tool-1", name: "Bash", input: { command: "pwd" } },
          ],
        },
      ],
    })
    renderPage()
    await waitFor(() => expect(streamHandler).not.toBeNull())
    await waitFor(() => expect(asApi.status).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getAllByText("执行工具").length).toBeGreaterThan(0))
    push({ id: "e1", type: "REPLY_START", session_id: "sess-1", reply_id: "r1" })
    await waitFor(() => expect(screen.getByRole("button", { name: "停止" })).toBeTruthy())
    streamDone?.()

    await waitFor(
      () => {
        expect(screen.getAllByText("等待用户确认工具调用").length).toBeGreaterThan(0)
        expect(screen.getAllByText(/1 个工具调用等待确认/).length).toBeGreaterThan(0)
        expect(screen.getByRole("button", { name: "批准执行" })).toBeTruthy()
        expect(screen.getByRole("button", { name: "拒绝" })).toBeTruthy()
      },
      { timeout: 2500 },
    )
    // 09-11 审计补测：拒绝路径调用 confirm(false)
    fireEvent.click(screen.getByRole("button", { name: "拒绝" }))
    await waitFor(() => expect(asApi.confirm).toHaveBeenCalledWith("agent-1", "sess-1", false))
  })

  it("重挂时等待外部结果：恢复等待态且不显示错误的批准按钮", async () => {
    vi.mocked(asApi.status).mockResolvedValue({ status: "awaiting_external_result" })
    renderPage()

    await waitFor(() => {
      expect(screen.getAllByText("等待外部执行结果").length).toBeGreaterThan(0)
    })
    expect(screen.queryByRole("button", { name: "批准执行" })).toBeNull()
    expect(screen.queryByRole("button", { name: "拒绝" })).toBeNull()
  })
})
