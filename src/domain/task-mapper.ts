/** 09-SDD §5.1/P0-B4：Task 表单态 ↔ API DTO 显式转换层（页面不直接拼接 API 结构）。
 * 纯函数，契约测试见 src/domain/__tests__/task-mapper.test.ts。 */
import type { TaskFormState } from "@/components/tasks/task-form-sections"
import type { CreateTaskPayload } from "@/services/wf-api"
import type { TaskVersionDTO } from "@/services/api-types"

const OP_MAP: Record<string, string> = {
  "=": "eq", "≠": "neq", ">": "gt", "<": "lt", "IN": "contains", "IS NOT NULL": "exists",
}

export function samplingLabelOf(form: TaskFormState): string {
  return form.samplingType === "全量" ? "全量"
    : form.samplingType === "随机抽样" ? `随机抽样 ${form.samplingPercent}%`
    : `固定数量 ${form.samplingCount} 条`
}

export function windowLabelOf(form: TaskFormState): string {
  return form.scheduleType === "一次性"
    ? `${form.dataWindowStart} → ${form.dataWindowEnd}`
    : form.dataWindowTemplate
}

/** 表单 → 结构化提交体（09 §10.1 / R7-1）。所有公开字段进入请求，不静默丢弃。 */
export function buildTaskPayload(form: TaskFormState): CreateTaskPayload {
  const isAgent = form.targetType === "agent"
  // R8-UI：Agent 三选策略（默认最新沙箱发布）；Workflow 维持二选
  const policy = isAgent
    ? (form.agentVersionPolicy === "pinned" ? "pinned"
      : form.agentVersionPolicy === "latest_prod" ? "latest_prod_release" : "latest_sandbox_release")
    : (form.versionPolicy === "Fixed" ? "pinned" : "latest_published")
  const payload: CreateTaskPayload = {
    name: form.name.trim(),
    description: form.description,
    dataAssetId: form.assetId,
    inputMapping: { ...form.mapping },
    scope: {
      op: "and",
      conditions: form.scope.map((c) => ({
        field: c.field,
        op: OP_MAP[c.operator] ?? "eq",
        value: c.value,
      })),
    },
    sampling:
      form.samplingType === "全量" ? { mode: "all" }
      : form.samplingType === "固定数量" ? { mode: "count", count: form.samplingCount }
      : { mode: "random", percent: form.samplingPercent },
    dataWindow:
      form.scheduleType === "一次性"
        ? { mode: "fixed", start: form.dataWindowStart, end: form.dataWindowEnd }
        : {
            mode: "relative",
            value: form.dataWindowTemplate === "上一自然日" ? "previous_day"
              : form.dataWindowTemplate === "上一自然周" ? "previous_week"
              : form.dataWindowTemplate === "上一自然月" ? "previous_month"
              : "previous_day",
            timezone: "Asia/Shanghai",
          },
  }
  // R7-1：统一执行目标。Agent 默认；Workflow 兼容。Provider 由 Release 决定，Task 不选 Provider。
  if (isAgent) {
    payload.executionTarget = {
      type: "agent", agentId: form.agentId, versionPolicy: policy,
      pinnedAgentVersionId: form.agentVersionPolicy === "pinned" ? form.fixedVersion : null,
    }
  } else {
    payload.workflowId = form.agentId
    payload.workflowVersionPolicy = form.versionPolicy === "Fixed" ? "pinned" : "latest_published"
    if (policy === "pinned") payload.pinnedWorkflowVersionId = form.fixedVersion
  }
  if (form.definitionVersionId) payload.dataDefinitionVersionId = form.definitionVersionId
  // SDD 13 §9.1：结果输出绑定（target_table 时服务端完整预检；platform_only 不发送）
  if (form.outputMode === "target_table") {
    payload.outputBinding = {
      mode: "target_table",
      assetId: form.outputAssetId,
      definitionVersionId: form.outputDefinitionVersionId || undefined,
      writeMode: form.outputWriteMode,
      keyFields: form.outputKeyFields.split(",").map((s) => s.trim()).filter(Boolean),
      mapping: Object.fromEntries(form.outputMappingRows.filter((r) => r.column && r.expr)
        .map((r) => [r.column, r.expr])),
      failurePolicy: "separate_delivery_status",
    }
  }
  // 09 P0：规则绑定——显式版本=pinned；未选=跟随最新发布（服务端解析时失败关闭）
  if (form.ruleVersionId) {
    payload.resultRuleVersionId = form.ruleVersionId
    payload.rulePolicy = "pinned"
  } else {
    // 09 闭环修复：follow_latest 必须带 RuleSet 作用域，否则后端 422
    payload.rulePolicy = "follow_latest"
    if (form.ruleSetId) payload.resultRuleSetId = form.ruleSetId
  }
  return payload
}

