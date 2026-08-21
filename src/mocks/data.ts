import type {
  AnalysisTask,
  AgentDetail,
  Connection,
  DataAsset,
  EvaluationAgent,
  InteractionExecution,
  QualityResult,
  ResultRuleSet,
  ResultRuleSetDetail,
  Run,
  Tool,
  ToolDetail,
} from "@/domain/types"
import { BRANDS, PRODUCT_CATEGORIES, SERVICERS, TEAMS, DEPARTMENTS } from "@/mocks/catalog"
import { SCENARIOS } from "@/mocks/scenarios"

/** 确定性伪随机：mock 数据在每次加载间保持稳定。 */
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = mulberry32(20260821)
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1))

const DAY = 24 * 60 * 60 * 1000
/** 原型基准“今天”：2026-08-21。 */
const TODAY = new Date("2026-08-21T12:00:00+08:00").getTime()

function iso(ts: number): string {
  return new Date(ts).toISOString()
}

function orgOf(servicerId: string) {
  const servicer = SERVICERS.find((s) => s.id === servicerId)!
  const team = TEAMS.find((t) => t.id === servicer.teamId)!
  const dept = DEPARTMENTS.find((d) => d.id === team.departmentId)!
  return {
    agentId: servicer.id,
    agentName: servicer.name,
    teamId: team.id,
    teamName: team.name,
    departmentId: dept.id,
    departmentName: dept.name,
  }
}

/* ------------------------------------------------------------------ */
/* Quality Results                                                     */
/* ------------------------------------------------------------------ */

const SCENARIO_WEIGHTS: { index: number; weight: number }[] = [
  { index: 1, weight: 0.68 }, // install good
  { index: 0, weight: 0.14 }, // repair reminder
  { index: 3, weight: 0.11 }, // return wrong
  { index: 2, weight: 0.07 }, // promise critical
]

function pickScenarioIndex(): number {
  const r = rand()
  let acc = 0
  for (const item of SCENARIO_WEIGHTS) {
    acc += item.weight
    if (r <= acc) return item.index
  }
  return 1
}

export const qualityResults: QualityResult[] = []

export const scenarioIdByInteraction: Record<string, string> = {}

function swapCategory(text: string, from: string, to: string): string {
  return from === to ? text : text.split(from).join(to)
}

let seq = 0
for (let day = 13; day >= 0; day--) {
  const count = int(8, 12)
  for (let i = 0; i < count; i++) {
    const scenario = SCENARIOS[pickScenarioIndex()]
    const category = pick(PRODUCT_CATEGORIES)
    const servicer = pick(SERVICERS)
    const dayStart = TODAY - day * DAY
    const hour = int(8, 20)
    const minute = int(0, 59)
    const ts = dayStart - (12 - hour) * 60 * 60 * 1000 + minute * 60 * 1000
    seq += 1
    const interactionId = `I-${new Date(ts).toISOString().slice(0, 10).replaceAll("-", "")}-${String(seq).padStart(4, "0")}`

    const failCount = scenario.sections.reduce(
      (acc, s) => acc + s.criteria.filter((c) => c.result === "FAIL").length,
      0,
    )
    const score =
      scenario.baseScore === 0
        ? undefined
        : Math.max(20, Math.min(100, scenario.baseScore + int(-6, 4)))

    const reviewRoll = rand()
    const review =
      reviewRoll < 0.55
        ? ({ status: "NONE" } as const)
        : reviewRoll < 0.78
          ? ({ status: "PENDING" } as const)
          : reviewRoll < 0.94
            ? ({
                status: "COMPLETED",
                reviewer: pick(["复核员·何莉", "复核员·马俊"]),
                reviewedAt: iso(ts + DAY / 2),
              } as const)
            : reviewRoll < 0.97
              ? ({ status: "IN_REVIEW", reviewer: "复核员·何莉" } as const)
              : ({ status: "REOPENED", reviewer: "质量管理员·林峰" } as const)

    scenarioIdByInteraction[interactionId] = scenario.id

    qualityResults.push({
      interactionId,
      interactionTime: iso(ts),
      durationSeconds: scenario.durationSeconds + int(-60, 90),
      org: orgOf(servicer.id),
      businessContext: {
        brand: pick(BRANDS),
        productCategory: category,
        serviceType: scenario.serviceType,
        issueTopic: scenario.issueTopic,
      },
      requestType: scenario.requestType,
      requestSummary: swapCategory(scenario.requestSummary, scenario.productCategory, category),
      score,
      risk: scenario.risk,
      critical: scenario.critical,
      issueCount: failCount,
      issueSummary: scenario.issueSummary,
      review,
      hasAudio: scenario.hasAudio,
      execution: {
        runId: "R-20260818-020001",
        taskId: "T-1001",
        status: "SUCCESS",
        agentVersion: "V7",
      },
    })
  }
}

/* ------------------------------------------------------------------ */
/* Analysis Tasks                                                      */
/* ------------------------------------------------------------------ */

