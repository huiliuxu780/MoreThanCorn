import type {
  AgentDetail,
  AnalysisTask,
  Connection,
  DataAsset,
  DataAssetRevisionInfo,
  EvaluationAgent,
  InteractionExecution,
  ListParams,
  ListResponse,
  QualityResult,
  QualityResultDetail,
  ResultRuleSet,
  ResultRuleSetDetail,
  Run,
  Tool,
  ToolDetail,
} from "@/domain/types"
import { parseListFilters } from "@/lib/list-filters"
import {
  agents,
  agentDetails,
  connections,
  dataAssets,
  executionsByRun,
  qualityResults,
  resultRuleDetails,
  resultRuleSets,
  runs,
  scenarioIdByInteraction,
  tasks,
  toolDetails,
  tools,
} from "@/mocks/data"
import { SCENARIOS } from "@/mocks/scenarios"
import { CRITERIA_CATALOG, criterionSeverity } from "@/mocks/catalog"

const LATENCY = 120
function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), LATENCY))
}



function failedCriteria(result: QualityResult): string[] {
  const scenario = SCENARIOS.find((s) => s.id === scenarioIdByInteraction[result.interactionId])
  if (!scenario) return []
  return scenario.sections
    .flatMap((s) => s.criteria)
    .filter((c) => c.result === "FAIL")
    .map((c) => c.criterion)
}

/* ------------------------------------------------------------------ */
/* 通用列表工具                                                         */
/* ------------------------------------------------------------------ */

function paginate<T>(items: T[], params: ListParams): ListResponse<T> {
  const page = params.page ?? 1
  const pageSize = params.pageSize ?? 20
  const start = (page - 1) * pageSize
  return { items: items.slice(start, start + pageSize), total: items.length, page, pageSize }
}

function matchSearch(text: string, search?: string): boolean {
  if (!search) return true
  return text.toLowerCase().includes(search.toLowerCase())
}

/* ------------------------------------------------------------------ */
/* Quality Results                                                     */
/* ------------------------------------------------------------------ */

const RISK_ORDER: Record<string, number> = { Critical: 4, High: 3, Medium: 2, Low: 1 }

export function listQualityResults(params: ListParams): Promise<ListResponse<QualityResult>> {
  const filters = parseListFilters(params.filters)
  let items = [...qualityResults]

  if (params.tab === "pending") items = items.filter((r) => r.review.status === "PENDING" || r.review.status === "IN_REVIEW" || r.review.status === "REOPENED")
  if (params.tab === "reviewed") items = items.filter((r) => r.review.status === "COMPLETED")

  items = items.filter((r) =>
    matchSearch(`${r.interactionId} ${r.org.agentName} ${r.requestSummary}`, params.search),
  )

  if (filters.risk) items = items.filter((r) => r.risk === filters.risk)
  if (filters.team) items = items.filter((r) => r.org.teamName === filters.team)
  if (filters.department) items = items.filter((r) => r.org.departmentName === filters.department)
  if (filters.agent) items = items.filter((r) => r.org.agentName === filters.agent)
  if (filters.serviceType) items = items.filter((r) => r.businessContext.serviceType === filters.serviceType)
  if (filters.brand) items = items.filter((r) => r.businessContext.brand === filters.brand)
  if (filters.productCategory) items = items.filter((r) => r.businessContext.productCategory === filters.productCategory)
  if (filters.issue) items = items.filter((r) => r.businessContext.issueTopic === filters.issue)
  if (filters.requestType) items = items.filter((r) => r.requestType === filters.requestType)
  if (filters.reviewStatus) {
    if (filters.reviewStatus === "待复核") items = items.filter((r) => r.review.status === "PENDING")
    if (filters.reviewStatus === "已复核") items = items.filter((r) => r.review.status === "COMPLETED")
    if (filters.reviewStatus === "AI/人工不一致")
      items = items.filter((r) => r.review.status === "COMPLETED" && scenarioIdByInteraction[r.interactionId] !== "sc-install-good")
  }
  if (filters.criterion) items = items.filter((r) => failedCriteria(r).includes(filters.criterion))
  if (filters.section) {
    items = items.filter((r) => {
      const scenario = SCENARIOS.find((s) => s.id === scenarioIdByInteraction[r.interactionId])
      return scenario?.sections.some((s) => s.section === filters.section && s.criteria.some((c) => c.result === "FAIL"))
    })
  }
  if (filters.quality === "有问题") items = items.filter((r) => r.issueCount > 0)
  if (filters.quality === "Critical") items = items.filter((r) => r.critical)

  const sort = params.sort || "time:desc"
  items.sort((a, b) => {
    switch (sort) {
      case "time:asc":
        return a.interactionTime.localeCompare(b.interactionTime)
      case "score:desc":
        return (b.score ?? -1) - (a.score ?? -1)
      case "score:asc":
        return (a.score ?? 101) - (b.score ?? 101)
      case "risk:desc":
        return (RISK_ORDER[b.risk ?? ""] ?? 0) - (RISK_ORDER[a.risk ?? ""] ?? 0)
      default:
        return b.interactionTime.localeCompare(a.interactionTime)
    }
  })

  return delay(paginate(items, params))
}

