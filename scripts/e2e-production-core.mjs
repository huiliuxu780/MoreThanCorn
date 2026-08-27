#!/usr/bin/env node
/** 09-SDD P0-14：真实核心 E2E（Production Profile）。
 *
 * 覆盖：发布 → 任务 → 执行 → 结果 → 复核 全链路，强断言；任一不变量失败 → 非零退出。
 * 与 seed-demo-pipeline.mjs（无断言 Demo）不同，本脚本是上线门禁。
 *
 * 不变量（09 §13.1 + INV-01..12）：
 *   read_count / interaction_run_count / quality_result_count / distinct(interaction_ref) 相等
 *   mock_output_count = 0；missing_traceability_count = 0；重复/空 ref/非法输出 → failed（非假成功）
 *
 * 用法：
 *   node scripts/e2e-production-core.mjs            # 使用全新数据库 wf_e2e 并自动起服务
 *   WF_E2E_BASE=http://127.0.0.1:8199 WF_E2E_TOKEN=... node scripts/e2e-production-core.mjs  # 复用已运行服务
 */
import { spawn, execSync } from "node:child_process"
import { setTimeout as sleep } from "node:timers/promises"
import process from "node:process"

const ROOT = new URL("..", import.meta.url).pathname
const PORT = process.env.WF_E2E_PORT ?? "8199"
const DB = process.env.WF_E2E_DB ?? "wf_e2e"
const DB_URL = `postgresql+psycopg://rivers@127.0.0.1:5432/${DB}`
const SECRET = "DtpVdK_t2tGHMmUvPRSHcyOIMeflUpBDC-gF0e0yBbk="

let failures = 0
let checks = 0
function assert(cond, label, actual) {
  checks++
  if (cond) {
    console.log(`  ✓ ${label}`)
  } else {
    failures++
    console.error(`  ✗ ${label}${actual !== undefined ? `（实际：${JSON.stringify(actual)}）` : ""}`)
  }
}

const BASE = process.env.WF_E2E_BASE ?? `http://127.0.0.1:${PORT}`
let TOKEN = process.env.WF_E2E_TOKEN ?? ""
const headers = () => ({ "Content-Type": "application/json", ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) })

async function api(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...headers(), ...(init.headers ?? {}) } })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`${res.status} ${path} → ${JSON.stringify(body?.detail ?? body)}`)
  return body
}
async function apiStatus(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...headers(), ...(init.headers ?? {}) } })
  await res.json().catch(() => null)
  return res.status
}