export const tasks: AnalysisTask[] = [
  {
    id: "T-1001",
    name: "每日热线全量质检",
    description: "对上一自然日全部接通热线通话执行服务质量评价。",
    agentId: "AG-01",
    agentName: "服务质量评价",
    agentVersionPolicy: "Latest Published",
    dataAssetId: "DA-01",
    dataAssetName: "热线通话",
    scope: "全部接通通话",
    sampling: "全量",
    schedule: "每日 02:00",
    dataWindow: "上一自然日",
    status: "Active",
    lastRun: { runId: "R-20260821-020001", status: "RUNNING" },
    nextRunAt: "2026-08-22 02:00",
    updatedAt: "2026-08-12 10:20",
  },
  {
    id: "T-1002",
    name: "每日在线会话质检",
    description: "在线文本会话全量质检。",
    agentId: "AG-04",
    agentName: "在线会话质量评价",
    agentVersionPolicy: "Latest Published",
    dataAssetId: "DA-02",
    dataAssetName: "在线会话",
    scope: "全部在线会话",
    sampling: "全量",
    schedule: "每日 03:00",
    dataWindow: "上一自然日",
    status: "Active",
    lastRun: { runId: "R-20260820-030002", status: "SUCCESS", finishedAt: "2026-08-20 03:26" },
    nextRunAt: "2026-08-22 03:00",
    updatedAt: "2026-08-05 16:40",
  },
  {
    id: "T-1003",
    name: "维修场景专项",
    description: "维修服务场景每周专项质检。",
    agentId: "AG-01",
    agentName: "服务质量评价",
    agentVersionPolicy: "Fixed",
    fixedAgentVersion: "V7",
    dataAssetId: "DA-01",
    dataAssetName: "热线通话",
    scope: "serviceType = 维修服务",
    sampling: "全量",
    schedule: "每周一 04:00",
    dataWindow: "上一自然周",
    status: "Active",
    lastRun: { runId: "R-20260817-040003", status: "BLOCKED", finishedAt: "2026-08-17 04:01" },
    nextRunAt: "2026-08-24 04:00",
    updatedAt: "2026-07-28 09:12",
  },
  {
    id: "T-1004",
    name: "低技能坐席抽检",
    description: "初级坐席每日固定数量抽检。",
    agentId: "AG-01",
    agentName: "服务质量评价",
    agentVersionPolicy: "Latest Published",
    dataAssetId: "DA-01",
    dataAssetName: "热线通话",
    scope: "skill_level = 初级",
    sampling: "固定数量 200 条",
    schedule: "每日 05:00",
    dataWindow: "上一自然日",
    status: "Active",
    lastRun: { runId: "R-20260820-050004", status: "SUCCESS", finishedAt: "2026-08-20 05:18" },
    nextRunAt: "2026-08-22 05:00",
    updatedAt: "2026-08-01 11:05",
  },
  {
    id: "T-1005",
    name: "违规承诺专项排查",
    description: "针对违规承诺问题的一次性专项排查。",
    agentId: "AG-03",
    agentName: "违规承诺专项",
    agentVersionPolicy: "Fixed",
    fixedAgentVersion: "V2",
    dataAssetId: "DA-01",
    dataAssetName: "热线通话",
    scope: "serviceType ∈ 维修服务/技术咨询",
    sampling: "随机抽样 20%",
    schedule: "一次性",
    dataWindow: "2026-08-01 → 2026-08-07",
    status: "Inactive",
    lastRun: { runId: "R-20260808-100005", status: "CANCELLED" },
    updatedAt: "2026-08-08 10:30",
  },
  {
    id: "T-1006",
    name: "新人首月全量质检",
    description: "入职首月坐席全量质检，月度执行。",
    agentId: "AG-01",
    agentName: "服务质量评价",
    agentVersionPolicy: "Latest Published",
    dataAssetId: "DA-01",
    dataAssetName: "热线通话",
    scope: "入职时间 ≤ 30 天",
    sampling: "全量",
    schedule: "每月 1 日 06:00",
    dataWindow: "上一自然月",
    status: "Active",
    lastRun: { runId: "R-20260801-060006", status: "SUCCESS", finishedAt: "2026-08-01 06:44" },
    nextRunAt: "2026-09-01 06:00",
    updatedAt: "2026-07-15 14:22",
  },
]

/* ------------------------------------------------------------------ */
/* Runs & Executions                                                   */
/* ------------------------------------------------------------------ */

function makeRun(input: {
  id: string
  taskId: string
  status: Run["status"]
  startedAt: string
  finishedAt?: string
  duration?: string
  windowLabel: string
  windowStart: string
  windowEnd: string
  agentVersion?: string
  assetRevision?: number
  summary?: Run["summary"]
  errors?: Run["errors"]
  blockedReason?: string
}): Run {
  const task = tasks.find((t) => t.id === input.taskId)!
  return {
    id: input.id,
    taskId: task.id,
    taskName: task.name,
    status: input.status,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    duration: input.duration,
    dataWindow: { start: input.windowStart, end: input.windowEnd, label: input.windowLabel },
    snapshot: {
      agentName: task.agentName,
      agentVersion: input.agentVersion ?? "V7",
      dataAssetName: task.dataAssetName,
      dataAssetRevision: input.assetRevision ?? 13,
      resultRulesVersion: "V4",
      scope: task.scope,
      sampling: task.sampling,
      runtime: "agent-runtime 2.4.1",
      toolVersions: [
        { toolName: "查询服务请求", version: "V2" },
        { toolName: "搜索知识", version: "V4" },
        { toolName: "查询产品信息", version: "V1" },
      ],
      inputMapping: [
        { agentInput: "interaction_id", assetField: "call_id" },
        { agentInput: "transcript", assetField: "asr_text" },
        { agentInput: "agent_id", assetField: "servicer_id" },
        { agentInput: "start_time", assetField: "call_start_time" },
        { agentInput: "phone_number", assetField: "consumer_phone" },
      ],
    },
    summary: input.summary ?? { input: 0, success: 0, skipped: 0, error: 0 },
    errors: input.errors,
    blockedReason: input.blockedReason,
  }
}