export function getQualityResultCounts(): Promise<{ all: number; pending: number; reviewed: number }> {
  const pending = qualityResults.filter((r) => ["PENDING", "IN_REVIEW", "REOPENED"].includes(r.review.status)).length
  const reviewed = qualityResults.filter((r) => r.review.status === "COMPLETED").length
  return delay({ all: qualityResults.length, pending, reviewed })
}

export function getQualityResult(interactionId: string): Promise<QualityResultDetail | null> {
  const base = qualityResults.find((r) => r.interactionId === interactionId)
  if (!base) return delay(null)
  const scenario = SCENARIOS.find((s) => s.id === scenarioIdByInteraction[interactionId])!

  const sections = scenario.sections.map((section) => ({
    section: section.section,
    criteria: section.criteria.map((criterion) => {
      // 已复核样本：演示 AI / 人工差异（人工修正首个 FAIL 项）。
      if (base.review.status === "COMPLETED" && criterion.result === "FAIL") {
        return {
          ...criterion,
          section: section.section,
          human: {
            result: "PASS" as const,
            comment: "复核确认：结合业务事实，该项实际已执行，修正为 PASS。",
          },
        }
      }
      return { ...criterion, section: section.section }
    }),
  }))

  const from = scenario.productCategory
  const to = base.businessContext.productCategory
  const swap = (text: string) => (from === to ? text : text.split(from).join(to))

  return delay({
    ...base,
    transcript: scenario.segments.map((seg) => ({ ...seg, text: swap(seg.text) })),
    sections,
    businessFacts: scenario.businessFacts,
  })
}

/* ------------------------------------------------------------------ */
/* Quality Overview 聚合                                                */
/* ------------------------------------------------------------------ */

export interface OverviewData {
  kpis: { label: string; value: string; delta: string; deltaTone: "success" | "danger" | "warning" | "neutral" }[]
  trend: { date: string; avgScore: number; issueRate: number; critical: number }[]
  attention: { id: string; title: string; detail: string; link: { label: string; filters: Record<string, string> } }[]
  topIssues: { section: string; criterion: string; affected: number; rate: string; delta: string; risk: string; scene: string }[]
  sceneQuality: { name: string; avgScore: number; count: number }[]
}

function inRange(result: QualityResult, days: number): boolean {
  const ts = new Date(result.interactionTime).getTime()
  const now = new Date("2026-08-21T23:59:59+08:00").getTime()
  return now - ts <= days * 24 * 60 * 60 * 1000
}