/** 表单 → 调度 cron（一次性任务无调度）。 */
export function buildTaskSchedule(form: TaskFormState): { cron: string; timezone: string } | null {
  if (form.scheduleType === "一次性") return null
  const [h, m] = (form.scheduleTime || "02:00").split(":").map((x) => Number(x))
  const minute = Number.isFinite(m) ? m : 0
  const hour = Number.isFinite(h) ? h : 2
  if (form.scheduleType === "每日") return { cron: `${minute} ${hour} * * *`, timezone: "Asia/Shanghai" }
  if (form.scheduleType === "每周") return { cron: `${minute} ${hour} * * 1`, timezone: "Asia/Shanghai" }
  return { cron: `${minute} ${hour} 1 * *`, timezone: "Asia/Shanghai" }
}

/** TaskVersion → 确认/详情页展示行（服务端返回快照，不用本地提交态冒充）。 */
export function taskVersionSummary(v: TaskVersionDTO): { label: string; value: string }[] {
  const policy = v.workflowVersionPolicy === "pinned"
    ? `Fixed ${(v.pinnedWorkflowVersionId ?? "").slice(0, 8) || "?"}`
    : "Latest Published"
  const sampling = v.sampling?.mode === "count" ? `固定数量 ${v.sampling.count ?? 0} 条`
    : v.sampling?.mode === "random" ? `随机抽样 ${v.sampling.percent ?? 0}%`
    : "全量"
  const win = v.dataWindow?.mode === "relative" ? `相对窗口 ${v.dataWindow.value ?? ""}`
    : v.dataWindow?.mode === "fixed" ? `${v.dataWindow.start ?? ""} → ${v.dataWindow.end ?? ""}`
    : "全量"
  const conds: { field: string; op: string; value: unknown }[] = v.scope?.conditions ?? []
  // R8-UI：确认页展示统一执行目标冻结值（服务端快照，非本地提交态）
  const et = v.executionTarget
  const etLabel = et?.type === "agent"
    ? `领域 Agent · ${et.versionPolicy === "pinned"
      ? `钉住 ${(et.pinnedAgentVersionId ?? "").slice(0, 8) || "?"}`
      : et.versionPolicy === "latest_prod_release" ? "最新线上发布" : "最新沙箱发布"}`
    : `工作流 · ${policy}`
  return [
    { label: "配置版本", value: `V${v.versionNo}` },
    { label: "执行目标", value: etLabel },
    { label: "版本策略", value: policy },
    { label: "输入映射", value: Object.keys(v.inputMapping ?? {}).length ? Object.entries(v.inputMapping).map(([k, s]) => `${k}←${s}`).join("；") : "默认同名" },
    { label: "范围", value: conds.length ? conds.map((c) => `${c.field} ${c.op} ${String(c.value)}`).join(" 且 ") : "全部" },
    { label: "采样", value: sampling },
    { label: "数据窗口", value: win },
    // SDD 13 §9.2：不再把非质检 Agent 显示为 quality_evaluation；读通用 outputSchema/outputBinding
    { label: "输出 Schema", value: v.outputSchema?.ref || v.outputSchemaVersion || "—" },
    { label: "结果输出", value: v.outputBinding?.mode === "target_table"
      ? `目标表 ${v.outputBinding.assetName ?? v.outputBinding.assetId ?? ""} · ${v.outputBinding.writeMode ?? "upsert"} · 键 ${(v.outputBinding.keyFields ?? []).join("+")} · 映射 ${Object.keys(v.outputBinding.mapping ?? {}).length} 列`
      : "仅保存在平台" },
  ]
}