export const runs: Run[] = [
  makeRun({
    id: "R-20260821-020001",
    taskId: "T-1001",
    status: "RUNNING",
    startedAt: "2026-08-21T02:00:00+08:00",
    windowLabel: "2026-08-20 全天",
    windowStart: "2026-08-20 00:00",
    windowEnd: "2026-08-21 00:00",
    summary: { input: 118, success: 74, skipped: 2, error: 1 },
  }),
  makeRun({
    id: "R-20260820-020001",
    taskId: "T-1001",
    status: "SUCCESS",
    startedAt: "2026-08-20T02:00:00+08:00",
    finishedAt: "2026-08-20T02:38:00+08:00",
    duration: "38m 12s",
    windowLabel: "2026-08-19 全天",
    windowStart: "2026-08-19 00:00",
    windowEnd: "2026-08-20 00:00",
    summary: { input: 121, success: 117, skipped: 3, error: 1 },
    errors: [{ type: "Tool timeout", count: 1 }],
  }),
  makeRun({
    id: "R-20260819-020001",
    taskId: "T-1001",
    status: "PARTIAL_SUCCESS",
    startedAt: "2026-08-19T02:00:00+08:00",
    finishedAt: "2026-08-19T02:52:00+08:00",
    duration: "52m 40s",
    windowLabel: "2026-08-18 全天",
    windowStart: "2026-08-18 00:00",
    windowEnd: "2026-08-19 00:00",
    summary: { input: 126, success: 108, skipped: 4, error: 14 },
    errors: [
      { type: "Tool timeout", count: 9 },
      { type: "Structured output invalid", count: 5 },
    ],
  }),
  makeRun({
    id: "R-20260818-020001",
    taskId: "T-1001",
    status: "SUCCESS",
    startedAt: "2026-08-18T02:00:00+08:00",
    finishedAt: "2026-08-18T02:42:00+08:00",
    duration: "42m 18s",
    windowLabel: "2026-08-17 全天",
    windowStart: "2026-08-17 00:00",
    windowEnd: "2026-08-18 00:00",
    summary: { input: 124, success: 118, skipped: 3, error: 3 },
    errors: [
      { type: "Tool timeout", count: 2 },
      { type: "Missing required input", count: 1 },
    ],
  }),
  makeRun({
    id: "R-20260817-020001",
    taskId: "T-1001",
    status: "SUCCESS",
    startedAt: "2026-08-17T02:00:00+08:00",
    finishedAt: "2026-08-17T02:40:00+08:00",
    duration: "40m 02s",
    windowLabel: "2026-08-16 全天",
    windowStart: "2026-08-16 00:00",
    windowEnd: "2026-08-17 00:00",
    summary: { input: 98, success: 96, skipped: 2, error: 0 },
  }),
  makeRun({
    id: "R-20260817-040003",
    taskId: "T-1003",
    status: "BLOCKED",
    startedAt: "2026-08-17T04:00:00+08:00",
    finishedAt: "2026-08-17T04:01:00+08:00",
    duration: "48s",
    windowLabel: "2026-08-10 → 2026-08-16",
    windowStart: "2026-08-10 00:00",
    windowEnd: "2026-08-17 00:00",
    summary: { input: 0, success: 0, skipped: 0, error: 0 },
    blockedReason:
      "Data Asset 当前不可用：热线通话 · Revision 13，Health: Error，Schema missing: transcript",
  }),
  makeRun({
    id: "R-20260818-090007",
    taskId: "T-1002",
    status: "FAILED",
    startedAt: "2026-08-18T03:00:00+08:00",
    finishedAt: "2026-08-18T03:06:00+08:00",
    duration: "6m 11s",
    windowLabel: "2026-08-17 全天",
    windowStart: "2026-08-17 00:00",
    windowEnd: "2026-08-18 00:00",
    agentVersion: "V1",
    assetRevision: 8,
    summary: { input: 86, success: 12, skipped: 0, error: 74 },
    errors: [{ type: "Structured output invalid", count: 74 }],
  }),
  makeRun({
    id: "R-20260820-030002",
    taskId: "T-1002",
    status: "SUCCESS",
    startedAt: "2026-08-20T03:00:00+08:00",
    finishedAt: "2026-08-20T03:26:00+08:00",
    duration: "26m 33s",
    windowLabel: "2026-08-19 全天",
    windowStart: "2026-08-19 00:00",
    windowEnd: "2026-08-20 00:00",
    agentVersion: "V1",
    assetRevision: 8,
    summary: { input: 92, success: 90, skipped: 2, error: 0 },
  }),
  makeRun({
    id: "R-20260820-050004",
    taskId: "T-1004",
    status: "SUCCESS",
    startedAt: "2026-08-20T05:00:00+08:00",
    finishedAt: "2026-08-20T05:18:00+08:00",
    duration: "18m 05s",
    windowLabel: "2026-08-19 全天",
    windowStart: "2026-08-19 00:00",
    windowEnd: "2026-08-20 00:00",
    summary: { input: 200, success: 194, skipped: 4, error: 2 },
    errors: [{ type: "Tool timeout", count: 2 }],
  }),
  makeRun({
    id: "R-20260808-100005",
    taskId: "T-1005",
    status: "CANCELLED",
    startedAt: "2026-08-08T10:00:00+08:00",
    finishedAt: "2026-08-08T10:12:00+08:00",
    duration: "12m 20s",
    windowLabel: "2026-08-01 → 2026-08-07",
    windowStart: "2026-08-01 00:00",
    windowEnd: "2026-08-08 00:00",
    agentVersion: "V2",
    summary: { input: 340, success: 122, skipped: 0, error: 0 },
  }),
  makeRun({
    id: "R-20260801-060006",
    taskId: "T-1006",
    status: "SUCCESS",
    startedAt: "2026-08-01T06:00:00+08:00",
    finishedAt: "2026-08-01T06:44:00+08:00",
    duration: "44m 51s",
    windowLabel: "2026-07 全月",
    windowStart: "2026-07-01 00:00",
    windowEnd: "2026-08-01 00:00",
    summary: { input: 412, success: 401, skipped: 8, error: 3 },
    errors: [{ type: "Tool timeout", count: 3 }],
  }),
]