export function getQualityOverview(params: ListParams, sceneDim = "serviceType"): Promise<OverviewData> {
  const filters = parseListFilters(params.filters)
  const days = filters.time === "近30日" ? 30 : filters.time === "今日" ? 1 : 7

  let scoped = qualityResults.filter((r) => inRange(r, days))
  if (filters.department) scoped = scoped.filter((r) => r.org.departmentName === filters.department)
  if (filters.team) scoped = scoped.filter((r) => r.org.teamName === filters.team)
  if (filters.serviceType) scoped = scoped.filter((r) => r.businessContext.serviceType === filters.serviceType)
  if (filters.agent) scoped = scoped.filter((r) => r.org.agentName === filters.agent)
  if (filters.brand) scoped = scoped.filter((r) => r.businessContext.brand === filters.brand)
  if (filters.productCategory) scoped = scoped.filter((r) => r.businessContext.productCategory === filters.productCategory)
  if (filters.issue) scoped = scoped.filter((r) => r.businessContext.issueTopic === filters.issue)
  if (filters.requestType) scoped = scoped.filter((r) => r.requestType === filters.requestType)

  const prev = qualityResults.filter((r) => {
    const ts = new Date(r.interactionTime).getTime()
    const now = new Date("2026-08-21T23:59:59+08:00").getTime()
    return now - ts > days * 86400000 && now - ts <= 2 * days * 86400000
  })

  const total = scoped.length || 1
  const withScore = scoped.filter((r) => r.score !== undefined)
  const avgScore = withScore.length ? withScore.reduce((a, r) => a + (r.score ?? 0), 0) / withScore.length : 0
  const issueCount = scoped.filter((r) => r.issueCount > 0).length
  const issueRate = (issueCount / total) * 100
  const criticalCount = scoped.filter((r) => r.critical).length
  const pendingCount = scoped.filter((r) => r.review.status === "PENDING").length
  const coverage = 92.4

  // 趋势：按日聚合
  const trendMap = new Map<string, { sum: number; n: number; issues: number; critical: number }>()
  for (const r of scoped) {
    const date = r.interactionTime.slice(0, 10)
    const entry = trendMap.get(date) ?? { sum: 0, n: 0, issues: 0, critical: 0 }
    entry.n += 1
    entry.sum += r.score ?? 0
    if (r.issueCount > 0) entry.issues += 1
    if (r.critical) entry.critical += 1
    trendMap.set(date, entry)
  }
  const trend = [...trendMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, e]) => ({
      date: date.slice(5),
      avgScore: Math.round((e.sum / Math.max(1, e.n)) * 10) / 10,
      issueRate: Math.round((e.issues / Math.max(1, e.n)) * 1000) / 10,
      critical: e.critical,
    }))

  // 主要质量问题：按 Criterion 聚合受影响 Interaction
  const criterionAgg = new Map<string, { affected: number; scenes: Map<string, number>; section: string }>()
  for (const r of scoped) {
    for (const criterion of failedCriteria(r)) {
      const entry = criterionAgg.get(criterion) ?? { affected: 0, scenes: new Map(), section: CRITERIA_CATALOG.find((c) => c.criterion === criterion)?.section ?? "" }
      entry.affected += 1
      entry.scenes.set(r.businessContext.serviceType, (entry.scenes.get(r.businessContext.serviceType) ?? 0) + 1)
      criterionAgg.set(criterion, entry)
    }
  }
  const topIssues = [...criterionAgg.entries()]
    .map(([criterion, e]) => {
      const scene = [...e.scenes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—"
      const prevAffected = prev.filter((p) => failedCriteria(p).includes(criterion)).length
      const prevRate = Math.round((prevAffected / Math.max(1, prev.length)) * 1000) / 10
      const curRate = Math.round((e.affected / total) * 1000) / 10
      const delta = curRate - prevRate
      return {
        section: e.section,
        criterion,
        affected: e.affected,
        rate: `${Math.round((e.affected / total) * 1000) / 10}%`,
        delta: delta === 0 ? "—" : `${delta > 0 ? "+" : ""}${delta.toFixed(1)} pct`,
        risk: criterionSeverity(criterion),
        scene,
      }
    })
    .sort((a, b) => b.affected - a.affected)
    .slice(0, 6)

  // 需要关注：确定性异常
  const attention: OverviewData["attention"] = []
  const promise = topIssues.find((t) => t.criterion === "违规承诺")
  if (promise) {
    attention.push({
      id: "at-1",
      title: "违规承诺问题明显上升",
      detail: `影响率 ${promise.rate} · 影响 ${promise.affected} 条 Interaction`,
      link: { label: "质量结果 · 违规承诺", filters: { criterion: "违规承诺" } },
    })
  }
  const teamIssue = (() => {
    const byTeam = new Map<string, { n: number; issues: number }>()
    for (const r of scoped) {
      const e = byTeam.get(r.org.teamName) ?? { n: 0, issues: 0 }
      e.n += 1
      if (r.issueCount > 0) e.issues += 1
      byTeam.set(r.org.teamName, e)
    }
    let worst: { team: string; rate: number } | null = null
    for (const [team, e] of byTeam) {
      const rate = (e.issues / Math.max(1, e.n)) * 100
      if (!worst || rate > worst.rate) worst = { team, rate }
    }
    return worst && worst.rate > issueRate + 2 ? worst : null
  })()
  if (teamIssue) {
    attention.push({
      id: "at-2",
      title: `${teamIssue.team}问题交互率明显偏高`,
      detail: `高于整体 ${(teamIssue.rate - issueRate).toFixed(1)} pct`,
      link: { label: "质量结果 · 班组", filters: { team: teamIssue.team } },
    })
  }
  if (pendingCount > 0) {
    attention.push({
      id: "at-3",
      title: "待复核积压",
      detail: `当前 ${pendingCount} 条`,
      link: { label: "质量结果 · 待复核", filters: { reviewStatus: "待复核" } },
    })
  }
  const criticalOpen = scoped.filter((r) => r.critical && r.review.status === "PENDING").length
  if (criticalOpen > 0) {
    attention.push({
      id: "at-4",
      title: "Critical 未处理",
      detail: `${criticalOpen} 条 Critical 待复核`,
      link: { label: "质量结果 · Critical", filters: { quality: "Critical", reviewStatus: "待复核" } },
    })
  }

  // 场景质量
  const sceneMap = new Map<string, { sum: number; n: number }>()
  for (const r of scoped) {
    const key =
      sceneDim === "productCategory"
        ? r.businessContext.productCategory
        : sceneDim === "issue"
          ? r.businessContext.issueTopic
          : sceneDim === "brand"
            ? r.businessContext.brand
            : r.businessContext.serviceType
    const e = sceneMap.get(key) ?? { sum: 0, n: 0 }
    e.n += 1
    e.sum += r.score ?? 0
    sceneMap.set(key, e)
  }
  const sceneQuality = [...sceneMap.entries()]
    .map(([name, e]) => ({ name, avgScore: Math.round((e.sum / Math.max(1, e.n)) * 10) / 10, count: e.n }))
    .sort((a, b) => a.avgScore - b.avgScore)

  return delay({
    kpis: [
      { label: "有效质检覆盖率", value: `${coverage}%`, delta: "+0.6 pct 较上周期", deltaTone: "success" },
      { label: "平均质量得分", value: avgScore.toFixed(1), delta: "+1.2 较上周期", deltaTone: "success" },
      { label: "问题交互率", value: `${issueRate.toFixed(1)}%`, delta: "-1.4 pct 较上周期", deltaTone: "success" },
      { label: "Critical", value: String(criticalCount), delta: criticalCount > 0 ? `待复核 ${criticalOpen}` : "—", deltaTone: criticalCount > 0 ? "danger" : "neutral" },
      { label: "待复核", value: String(pendingCount), delta: pendingCount > 5 ? "存在积压" : "正常", deltaTone: pendingCount > 5 ? "warning" : "neutral" },
    ],
    trend,
    attention,
    topIssues,
    sceneQuality,
  })
}

