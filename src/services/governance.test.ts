import { describe, expect, it } from "vitest"
import {
  allowedActions,
  diffRows,
  isTerminal,
  summarizeDiff,
  STATE_LABEL,
  ACTION_LABEL,
} from "@/services/governance"

describe("governance：发布申请状态机（09 P2-08）", () => {
  it("pending 可审批/驳回", () => {
    expect(allowedActions("pending", false, false)).toEqual(["approve", "reject"])
  })
  it("approved 可发布", () => {
    expect(allowedActions("approved", false, false)).toEqual(["release"])
  })
  it("released 可回滚；canary 未转全量时额外可 promote", () => {
    expect(allowedActions("released", false, false)).toEqual(["rollback"])
    expect(allowedActions("released", true, false)).toEqual(["promote", "rollback"])
    expect(allowedActions("released", true, true)).toEqual(["rollback"])
  })
  it("rejected / rolled_back 为终态，无动作", () => {
    expect(allowedActions("rejected", false, false)).toEqual([])
    expect(allowedActions("rolled_back", false, false)).toEqual([])
    expect(isTerminal("rejected")).toBe(true)
    expect(isTerminal("rolled_back")).toBe(true)
    expect(isTerminal("released")).toBe(false)
  })
  it("状态与动作文案齐备（供面板渲染）", () => {
    expect(STATE_LABEL.pending).toBe("待审批")
    expect(STATE_LABEL.rolled_back).toBe("已回滚")
    expect(ACTION_LABEL.promote).toBe("转全量")
    expect(ACTION_LABEL.rollback).toBe("回滚")
  })
})

describe("governance：版本 Diff 摘要（09 P2-08）", () => {
  const diff = {
    added: { "graph.nodes[2]": { id: "n_new" } },
    removed: { "config.old": 1 },
    changed: { "definition.graph.nodes[1].name": { from: "A", to: "B" } },
  }
  it("summarizeDiff 计数正确", () => {
    expect(summarizeDiff(diff)).toEqual({ added: 1, removed: 1, changed: 1, total: 3 })
  })
  it("空 diff 计数为 0", () => {
    expect(summarizeDiff({ added: {}, removed: {}, changed: {} })).toEqual({ added: 0, removed: 0, changed: 0, total: 0 })
  })
  it("diffRows 拍平并按 path 稳定排序、标注 kind", () => {
    const rows = diffRows(diff)
    expect(rows).toHaveLength(3)
    const byKind = Object.fromEntries(rows.map((r) => [r.kind, r]))
    expect(byKind.added.to).toEqual({ id: "n_new" })
    expect(byKind.removed.from).toBe(1)
    expect(byKind.changed.from).toBe("A")
    expect(byKind.changed.to).toBe("B")
    const paths = rows.map((r) => r.path)
    expect(paths).toEqual([...paths].sort((a, b) => a.localeCompare(b)))
  })
})