const ERROR_TYPES = ["Tool timeout", "Structured output invalid", "Missing required input"] as const

function makeExecutions(run: Run, count: number): InteractionExecution[] {
  const list: InteractionExecution[] = []
  for (let i = 0; i < count; i++) {
    const servicer = pick(SERVICERS)
    const scenario = SCENARIOS[pickScenarioIndex()]
    const roll = rand()
    const status: InteractionExecution["status"] =
      roll < 0.9 ? "SUCCESS" : roll < 0.96 ? "ERROR" : "SKIPPED"
    const errorType = status === "ERROR" ? pick(ERROR_TYPES) : undefined
    const attempts =
      status === "ERROR"
        ? [
            { no: 1, status: "ERROR" as const, error: errorType },
            { no: 2, status: "ERROR" as const, error: errorType },
          ]
        : status === "SUCCESS" && rand() < 0.12
          ? [
              { no: 1, status: "ERROR" as const, error: "Tool timeout" },
              { no: 2, status: "SUCCESS" as const },
            ]
          : [{ no: 1, status }]
    list.push({
      id: `${run.id}-E${String(i + 1).padStart(4, "0")}`,
      runId: run.id,
      interactionId: `I-${run.dataWindow.start.slice(0, 10).replaceAll("-", "")}-${String(i + 1).padStart(4, "0")}`,
      agentName: servicer.name,
      teamName: TEAMS.find((t) => t.id === servicer.teamId)!.name,
      businessContext: {
        brand: pick(BRANDS),
        productCategory: scenario.productCategory,
        serviceType: scenario.serviceType,
        issueTopic: scenario.issueTopic,
      },
      status,
      risk: status === "SUCCESS" ? scenario.risk : undefined,
      score: status === "SUCCESS" ? scenario.baseScore : undefined,
      duration: status === "SKIPPED" ? undefined : `${(rand() * 4 + 0.8).toFixed(1)}s`,
      errorType,
      attempts,
    })
  }
  return list
}

export const executionsByRun: Record<string, InteractionExecution[]> = {
  "R-20260818-020001": makeExecutions(runs.find((r) => r.id === "R-20260818-020001")!, 124),
  "R-20260819-020001": makeExecutions(runs.find((r) => r.id === "R-20260819-020001")!, 126),
  "R-20260820-020001": makeExecutions(runs.find((r) => r.id === "R-20260820-020001")!, 121),
  "R-20260821-020001": makeExecutions(runs.find((r) => r.id === "R-20260821-020001")!, 77),
  "R-20260817-020001": makeExecutions(runs.find((r) => r.id === "R-20260817-020001")!, 98),
  "R-20260818-090007": makeExecutions(runs.find((r) => r.id === "R-20260818-090007")!, 86),
  "R-20260820-030002": makeExecutions(runs.find((r) => r.id === "R-20260820-030002")!, 92),
  "R-20260820-050004": makeExecutions(runs.find((r) => r.id === "R-20260820-050004")!, 60),
}

/* ------------------------------------------------------------------ */
/* Agents                                                              */
/* ------------------------------------------------------------------ */

