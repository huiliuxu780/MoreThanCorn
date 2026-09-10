// AgentScope 2.0.8 原生 SSE 事件 → 前端流式状态 reducer（P0-C 09-10）。
//
// 事件契约来源：runtimes/agentscope/.venv/.../agentscope/event/_event.py
// （EventType 全枚举）。每个事件带唯一 id（EventBase.id）——重连去重依据。
//
// 处理策略（任务书 §五.7）：
// - TEXT_BLOCK_START/DELTA/END：同一条逐字增长的 Agent 消息（按 block id）；
// - THINKING_BLOCK_*：按 block id 聚合，UI 折叠/展开；
// - TOOL_CALL_*/TOOL_RESULT_*：按 tool_call_id 聚合为连续工具卡；
// - MODEL_CALL_*：执行过程记录（模型调用开始/结束）；
// - HINT_BLOCK / DATA_BLOCK_* / CUSTOM：显式呈现或登记，不静默丢弃；
// - REQUIRE_USER_CONFIRM / REQUIRE_EXTERNAL_EXECUTION：HITL 状态；
// - EXCEED_MAX_ITERS / USER_INTERRUPT / REPLY_END(error)：明确终态；
// - 未识别事件：进入 unsupported 台账（可观测），不静默丢弃。
export interface ToolCard {
  id: string
  name: string
  args: string
  result: string
  state: "running" | "called" | "success" | "error" | "interrupted" | "denied"
}

export interface LiveBlock {
  id: string
  kind: "text" | "thinking" | "hint" | "data" | "status"
  text: string
  eventType: string
  finished?: boolean
}

export interface ModelCallRow {
  id: string
  status: "running" | "done" | "error"
  startedAt: string
}

export interface ChatStreamState {
  live: LiveBlock[]
  tools: ToolCard[]
  status: "idle" | "running" | "completed" | "interrupted" | "failed" | "hitl" | "exceeded"
  statusDetail: string
  modelCalls: ModelCallRow[]
  hitlToolCalls: unknown[]
  unsupported: { type: string; at: string }[]
  seenEventIds: string[]
  replyEnded: boolean
}

export function initialStreamState(): ChatStreamState {
  return {
    live: [],
    tools: [],
    status: "idle",
    statusDetail: "",
    modelCalls: [],
    hitlToolCalls: [],
    unsupported: [],
    seenEventIds: [],
    replyEnded: false,
  }
}

