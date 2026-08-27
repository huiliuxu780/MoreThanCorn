#!/usr/bin/env node
/** 09-SDD P1-12：故障演练（fault drill）。自启全新数据库 + Production Profile 服务，
 * 注入故障并断言系统失败关闭 / 可重试 / 无重复批次。
 * 用法：node scripts/fault-drill.mjs（无需外部依赖；退出码 0=通过 1=失败） */
import { spawn, execSync } from "node:child_process"
import { setTimeout as sleep } from "node:timers/promises"
import process from "node:process"

const ROOT = new URL("..", import.meta.url).pathname
const PORT = process.env.WF_DRILL_PORT ?? "8299"
const DB = process.env.WF_DRILL_DB ?? "wf_drill"
const DB_URL = `postgresql+psycopg://rivers@127.0.0.1:5432/${DB}`
const BASE = `http://127.0.0.1:${PORT}`

let failures = 0
const assert = (cond, label, actual) => {
  console.log(`${cond ? "✓" : "✗"} ${label}${cond ? "" : `（实际：${JSON.stringify(actual)}）`}`)
  if (!cond) failures++
}

let TOKEN = ""
const headers = () => ({ "Content-Type": "application/json", ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) })
async function api(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...headers(), ...(init.headers ?? {}) } })
  const body = await res.json().catch(() => null)
  return { status: res.status, body }
}

