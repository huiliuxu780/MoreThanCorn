import type { StatusTone } from "@/domain/types"

/**
 * 导航与业务对象的固定文案。
 * MTC-001：一级导航冻结为 任务 / 自动任务 / Agent / 能力与资源 / Workflow 五项，
 * 底部固定 主题 / 设置 / 账号。不允许新增一级入口。
 * 2026-09-13 用户拍板：/autonomous-tasks（v2 通用自动任务）导航项 = 「自动任务」，
 * 与页面 h1 一致；F1 误将其收敛为「分析任务」（那是 /batch-tasks AnalysisTask 域的词）。
 */
export const UI_TERMS = {
  productName: "CORTEX",
  productSubtitle: "AI Quality Intelligence",
  navigation: {
    /* ---- MTC-001 一级入口（冻结） ---- */
    tasksWorkbench: "任务",
    autonomousTasks: "自动任务",
    agents: "Agent",
    resourcesHub: "能力与资源",
    workflows: "Workflow",
    /* ---- MTC-001 底部固定项 ---- */
    theme: "主题",
    settings: "设置",
    account: "账号",
    /* ---- 二级/遗留页面标签 ---- */
    qualityCenter: "质量中心",
    qualityOverview: "质量总览",
    qualityResults: "质量结果",
    agentAnalysis: "坐席分析",
    batchHistory: "批次历史",
    aiResources: "AI Resources",
    dataResources: "Data Resources",
    /* docs/v2-design/10：壳内五分类标签 */
    skills: "Skills",
    modelAccess: "模型接入",
    toolsMcp: "工具与 MCP",
    knowledgeBase: "知识库",
    dataAssetsHub: "数据资产",
    dataAssets: "数据定义",
    resultRules: "结果规则",
    forms: "表单",
    connections: "Connections",
    auditLog: "审计日志",
    governance: "发布治理",
  },
} as const

/** 09-14 D4 拍板：双「数据源」概念边界说明（文案单一事实源；不动导航不改名）。 */
export const IA_BOUNDARY = {
  ingress: {
    text: "这里管理事件入口（Webhook/轮询：外部系统把事件推给平台，触发自动任务或分析批次）。",
    linkText: "前往 能力与资源 → 数据资产 →",
    to: "/resources/data",
  },
  assets: {
    text: "这里管理数据资产（数据库连接与表/对象，供分析任务读取与写回）。",
    linkText: "Webhook/轮询等事件入口在 数据接入 → 管理",
    to: "/data-sources?tab=connections",
  },
} as const

/** 09-14 D4 拍板：术语表样张落地（新文案一律从表取；含已拍板分词）。 */
export const GLOSSARY: readonly { zh: string; en: string; scope: string; note: string }[] = [
  { zh: "数据源（事件）", en: "DataSource", scope: "数据接入 /api/v2/data-sources",
    note: "Webhook/轮询/测试事件入口；产出 SourceEvent，经 EventRoute 派发" },
  { zh: "数据资产", en: "Datasource + DataAsset", scope: "能力与资源 → 数据资产",
    note: "数据库连接与表/对象；禁止再译作「数据源」" },
  { zh: "连接（凭据）", en: "Connection", scope: "设置 → 连接",
    note: "协议端点+加密凭据+多环境；Secret 永不回显" },
  { zh: "自动任务", en: "AutomationDefinition", scope: "导航「自动任务」",
    note: "一次触发→一次 Invocation→一个执行体；不套批次" },
  { zh: "分析任务", en: "AnalysisTask", scope: "任务域 /batch-tasks",
    note: "数据集批量分析：TaskRun→N Run；与自动任务严格分词" },
  { zh: "工作项", en: "WorkItem", scope: "导航「任务」看板",
    note: "跨执行体统一投影卡（五态）；不是新执行实体" },
  { zh: "调用", en: "AutomationInvocation", scope: "自动任务运行历史",
    note: "一次触发的权威业务事实；目标 XOR（Session/Flow/Workflow Run）" },
  { zh: "事件路由 / 投递", en: "EventRoute / EventDelivery", scope: "数据接入 · 治理页",
    note: "路由=契约（destination 二选一）；投递=每路由一条流水（重试/死信独立）" },
] as const

/** MTC-002B：WorkItem 主状态中文映射（固定五组，顺序即泳道顺序）。 */
export const WORK_ITEM_STATUS_LABELS: Record<string, string> = {
  needs_action: "需要操作",
  running: "执行中",
  completed: "已完成",
  queued: "排队中",
  failed_cancelled: "失败/取消",
}

export const WORK_ITEM_STATUS_ORDER = [
  "needs_action", "running", "completed", "queued", "failed_cancelled",
] as const

export const WORK_ITEM_ORIGIN_LABELS: Record<string, string> = {
  manual: "手动", schedule: "调度", api: "API", backfill: "回填", unknown: "未知",
}

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
