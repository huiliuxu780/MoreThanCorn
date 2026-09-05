/**
 * MTC-002B 验收自检脚本（可复现）：
 * - /tasks 五泳道（需要操作/执行中/已完成/排队中/失败取消），无即将运行/结果投递/已投递/raw delivery；
 * - 状态冲突卡（execution running + delivery succeeded）位于需要操作泳道；
 * - 五种状态卡片元素级截图 + Light/Dark 全板 + 详情无投递列 + 移动端无水平溢出；
 * - 截图唯一性以纯 SHA-256 判定；80px rail 无回归。
 * 依赖：后端 8120（含 /api/work-items 与 wf_dev 视觉夹具）+ 前端 5199。
 */
import { createHash } from "node:crypto"
import fs from "node:fs"
import puppeteer from "puppeteer-core"

const BASE = process.env.MTC_BASE ?? "http://localhost:5199"
const API = process.env.MTC_API ?? "http://127.0.0.1:8120"
const OUT = ".tmp-docs/mtc002b"
fs.mkdirSync(OUT, { recursive: true })
fs.rmSync(`${OUT}/profile`, { recursive: true, force: true })

const results = []
function check(name, ok, detail = "") {
  results.push({ name, ok, detail })
  console.log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? ` | ${detail}` : ""}`)
}

const list = await fetch(`${API}/api/work-items?pageSize=200`).then((r) => r.json())
const byStatus = (s) => list.items.filter((w) => w.status === s)
const conflict = list.items.find((w) => w.diagnostics.conflictCodes.includes("EXECUTION_DELIVERY_CONFLICT"))
let queuedOcc = byStatus("queued").find((w) => w.kind === "schedule_occurrence")
let occDate = ""
if (!queuedOcc) {
  // 深夜场景：occurrence 可能落在下一业务日 → 两日窗口查找 + 页面日期控件定位
  const pad = (n) => String(n).padStart(2, "0")
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const t0 = new Date()
  const t1 = new Date(t0.getTime() + 86400000)
  const l2 = await fetch(`${API}/api/work-items?dateFrom=${fmt(t0)}&dateTo=${fmt(t1)}&pageSize=200`).then((r) => r.json())
  queuedOcc = l2.items.find((w) => w.kind === "schedule_occurrence" && w.status === "queued")
  if (queuedOcc) occDate = (queuedOcc.scheduledAt ?? "").slice(0, 10)
}
check("API 五组状态均有样本", ["needs_action", "running", "completed", "queued", "failed_cancelled"].every((s) => byStatus(s).length > 0), JSON.stringify(list.counts))
check("存在 execution=running+delivery=succeeded 冲突样本", !!conflict, conflict?.id ?? "")

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  userDataDir: `${OUT}/profile`,
  defaultViewport: { width: 1440, height: 900 },
})
const page = await browser.newPage()

async function setTheme(mode) {
  await page.evaluateOnNewDocument((m) => localStorage.setItem("mtc-theme", m), mode)
}
async function openTasks() {
  await page.goto(BASE + "/tasks", { waitUntil: "domcontentloaded" })
  await page.waitForSelector('[data-lane="needs_action"]', { timeout: 15000 })
  await new Promise((r) => setTimeout(r, 1200))
}

/* ---------- Light 全板 ---------- */
await setTheme("light")
await openTasks()
// P1-01：页面必须进入实时（SSE），不得静默降级
const sseUp = await page.waitForFunction(() => document.body.innerText.includes("实时（SSE）"), { timeout: 20000 }).then(() => true).catch(() => false)
check("页面进入实时（SSE）通道", sseUp)
const laneLabels = await page.evaluate(() =>
  [...document.querySelectorAll("[data-lane]")].map((l) => l.querySelector(".text-sm.font-medium")?.textContent?.trim()),
)
check("五泳道且固定顺序", JSON.stringify(laneLabels) === JSON.stringify(["需要操作", "执行中", "已完成", "排队中", "失败/取消"]), JSON.stringify(laneLabels))
const forbidden = await page.evaluate(() => {
  const t = document.body.innerText
  return ["即将运行", "结果投递", "已投递", "not_configured", "投递中"].filter((x) => t.includes(x))
})
check("无即将运行/结果投递/已投递/raw delivery 文案", forbidden.length === 0, forbidden.join(","))
const railW = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="app-rail"]')).width)
check("80px rail 无回归", railW === "80px", railW)
if (conflict) {
  const inLane = await page.evaluate((wid) => {
    const el = document.querySelector(`[data-lane="needs_action"] [data-workitem-id="${wid}"]`)
    return !!el
  }, conflict.id)
  check("状态冲突卡位于需要操作泳道", inLane, conflict.id)
}
// P1-01：主动制造一次允许范围内的变化，观察 SSE refresh 驱动看板更新
const demo = list.items.find((w) => w.title.startsWith("DEMO-002B") && w.kind === "task_run")
if (demo) {
  const pr = await fetch(`${API}/api/tasks/${demo.automationId}/runs`, {
    method: "POST", body: "{}",
    headers: { "Idempotency-Key": `demo-002b-verify-${Date.now()}`, "Content-Type": "application/json" },
  })
  check("制造变化：新批次启动 202", pr.status === 202, String(pr.status))
  // 新批次可能保持 queued，也可能被在线 worker 立即执行成 completed：两者任一 +1 即证明 refresh 生效
  const expectQ = list.counts.queued + 1
  const expectC = list.counts.completed + 1
  const saw = await page.waitForFunction(
    (q, c) => document.body.innerText.includes(`排队中 ${q}`) || document.body.innerText.includes(`已完成 ${c}`),
    { timeout: 15000 }, expectQ, expectC).then(() => true).catch(() => false)
  check("SSE refresh 后看板反映变化（排队中/已完成 +1）", saw, `期望 排队中 ${expectQ} 或 已完成 ${expectC}`)
  check("变化后仍为实时（SSE）通道", await page.evaluate(() => document.body.innerText.includes("实时（SSE）")))
} else {
  check("存在 DEMO-002B 夹具任务", false, "先运行 scripts/seed_workitems_demo.py")
}
await page.screenshot({ path: `${OUT}/01-work-items-five-lanes-light.png` })

/* ---------- Dark 全板 ---------- */
await setTheme("dark")
await openTasks()
await page.screenshot({ path: `${OUT}/02-work-items-five-lanes-dark.png` })

/* ---------- 元素级状态卡截图 ---------- */
async function cardShot(wid, file) {
  const el = await page.$(`[data-workitem-id="${wid}"]`)
  if (!el) { check(`卡片截图 ${file}`, false, "元素不存在"); return }
  await el.screenshot({ path: `${OUT}/${file}` })
  check(`卡片截图 ${file}`, true, wid)
}
if (conflict) await cardShot(conflict.id, "03-needs-action-conflict-card.png")
const running = byStatus("running")[0]
if (running) await cardShot(running.id, "04-running-card.png")
const completed = byStatus("completed")[0]
if (completed) await cardShot(completed.id, "05-completed-card.png")
if (queuedOcc) {
  if (occDate) {
    await page.evaluate((val) => {
      const el = document.querySelector('input[aria-label="业务日期"]')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
      setter.call(el, val)
      el.dispatchEvent(new Event("input", { bubbles: true }))
      el.dispatchEvent(new Event("change", { bubbles: true }))
    }, occDate)
    await new Promise((r) => setTimeout(r, 1500))
  }
  await cardShot(queuedOcc.id, "06-queued-schedule-card.png")
  if (occDate) {
    await page.evaluate(() => {
      const el = document.querySelector('input[aria-label="业务日期"]')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
      setter.call(el, "")
      el.dispatchEvent(new Event("input", { bubbles: true }))
      el.dispatchEvent(new Event("change", { bubbles: true }))
    })
    await new Promise((r) => setTimeout(r, 1500))
  }
} else {
  check("存在排队中调度卡（occurrence）", false, "先运行 scripts/seed_workitems_demo.py 后立即复跑")
}
const failed = byStatus("failed_cancelled")[0]
if (failed) await cardShot(failed.id, "07-failed-cancelled-card.png")

/* ---------- 自主任务详情：无投递列，有任务状态列 ---------- */
const autoId = conflict?.automationId ?? list.items[0]?.automationId
await page.goto(BASE + `/autonomous-tasks/${autoId}`, { waitUntil: "domcontentloaded" })
await new Promise((r) => setTimeout(r, 1500))
const detailOk = await page.evaluate(() => {
  const t = document.body.innerText
  return !t.includes("投递状态") && t.includes("任务状态") && !t.includes("not_configured")
})
check("详情页无投递状态列、有任务状态列", detailOk)
await page.screenshot({ path: `${OUT}/08-autonomous-task-detail-no-delivery-status.png` })

/* ---------- 移动端：无水平溢出 ---------- */
await page.setViewport({ width: 640, height: 960 })
await openTasks()
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
check("移动端无水平溢出", !overflow)
await page.screenshot({ path: `${OUT}/09-mobile-work-items.png` })

/* ---------- 截图 SHA-256 唯一 ---------- */
const shots = ["01-work-items-five-lanes-light.png", "02-work-items-five-lanes-dark.png", "03-needs-action-conflict-card.png", "04-running-card.png", "05-completed-card.png", "06-queued-schedule-card.png", "07-failed-cancelled-card.png", "08-autonomous-task-detail-no-delivery-status.png", "09-mobile-work-items.png"]
const hashes = shots.map((f) => createHash("sha256").update(fs.readFileSync(`${OUT}/${f}`)).digest("hex"))
check("九张截图 SHA-256 互不相同", new Set(hashes).size === hashes.length, hashes.map((h) => h.slice(0, 8)).join(" "))

await browser.close()
const failedChecks = results.filter((r) => !r.ok)
console.log(`\n==== 汇总：${results.length - failedChecks.length}/${results.length} 通过 ====`)
process.exit(failedChecks.length ? 1 : 0)
