/**
 * MTC-002B-R2 验收门禁（可复现）：
 * - 五泳道固定顺序 + 无投递一级语义 + 80px rail；
 * - connecting → 真实 SSE（首帧 refresh + sequence 递增为真证据，非文案断言）；
 * - 日期切换：旧日期流不因新日期变化刷新；页面日期控件切换有截图；
 * - needs_action 冲突卡元素级截图；load more / truncated 真实证据（需 seed --bulk）；
 * - 移动端无水平溢出；截图 SHA-256 互不相同。
 * 前置：后端 8120；WF_ENV=development ALLOW_DEMO_SEED=1 seed_workitems_demo.py（--bulk 210 用于 truncated）。
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
// 冲突样本按状态筛选取（bulk 夹具可能把第一页占满）
const needsList = await fetch(`${API}/api/work-items?status=needs_action&pageSize=200`).then((r) => r.json())
const conflict = needsList.items.find((w) => w.diagnostics.conflictCodes.includes("EXECUTION_DELIVERY_CONFLICT"))
const demo = list.items.find((w) => w.title.startsWith("DEMO002B") && w.kind === "task_run")
check("API 五组状态均有样本（counts 基于筛选全集）", ["needs_action", "running", "completed", "queued", "failed_cancelled"].every((s) => (list.counts?.[s] ?? 0) > 0), JSON.stringify(list.counts))
check("存在 execution=running+delivery=succeeded 冲突样本", !!conflict, conflict?.id ?? "")
check("存在 DEMO002B 夹具（seed 已运行）", !!demo, demo?.title ?? "先运行 seed_workitems_demo.py")

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  userDataDir: `${OUT}/profile`,
  defaultViewport: { width: 1440, height: 900 },
})
const page = await browser.newPage()

/* ---------- 02 connecting → sse（拦截首条 stream 请求制造 connecting 态） ---------- */
let aborted = false
await page.setRequestInterception(true)
page.on("request", (req) => {
  if (!aborted && req.url().includes("/api/work-items/stream")) {
    aborted = true
    req.abort()
    return
  }
  req.continue()
})
await page.goto(BASE + "/tasks", { waitUntil: "domcontentloaded" })
await page.waitForSelector('[data-lane="needs_action"]', { timeout: 15000 })
const connectingSeen = await page.waitForFunction(
  () => document.body.innerText.includes("连接实时更新中"), { timeout: 8000 },
).then(() => true).catch(() => false)
check("首帧前显示 connecting（连接实时更新中）", connectingSeen)
if (connectingSeen) await page.screenshot({ path: `${OUT}/02-connecting-to-sse.png` })
const sseUp = await page.waitForFunction(
  () => document.body.innerText.includes("实时（SSE）"), { timeout: 20000 },
).then(() => true).catch(() => false)
check("重连后进入实时（SSE）", sseUp)

/* ---------- 01 五泳道 ---------- */
await new Promise((r) => setTimeout(r, 1200))
const laneLabels = await page.evaluate(() =>
  [...document.querySelectorAll("[data-lane]")].map((l) => l.querySelector(".text-sm.font-medium")?.textContent?.trim()))
check("五泳道且固定顺序", JSON.stringify(laneLabels) === JSON.stringify(["需要操作", "执行中", "已完成", "排队中", "失败/取消"]), JSON.stringify(laneLabels))
const forbidden = await page.evaluate(() => {
  const t = document.body.innerText
  return ["即将运行", "结果投递", "已投递", "not_configured", "投递中"].filter((x) => t.includes(x))
})
check("无即将运行/结果投递/已投递/raw delivery 文案", forbidden.length === 0, forbidden.join(","))
const railW = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="app-rail"]')).width)
check("80px rail 无回归", railW === "80px", railW)
await page.screenshot({ path: `${OUT}/01-five-lanes-light.png` })

/* ---------- 真实首帧 + sequence 递增（页面内 fetch 流） ---------- */
const streamUrl = `${API}/api/work-items/stream`
const seqProbe = page.evaluate(async (url) => {
  const resp = await fetch(url)
  if (!resp.ok || !resp.body) return { error: resp.status }
  const reader = resp.body.getReader()
  const dec = new TextDecoder()
  const readEvent = async () => {
    let buf = ""
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return null
      buf += dec.decode(value, { stream: true })
      const i = buf.indexOf("\n\n")
      if (i >= 0) {
        const block = buf.slice(0, i)
        buf = buf.slice(i + 2)
        const l = block.split("\n").find((x) => x.startsWith("id:"))
        if (l) return Number(l.slice(3).trim())
      }
    }
  }
  const s1 = await readEvent()
  const t0 = Date.now()
  while (!window.__mtcGo && Date.now() - t0 < 25000) await new Promise((r) => setTimeout(r, 100))
  const s2 = await readEvent()
  reader.cancel()
  return { s1, s2 }
}, streamUrl)
await new Promise((r) => setTimeout(r, 2000))
if (demo) {
  const pr = await fetch(`${API}/api/tasks/${demo.automationId}/runs`, {
    method: "POST", body: "{}",
    headers: { "Idempotency-Key": `demo002b-r2-verify-${Date.now()}`, "Content-Type": "application/json" },
  })
  check("制造变化：新批次启动 202", pr.status === 202, String(pr.status))
}
await page.evaluate(() => { window.__mtcGo = true })
const seqRes = await seqProbe
check("SSE 真实首帧且 sequence 递增", !!seqRes && seqRes.s1 >= 1 && seqRes.s2 === seqRes.s1 + 1, JSON.stringify(seqRes))

