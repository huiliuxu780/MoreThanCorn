import { describe, expect, it } from "vitest"
import { mapServerRole } from "@/services/rbac"
import { buildTaskSchedule } from "@/domain/task-mapper"
import type { TaskFormState } from "@/components/tasks/task-form-sections"
import { emptyTaskForm } from "@/components/tasks/task-form-sections"

describe("rbac：服务端角色 → 前端角色映射（09 P0-10）", () => {
  it("admin→admin，operator→publisher，viewer→viewer", () => {
    expect(mapServerRole("admin")).toBe("admin")
    expect(mapServerRole("operator")).toBe("publisher")
    expect(mapServerRole("viewer")).toBe("viewer")
  })
  it("未知角色降级为 viewer（最小权限）", () => {
    expect(mapServerRole("whatever")).toBe("viewer")
    expect(mapServerRole("")).toBe("viewer")
  })
})

describe("buildTaskSchedule：调度 cron 转换（09 P1-01）", () => {
  const form = (over: Partial<TaskFormState>): TaskFormState => ({ ...emptyTaskForm, ...over })
  it("一次性任务无调度", () => {
    expect(buildTaskSchedule(form({ scheduleType: "一次性" }))).toBeNull()
  })
  it("每日/每周/每月生成标准 cron", () => {
    expect(buildTaskSchedule(form({ scheduleType: "每日", scheduleTime: "02:30" })))
      .toEqual({ cron: "30 2 * * *", timezone: "Asia/Shanghai" })
    expect(buildTaskSchedule(form({ scheduleType: "每周", scheduleTime: "09:00" })))
      .toEqual({ cron: "0 9 * * 1", timezone: "Asia/Shanghai" })
    expect(buildTaskSchedule(form({ scheduleType: "每月", scheduleTime: "08:15" })))
      .toEqual({ cron: "15 8 1 * *", timezone: "Asia/Shanghai" })
  })
})
