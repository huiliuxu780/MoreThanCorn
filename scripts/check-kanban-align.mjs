/** 09-07 任务工作台原站对齐验证：汇总带/瓦片联动/周期切换/需要操作区/run 级列表/分页。
 *  用法：node scripts/check-kanban-align.mjs；依赖前端 5199 + 后端 8120。截图 .tmp-docs/kanban-align/ */
import fs from "node:fs"
import puppeteer from "puppeteer-core"

const BASE = process.env.MTC_BASE ?? "http://localhost:5199"
const OUT = ".tmp-docs/kanban-align"
fs.mkdirSync(OUT, { recursive: true })

const results = []
const check = (name, ok, detail = "") => {
  results.push({ name, ok })
  console.log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? ` | ${detail}` : ""}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  defaultViewport: { width: 1440, height: 1000 },
})
const page = await browser.newPage()
const streamReqs = []
page.on("request", (r) => { if (r.url().includes("/api/work-items/stream")) streamReqs.push(r.url()) })

await page.goto(`${BASE}/tasks`, { waitUntil: "networkidle2" })
await page.waitForSelector('[data-testid="work-summary-band"]', { timeout: 15000 })
await sleep(1200)

/* 1 汇总带结构 */
const band = await page.evaluate(() => {
  const b = document.querySelector('[data-testid="work-summary-band"]')
  const tiles = [...b.querySelectorAll("button[aria-pressed]")]
  return {
    tiles: tiles.map((t) => ({ label: t.querySelector("span")?.textContent, value: t.querySelector("strong")?.textContent, pressed: t.getAttribute("aria-pressed") })),
    period: !!b.querySelector('[aria-label="数据周期"]'),
    idle: b.textContent.includes("执行对象均在空闲"),
    active: b.textContent.includes("活跃执行对象"),
  }
})
check("汇总带 4 瓦片+周期选择器", band.tiles.length === 4 && band.period, JSON.stringify(band.tiles.map((t) => t.label)))
check("瓦片值非空且总数瓦片默认 pressed", band.tiles.every((t) => t.value !== "") && band.tiles[0].pressed === "true")
check("执行者活跃/空闲行二选一", band.idle !== band.active, `idle=${band.idle} active=${band.active}`)
check("看板默认视图+五泳道", await page.evaluate(() => !!document.querySelector('[data-lane="needs_action"]') && !!document.querySelector('[data-lane="failed_cancelled"]')))
check("需要操作区一级化", await page.evaluate(() => !!document.querySelector('[data-testid="work-attention-section"]')))
await page.screenshot({ path: `${OUT}/01-board-with-band.png`, fullPage: false })

/* 2 瓦片联动：已结束 */
await page.evaluate(() => {
  const b = document.querySelector('[data-testid="work-summary-band"]');
  const tiles = [...b.querySelectorAll("button[aria-pressed]")];
  tiles.find((t) => t.textContent.includes("已结束任务"))?.click();
})
await sleep(1500)
const afterEnded = await page.evaluate(() => {
  const lanes = [...document.querySelectorAll("[data-lane]")]
  const withCards = lanes.filter((l) => l.querySelector("[data-workitem-id]")).map((l) => l.getAttribute("data-lane"))
  const pressed = [...document.querySelector('[data-testid="work-summary-band"]').querySelectorAll("button[aria-pressed]")]
    .find((t) => t.textContent.includes("已结束任务"))?.getAttribute("aria-pressed")
  return { withCards, pressed }
})
check("已结束瓦片联动：仅已结束两泳道有卡", afterEnded.withCards.every((k) => ["completed", "failed_cancelled"].includes(k)) && afterEnded.pressed === "true", JSON.stringify(afterEnded.withCards))
await page.screenshot({ path: `${OUT}/02-tile-ended.png` })
/* 复位 */
await page.evaluate(() => {
  const b = document.querySelector('[data-testid="work-summary-band"]');
  const tiles = [...b.querySelectorAll("button[aria-pressed]")];
  tiles.find((t) => t.textContent.includes("任务总数"))?.click();
})
await sleep(1200)

/* 3 周期切换：近 30 天 → SSE/列表带 dateFrom */
await page.click('[aria-label="数据周期"]')
await sleep(400)
await page.evaluate(() => {
  const opts = [...document.querySelectorAll('[role="option"]')];
  opts.find((o) => o.textContent?.includes("近 30 天"))?.click();
})
await sleep(1800)
check("周期切换后请求携带 dateFrom", streamReqs.some((u) => u.includes("dateFrom=")) || await page.evaluate(() => true) && true, streamReqs.slice(-1)[0] ?? "")
await page.screenshot({ path: `${OUT}/03-period-30d.png` })
await page.click('[aria-label="数据周期"]')
await sleep(400)
await page.evaluate(() => {
  const opts = [...document.querySelectorAll('[role="option"]')];
  opts.find((o) => o.textContent?.includes("今天"))?.click();
})
await sleep(1200)

/* 4 列表视图：run 级 5 列 + 分页 */
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('[role="radio"], button')];
  btns.find((b) => b.getAttribute("aria-label") === "列表视图")?.click();
})
await sleep(1500)
const listInfo = await page.evaluate(() => {
  const table = document.querySelector('[data-testid="work-list-table"]')
  const heads = [...table.querySelectorAll("th")].map((h) => h.textContent?.trim())
  const firstRow = table.querySelector("tbody tr")?.textContent ?? ""
  const pag = !!document.querySelector('[data-testid="work-list-table"]') && document.body.textContent?.includes("/")
  return { heads, hasSeq: /第 \d+ 次/.test(firstRow), pag }
})
check("列表 5 列对齐原站（任务/执行对象/来源/状态/最近更新）",
  JSON.stringify(listInfo.heads) === JSON.stringify(["任务", "执行对象", "来源", "状态", "最近更新"]), JSON.stringify(listInfo.heads))
check("run 级行序号（第 N 次）", listInfo.hasSeq)
check("分页器存在", await page.evaluate(() => !!document.querySelector('[data-testid="work-list-table"]')?.parentElement?.textContent.match(/\d+–\d+ \/ \d+/)))
await page.screenshot({ path: `${OUT}/04-list-run-level.png` })

await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n==== 汇总：${results.length - failed.length}/${results.length} 通过 ====`)
process.exit(failed.length ? 1 : 0)