let serverProc = null
async function setup() {
  if (process.env.WF_E2E_BASE) {
    console.log(`[setup] 复用已运行服务 ${BASE}`)
    return
  }
  console.log(`[setup] 全新数据库 ${DB} + Production Profile 服务 :${PORT}`)
  execSync(`dropdb --if-exists -U rivers -h 127.0.0.1 ${DB}`, { stdio: "ignore" })
  execSync(`createdb -U rivers -h 127.0.0.1 ${DB}`, { stdio: "ignore" })
  execSync(`.venv/bin/alembic upgrade head`, { cwd: `${ROOT}server`, stdio: "pipe",
    env: { ...process.env, WF_DATABASE_URL: DB_URL } })
  serverProc = spawn(".venv/bin/uvicorn", ["app.main:app", "--host", "127.0.0.1", "--port", PORT], {
    cwd: `${ROOT}server`,
    env: { ...process.env, WF_DATABASE_URL: DB_URL, WF_ENV: "production",
           WF_SECRET_KEY: SECRET, WF_ADMIN_PASSWORD: "admin", WF_PAR_RUN: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  })
  serverProc.stderr.on("data", (d) => process.env.WF_E2E_VERBOSE && process.stderr.write(d))
  // 等待就绪
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/healthz`)
      if (r.ok) break
    } catch { /* retry */ }
    await sleep(500)
    if (i === 59) throw new Error("服务未在 30s 内就绪")
  }
}

function teardown() {
  if (serverProc) { serverProc.kill("SIGTERM"); serverProc = null }
}

async function login() {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin" }),
  })
  if (!r.ok) throw new Error(`登录失败 ${r.status}`)
  TOKEN = (await r.json()).token
}

/* ---------- 确定性质检工作流（create-record 产出合法 QualityEvaluation 结构） ---------- */
async function buildWorkflow(name, assetId) {
  const wf = await api("/api/workflows", { method: "POST", body: JSON.stringify({ name }) })
  const d = await api(`/api/workflows/${wf.id}`)
  const defn = d.definition
  defn.graph.nodes = [
    { id: "n_start", type: "input", name: "开始", config: {}, inputs: [] },
    { id: "n_rec", type: "create-record", name: "落质检结果", config: { outputKey: "quality_result" }, inputs: [
      { name: "score", type: "number", source: { kind: "input", path: "score" } },
      { name: "risk", type: "string", source: { kind: "input", path: "risk" } },
      { name: "issues", type: "array", source: { kind: "input", path: "issues" } },
      { name: "summary", type: "string", source: { kind: "input", path: "summary" } },
    ] },
  ]
  defn.graph.edges = [{ id: "e1", source: "n_start", target: "n_rec" }]
  await api(`/api/workflows/${wf.id}/draft`, { method: "PUT",
    body: JSON.stringify({ definition: defn, baseRevision: d.draftRevision }) })
  const pub = await api(`/api/workflows/${wf.id}/publish`, { method: "POST", body: JSON.stringify({}) })
  return { workflowId: wf.id, versionId: pub.versionId }
}

async function buildAsset(name, rows) {
  return api("/api/data-assets", { method: "POST", body: JSON.stringify({ name, rows }) })
}

async function buildRules(name) {
  const r = await api("/api/result-rules", { method: "POST",
    body: JSON.stringify({ name, rules: { scoreRules: [], issueRules: [] } }) })
  const pub = await api(`/api/result-rules/${r.id}/publish`, { method: "POST", body: JSON.stringify({}) })
  return { ruleSetId: r.id, ruleVersionId: pub.ruleVersionId }
}

async function buildDefinition(name, assetId) {
  const d = await api("/api/data-definitions", { method: "POST", body: JSON.stringify({
    name, assetId, fieldSchema: [
      { key: "interactionId", type: "String", required: true },
      { key: "score", type: "Number", required: false },
      { key: "risk", type: "String", required: false },
      { key: "issues", type: "Array", required: false },
      { key: "summary", type: "String", required: false },
    ] }) })
  const pub = await api(`/api/data-definitions/${d.id}/publish`, { method: "POST", body: JSON.stringify({}) })
  return pub.versionId
}

async function buildTask(name, { workflowId, versionId, assetId, ruleVersionId, defVersionId, inputMapping }) {
  return api("/api/tasks", { method: "POST", body: JSON.stringify({
    name, workflowId, workflowVersionPolicy: "pinned", pinnedWorkflowVersionId: versionId,
    dataAssetId: assetId, dataDefinitionVersionId: defVersionId,
    resultRuleVersionId: ruleVersionId, rulePolicy: ruleVersionId ? "pinned" : "follow_latest",
    inputMapping,
    scope: { op: "and", conditions: [] }, sampling: { mode: "all" }, dataWindow: { mode: "all" },
  }) })
}

async function runTaskAndWait(taskId, idem) {
  const init = { method: "POST", body: "{}" }
  if (idem) init.headers = { "Idempotency-Key": idem }
  const res = await fetch(`${BASE}/api/tasks/${taskId}/runs`, { ...init, headers: { ...headers(), ...(init.headers ?? {}) } })
  const body = await res.json().catch(() => null)
  if (res.status !== 202) return { startStatus: res.status, taskRun: null }
  const trid = body.taskRunId
  for (let i = 0; i < 120; i++) {
    const t = await api(`/api/task-runs/${trid}`)
    if (["succeeded", "partial", "failed", "cancelled"].includes(t.status)) return { startStatus: 202, taskRun: t }
    await sleep(500)
  }
  throw new Error(`task-run ${trid} 60s 未到终态`)
}

/* ================= 场景 ================= */

const MAPPING = { interactionId: "interactionId", score: "score", risk: "risk", issues: "issues", summary: "summary" }

async function scenarioA_core() {
  console.log("\n[场景 A] N 输入 = N Run = N Result（10 条，全合法）")
  const rows = []
  const riskCycle = ["Low", "Medium", "High", "Critical"]
  for (let i = 1; i <= 10; i++) {
    const risk = riskCycle[(i - 1) % 4]
    rows.push({
      interactionId: `INT-${String(i).padStart(3, "0")}`,
      score: 90 - i, risk,
      issues: risk === "Low" ? [] : [{ criterion: `问题-${i}`, severity: risk }],
      summary: `质检摘要 ${i}`,
    })
  }
  const asset = await buildAsset("E2E-A-数据", rows)
  const { workflowId, versionId } = await buildWorkflow("E2E-A-质检流", asset.id)
  const { ruleVersionId } = await buildRules("E2E-A-规则")
  const defVersionId = await buildDefinition("E2E-A-定义", asset.id)
  const task = await buildTask("E2E-A-任务", { workflowId, versionId, assetId: asset.id, ruleVersionId, defVersionId, inputMapping: MAPPING })

  const { taskRun } = await runTaskAndWait(task.id)
  assert(taskRun.status === "succeeded", `批次状态=succeeded（INV-06 全合法应成功）`, taskRun.status)
  assert(taskRun.total === 10, "read_count=10", taskRun.total)
  assert(taskRun.succeeded === 10, "succeeded=10", taskRun.succeeded)
  assert(taskRun.failed === 0, "failed=0", taskRun.failed)

  const runs = (await api(`/api/task-runs/${taskRun.id}/runs`)).items
  const results = (await api(`/api/task-runs/${taskRun.id}/results`)).items
  assert(runs.length === 10, "interaction_run_count=10（INV-02 一输入一 Run）", runs.length)
  assert(results.length === 10, "quality_result_count=10（INV-03 一成功 Run 一结果）", results.length)
  const distinctRefs = new Set(results.map((r) => r.interactionRef))
  assert(distinctRefs.size === 10, "distinct(interaction_ref)=10（INV-04 非空且唯一）", distinctRefs.size)

  // 追踪链完整（INV-05/P0-08）：每条结果可反查 TaskRun/WorkflowVersion/RuleVersion
  let missingTrace = 0, mockOut = 0
  for (const r of results) {
    if (!r.taskRunId || !r.workflowVersionId || !r.ruleVersionId || !r.interactionRef) missingTrace++
    const det = await api(`/api/quality-results/${r.id}`)
    const so = JSON.stringify(det.structuredOutput ?? {})
    if (so.includes("[mock") || so.includes("已处理")) mockOut++
    assert(det.ruleVersionId === ruleVersionId, `结果 ${r.interactionRef} 绑定冻结 RuleVersion`, det.ruleVersionId)
  }
  assert(missingTrace === 0, "missing_traceability_count=0", missingTrace)
  assert(mockOut === 0, "mock_output_count=0（INV-09 生产无 mock 结果）", mockOut)
  assert(runs.every((x) => x.workflowVersionId === versionId), "所有 Run 冻结同一 WorkflowVersion（INV-05）")
  return { taskId: task.id, firstResultId: results[0].id }
}

async function scenarioB_fault() {
  console.log("\n[场景 B] 故障注入：重复/空 interactionId/非法 Schema → failed，不造假结果")
  const rows = [
    { interactionId: "INT-B1", score: 80, risk: "Low", issues: [], summary: "合法样本" },
    { interactionId: "INT-DUP", score: 70, risk: "Low", issues: [], summary: "重复样本1" },
    { interactionId: "INT-DUP", score: 71, risk: "Low", issues: [], summary: "重复样本2" },
    { score: 60, risk: "Low", issues: [], summary: "缺 interactionId" },
    { interactionId: "INT-BADRISK", score: 50, risk: "NotARisk", issues: [], summary: "非法 risk 枚举" },
  ]
  const asset = await buildAsset("E2E-B-数据", rows)
  const { workflowId, versionId } = await buildWorkflow("E2E-B-质检流", asset.id)
  const { ruleVersionId } = await buildRules("E2E-B-规则")
  const defVersionId = await buildDefinition("E2E-B-定义", asset.id)
  const task = await buildTask("E2E-B-任务", { workflowId, versionId, assetId: asset.id, ruleVersionId, defVersionId, inputMapping: MAPPING })
  const { taskRun } = await runTaskAndWait(task.id)
  // 5 行 = INT-B1 + INT-DUP×2 + 空ref + 非法risk。
  // 首个 INT-DUP 是合法首次出现（成功）；第二个重复、空 ref、非法 risk 各失败。
  assert(taskRun.status === "partial", "批次状态=partial（部分成功）", taskRun.status)
  assert(taskRun.total === 5, "read_count=5", taskRun.total)
  assert(taskRun.succeeded === 2, "succeeded=2（INT-B1 + 首个 INT-DUP 合法）", taskRun.succeeded)
  assert(taskRun.failed === 3, "failed=3（重复第二次 + 空ref + 非法Schema）", taskRun.failed)
  const results = (await api(`/api/task-runs/${taskRun.id}/results`)).items
  assert(results.length === 2, "合法样本产生结果；非法/重复/空 ref 不落库（INV-06）", results.length)
  assert(results.every((r) => r.interactionRef !== "INT-BADRISK"), "非法 Schema 样本无结果")
  const errs = JSON.stringify(taskRun.errorSummary ?? {})
  assert(errs.includes("DUPLICATE_INTERACTION_REF"), "重复 ref 有可解释错误")
  assert(errs.includes("EMPTY_INTERACTION_REF"), "空 ref 有可解释错误")
  assert(errs.includes("OUTPUT_SCHEMA_INVALID"), "非法 Schema 有可解释错误")
}

async function scenarioC_review(firstResultId) {
  console.log("\n[场景 C] 人工复核追加 revision，AI 原始结果不可变（INV-08）")
  const before = await api(`/api/quality-results/${firstResultId}`)
  const aiScore = before.aiResult?.score
  // 09 P0-10（审计）：尝试用请求体伪造 reviewer，应被忽略（以鉴权身份为准）
  await api(`/api/quality-results/${firstResultId}/review`, { method: "POST",
    body: JSON.stringify({ action: "revise", score: 10, reviewer: "forged-reviewer", note: "复核降级" }) })
  const after = await api(`/api/quality-results/${firstResultId}`)
  assert(after.score === 10, "生效分=人工修订值", after.score)
  assert(after.aiResult?.score === aiScore, "aiResult 原始分不变（INV-08）", after.aiResult?.score)
  assert((after.reviewRevisions ?? []).length === 1, "追加 1 条 ReviewRevision", after.reviewRevisions?.length)
  assert(after.reviewRevisions[0].reviewer === "admin", "reviewer 来自鉴权身份（忽略请求体伪造）", after.reviewRevisions[0].reviewer)
}

async function scenarioD_idempotency(ctx) {
  console.log("\n[场景 D] Idempotency-Key 重复请求返回同一 TaskRun（INV-11）")
  const key = "e2e-idem-key-1"
  const post = () => fetch(`${BASE}/api/tasks/${ctx.taskId}/runs`, {
    method: "POST", body: "{}", headers: { ...headers(), "Idempotency-Key": key },
  }).then((r) => r.json())
  const t1 = await post()
  const t2 = await post()
  assert(!!t1.taskRunId, "首次启动返回 taskRunId", t1)
  assert(t1.taskRunId === t2.taskRunId, "同一幂等键返回同一 TaskRun", { t1: t1.taskRunId, t2: t2.taskRunId })
  // 等待该批次终态，避免影响后续场景
  for (let i = 0; i < 120; i++) {
    const t = await api(`/api/task-runs/${t1.taskRunId}`)
    if (["succeeded", "partial", "failed", "cancelled"].includes(t.status)) break
    await sleep(500)
  }
  const runs = (await api(`/api/tasks/${ctx.taskId}/runs`)).items
  const sameKey = runs.filter((x) => x.idempotencyKey === key)
  assert(sameKey.length === 1, "同键仅一个 TaskRun（无重复批次）", sameKey.length)
}

async function scenarioE_pause(ctx) {
  console.log("\n[场景 E] paused 任务禁止新批次（INV-10）")
  await api(`/api/tasks/${ctx.taskId}/status`, { method: "POST", body: JSON.stringify({ status: "paused" }) })
  const st = await apiStatus(`/api/tasks/${ctx.taskId}/runs`, { method: "POST", body: "{}" })
  assert(st === 409, "paused 启动被拒（409）", st)
  await api(`/api/tasks/${ctx.taskId}/status`, { method: "POST", body: JSON.stringify({ status: "active" }) })
}

async function scenarioF_auth() {
  console.log("\n[场景 F] Production 鉴权：无凭证 401（P0-10）")
  const res = await fetch(`${BASE}/api/tasks`)
  assert(res.status === 401, "无 Token 访问 /api/* → 401", res.status)
}

/* ================= main ================= */
try {
  await setup()
  if (!TOKEN) await login()
  await scenarioF_auth()
  const ctx = await scenarioA_core()
  await scenarioB_fault()
  await scenarioC_review(ctx.firstResultId)
  await scenarioD_idempotency(ctx)
  await scenarioE_pause(ctx)
  console.log(`\n========================================`)
  console.log(`E2E 断言：${checks} 项，通过 ${checks - failures}，失败 ${failures}`)
  if (failures > 0) {
    console.error("P0 核心 E2E 未通过（存在失败断言）")
    teardown()
    process.exit(1)
  }
  console.log("P0 核心 E2E 通过（Production Profile 全链路闭环）")
  teardown()
  process.exit(0)
} catch (e) {
  console.error(`\nE2E 异常：${e.message}`)
  teardown()
  process.exit(1)
}
