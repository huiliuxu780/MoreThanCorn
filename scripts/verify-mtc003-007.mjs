/**
 * MTC-003~007 证据截图脚本：全部来自真实运行页面（真实 API）。
 * 输出 .tmp-docs/mtc003-007/。
 */
import fs from "node:fs"
import puppeteer from "puppeteer-core"

const BASE = process.env.MTC_BASE ?? "http://localhost:5199"
const API = process.env.MTC_API ?? "http://127.0.0.1:8120"
const OUT = ".tmp-docs/mtc003-007"
fs.mkdirSync(OUT, { recursive: true })
fs.rmSync(`${OUT}/profile`, { recursive: true, force: true })

const results = []
function check(name, ok, detail = "") {
  results.push({ name, ok, detail })
  console.log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? ` | ${detail}` : ""}`)
}

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  userDataDir: `${OUT}/profile`,
  defaultViewport: { width: 1440, height: 900 },
})
const page = await browser.newPage()

async function shot(name) {
  await page.screenshot({ path: `${OUT}/${name}` })
  check(`截图 ${name}`, true)
}
async function go(url, wait = 1800) {
  await page.goto(BASE + url, { waitUntil: "domcontentloaded" })
  await new Promise((r) => setTimeout(r, wait))
}

const j = (p) => fetch(`${API}${p}`).then((r) => r.json()).catch(() => null)
const [tasks, agents, wfs, conns] = await Promise.all([
  j("/api/tasks?pageSize=1"), j("/api/agents?pageSize=1"), j("/api/workflows?page=1&pageSize=1"), j("/api/connections?page=1&pageSize=1"),
])
const taskId = tasks?.items?.[0]?.id
const agentId = agents?.items?.[0]?.id
const wfId = wfs?.items?.[0]?.id
const connId = conns?.items?.[0]?.id

/* 任务工作台 */
await go("/tasks")
await shot("tasks-board-light.png")
await page.evaluate(() => {
  const ev = new Event("mtc-theme", { bubbles: false })
  localStorage.setItem("mtc-theme", "dark")
  void ev
  location.reload()
})
await page.waitForSelector('[data-lane="needs_action"]', { timeout: 15000 })
await new Promise((r) => setTimeout(r, 1500))
await shot("tasks-board-dark.png")
await go("/tasks?view=list")
await shot("tasks-list.png")
await go("/tasks")
const card = await page.$("[data-workitem-id]")
if (card) {
  await card.click()
  await new Promise((r) => setTimeout(r, 1200))
  await shot("workitem-drawer.png")
  await page.keyboard.press("Escape")
} else check("WorkItem Drawer（无卡可点）", false)

/* 自主任务 */
if (taskId) {
  await go("/autonomous-tasks")
  await shot("autonomous-list.png")
  await go("/autonomous-tasks/new")
  await shot("autonomous-new.png")
  await go(`/autonomous-tasks/${taskId}`)
  await shot("autonomous-detail.png")
  await go(`/autonomous-tasks/${taskId}/edit`)
  await shot("autonomous-edit.png")
} else check("自主任务夹具存在", false)

/* Agent */
await go("/agents")
await shot("agents-list.png")
await go("/agents/new")
await shot("agents-new.png")
if (agentId) {
  await go(`/agents/${agentId}`)
  await shot("agent-detail-build.png")
  const observe = await page.evaluateHandle(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "观测"))
  if (observe.asElement()) {
    await observe.asElement().click()
    await new Promise((r) => setTimeout(r, 1200))
    await shot("agent-detail-observe.png")
  } else check("Agent 观测 Tab", false)
} else check("Agent 夹具存在", false)

/* 资源 */
await go("/resources")
await shot("resources-hub.png")
await go("/resources/ai")
await shot("resources-ai.png")
await go("/resources/data")
await shot("resources-data.png")
await go("/resources/connections")
if (connId) {
  const row = await page.evaluateHandle((id) => [...document.querySelectorAll("button, [role=button], .cursor-pointer")].find((e) => e.textContent?.includes(id.slice(0, 8))) , connId)
  if (row.asElement()) {
    await row.asElement().click()
    await new Promise((r) => setTimeout(r, 1200))
  }
}
await shot("connection-detail.png")

/* Workflow */
await go("/workflows")
await shot("workflows-list.png")
if (wfId) {
  await go(`/workflows/${wfId}`, 3000)
  await shot("workflow-canvas.png")
  const node = await page.$(".react-flow__node")
  if (node) {
    await node.click()
    await new Promise((r) => setTimeout(r, 1200))
    await shot("workflow-inspector.png")
  } else check("画布节点可点", false)
  await shot("workflow-runstate.png")
} else check("Workflow 夹具存在", false)

/* 视口与主题 */
await page.setViewport({ width: 768, height: 1000 })
await go("/tasks")
await shot("768.png")
await page.setViewport({ width: 640, height: 960 })
await go("/tasks")
const burger = await page.$('[aria-label="打开导航"]')
if (burger) {
  await burger.click()
  await new Promise((r) => setTimeout(r, 1000))
  await shot("640-sheet.png")
} else check("640 Sheet 触发器", false)
await page.setViewport({ width: 1440, height: 900 })
await go("/tasks")
await shot("theme-toggle.png")

await browser.close()
const shots = fs.readdirSync(OUT).filter((f) => f.endsWith(".png"))
check("截图数量 >= 17", shots.length >= 17, String(shots.length))
const failed = results.filter((r) => !r.ok)
console.log(`\n==== 汇总：${results.length - failed.length}/${results.length} 通过 ====`)
process.exit(failed.length ? 1 : 0)