/* ---------- 03 日期切换：旧日期流不随新日期变化刷新 ---------- */
const tomorrow = new Date(Date.now() + 86400000)
const pad = (n) => String(n).padStart(2, "0")
const tstr = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`
// 日期切换真证据：页面切换业务日期后，SSE 请求必须携带 dateFrom 重建连接；
// “旧日期终态变化不影响新日期 digest”的边界由 pytest test_digest_date_switch 覆盖。
const streamReqs = []
page.on("request", (req) => { if (req.url().includes("/api/work-items/stream")) streamReqs.push(req.url()) })
// 页面日期控件切换截图（明日窗口可见 queued occurrence）
await page.evaluate((val) => {
  const el = document.querySelector('input[aria-label="业务日期"]')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
  setter.call(el, val)
  el.dispatchEvent(new Event("input", { bubbles: true }))
  el.dispatchEvent(new Event("change", { bubbles: true }))
}, tstr)
await new Promise((r) => setTimeout(r, 1500))
await page.screenshot({ path: `${OUT}/03-date-switch.png` })
const dateStreamOk = await page.waitForFunction(
  () => window.__mtcStreamReqs?.some((u) => u.includes("dateFrom=")) , { timeout: 8000 },
).then(() => true).catch(() => false)
check("日期切换后 SSE 携带 dateFrom 重建", dateStreamOk || streamReqs.some((u) => u.includes("dateFrom=")), JSON.stringify(streamReqs.slice(-2)))
await page.evaluate(() => {
  const el = document.querySelector('input[aria-label="业务日期"]')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
  setter.call(el, "")
  el.dispatchEvent(new Event("input", { bubbles: true }))
  el.dispatchEvent(new Event("change", { bubbles: true }))
})
await new Promise((r) => setTimeout(r, 1200))

/* ---------- 04 needs_action 冲突卡（进入“仅看需要操作”过滤后取元素） ---------- */
if (conflict) {
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("仅看需要操作"))
    btn?.click()
  })
  await new Promise((r) => setTimeout(r, 1500))
  const el = await page.$(`[data-lane="needs_action"] [data-workitem-id="${conflict.id}"]`)
  check("状态冲突卡位于需要操作泳道", !!el, conflict.id)
  if (el) await el.screenshot({ path: `${OUT}/04-needs-action.png` })
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("仅看需要操作"))
    btn?.click()
  })
  await new Promise((r) => setTimeout(r, 1500))
}

/* ---------- 05 load more / truncated ---------- */
const banner = await page.$('[data-testid="load-more"]')
if (banner) {
  const before = await page.evaluate(() => document.querySelectorAll("[data-workitem-id]").length)
  await page.evaluate(() => document.querySelector('[data-testid="load-more"]').scrollIntoView({ block: "center" }))
  await new Promise((r) => setTimeout(r, 400))
  await page.screenshot({ path: `${OUT}/05-load-more-truncated.png` })
  const page2Seen = []
  page.on("request", (req) => { if (req.url().includes("page=2")) page2Seen.push(req.url()) })
  await page.evaluate(() => document.querySelector('[data-testid="load-more"] button').click())
  await new Promise((r) => setTimeout(r, 3000))
  const after = await page.evaluate(() => {
    const ids = [...document.querySelectorAll("[data-workitem-id]")].map((e) => e.getAttribute("data-workitem-id"))
    return { n: ids.length, uniq: new Set(ids).size }
  })
  // 策略：refresh 到达会重置第一页并提示；故接受“追加生效”或“被 refresh 重置”，但全程不得出现重复 id
  check("load more 发起 page=2 且 DOM 无重复 id", page2Seen.length > 0 && after.n === after.uniq, JSON.stringify({ before, after, page2: page2Seen.length }))
} else {
  check("load more/truncated 证据", false, "当前窗口未截断：先以 seed --bulk 210 制造 >200 条")
}

/* ---------- 移动端 ---------- */
await page.setViewport({ width: 640, height: 960 })
await new Promise((r) => setTimeout(r, 800))
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
check("移动端无水平溢出", !overflow)

await browser.close()
const shots = fs.readdirSync(OUT).filter((f) => f.endsWith(".png"))
const hashes = shots.map((f) => createHash("sha256").update(fs.readFileSync(`${OUT}/${f}`)).digest("hex"))
check("截图 SHA-256 互不相同", new Set(hashes).size === hashes.length, shots.join(" "))

const failed = results.filter((r) => !r.ok)
console.log(`\n==== 汇总：${results.length - failed.length}/${results.length} 通过 ====`)
process.exit(failed.length ? 1 : 0)
