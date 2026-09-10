#!/usr/bin/env node
/** 审计补证（09-10 返工）：自动任务执行者校验证据。
 *  1) /api/agents 全量（archived=all）的 executable 判定快照（与 as_automations._validate_target 同一规则）；
 *  2) 草稿/归档 Agent（数据分析师、前端工程师）作为 target 的 POST /api/v2/automations → 422 拒绝；
 *  3) 临时解除归档的数据分析师 → 仍因无 active prod Release 被 422 TARGET_NOT_EXECUTABLE 拒绝（随后恢复归档）；
 *  4) 正向对照：活跃产品 Agent（业务分析-通话打标）→ 201 创建成功 → 立即删除（不留残余）；
 *  5) 三个选择器数据源现状：agents(executable)/workflows(published)/agentflows(active_release_id)。
 *  输出 evidence/automation-target-rejection.json。只读 + 自清理，不留任何持久数据。 */
import { writeFileSync } from "node:fs"

const API = "http://127.0.0.1:8120"
const OUT = "research/morethancorn/11-p0-rework-20260910/evidence/automation-target-rejection.json"
const DRAFT_ANALYST = "ed057326b9404876912a6962c52d9640" // 数据分析师（本轮草稿，已归档）
const DRAFT_FRONTEND = "4d78a08ab9cf4467af954b57dbca2e22" // 前端工程师（本轮草稿，已归档）

const results = []
let failures = 0
function record(name, ok, detail) {
  results.push({ name, ok, ...detail })
  if (!ok) failures++
  console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(detail).slice(0, 200)}`)
}

async function req(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
  })
  let body = null
  try { body = await res.json() } catch { /* 204 etc */ }
  return { status: res.status, body }
}

const autoBody = (agentId) => ({
  name: "EVID-REJECT-TEST", description: "审计补证：执行者校验，创建即删",
  target_kind: "agent", agent_id: agentId, triggers: [],
})

// 1) executable 快照
const all = await req("/api/agents?pageSize=100&archived=all")
const agents = (all.body?.items ?? []).map((a) => ({
  id: a.id, name: a.name, archived: a.archived ?? false, executable: a.executable ?? false,
}))
record("agents_executable_snapshot", agents.length > 0 && agents.filter((a) => a.executable).length === 1, {
  total: agents.length,
  executable: agents.filter((a) => a.executable).map((a) => a.name),
})

// 2) 归档草稿 Agent → 422 TARGET_ARCHIVED
for (const [label, id] of [["数据分析师", DRAFT_ANALYST], ["前端工程师", DRAFT_FRONTEND]]) {
  const r = await req("/api/v2/automations", { method: "POST", body: JSON.stringify(autoBody(id)) })
  record(`reject_archived_${label}`, r.status === 422 && r.body?.detail?.code === "TARGET_ARCHIVED", {
    status: r.status, code: r.body?.detail?.code, message: r.body?.detail?.message,
  })
}

// 3) 临时解除归档 → 无 active prod Release → 422 TARGET_NOT_EXECUTABLE → 恢复归档
const un = await req(`/api/agents/${DRAFT_ANALYST}`, { method: "PUT", body: JSON.stringify({ archived: false }) })
const r3 = await req("/api/v2/automations", { method: "POST", body: JSON.stringify(autoBody(DRAFT_ANALYST)) })
const re = await req(`/api/agents/${DRAFT_ANALYST}`, { method: "PUT", body: JSON.stringify({ archived: true }) })
record("reject_unarchived_no_release_数据分析师", un.status === 200 && r3.status === 422 &&
  r3.body?.detail?.code === "TARGET_NOT_EXECUTABLE" && re.status === 200 && re.body?.archived === true, {
  unarchive_status: un.status, post_status: r3.status, code: r3.body?.detail?.code,
  message: r3.body?.detail?.message, rearchived: re.body?.archived,
})

// 4) 正向对照：活跃产品 Agent → 201 → 删除
const active = agents.find((a) => a.executable)
let created = null
if (active) {
  const r4 = await req("/api/v2/automations", { method: "POST", body: JSON.stringify(autoBody(active.id)) })
  created = r4.body?.id ?? null
  const del = created ? await req(`/api/v2/automations/${created}`, { method: "DELETE" }) : null
  record("positive_control_active_agent", (r4.status === 200 || r4.status === 201) && del && del.status < 300, {
    agent: active.name, create_status: r4.status, automation_id: created, delete_status: del?.status,
  })
} else {
  record("positive_control_active_agent", false, { reason: "no executable agent found" })
}

// 5) 三个选择器数据源现状
const wfs = await req("/api/workflows?pageSize=100")
const flows = await req("/api/v2/agentflows")
const wfItems = (wfs.body?.items ?? []).map((w) => ({ id: w.id, name: w.name, status: w.status }))
const flowItems = (flows.body?.items ?? []).map((f) => ({ id: f.id, name: f.name, active_release_id: f.active_release_id ?? null }))
record("selector_sources", true, {
  agents_executable_only: agents.filter((a) => a.executable).map((a) => a.name),
  workflows_published_only: wfItems.filter((w) => w.status === "published").map((w) => w.name),
  workflows_all: wfItems,
  agentflows_with_release: flowItems.filter((f) => Boolean(f.active_release_id)).map((f) => f.name),
  agentflows_all: flowItems,
})

writeFileSync(OUT, JSON.stringify({
  collected_at: new Date().toISOString(),
  api: API,
  rule: "executable = not archived AND has active prod Release（前端选择器与后端 _validate_target 同一判定）",
  results, failures,
  agents_snapshot: agents,
}, null, 2))
console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURES`} → ${OUT}`)
process.exit(failures === 0 ? 0 : 1)