export const agents: EvaluationAgent[] = [
  { id: "AG-01", name: "服务质量评价", description: "热线通话服务质量全量评价，输出 quality_result 与 interaction_labels。", currentVersion: "V8 · Draft", status: "Published", updatedAt: "2026-08-20 18:22", updatedBy: "质量管理员·林峰" },
  { id: "AG-02", name: "消费者诉求识别", description: "识别 Interaction 的业务语境与消费者诉求。", currentVersion: "V3", status: "Published", updatedAt: "2026-08-11 09:40", updatedBy: "质量管理员·林峰" },
  { id: "AG-03", name: "违规承诺专项", description: "针对违规承诺话术的专项检测 Agent。", currentVersion: "V2", status: "Testing", updatedAt: "2026-08-19 15:12", updatedBy: "Agent 编辑·韩雪" },
  { id: "AG-04", name: "在线会话质量评价", description: "在线文本会话质量评价。", currentVersion: "V1", status: "Published", updatedAt: "2026-07-30 10:02", updatedBy: "质量管理员·林峰" },
  { id: "AG-05", name: "IVR 进入标记", description: "IVR 进入记录基础状态标记（已由数据资产规则替代）。", currentVersion: "V2", status: "Deprecated", updatedAt: "2026-06-18 14:47", updatedBy: "质量管理员·林峰" },
  { id: "AG-06", name: "新人辅导辅助", description: "基于质检结果生成新人辅导要点（草稿）。", currentVersion: "V1 · Draft", status: "Draft", updatedAt: "2026-08-16 11:26", updatedBy: "Agent 编辑·韩雪" },
]

export const agentDetails: Record<string, AgentDetail> = {
  "AG-01": {
    ...agents[0],
    inputSchema: [
      { key: "interaction_id", type: "String", required: true, description: "Interaction 唯一标识" },
      { key: "transcript", type: "String", required: true, description: "ASR 文本" },
      { key: "agent_id", type: "String", required: true, description: "坐席 ID" },
      { key: "start_time", type: "DateTime", required: true, description: "通话开始时间" },
      { key: "phone_number", type: "String", required: false, description: "消费者电话（用于业务事实查询）" },
    ],
    structuredOutputs: [
      { name: "quality_result", description: "按 Section / Criterion 的结构化评价结果", schema: "{ section, criterion, result, reason, evidence, confidence, severity }[]" },
      { name: "interaction_labels", description: "业务语境与诉求标签", schema: "{ brand, product_category, service_type, issue_topic, request_type, request_summary }" },
    ],
    versions: [
      { version: "V8", status: "Draft", versionNote: "增加违规承诺并行判断分支" },
      { version: "V7", status: "Published", publishedAt: "2026-08-02 10:12", publishedBy: "质量管理员·林峰", versionNote: "上线必要催促评价项" },
      { version: "V6", status: "Deprecated", publishedAt: "2026-07-12 09:00", publishedBy: "质量管理员·林峰", versionNote: "初始全量评价版本" },
    ],
    graph: {
      nodes: [
        { id: "n-input", kind: "input", name: "Interaction 输入", description: "Input Schema", position: { x: 0, y: 160 }, config: {} },
        { id: "n-llm-request", kind: "llm", name: "识别消费者诉求", description: "LLM · 诉求与业务语境", position: { x: 280, y: 40 }, config: { model: "qwen-max", prompt: "识别消费者诉求与业务语境…", variables: ["transcript"] } },
        { id: "n-tool-sr", kind: "tool", name: "查询服务请求", description: "Tool V2 · READ", position: { x: 280, y: 280 }, config: { toolId: "TL-01", toolVersion: "V2" } },
        { id: "n-llm-flow", kind: "llm", name: "评价服务流程", description: "LLM · 流程与催促", position: { x: 560, y: 160 }, config: { model: "qwen-max", prompt: "基于服务单事实评价流程执行…" } },
        { id: "n-llm-promise", kind: "llm", name: "判断违规承诺", description: "LLM · 合规", position: { x: 560, y: 400 }, config: { model: "qwen-max", prompt: "判断是否存在超范围承诺…" } },
        { id: "n-cond", kind: "condition", name: "是否存在历史超期单", description: "Condition", position: { x: 560, y: -80 }, config: { expression: "tool.sr.overdue == true" } },
        { id: "n-transform", kind: "transform", name: "汇总结构化结果", description: "Transform", position: { x: 840, y: 160 }, config: {} },
        { id: "n-record", kind: "create-record", name: "Create Quality Record", description: "Sink · 持久化业务结果", position: { x: 1120, y: 160 }, config: { idempotency: "interaction_id + run_id" } },
        { id: "n-end", kind: "end", name: "结束", description: "Terminal", position: { x: 1400, y: 160 }, config: {} },
      ],
      edges: [
        { id: "e1", source: "n-input", target: "n-llm-request" },
        { id: "e2", source: "n-input", target: "n-tool-sr" },
        { id: "e3", source: "n-llm-request", target: "n-cond" },
        { id: "e4", source: "n-tool-sr", target: "n-llm-flow" },
        { id: "e5", source: "n-cond", target: "n-llm-flow", sourceHandle: "if", label: "if" },
        { id: "e6", source: "n-cond", target: "n-llm-promise", sourceHandle: "else", label: "else" },
        { id: "e7", source: "n-llm-flow", target: "n-transform" },
        { id: "e8", source: "n-llm-promise", target: "n-transform" },
        { id: "e9", source: "n-transform", target: "n-record" },
        { id: "e10", source: "n-record", target: "n-end" },
      ],
    },
    lastTestPassed: true,
    changedSinceTest: true,
  },
}