/* ------------------------------------------------------------------ */
/* 坐席分析聚合                                                         */
/* ------------------------------------------------------------------ */

export interface AgentAnalysisData {
  scopeSummary: { label: string; value: string }[]
  trend: { date: string; avgScore: number; issueRate: number; critical: number }[]
  teams: { team: string; department: string; valid: number; avgScore: number; issueRate: number; critical: number; topProblem: string; topScene: string; delta: string }[]
  agents: { agent: string; team: string; valid: number; avgScore: number; issueRate: number; critical: number; topProblem: string; topScene: string }[]
  attentionAgents: { agent: string; reason: string; criterion: string }[]
  problems: { criterion: string; rate: string; affected: number }[]
  scenes: { name: string; avgScore: number; count: number }[]
  related: QualityResult[]
}

export function getAgentAnalysis(params: ListParams): Promise<AgentAnalysisData> {
  const filters = parseListFilters(params.filters)
  let scoped = qualityResults.filter((r) => inRange(r, filters.time === "近30日" ? 30 : 7))
  if (filters.department) scoped = scoped.filter((r) => r.org.departmentName === filters.department)
  if (filters.team) scoped = scoped.filter((r) => r.org.teamName === filters.team)
  if (filters.agent) scoped = scoped.filter((r) => r.org.agentName === filters.agent)
  if (filters.serviceType) scoped = scoped.filter((r) => r.businessContext.serviceType === filters.serviceType)

  const total = scoped.length || 1
  const withScore = scoped.filter((r) => r.score !== undefined)
  const avgScore = withScore.length ? withScore.reduce((a, r) => a + (r.score ?? 0), 0) / withScore.length : 0
  const issueRate = (scoped.filter((r) => r.issueCount > 0).length / total) * 100

  const groupBy = <K extends string>(keyFn: (r: QualityResult) => K) => {
    const map = new Map<K, { rows: QualityResult[] }>()
    for (const r of scoped) {
      const key = keyFn(r)
      const entry = map.get(key) ?? { rows: [] }
      entry.rows.push(r)
      map.set(key, entry)
    }
    return map
  }

  function summarize(rows: QualityResult[]) {
    const n = rows.length || 1
    const ws = rows.filter((r) => r.score !== undefined)
    const avg = ws.length ? ws.reduce((a, r) => a + (r.score ?? 0), 0) / ws.length : 0
    const issues = rows.filter((r) => r.issueCount > 0).length
    const crit = rows.filter((r) => r.critical).length
    const problemAgg = new Map<string, number>()
    const sceneAgg = new Map<string, number>()
    for (const r of rows) {
      for (const c of failedCriteria(r)) problemAgg.set(c, (problemAgg.get(c) ?? 0) + 1)
      sceneAgg.set(r.businessContext.serviceType, (sceneAgg.get(r.businessContext.serviceType) ?? 0) + 1)
    }
    const topProblem = [...problemAgg.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—"
    const topScene = [...sceneAgg.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—"
    return { valid: rows.length, avgScore: Math.round(avg * 10) / 10, issueRate: Math.round((issues / n) * 1000) / 10, critical: crit, topProblem, topScene }
  }

  const teamMap = groupBy((r) => r.org.teamName)
  const teams = [...teamMap.entries()].map(([team, e]) => ({
    team,
    department: e.rows[0].org.departmentName,
    ...summarize(e.rows),
    delta: "—",
  }))

  const agentMap = groupBy((r) => r.org.agentName)
  const agentsRows = [...agentMap.entries()].map(([agent, e]) => ({
    agent,
    team: e.rows[0].org.teamName,
    ...summarize(e.rows),
  }))

  const overallIssueRate = issueRate
  const attentionAgents = agentsRows
    .filter((a) => a.issueRate > overallIssueRate + 3 || a.critical > 0)
    .slice(0, 4)
    .map((a) => ({
      agent: `${a.agent}（${a.team}）`,
      reason: a.critical > 0 ? `连续出现 ${a.critical} 条 Critical` : `问题交互率 ${a.issueRate}%，高于整体 ${(a.issueRate - overallIssueRate).toFixed(1)} pct`,
      criterion: a.topProblem,
    }))

  const trendMap = new Map<string, { sum: number; n: number; issues: number; critical: number }>()
  for (const r of scoped) {
    const date = r.interactionTime.slice(0, 10)
    const e = trendMap.get(date) ?? { sum: 0, n: 0, issues: 0, critical: 0 }
    e.n += 1
    e.sum += r.score ?? 0
    if (r.issueCount > 0) e.issues += 1
    if (r.critical) e.critical += 1
    trendMap.set(date, e)
  }
  const trend = [...trendMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, e]) => ({
      date: date.slice(5),
      avgScore: Math.round((e.sum / Math.max(1, e.n)) * 10) / 10,
      issueRate: Math.round((e.issues / Math.max(1, e.n)) * 1000) / 10,
      critical: e.critical,
    }))

  const problemAgg = new Map<string, number>()
  for (const r of scoped) for (const c of failedCriteria(r)) problemAgg.set(c, (problemAgg.get(c) ?? 0) + 1)
  const problems = [...problemAgg.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([criterion, n]) => ({ criterion, affected: n, rate: `${Math.round((n / total) * 1000) / 10}%` }))

  const sceneAgg = new Map<string, { sum: number; n: number }>()
  for (const r of scoped) {
    const e = sceneAgg.get(r.businessContext.serviceType) ?? { sum: 0, n: 0 }
    e.n += 1
    e.sum += r.score ?? 0
    sceneAgg.set(r.businessContext.serviceType, e)
  }
  const scenes = [...sceneAgg.entries()]
    .map(([name, e]) => ({ name, avgScore: Math.round((e.sum / Math.max(1, e.n)) * 10) / 10, count: e.n }))
    .sort((a, b) => a.avgScore - b.avgScore)

  const related = [...scoped]
    .filter((r) => r.issueCount > 0)
    .sort((a, b) => b.interactionTime.localeCompare(a.interactionTime))
    .slice(0, 8)

  return delay({
    scopeSummary: [
      { label: "有效质检", value: String(scoped.length) },
      { label: "平均质量得分", value: avgScore.toFixed(1) },
      { label: "问题交互率", value: `${issueRate.toFixed(1)}%` },
      { label: "Critical", value: String(scoped.filter((r) => r.critical).length) },
    ],
    trend,
    teams,
    agents: agentsRows,
    attentionAgents,
    problems,
    scenes,
    related,
  })
}

