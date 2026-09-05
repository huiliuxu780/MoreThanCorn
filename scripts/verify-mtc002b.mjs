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
const queuedOcc = byStatus("queued").find((w) => w.kind === "schedule_occurrence")
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
if (queuedOcc) await cardShot(queuedOcc.id, "06-queued-schedule-card.png")
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