/* ------------------------------------------------------------------ */
/* Tools                                                               */
/* ------------------------------------------------------------------ */

export const tools: Tool[] = [
  { id: "TL-01", name: "查询服务请求", description: "按电话号码 / 时间查询消费者历史服务请求与状态。", source: "API", capability: "READ", governance: "Enabled", currentVersion: "V2", versionStatus: "Published", connectionId: "CN-02", connectionName: "工单系统", requiresApproval: false, updatedAt: "2026-08-10 16:20", lastTestPassed: true },
  { id: "TL-02", name: "搜索知识", description: "在知识库中检索产品与政策知识。", source: "API", capability: "READ", governance: "Enabled", currentVersion: "V4", versionStatus: "Published", connectionId: "CN-03", connectionName: "知识库 API", requiresApproval: false, updatedAt: "2026-08-14 10:05", lastTestPassed: true },
  { id: "TL-03", name: "查询产品信息", description: "查询产品型号、保修状态等主数据。", source: "API", capability: "READ", governance: "Enabled", currentVersion: "V1", versionStatus: "Published", connectionId: "CN-01", connectionName: "CRM 系统", requiresApproval: false, updatedAt: "2026-07-22 09:30", lastTestPassed: true },
  { id: "TL-04", name: "查询催促记录", description: "查询服务单的催促与跟进记录。", source: "API", capability: "READ", governance: "Enabled", currentVersion: "V1", versionStatus: "Published", connectionId: "CN-02", connectionName: "工单系统", requiresApproval: false, updatedAt: "2026-07-25 14:12", lastTestPassed: true },
  { id: "TL-05", name: "更新服务请求", description: "更新服务请求节点 / 添加跟进记录（WRITE，需审批）。", source: "API", capability: "WRITE", governance: "Enabled", currentVersion: "V2", versionStatus: "Published", connectionId: "CN-02", connectionName: "工单系统", requiresApproval: true, updatedAt: "2026-08-06 11:48", lastTestPassed: true },
  { id: "TL-06", name: "查询短信日志", description: "查询下发给消费者的短信日志。", source: "API", capability: "READ", governance: "Enabled", currentVersion: "V1", versionStatus: "Draft", connectionId: "CN-04", connectionName: "短信平台", requiresApproval: false, updatedAt: "2026-08-19 17:33", lastTestPassed: false },
  { id: "TL-07", name: "查询消费者信息", description: "查询消费者基础信息与偏好（紧急停用中）。", source: "API", capability: "READ", governance: "Disabled", currentVersion: "V3", versionStatus: "Published", connectionId: "CN-01", connectionName: "CRM 系统", requiresApproval: false, updatedAt: "2026-08-18 08:15", lastTestPassed: true },
  { id: "TL-08", name: "外呼通知", description: "触发外呼通知任务（ACTION，需审批）。", source: "API", capability: "ACTION", governance: "Disabled", currentVersion: "V1", versionStatus: "Published", connectionId: "CN-05", connectionName: "外呼系统", requiresApproval: true, updatedAt: "2026-06-30 15:40", lastTestPassed: true },
  { id: "TL-09", name: "数据推送", description: "向下游系统推送数据（已弃用，建议迁移）。", source: "API", capability: "WRITE", governance: "Deprecated", currentVersion: "V2", versionStatus: "Published", connectionId: "CN-04", connectionName: "短信平台", requiresApproval: true, updatedAt: "2026-05-12 10:00", lastTestPassed: true },
  { id: "TL-10", name: "时间格式转换", description: "平台内置时间格式 / 时区转换能力。", source: "Built-in", capability: "READ", governance: "Enabled", currentVersion: "V1", versionStatus: "Published", requiresApproval: false, updatedAt: "2026-04-01 09:00", lastTestPassed: true },
]

export const toolDetails: Record<string, ToolDetail> = Object.fromEntries(
  tools.map((tool) => [
    tool.id,
    {
      ...tool,
      http: {
        method: tool.capability === "READ" ? "GET" : "POST",
        path: tool.id === "TL-01" ? "/api/v1/service-requests" : `/api/v1/${tool.id.toLowerCase()}`,
        headers: [{ key: "X-Trace-Id", value: "{{system.trace_id}}" }],
        queryParams: tool.id === "TL-01" ? [{ key: "phone", value: "{{phone_number}}" }] : [],
        body: tool.capability === "READ" ? undefined : '{ "payload": "{{input}}" }',
      },
      inputContract: [
        { name: "phone_number", type: "String", required: true, location: "Query", requestKey: "phone" },
        { name: "days", type: "Number", required: false, location: "Query", requestKey: "days" },
      ],
      outputContract: [
        { name: "request_id", type: "String", description: "服务请求 ID" },
        { name: "status", type: "String", description: "服务单状态" },
        { name: "created_at", type: "DateTime", description: "创建时间" },
        { name: "overdue", type: "Boolean", description: "是否超期" },
      ],
      versions: [
        { version: tool.currentVersion, status: tool.versionStatus, publishedAt: tool.updatedAt, versionNote: "当前版本" },
        { version: "V1", status: "Published", publishedAt: "2026-05-02 10:00", versionNote: "初始版本" },
      ],
      permission: "Agent Editor 可引用 · Tool Admin 可管理",
    } satisfies ToolDetail,
  ]),
)

