import { describe, expect, it } from "vitest"
import { parseListFilters, serializeListFilters } from "@/lib/list-filters"

describe("list-filters（SDD D-5 vitest）", () => {
  it("解析 key:value 过滤器", () => {
    expect(parseListFilters("agent:张三,team:售后")).toEqual({ agent: "张三", team: "售后" })
  })
  it("忽略非法片段", () => {
    expect(parseListFilters("noColon,:noKey,a:")).toEqual({})
    expect(parseListFilters(undefined)).toEqual({})
  })
  it("URL 编码往返一致", () => {
    const f = { agent: "张三/售后", scene: "安装 咨询" }
    expect(parseListFilters(serializeListFilters(f))).toEqual(f)
  })
  it("序列化过滤空值", () => {
    expect(serializeListFilters({ a: "1", b: "", c: undefined as unknown as string })).toBe("a:1")
  })
})
