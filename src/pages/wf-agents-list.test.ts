import { describe, expect, it } from "vitest"
import { avatarFor } from "@/pages/wf-agents-list"

describe("avatarFor（SDD D-5 vitest）", () => {
  it("已保存头像优先", () => {
    expect(avatarFor("any-id", "/avatars/avatar-7.png")).toBe("/avatars/avatar-7.png")
  })
  it("无头像时按 id 哈希稳定回落", () => {
    const a1 = avatarFor("same-id")
    const a2 = avatarFor("same-id")
    expect(a1).toBe(a2)
    expect(a1).toMatch(/^\/avatars\/avatar-\d+\.png$/)
  })
  it("不同 id 可产生不同头像（哈希分布）", () => {
    const set = new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => avatarFor(id)))
    expect(set.size).toBeGreaterThan(1)
  })
})