/* ------------------------------------------------------------------ */
/* Data Assets                                                         */
/* ------------------------------------------------------------------ */

export const dataAssets: DataAsset[] = [
  {
    id: "DA-01",
    name: "热线通话",
    description: "热线接通通话记录，含 ASR 文本。",
    source: "数仓 · dwd_hotline_call_di",
    recordMeaning: "一通电话",
    recordIdField: "call_id",
    timeField: "call_start_time",
    timeFieldLabel: "通话开始时间",
    lifecycle: "Ready",
    health: "Healthy",
    currentRevision: 13,
    updatedAt: "2026-08-15 09:20",
    schema: [
      { key: "call_id", displayName: "通话 ID", type: "String", required: true, description: "Record ID" },
      { key: "asr_text", displayName: "ASR 文本", type: "String", required: true },
      { key: "servicer_id", displayName: "坐席 ID", type: "String", required: true },
      { key: "call_start_time", displayName: "通话开始时间", type: "DateTime", required: true },
      { key: "consumer_phone", displayName: "消费者电话", type: "String", required: false },
      { key: "connected", displayName: "是否接通", type: "Boolean", required: true },
      { key: "duration", displayName: "通话时长(秒)", type: "Number", required: false },
    ],
    eligibility: ["connected = true", "asr_text IS NOT NULL", "duration > 0"],
  },
  {
    id: "DA-02",
    name: "在线会话",
    description: "在线文本会话记录。",
    source: "数仓 · dwd_online_session_di",
    recordMeaning: "一次在线会话",
    recordIdField: "session_id",
    timeField: "session_start_time",
    timeFieldLabel: "会话开始时间",
    lifecycle: "Ready",
    health: "Healthy",
    currentRevision: 8,
    updatedAt: "2026-08-09 13:44",
    schema: [
      { key: "session_id", displayName: "会话 ID", type: "String", required: true },
      { key: "chat_text", displayName: "会话文本", type: "String", required: true },
      { key: "servicer_id", displayName: "坐席 ID", type: "String", required: true },
      { key: "session_start_time", displayName: "会话开始时间", type: "DateTime", required: true },
    ],
    eligibility: ["chat_text IS NOT NULL"],
  },
  {
    id: "DA-03",
    name: "消费者工单",
    description: "消费者服务工单（含退换货 / 投诉）。",
    source: "工单系统 · view_consumer_ticket",
    recordMeaning: "一张工单",
    recordIdField: "ticket_id",
    timeField: "ticket_created_at",
    timeFieldLabel: "工单创建时间",
    lifecycle: "Ready",
    health: "Degraded",
    currentRevision: 5,
    updatedAt: "2026-08-17 18:02",
    schema: [
      { key: "ticket_id", displayName: "工单 ID", type: "String", required: true },
      { key: "ticket_type", displayName: "工单类型", type: "String", required: true },
      { key: "ticket_created_at", displayName: "创建时间", type: "DateTime", required: true },
      { key: "consumer_phone", displayName: "消费者电话", type: "String", required: false },
    ],
    eligibility: ["ticket_type IS NOT NULL"],
  },
  {
    id: "DA-04",
    name: "IVR 进入记录",
    description: "进入 IVR 但未接通的交互记录，仅保留基础状态 / 标记。",
    source: "数仓 · ods_ivr_enter_di",
    recordMeaning: "一次 IVR 进入",
    recordIdField: "ivr_id",
    timeField: "enter_time",
    timeFieldLabel: "进入时间",
    lifecycle: "Draft",
    health: "Healthy",
    currentRevision: 0,
    updatedAt: "2026-08-19 10:15",
    schema: [
      { key: "ivr_id", displayName: "IVR ID", type: "String", required: true },
      { key: "enter_time", displayName: "进入时间", type: "DateTime", required: true },
      { key: "consumer_phone", displayName: "消费者电话", type: "String", required: false },
    ],
    eligibility: [],
  },
  {
    id: "DA-05",
    name: "AI Agent 执行记录",
    description: "AI Agent 运行记录（上游链路异常，已弃用）。",
    source: "数仓 · dwd_agent_run_di",
    recordMeaning: "一次 Agent 执行",
    recordIdField: "run_id",
    timeField: "run_time",
    timeFieldLabel: "执行时间",
    lifecycle: "Deprecated",
    health: "Error",
    currentRevision: 3,
    updatedAt: "2026-06-20 09:00",
    schema: [
      { key: "run_id", displayName: "执行 ID", type: "String", required: true },
      { key: "run_time", displayName: "执行时间", type: "DateTime", required: true },
    ],
    eligibility: [],
  },
]

/* ------------------------------------------------------------------ */
/* Result Rules                                                        */
/* ------------------------------------------------------------------ */

