import { describe, expect, it } from "vitest"
import { emptyTaskForm, type TaskFormState } from "@/components/tasks/task-form-sections"
import { buildTaskPayload, buildTaskSchedule, taskVersionSummary } from "@/domain/task-mapper"
import { mapServerRole } from "@/services/rbac"
import type { TaskVersionDTO } from "@/services/api-types"

const base = (over: Partial<TaskFormState> = {}): TaskFormState => ({
  ...emptyTaskForm,
  name: " 每日弹幕质检 ",
  agentId: "wf_1",
  assetId: "asset_1",
  ...over,
})

describe("task-mapper（09 P0-B4 契约：表单 → §10.1 结构化提交体）", () => {
  it("全字段结构化提交：workflow 命名、scope/sampling/dataWindow 不落扁平字符串", () => {
    const p = buildTaskPayload(base({
      mapping: { interactionId: "id", text: "content" },
      scope: [{ field: "shop", operator: "=", value: "博世" }],
      samplingType: "固定数量",
      samplingCount: 5,
    }))
    expect(p.name).toBe("每日弹幕质检")           // trim
    expect(p.workflowId).toBe("wf_1")
    expect(p.workflowVersionPolicy).toBe("latest_published")
    expect(p.dataAssetId).toBe("asset_1")
    expect(p.inputMapping).toEqual({ interactionId: "id", text: "content" })
    expect(p.scope).toEqual({ op: "and", conditions: [{ field: "shop", op: "eq", value: "博世" }] })
    expect(p.sampling).toEqual({ mode: "count", count: 5 })
    // 不允许出现扁平字符串（旧契约回归防护）
    expect(typeof p.scope).toBe("object")
    expect(typeof p.sampling).toBe("object")
  })

  it("Fixed 策略 → pinned 且携带固定版本 ID", () => {
    const p = buildTaskPayload(base({ versionPolicy: "Fixed", fixedVersion: "wfv_9" }))
    expect(p.workflowVersionPolicy).toBe("pinned")
    expect(p.pinnedWorkflowVersionId).toBe("wfv_9")
  })

  it("Latest Published 策略不带 pinnedWorkflowVersionId", () => {
    const p = buildTaskPayload(base())
    expect(p.workflowVersionPolicy).toBe("latest_published")
    expect(p.pinnedWorkflowVersionId).toBeUndefined()
  })

  it("随机抽样映射为 random/percent", () => {
    const p = buildTaskPayload(base({ samplingType: "随机抽样", samplingPercent: 20 }))
    expect(p.sampling).toEqual({ mode: "random", percent: 20 })
  })

  it("一次性窗口 → fixed；周期任务 → relative", () => {
    const once = buildTaskPayload(base({ scheduleType: "一次性", dataWindowStart: "2026-08-01", dataWindowEnd: "2026-08-07" }))
    expect(once.dataWindow).toEqual({ mode: "fixed", start: "2026-08-01", end: "2026-08-07" })
    const daily = buildTaskPayload(base({ dataWindowTemplate: "上一自然日" }))
    expect(daily.dataWindow).toMatchObject({ mode: "relative", value: "previous_day", timezone: "Asia/Shanghai" })
  })

  it("可选版本绑定字段仅在有值时出现", () => {
    const p = buildTaskPayload(base({ ruleVersionId: "rv_1", definitionVersionId: "dv_2" }))
    expect(p.resultRuleVersionId).toBe("rv_1")
    expect(p.dataDefinitionVersionId).toBe("dv_2")
    const q = buildTaskPayload(base())
    expect(q.resultRuleVersionId).toBeUndefined()
    expect(q.dataDefinitionVersionId).toBeUndefined()
  })
})