/* ------------------------------------------------------------------ */
/* Tasks / Runs / Executions                                           */
/* ------------------------------------------------------------------ */

export function listTasks(params: ListParams): Promise<ListResponse<AnalysisTask>> {
  const filters = parseListFilters(params.filters)
  let items = [...tasks]
  items = items.filter((t) => matchSearch(`${t.name} ${t.agentName} ${t.dataAssetName}`, params.search))
  if (filters.status) items = items.filter((t) => (filters.status === "启用" ? t.status === "Active" : t.status === "Inactive"))
  if (filters.agent) items = items.filter((t) => t.agentName === filters.agent)
  if (filters.asset) items = items.filter((t) => t.dataAssetName === filters.asset)
  items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return delay(paginate(items, params))
}

export function getTask(taskId: string): Promise<AnalysisTask | null> {
  return delay(tasks.find((t) => t.id === taskId) ?? null)
}

export function listRuns(taskId: string, params: ListParams): Promise<ListResponse<Run>> {
  const items = runs.filter((r) => r.taskId === taskId)
  items.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  return delay(paginate(items, params))
}

export function getRun(runId: string): Promise<Run | null> {
  return delay(runs.find((r) => r.id === runId) ?? null)
}

export function listExecutions(runId: string, params: ListParams): Promise<ListResponse<InteractionExecution>> {
  const filters = parseListFilters(params.filters)
  let items = [...(executionsByRun[runId] ?? [])]
  items = items.filter((e) => matchSearch(`${e.interactionId} ${e.agentName}`, params.search))
  if (filters.executionStatus) items = items.filter((e) => e.status === filters.executionStatus)
  if (filters.errorType) items = items.filter((e) => e.errorType === filters.errorType)
  return delay(paginate(items, params))
}

