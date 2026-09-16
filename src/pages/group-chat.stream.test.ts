// 09-16 统一切片：群聊聚合流 per-source reducer 复用断言（与单 Agent 聊天同一
// applyStreamEvent）。页面级时序由活体 E2E 覆盖（验收 §7）。
import { describe, expect, it } from "vitest"
import {
  applyStreamEvent, initialStreamState, type ChatStreamState,
} from "@/services/chat-stream"

type Envelope = { id: number; source: { sessionId: string }; payload: string }

const env = (id: number, sessionId: string, ev: Record<string, unknown>): Envelope =>
  ({ id, source: { sessionId }, payload: JSON.stringify(ev) })

/** 与 group-chat.tsx 相同的归并逻辑：envelope → per-source state。 */
function reduce(
  prev: Record<string, ChatStreamState>,
  e: Envelope,
): Record<string, ChatStreamState> {
  const cur = prev[e.source.sessionId] ?? initialStreamState()
  return { ...prev, [e.source.sessionId]: applyStreamEvent(cur, JSON.parse(e.payload)) }
}

describe("group chat per-source stream reduce", () => {
  it("两路 source 独立累积正文，互不串流", () => {
    let s: Record<string, ChatStreamState> = {}
    s = reduce(s, env(1, "sessA", { id: "e1", type: "TEXT_BLOCK_DELTA", block_id: "b1", delta: "甲" }))
    s = reduce(s, env(2, "sessB", { id: "e2", type: "TEXT_BLOCK_DELTA", block_id: "b1", delta: "乙" }))
    s = reduce(s, env(3, "sessA", { id: "e3", type: "TEXT_BLOCK_DELTA", block_id: "b1", delta: "丙" }))
    expect(s.sessA.live.find((b) => b.id === "txt:b1")?.text).toBe("甲丙")
    expect(s.sessB.live.find((b) => b.id === "txt:b1")?.text).toBe("乙")
  })

  it("重连重放同 id 事件不重复（per-source seenEventIds）", () => {
    let s: Record<string, ChatStreamState> = {}
    s = reduce(s, env(1, "sessA", { id: "e1", type: "TEXT_BLOCK_DELTA", block_id: "b1", delta: "甲" }))
    s = reduce(s, env(1, "sessA", { id: "e1", type: "TEXT_BLOCK_DELTA", block_id: "b1", delta: "甲" }))
    expect(s.sessA.live.find((b) => b.id === "txt:b1")?.text).toBe("甲")
  })

  it("HITL 状态按 source 隔离且可经 confirm 复位语义（status 字段）", () => {
    let s: Record<string, ChatStreamState> = {}
    s = reduce(s, env(1, "sessA", {
      id: "e1", type: "REQUIRE_USER_CONFIRM", tool_calls: [{ id: "t1", name: "Bash" }],
    }))
    expect(s.sessA.status).toBe("hitl")
    expect(s.sessA.hitlToolCalls).toHaveLength(1)
    // 另一路不受影响
    expect(s.sessB).toBeUndefined()
  })

  it("REPLY_END 归并终态（页面随后回捞历史并清 live）", () => {
    let s: Record<string, ChatStreamState> = {}
    s = reduce(s, env(1, "sessA", { id: "e1", type: "TEXT_BLOCK_DELTA", block_id: "b1", delta: "完成" }))
    s = reduce(s, env(2, "sessA", { id: "e2", type: "REPLY_END", finished_reason: "completed" }))
    expect(s.sessA.status).toBe("completed")
    expect(s.sessA.replyEnded).toBe(true)
  })
})