const SECRET_RE =
  /(sk-[A-Za-z0-9_-]{6,}|Bearer\s+[A-Za-z0-9._-]+|api[_-]?key["']?\s*[:=]\s*["']?[A-Za-z0-9._-]{6,}|token["']?\s*[:=]\s*["']?[A-Za-z0-9._-]{6,}|cookie["']?\s*[:=]\s*["']?[^\s"']{6,})/gi
export const maskSecrets = (t: string) =>
  t.replace(SECRET_RE, (m) => `${m.slice(0, 6)}…[masked]`)

function blockText(b: unknown): string {
  if (typeof b === "string") return b
  if (b && typeof b === "object") {
    const rec = b as Record<string, unknown>
    if (typeof rec.text === "string") return rec.text
    if (typeof rec.delta === "string") return rec.delta
  }
  return ""
}

function upsertById(
  blocks: LiveBlock[],
  id: string,
  kind: LiveBlock["kind"],
  eventType: string,
  delta: string,
): LiveBlock[] {
  const i = blocks.findIndex((b) => b.id === id && b.kind === kind)
  if (i >= 0) {
    const next = [...blocks]
    next[i] = { ...next[i], text: next[i].text + delta }
    return next
  }
  return [...blocks, { id, kind, text: delta, eventType }]
}

/** 纯函数 reducer：单事件 → 新状态。重连去重按事件 id。 */
export function applyStreamEvent(
  s: ChatStreamState,
  ev: Record<string, unknown>,
): ChatStreamState {
  const eid = String(ev.id ?? "")
  if (eid && s.seenEventIds.includes(eid)) return s // 重连去重（§五.9）
  const seen = eid ? [...s.seenEventIds, eid] : s.seenEventIds
  const type = String(ev.type ?? "")
  const next: ChatStreamState = { ...s, seenEventIds: seen.slice(-2000) }

  switch (type) {
    case "REPLY_START":
      next.status = "running"
      next.statusDetail = ""
      next.replyEnded = false
      return next
    case "TEXT_BLOCK_START": {
      const bid = String(ev.block_id ?? `tb${s.live.length}`)
      next.live = [...s.live, { id: `txt:${bid}`, kind: "text", text: "", eventType: type }]
      return next
    }
    case "TEXT_BLOCK_DELTA": {
      const bid = String(ev.block_id ?? "default")
      const delta = blockText(ev.delta)
      const has = s.live.some((b) => b.id === `txt:${bid}` && b.kind === "text")
      next.live = has
        ? s.live.map((b) => (b.id === `txt:${bid}` ? { ...b, text: b.text + delta } : b))
        : upsertById(s.live, `txt:${bid}`, "text", type, delta)
      return next
    }
    case "TEXT_BLOCK_END": {
      const bid = String(ev.block_id ?? "default")
      next.live = s.live.map((b) => (b.id === `txt:${bid}` ? { ...b, finished: true } : b))
      return next
    }
    case "THINKING_BLOCK_START":
    case "THINKING_BLOCK_DELTA": {
      const bid = String(ev.block_id ?? "default")
      const delta = blockText(ev.delta ?? ev.thinking)
      next.live = upsertById(s.live, `th:${bid}`, "thinking", type, delta)
      return next
    }
    case "THINKING_BLOCK_END": {
      const bid = String(ev.block_id ?? "default")
      next.live = s.live.map((b) => (b.id === `th:${bid}` ? { ...b, finished: true } : b))
      return next
    }
    case "HINT_BLOCK":
      next.live = [
        ...s.live,
        { id: `hint:${eid || s.live.length}`, kind: "hint", text: blockText(ev.hint ?? ev), eventType: type },
      ]
      return next
    case "DATA_BLOCK_START":
    case "DATA_BLOCK_DELTA": {
      const bid = String(ev.block_id ?? "default")
      const chunk = typeof ev.delta === "string" ? ev.delta : JSON.stringify(ev.delta ?? "")
      next.live = upsertById(s.live, `data:${bid}`, "data", type, chunk)
      return next
    }
    case "DATA_BLOCK_END":
      return next
    case "TOOL_CALL_START":
      next.tools = [
        ...s.tools,
        {
          id: String(ev.tool_call_id ?? eid),
          name: String(ev.tool_call_name ?? ""),
          args: "",
          result: "",
          state: "running",
        },
      ]
      return next
    case "TOOL_CALL_DELTA":
      next.tools = s.tools.map((t) =>
        t.id === String(ev.tool_call_id ?? "") ? { ...t, args: t.args + String(ev.delta ?? "") } : t,
      )
      return next
    case "TOOL_CALL_END":
      next.tools = s.tools.map((t) =>
        t.id === String(ev.tool_call_id ?? "") ? { ...t, state: "called" } : t,
      )
      return next
    case "TOOL_RESULT_START":
      next.tools = s.tools.map((t) =>
        t.id === String(ev.tool_call_id ?? "")
          ? { ...t, name: t.name || String(ev.tool_call_name ?? "") }
          : t,
      )
      return next
    case "TOOL_RESULT_TEXT_DELTA":
      next.tools = s.tools.map((t) =>
        t.id === String(ev.tool_call_id ?? "")
          ? { ...t, result: t.result + String(ev.delta ?? "") }
          : t,
      )
      return next
    case "TOOL_RESULT_DATA_DELTA":
      next.tools = s.tools.map((t) =>
        t.id === String(ev.tool_call_id ?? "")
          ? { ...t, result: t.result + JSON.stringify(ev.delta ?? "") }
          : t,
      )
      return next
    case "TOOL_RESULT_END": {
      const st = String(ev.state ?? "success")
      next.tools = s.tools.map((t) =>
        t.id === String(ev.tool_call_id ?? "")
          ? {
              ...t,
              state:
                st === "success"
                  ? "success"
                  : st === "error"
                    ? "error"
                    : st === "interrupted"
                      ? "interrupted"
                      : "denied",
            }
          : t,
      )
      return next
    }
    case "MODEL_CALL_START":
      next.modelCalls = [
        ...s.modelCalls,
        { id: String(ev.id ?? `mc${s.modelCalls.length}`), status: "running", startedAt: String(ev.created_at ?? "") },
      ]
      next.status = next.status === "idle" ? "running" : next.status
      return next
    case "MODEL_CALL_END":
      next.modelCalls = s.modelCalls.map((m, i) =>
        i === s.modelCalls.length - 1 ? { ...m, status: "done" } : m,
      )
      return next
    case "REQUIRE_USER_CONFIRM":
      next.status = "hitl"
      next.statusDetail = "等待用户确认工具调用"
      next.hitlToolCalls = (ev.tool_calls as unknown[]) ?? []
      return next
    case "REQUIRE_EXTERNAL_EXECUTION":
      next.status = "hitl"
      next.statusDetail = "等待外部执行结果"
      next.hitlToolCalls = (ev.tool_calls as unknown[]) ?? []
      return next
    case "USER_INTERRUPT":
      next.status = "interrupted"
      next.statusDetail = "用户中断"
      return next
    case "EXCEED_MAX_ITERS":
      next.status = "exceeded"
      next.statusDetail = "超过最大迭代次数"
      return next
    case "CUSTOM":
      next.live = [
        ...s.live,
        {
          id: `custom:${eid || s.live.length}`,
          kind: "status",
          text: `自定义事件：${maskSecrets(JSON.stringify(ev.data ?? ev).slice(0, 200))}`,
          eventType: type,
        },
      ]
      return next
    case "REPLY_END": {
      const err = ev.error as Record<string, unknown> | undefined
      const fr = String(ev.finished_reason ?? "completed")
      next.replyEnded = true
      if (err) {
        next.status = "failed"
        next.statusDetail = maskSecrets(String(err.message ?? err.type ?? "error"))
      } else if (fr === "interrupted") {
        next.status = "interrupted"
        next.statusDetail = "已取消"
      } else if (fr === "exceed_max_iters") {
        next.status = "exceeded"
        next.statusDetail = "超过最大迭代次数"
      } else {
        next.status = "completed"
        next.statusDetail = ""
      }
      return next
    }
    default:
      // §五.7：不支持的事件可观测记录，不静默丢弃
      next.unsupported = [...s.unsupported, { type: type || "(no-type)", at: new Date().toISOString() }].slice(-50)
      return next
  }
}
