// 审计返工 P0-1（2026-09-10 二轮）：「可执行对象」唯一判定的单元测试。
// 语义与后端 as_automations._validate_target 对齐：
// Agent=executable（未归档+active prod Release，由后端计算下发）；Workflow=published；AgentFlow=active_release_id。
import { describe, expect, it } from "vitest"
import {
  defaultExecutorId,
  executableAgentFlows,
  executableAgents,
  executableWorkflows,
} from "./executable-targets"

describe("executableAgents", () => {
  it("未归档但无 active prod Release（executable=false）不出现在选择器", () => {
    const opts = executableAgents([
      { id: "draft-1", name: "数据分析师", executable: false, archived: false },
      { id: "draft-2", name: "前端工程师", executable: false, archived: false },
      { id: "prod-1", name: "业务分析-通话打标", executable: true, archived: false },
    ])
    expect(opts).toEqual([{ id: "prod-1", name: "业务分析-通话打标" }])
  })

  it("executable 缺失（旧后端/异常数据）按不可执行处理，不得回退 !archived 近似", () => {
    const opts = executableAgents([
      { id: "a", name: "A" }, // executable undefined
      { id: "b", name: "B", executable: true },
    ])
    expect(opts.map((o) => o.id)).toEqual(["b"])
  })
})

describe("executableWorkflows", () => {
  it("仅 published 可选；草稿/归档不出现", () => {
    const opts = executableWorkflows([
      { id: "w1", name: "草稿流", status: "draft" },
      { id: "w2", name: "已发布流", status: "published" },
      { id: "w3", name: "无状态流" },
    ])
    expect(opts).toEqual([{ id: "w2", name: "已发布流" }])
  })
})

describe("executableAgentFlows", () => {
  it("无 active Release 的 AgentFlow 不可选", () => {
    const opts = executableAgentFlows([
      { id: "f1", name: "无发布流程", active_release_id: null },
      { id: "f2", name: "缺字段流程" },
      { id: "f3", name: "已发布流程", active_release_id: "rel-1" },
    ])
    expect(opts).toEqual([{ id: "f3", name: "已发布流程" }])
  })
})

describe("defaultExecutorId", () => {
  it("默认执行者=第一个真正可执行对象", () => {
    expect(defaultExecutorId([{ id: "x" }, { id: "y" }])).toBe("x")
  })
  it("空列表返回空串（由空态接管，不回填草稿对象）", () => {
    expect(defaultExecutorId([])).toBe("")
  })
})
