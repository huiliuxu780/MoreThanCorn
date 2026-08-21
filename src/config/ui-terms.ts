import type { StatusTone } from "@/domain/types"

/** 导航与业务对象的固定文案。导航结构冻结，不允许新增一级入口。 */
export const UI_TERMS = {
  productName: "企业智能质量平台",
  productSubtitle: "AI Quality Intelligence",
  navigation: {
    quality: "智能质检",
    agentQuality: "坐席质检",
    qualityOverview: "质量总览",
    qualityResults: "质量结果",
    agentAnalysis: "坐席分析",
    config: "配置管理",
    tasks: "分析任务",
    agents: "Agents",
    tools: "Tools",
    dataAssets: "数据定义",
    resultRules: "结果规则",
    settings: "Settings",
    connections: "Connections",
  },
} as const

/** 状态中文文案。状态文字必须始终存在，颜色只是辅助语义。 */
export const STATUS_LABELS: Record<string, string> = {
  // Agent / Tool Version / Data Asset lifecycle / Result Rules
  Draft: "草稿",
  Testing: "测试中",
  Published: "已发布",
  Deprecated: "已弃用",
  Ready: "就绪",
  // Tool governance
  Enabled: "启用",
  Disabled: "停用",
  // Data Asset health
  Healthy: "健康",
  Degraded: "退化",
  Error: "异常",
  // Run
  PENDING: "等待中",
  RUNNING: "运行中",
  SUCCESS: "成功",
  PARTIAL_SUCCESS: "部分成功",
  FAILED: "失败",
  CANCELLED: "已取消",
  BLOCKED: "阻塞",
  // Interaction Execution
  ERROR: "错误",
  SKIPPED: "跳过",
  // Review
  IN_REVIEW: "复核中",
  COMPLETED: "已完成",
  REOPENED: "重新打开",
  // Connection
  Connected: "已连接",
  Failed: "连接失败",
  "Not Tested": "未测试",
  // Task
  Active: "启用",
  Inactive: "停用",
}

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status
}

/** 风险等级文案。 */
export const RISK_LABELS: Record<string, string> = {
  Critical: "Critical",
  High: "High",
  Medium: "Medium",
  Low: "Low",
}

/** 状态 → 语义 token 的全局映射（Implementation Spec §2）。 */
export const STATUS_TONES: Record<string, StatusTone> = {
  // Agent lifecycle
  Draft: "neutral",
  Testing: "info",
  Published: "success",
  Deprecated: "neutral",
  // Tool governance
  Enabled: "success",
  Disabled: "neutral",
  // Data Asset lifecycle / health
  Ready: "success",
  Healthy: "success",
  Degraded: "warning",
  Error: "danger",
  // Run
  PENDING: "neutral",
  RUNNING: "info",
  SUCCESS: "success",
  PARTIAL_SUCCESS: "warning",
  FAILED: "danger",
  CANCELLED: "neutral",
  BLOCKED: "danger",
  // Interaction Execution
  ERROR: "danger",
  SKIPPED: "neutral",
  // Review
  IN_REVIEW: "info",
  COMPLETED: "success",
  REOPENED: "warning",
  // Connection
  Connected: "success",
  Failed: "danger",
  "Not Tested": "neutral",
  // Task state
  Active: "success",
  Inactive: "neutral",
  // Criterion result
  PASS: "success",
  FAIL: "danger",
  "N/A": "neutral",
  NOT_APPLICABLE: "neutral",
  UNABLE_TO_EVALUATE: "warning",
  INCOMPLETE: "warning",
}