describe("task-mapper：调度生成", () => {
  it("一次性任务无调度", () => {
    expect(buildTaskSchedule(base({ scheduleType: "一次性" }))).toBeNull()
  })
  it("每日/每周/每月生成标准 cron（Asia/Shanghai）", () => {
    expect(buildTaskSchedule(base({ scheduleType: "每日", scheduleTime: "02:30" })))
      .toEqual({ cron: "30 2 * * *", timezone: "Asia/Shanghai" })
    expect(buildTaskSchedule(base({ scheduleType: "每周", scheduleTime: "09:00" })))
      .toEqual({ cron: "0 9 * * 1", timezone: "Asia/Shanghai" })
    expect(buildTaskSchedule(base({ scheduleType: "每月", scheduleTime: "08:15" })))
      .toEqual({ cron: "15 8 1 * *", timezone: "Asia/Shanghai" })
  })
})

describe("task-mapper：TaskVersion 快照展示", () => {
  const v: TaskVersionDTO = {
    id: "tv1", versionNo: 3, workflowId: "wf1",
    workflowVersionPolicy: "pinned", pinnedWorkflowVersionId: "wfv9",
    dataAssetId: "a1", dataDefinitionVersionId: null, resultRuleVersionId: "rv1",
    inputMapping: { text: "content" },
    scope: { op: "and", conditions: [{ field: "shop", op: "eq", value: "x" }] },
    sampling: { mode: "count", count: 10 },
    dataWindow: { mode: "relative", value: "previous_day" },
    outputSchemaVersion: "quality_evaluation@v1", outputSchemaVersionId: "os1",
    note: "", createdBy: "admin", createdAt: "2026-08-27T00:00:00Z",
  }
  it("版本/策略/映射/窗口均来自服务端快照", () => {
    const rows = Object.fromEntries(taskVersionSummary(v).map((r) => [r.label, r.value]))
    expect(rows["配置版本"]).toBe("V3")
    expect(rows["版本策略"]).toContain("Fixed")
    expect(rows["输入映射"]).toBe("text←content")
    expect(rows["采样"]).toBe("固定数量 10 条")
    expect(rows["输出 Schema"]).toBe("quality_evaluation@v1")
  })
})

describe("buildTaskPayload：scope 运算符映射与边界（09 P0-12）", () => {
  it("scope 运算符映射为后端语义（=→eq, ≠→neq, IN→contains, IS NOT NULL→exists）", () => {
    const p = buildTaskPayload(base({
      scope: [
        { field: "shop", operator: "=", value: "A" },
        { field: "text", operator: "≠", value: "B" },
        { field: "tag", operator: "IN", value: "x,y" },
        { field: "phone", operator: "IS NOT NULL", value: "" },
      ],
    }))
    expect(p.scope).toEqual({
      op: "and",
      conditions: [
        { field: "shop", op: "eq", value: "A" },
        { field: "text", op: "neq", value: "B" },
        { field: "tag", op: "contains", value: "x,y" },
        { field: "phone", op: "exists", value: "" },
      ],
    })
  })
  it("未知运算符回落 eq（不产生 undefined）", () => {
    const p = buildTaskPayload(base({ scope: [{ field: "f", operator: "??" as never, value: "v" }] }))
    expect(p.scope?.conditions?.[0].op).toBe("eq")
  })
  it("空 scope → 空条件数组（全部数据），而非缺字段", () => {
    const p = buildTaskPayload(base())
    expect(p.scope).toEqual({ op: "and", conditions: [] })
  })
  it("随机抽样百分比进入 payload", () => {
    const p = buildTaskPayload(base({ samplingType: "随机抽样", samplingPercent: 30 }))
    expect(p.sampling).toEqual({ mode: "random", percent: 30 })
  })
})

describe("rbac：服务端角色映射（09 P0-10）", () => {
  it("admin→admin，operator→publisher，viewer→viewer，未知→viewer", () => {
    expect(mapServerRole("admin")).toBe("admin")
    expect(mapServerRole("operator")).toBe("publisher")
    expect(mapServerRole("viewer")).toBe("viewer")
    expect(mapServerRole("whatever")).toBe("viewer")
  })
})