export const resultRuleSets: ResultRuleSet[] = [
  { id: "RR-01", name: "服务质量结果规则", description: "热线服务质量评价的评分 / 风险 / 等级派生规则。", agentId: "AG-01", agentName: "服务质量评价", currentVersion: "V5 · Draft", versionStatus: "Published", evaluationPriority: "Most Recent Completed", updatedAt: "2026-08-20 09:30" },
  { id: "RR-02", name: "在线会话结果规则", description: "在线会话质量评价派生规则。", agentId: "AG-04", agentName: "在线会话质量评价", currentVersion: "V2", versionStatus: "Published", evaluationPriority: "Most Recent Completed", updatedAt: "2026-07-28 15:10" },
  { id: "RR-03", name: "违规承诺专项规则", description: "违规承诺专项的风险派生规则（草稿）。", agentId: "AG-03", agentName: "违规承诺专项", currentVersion: "V1 · Draft", versionStatus: "Draft", evaluationPriority: "Initial Completed", updatedAt: "2026-08-19 16:44" },
]

export const resultRuleDetails: Record<string, ResultRuleSetDetail> = {
  "RR-01": {
    ...resultRuleSets[0],
    scoreRules: [
      { id: "sr1", criterion: "消费者诉求识别", resultType: "Pass / Fail", scoringRule: "PASS → 15 · FAIL → 0", weight: 15 },
      { id: "sr2", criterion: "确认消费者真实诉求", resultType: "Pass / Fail", scoringRule: "PASS → 20 · FAIL → 0", weight: 20 },
      { id: "sr3", criterion: "服务请求创建正确性", resultType: "Pass / Fail", scoringRule: "PASS → 20 · FAIL → 0", weight: 20 },
      { id: "sr4", criterion: "必要催促执行", resultType: "Pass / Fail", scoringRule: "PASS → 15 · FAIL → 0", weight: 15 },
      { id: "sr5", criterion: "违规承诺", resultType: "Pass / Fail", scoringRule: "PASS → 20 · FAIL → 0", weight: 20 },
      { id: "sr6", criterion: "开场与结束规范", resultType: "Pass / Fail", scoringRule: "PASS → 10 · FAIL → 0", weight: 10 },
    ],
    overall: { rule: "总分 ≥ 80 且无 Critical 为 Overall Pass", passLine: 80 },
    criticalRules: [
      { id: "cr1", condition: "违规承诺 = FAIL", effect: "Overall Score = 0 · Risk = Critical" },
      { id: "cr2", condition: "信息安全合规 = FAIL", effect: "Overall Score = 0 · Risk = Critical" },
    ],
    riskMapping: [
      { id: "rm1", condition: "存在 Critical", risk: "Critical" },
      { id: "rm2", condition: "总分 < 60", risk: "High" },
      { id: "rm3", condition: "总分 60–79 或存在 High 问题", risk: "Medium" },
      { id: "rm4", condition: "其他", risk: "Low" },
    ],
    levels: [
      { id: "lv1", range: "≥ 90", level: "A" },
      { id: "lv2", range: "80–89", level: "B" },
      { id: "lv3", range: "60–79", level: "C" },
      { id: "lv4", range: "< 60", level: "D" },
    ],
    derivedLabels: [
      { id: "dl1", condition: "必要催促执行 = FAIL", label: "催促缺失" },
      { id: "dl2", condition: "服务请求创建正确性 = FAIL", label: "建单错误" },
    ],
    versions: [
      { version: "V5", status: "Draft", versionNote: "调整催促权重 10 → 15" },
      { version: "V4", status: "Published", publishedAt: "2026-08-02 10:20", publishedBy: "质量管理员·林峰", versionNote: "上线违规承诺 Critical 规则" },
      { version: "V3", status: "Published", publishedAt: "2026-07-01 09:00", publishedBy: "质量管理员·林峰", versionNote: "权重初版（已被 V4 替代）" },
    ],
  },
}

/* ------------------------------------------------------------------ */
/* Connections                                                         */
/* ------------------------------------------------------------------ */

export const connections: Connection[] = [
  { id: "CN-01", name: "CRM 系统", endpoint: "https://crm.internal.example.com", authType: "API Key", secretConfigured: true, requiredHeaders: ["X-App-Id"], status: "Connected", updatedAt: "2026-08-12 10:10" },
  { id: "CN-02", name: "工单系统", endpoint: "https://ticket.internal.example.com", authType: "Bearer Token", secretConfigured: true, status: "Connected", updatedAt: "2026-08-16 14:25" },
  { id: "CN-03", name: "知识库 API", endpoint: "https://kb.internal.example.com", authType: "API Key", secretConfigured: true, status: "Connected", updatedAt: "2026-07-30 09:12" },
  { id: "CN-04", name: "短信平台", endpoint: "https://sms.internal.example.com", authType: "Basic Auth", secretConfigured: true, status: "Failed", updatedAt: "2026-08-20 08:02" },
  { id: "CN-05", name: "外呼系统", endpoint: "https://call.internal.example.com", authType: "Bearer Token", secretConfigured: false, status: "Not Tested", updatedAt: "2026-06-25 11:30" },
]