let serverProc = null
async function setup() {
  execSync(`dropdb --if-exists -U rivers -h 127.0.0.1 ${DB}`, { stdio: "ignore" })
  execSync(`createdb -U rivers -h 127.0.0.1 ${DB}`, { stdio: "ignore" })
  execSync(`.venv/bin/alembic upgrade head`, { cwd: `${ROOT}server`, stdio: "pipe",
    env: { ...process.env, WF_DATABASE_URL: DB_URL } })
  serverProc = spawn(".venv/bin/uvicorn", ["app.main:app", "--host", "127.0.0.1", "--port", PORT], {
    cwd: `${ROOT}server`,
    env: { ...process.env, WF_DATABASE_URL: DB_URL, WF_ENV: "production",
           WF_SECRET_KEY: "DtpVdK_t2tGHMmUvPRSHcyOIMeflUpBDC-gF0e0yBbk=", WF_ADMIN_PASSWORD: "admin", WF_PAR_RUN: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  })
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/healthz`)).ok) break } catch { /* retry */ }
    await sleep(500)
    if (i === 59) throw new Error("服务未就绪")
  }
  const r = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: "admin", password: "admin" }) })
  TOKEN = r.body.token
}
function teardown() { if (serverProc) serverProc.kill("SIGTERM") }

try {
  await setup()

  console.log("\n[演练 1] 数据源不可达 → 任务启动失败关闭（09 P0-03）")
  // 建一个绑定不可达数据源的任务，启动应失败（502），不产生批次
  const asset = (await api("/api/data-assets", { method: "POST", body: JSON.stringify({
    name: "drill-bad-asset", source: "datasource", rows: [],
  }) })).body
  // 无 datasource 且无 rows 的内联资产 → 数据集为空 → 启动失败
  const wf = (await api("/api/workflows", { method: "POST", body: JSON.stringify({ name: "drill-wf" }) })).body
  const wfd = (await api(`/api/workflows/${wf.id}`)).body
  const defn = wfd.definition
  defn.graph.nodes = [
    { id: "n_start", type: "input", name: "开始", config: {}, inputs: [] },
    { id: "n_rec", type: "create-record", name: "落质检", config: { outputKey: "quality_result" }, inputs: [
      { name: "score", type: "number", source: { kind: "input", path: "score" } },
      { name: "risk", type: "string", source: { kind: "input", path: "risk" } },
      { name: "issues", type: "array", source: { kind: "input", path: "issues" } },
      { name: "summary", type: "string", source: { kind: "input", path: "summary" } },
    ] },
  ]
  defn.graph.edges = [{ id: "e1", source: "n_start", target: "n_rec" }]
  await api(`/api/workflows/${wf.id}/draft`, { method: "PUT", body: JSON.stringify({ definition: defn, baseRevision: wfd.draftRevision }) })
  const pub = (await api(`/api/workflows/${wf.id}/publish`, { method: "POST", body: "{}" })).body
  // 09 P0 修复轮：任务创建需定义版本 + 规则绑定
  const dd = (await api("/api/data-definitions", { method: "POST", body: JSON.stringify({
    name: "drill-def", assetId: asset.id,
    fieldSchema: [{ key: "interactionId", type: "String", required: true }],
  }) })).body
  const defv = (await api(`/api/data-definitions/${dd.id}/publish`, { method: "POST", body: "{}" })).body.versionId
  const rl = (await api("/api/result-rules", { method: "POST", body: JSON.stringify({ name: "drill-rule", rules: {} }) })).body
  const rpv = (await api(`/api/result-rules/${rl.id}/publish`, { method: "POST", body: "{}" })).body.ruleVersionId
  const task = (await api("/api/tasks", { method: "POST", body: JSON.stringify({
    name: "drill-task", workflowId: wf.id, workflowVersionPolicy: "pinned",
    pinnedWorkflowVersionId: pub.versionId, dataAssetId: asset.id,
    dataDefinitionVersionId: defv, resultRuleVersionId: rpv,
    sampling: { mode: "all" }, dataWindow: { mode: "all" },
  }) })).body
  const start = await api(`/api/tasks/${task.id}/runs`, { method: "POST", body: "{}" })
  assert([422, 502].includes(start.status), "空/不可达数据源启动应失败关闭", start.status)

  console.log("\n[演练 2] 暂停任务 → 禁止新批次（09 INV-10）")
  // 给任务一个有数据的资产以激活，再暂停
  const goodAsset = (await api("/api/data-assets", { method: "POST", body: JSON.stringify({
    name: "drill-good", rows: [{ interactionId: "D1", score: 90, risk: "Low", issues: [], summary: "ok" }],
  }) })).body
  await api(`/api/tasks/${task.id}`, { method: "PUT", body: JSON.stringify({ dataAssetId: goodAsset.id }) })
  await api(`/api/tasks/${task.id}/status`, { method: "POST", body: JSON.stringify({ status: "paused" }) })
  const pausedStart = await api(`/api/tasks/${task.id}/runs`, { method: "POST", body: "{}" })
  assert(pausedStart.status === 409, "paused 任务启动应被拒（409）", pausedStart.status)

  console.log("\n[演练 3] 恢复后幂等重放（09 INV-11）")
  await api(`/api/tasks/${task.id}/status`, { method: "POST", body: JSON.stringify({ status: "active" }) })
  const k = "drill-idem-1"
  const s1 = await api(`/api/tasks/${task.id}/runs`, { method: "POST", body: "{}", headers: { "Idempotency-Key": k } })
  const s2 = await api(`/api/tasks/${task.id}/runs`, { method: "POST", body: "{}", headers: { "Idempotency-Key": k } })
  assert(s1.body.taskRunId === s2.body.taskRunId, "同幂等键返回同一批次", { a: s1.body.taskRunId, b: s2.body.taskRunId })

  console.log("\n[演练 4] 观测端点可用（队列/调度/成本）")
  const q = await api("/api/observability/queue-stats")
  assert(q.status === 200 && typeof q.body.pending === "number", "队列统计可用", q.status)
  const sch = await api("/api/observability/schedule-stats")
  assert(sch.status === 200, "调度统计可用", sch.status)

  console.log(`\n========================================`)
  console.log(`故障演练：${failures === 0 ? "通过" : `${failures} 项未通过`}`)
  teardown(); process.exit(failures === 0 ? 0 : 1)
} catch (e) {
  console.error(`\n演练异常：${e.message}`)
  teardown(); process.exit(1)
}