/* ------------------------------------------------------------------ */
/* Agents / Tools / Assets / Rules / Connections                       */
/* ------------------------------------------------------------------ */

export function listAgents(params: ListParams): Promise<ListResponse<EvaluationAgent>> {
  const filters = parseListFilters(params.filters)
  let items = [...agents]
  items = items.filter((a) => matchSearch(`${a.name} ${a.description}`, params.search))
  if (filters.status) items = items.filter((a) => a.status === filters.status)
  items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return delay(paginate(items, params))
}

export function getAgent(agentId: string): Promise<AgentDetail | null> {
  const detail = agentDetails[agentId]
  if (detail) return delay(detail)
  const base = agents.find((a) => a.id === agentId)
  if (!base) return delay(null)
  return delay({
    ...base,
    inputSchema: [
      { key: "interaction_id", type: "String", required: true },
      { key: "transcript", type: "String", required: true },
    ],
    structuredOutputs: [{ name: "quality_result", description: "结构化评价结果", schema: "{ ... }" }],
    versions: [{ version: base.currentVersion, status: base.status === "Draft" ? "Draft" : "Published" }],
    graph: {
      nodes: [
        { id: "n-input", kind: "input", name: "Interaction 输入", position: { x: 0, y: 120 }, config: {} },
        { id: "n-llm", kind: "llm", name: "评价", position: { x: 280, y: 120 }, config: { model: "qwen-max" } },
        { id: "n-record", kind: "create-record", name: "Create Quality Record", position: { x: 560, y: 120 }, config: {} },
        { id: "n-end", kind: "end", name: "结束", position: { x: 840, y: 120 }, config: {} },
      ],
      edges: [
        { id: "e1", source: "n-input", target: "n-llm" },
        { id: "e2", source: "n-llm", target: "n-record" },
        { id: "e3", source: "n-record", target: "n-end" },
      ],
    },
    lastTestPassed: base.status !== "Draft",
    changedSinceTest: false,
  })
}

export function listTools(params: ListParams): Promise<ListResponse<Tool>> {
  const filters = parseListFilters(params.filters)
  let items = [...tools]
  items = items.filter((t) => matchSearch(`${t.name} ${t.description}`, params.search))
  if (filters.capability) items = items.filter((t) => t.capability === filters.capability)
  if (filters.governance) items = items.filter((t) => t.governance === filters.governance)
  if (filters.source) items = items.filter((t) => t.source === filters.source)
  const sort = params.sort || "updated:desc"
  items.sort((a, b) => (sort === "updated:asc" ? a.updatedAt.localeCompare(b.updatedAt) : sort === "created:desc" ? a.id.localeCompare(b.id) : sort === "created:asc" ? b.id.localeCompare(a.id) : b.updatedAt.localeCompare(a.updatedAt)))
  return delay(paginate(items, params))
}

export function getTool(toolId: string): Promise<ToolDetail | null> {
  return delay(toolDetails[toolId] ?? null)
}

export function listDataAssets(params: ListParams): Promise<ListResponse<DataAsset>> {
  const filters = parseListFilters(params.filters)
  let items = [...dataAssets]
  items = items.filter((a) => matchSearch(`${a.name} ${a.source}`, params.search))
  if (filters.lifecycle) items = items.filter((a) => a.lifecycle === filters.lifecycle)
  if (filters.health) items = items.filter((a) => a.health === filters.health)
  items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return delay(paginate(items, params))
}

export function getDataAsset(assetId: string): Promise<DataAsset | null> {
  return delay(dataAssets.find((a) => a.id === assetId) ?? null)
}

export function getDataAssetRevisions(assetId: string): Promise<DataAssetRevisionInfo[]> {
  const asset = dataAssets.find((a) => a.id === assetId)
  if (!asset) return delay([])
  const revisions: DataAssetRevisionInfo[] = []
  for (let rev = asset.currentRevision; rev >= Math.max(1, asset.currentRevision - 4); rev--) {
    revisions.push({
      revision: rev,
      status: rev === asset.currentRevision ? (asset.lifecycle === "Draft" ? "Draft" : "Ready") : "Ready",
      updatedAt: `2026-0${(rev % 8) + 1}-1${rev % 10} 10:00`,
      note: rev === asset.currentRevision ? "当前 Revision" : "历史 Ready Revision",
    })
  }
  return delay(revisions)
}

export function listResultRules(params: ListParams): Promise<ListResponse<ResultRuleSet>> {
  let items = [...resultRuleSets]
  items = items.filter((r) => matchSearch(`${r.name} ${r.agentName}`, params.search))
  items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return delay(paginate(items, params))
}

export function getResultRule(ruleSetId: string): Promise<ResultRuleSetDetail | null> {
  const detail = resultRuleDetails[ruleSetId]
  if (detail) return delay(detail)
  const base = resultRuleSets.find((r) => r.id === ruleSetId)
  if (!base) return delay(null)
  return delay({
    ...base,
    scoreRules: [
      { id: "sr1", criterion: "消费者诉求识别", resultType: "Pass / Fail", scoringRule: "PASS → 20 · FAIL → 0", weight: 20 },
      { id: "sr2", criterion: "违规承诺", resultType: "Pass / Fail", scoringRule: "PASS → 30 · FAIL → 0", weight: 30 },
    ],
    overall: { rule: "总分 ≥ 80 为 Overall Pass", passLine: 80 },
    criticalRules: [{ id: "cr1", condition: "违规承诺 = FAIL", effect: "Risk = Critical" }],
    riskMapping: [{ id: "rm1", condition: "存在 Critical", risk: "Critical" }],
    levels: [{ id: "lv1", range: "≥ 80", level: "合格" }],
    derivedLabels: [],
    versions: [{ version: base.currentVersion, status: base.versionStatus }],
  })
}

export function listConnections(params: ListParams): Promise<ListResponse<Connection>> {
  const filters = parseListFilters(params.filters)
  let items = [...connections]
  items = items.filter((c) => matchSearch(`${c.name} ${c.endpoint}`, params.search))
  if (filters.status) items = items.filter((c) => c.status === filters.status)
  items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return delay(paginate(items, params))
}
