/**
 * MTC-001 验收自检脚本（可复现）：
 * - 五个一级入口 + 底部 主题/设置/账号
 * - 路由映射与旧路由重定向
 * - Light/Dark/System 主题：切换、持久化、刷新不闪白（inline 引导脚本）
 * - Sidebar 展开/收起（Tooltip）、键盘操作、768/1280/1440 三视口
 * 截图输出到 .tmp-docs/mtc001/（gitignore）。
 */
import fs from "node:fs"
import puppeteer from "puppeteer-core"

const BASE = process.env.MTC_BASE ?? "http://localhost:5199"
const OUT = ".tmp-docs/mtc001"
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
const consoleErrors = []
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 160)) })
page.on("pageerror", (e) => consoleErrors.push(String(e).slice(0, 160)))

async function clickButtonByText(scope, text) {
  const handle = await scope.evaluateHandle((t) => {
    const buttons = [...document.querySelectorAll("button")]
    return buttons.find((b) => b.textContent?.includes(t)) ?? null
  }, text)
  const el = handle.asElement()
  if (!el) throw new Error(`button not found: ${text}`)
  await el.click()
  return el
}

/** Radix DropdownMenu 的菜单项是 div[role=menuitem]，不是 button。 */
async function clickMenuItem(text) {
  await page.waitForSelector('[role="menu"]', { timeout: 5000 })
  const handle = await page.evaluateHandle((t) => {
    const items = [...document.querySelectorAll('[role="menuitem"], [role="menuitemradio"]')]
    return items.find((m) => m.textContent?.includes(t)) ?? null
  }, text)
  const el = handle.asElement()
  if (!el) throw new Error(`menu item not found: ${text}`)
  await el.click()
  return el
}

async function waitForNav() {
  await page.waitForSelector('[data-sidebar="sidebar"]', { timeout: 15000 })
}

/* ---------- 1. 首载重定向 + 五个一级入口 ---------- */
await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 30000 })
await waitForNav()
await new Promise((r) => setTimeout(r, 1500))
check("根路径 / → /tasks", page.url().endsWith("/tasks"), page.url())

const navInfo = await page.evaluate(() => {
  const buttons = [...document.querySelectorAll('[data-sidebar="menu-button"]')]
  return buttons.map((b) => ({ text: b.textContent?.trim() ?? "", active: b.getAttribute("data-active") }))
})
const expectedNav = ["任务", "自主任务", "Agent", "能力与资源", "Workflow", "主题", "设置"]
const navTexts = navInfo.map((n) => n.text)
check(
  "导航含五个一级入口 + 底部主题/设置",
  expectedNav.every((t) => navTexts.includes(t)),
  JSON.stringify(navTexts),
)
const tasksActive = navInfo.find((n) => n.text === "任务")?.active === "true"
check("当前路由（/tasks）选中态", tasksActive)

/* ---------- 2. Light 截图 ---------- */
await page.screenshot({ path: `${OUT}/01-tasks-1440-light.png` })
check("Light 截图（1440）", true, "01-tasks-1440-light.png")

/* ---------- 3. 主题菜单：切换深色 ---------- */
await clickButtonByText(page, "主题")
await page.waitForSelector('[role="menu"]', { timeout: 5000 })
const themeMenuItems = await page.evaluate(() =>
  [...document.querySelectorAll('[role="menuitem"]')].map((m) => m.textContent?.trim()),
)
check("主题菜单三项", ["跟随系统", "浅色", "深色"].every((t) => themeMenuItems.some((m) => m?.includes(t))), JSON.stringify(themeMenuItems))
await clickMenuItem("深色")
await new Promise((r) => setTimeout(r, 300))
const darkOn = await page.evaluate(() => document.documentElement.classList.contains("dark"))
const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
check("切换深色立即生效", darkOn && bodyBg === "rgb(16, 18, 22)", bodyBg)
await page.screenshot({ path: `${OUT}/02-tasks-1440-dark.png` })
check("Dark 截图（1440）", true, "02-tasks-1440-dark.png")

/* ---------- 4. 刷新保持 + 无闪白（inline 引导脚本） ---------- */
await page.reload({ waitUntil: "domcontentloaded" })
const earlyDark = await page.evaluate(() => ({
  dark: document.documentElement.classList.contains("dark"),
  htmlBg: getComputedStyle(document.documentElement).backgroundColor,
}))
check("刷新后深色保持且首帧不闪白", earlyDark.dark && earlyDark.htmlBg === "rgb(16, 18, 22)", earlyDark.htmlBg)
await waitForNav()

/* ---------- 5. 跟随系统 ---------- */
await clickButtonByText(page, "主题")
await page.waitForSelector('[role="menu"]', { timeout: 5000 })
await clickMenuItem("跟随系统")
await new Promise((r) => setTimeout(r, 300))
const sysState = await page.evaluate(() => ({
  dark: document.documentElement.classList.contains("dark"),
  prefersDark: window.matchMedia("(prefers-color-scheme: dark)").matches,
}))
check("跟随系统与 OS 偏好一致", sysState.dark === sysState.prefersDark, JSON.stringify(sysState))
// 恢复深色用于后续截图
await clickButtonByText(page, "主题")
await page.waitForSelector('[role="menu"]', { timeout: 5000 })
await clickMenuItem("深色")
await new Promise((r) => setTimeout(r, 300))

/* ---------- 6. /tasks 与 /autonomous-tasks 无对象混淆 ---------- */
const tasksText = await page.evaluate(() => document.body.innerText.slice(0, 400))
await page.goto(BASE + "/autonomous-tasks", { waitUntil: "domcontentloaded" })
await new Promise((r) => setTimeout(r, 2000))
const autoText = await page.evaluate(() => document.body.innerText.slice(0, 400))
const autoNavActive = await page.evaluate(() =>
  [...document.querySelectorAll('[data-sidebar="menu-button"]')].find((b) => b.textContent?.includes("自主任务"))?.getAttribute("data-active"),
)
check("/autonomous-tasks 加载且导航选中正确", autoNavActive === "true")
check("两页内容不同（无对象混淆）", tasksText !== autoText)
await page.screenshot({ path: `${OUT}/03-autonomous-1440-dark.png` })

/* ---------- 7. 其余一级页面 ---------- */
for (const [path, marker] of [["/agents", "Agent"], ["/resources", "能力与资源"], ["/workflows", "Workflow"], ["/settings", "设置"]]) {
  await page.goto(BASE + path, { waitUntil: "domcontentloaded" })
  await new Promise((r) => setTimeout(r, 1200))
  const hasMarker = await page.evaluate((m) => document.body.innerText.includes(m), marker)
  check(`页面 ${path} 渲染（含「${marker}」）`, hasMarker)
}

/* ---------- 8. /resources Hub 卡片 ---------- */
await page.goto(BASE + "/resources", { waitUntil: "domcontentloaded" })
await new Promise((r) => setTimeout(r, 1200))
const hubCards = await page.evaluate(() =>
  [...document.querySelectorAll("a[href^='/config'], a[href='/settings/connections']")].map((a) => a.textContent?.trim().slice(0, 20)),
)
check("Hub 卡片链接现有资源页", hubCards.length >= 4, JSON.stringify(hubCards.slice(0, 6)))

/* ---------- 9. /settings 七分区 ---------- */
const settingsResults = {}
for (const sec of ["general", "appearance", "notifications", "execution", "security", "audit", "system"]) {
  await page.goto(BASE + `/settings?section=${sec}`, { waitUntil: "domcontentloaded" })
  await new Promise((r) => setTimeout(r, 800))
  settingsResults[sec] = await page.evaluate(() => document.body.innerText.slice(-600))
}
check("settings 通用/通知/执行策略 = 暂未开放", ["general", "notifications", "execution"].every((s) => settingsResults[s].includes("暂未开放")))
check("settings 外观含主题选项", ["跟随系统", "浅色", "深色"].every((t) => settingsResults.appearance.includes(t)))
check("settings 权限与安全含真实权限矩阵", settingsResults.security.includes("task.view"))
check("settings 系统信息含真实版本与 API 基地址", settingsResults.system.includes("v0.1.0") && settingsResults.system.includes("8120"))
await page.goto(BASE + "/settings?section=appearance", { waitUntil: "domcontentloaded" })
await new Promise((r) => setTimeout(r, 800))
await page.screenshot({ path: `${OUT}/04-settings-appearance-1440-dark.png` })

/* ---------- 10. 旧路由重定向 ---------- */
const redirects = [
  ["/config/tasks", "/autonomous-tasks"],
  ["/config/agents", "/agents"],
  ["/config/workflows", "/workflows"],
  ["/operations/task-runs/today", "/tasks"],
]
for (const [from, to] of redirects) {
  await page.goto(BASE + from, { waitUntil: "domcontentloaded" })
  await new Promise((r) => setTimeout(r, 1200))
  check(`重定向 ${from} → ${to}`, new URL(page.url()).pathname === to, page.url())
}

/* ---------- 11. 遗留页面仍可达 ---------- */
for (const p of ["/quality/overview", "/operations/task-runs", "/config/ai-resources"]) {
  await page.goto(BASE + p, { waitUntil: "domcontentloaded" })
  await new Promise((r) => setTimeout(r, 1200))
  const ok = await page.evaluate(() => !document.body.innerText.includes("404"))
  check(`遗留页面可达 ${p}`, ok)
}

/* ---------- 12. Sidebar 收起：Tooltip + 展开 ---------- */
await page.goto(BASE + "/tasks", { waitUntil: "domcontentloaded" })
await waitForNav()
await page.click('[data-slot="sidebar-trigger"]')
await new Promise((r) => setTimeout(r, 500))
const collapsedState = await page.evaluate(() => {
  const el = document.querySelector('[data-sidebar="sidebar"]')
  return el ? { state: el.getAttribute("data-state"), w: parseFloat(getComputedStyle(el).width) } : null
})
check("Sidebar 可收起（icon 态 ~3rem）", collapsedState !== null && collapsedState.w <= 48 && collapsedState.w >= 40, JSON.stringify(collapsedState))
// 收起态悬停出 Tooltip
const firstNavBtn = await page.$('[data-sidebar="menu-button"]')
await firstNavBtn.hover()
await new Promise((r) => setTimeout(r, 900))
const tooltipVisible = await page.evaluate(() => !!document.querySelector('[role="tooltip"]'))
check("收起态悬停显示 Tooltip", tooltipVisible)
await page.screenshot({ path: `${OUT}/05-sidebar-collapsed-dark.png` })
await page.click('[data-slot="sidebar-trigger"]')
await new Promise((r) => setTimeout(r, 500))
const expandedWidth = await page.evaluate(() => {
  const el = document.querySelector('[data-sidebar="sidebar"]')
  return el ? parseFloat(getComputedStyle(el).width) : null
})
check("Sidebar 可重新展开（~14rem）", expandedWidth !== null && expandedWidth >= 200, String(expandedWidth))

/* ---------- 13. 键盘操作：主题菜单 ---------- */
await clickButtonByText(page, "主题")
await page.waitForSelector('[role="menu"]', { timeout: 5000 })
await page.keyboard.press("Escape")
await new Promise((r) => setTimeout(r, 300))
const menuClosed = await page.evaluate(() => !document.querySelector('[role="menu"]'))
check("主题菜单 Escape 关闭", menuClosed)
await clickButtonByText(page, "主题")
await page.waitForSelector('[role="menu"]', { timeout: 5000 })
await page.keyboard.press("ArrowDown") // 浅色
await page.keyboard.press("Enter")
await new Promise((r) => setTimeout(r, 300))
const kbLight = await page.evaluate(() => !document.documentElement.classList.contains("dark"))
check("键盘方向键+回车切换主题（浅色）", kbLight)
await page.screenshot({ path: `${OUT}/06-tasks-1440-light-after-kb.png` })
await clickButtonByText(page, "主题")
await page.waitForSelector('[role="menu"]', { timeout: 5000 })
await page.keyboard.press("ArrowDown")
await page.keyboard.press("ArrowDown") // 深色
await page.keyboard.press("Enter")
await new Promise((r) => setTimeout(r, 300))

/* ---------- 14. 账号菜单 ---------- */
const accountBtn = await page.evaluateHandle(() => {
  const btns = [...document.querySelectorAll('[data-sidebar="menu-button"]')]
  return btns.find((b) => /账号|开发者|dev/.test(b.textContent ?? "")) ?? btns[btns.length - 1] ?? null
})
const accEl = accountBtn.asElement()
check("账号入口存在", !!accEl)
if (accEl) {
  await accEl.click()
  await page.waitForSelector('[role="menu"]', { timeout: 5000 })
  const accItems = await page.evaluate(() => [...document.querySelectorAll('[role="menu"] [role="menuitem"], [role="menu"] [role="menuitemradio"]')].map((m) => m.textContent?.trim()))
  check("账号菜单含 我的偏好/我的权限/退出或登录", accItems.some((t) => t?.includes("我的偏好")) && accItems.some((t) => t?.includes("我的权限")), JSON.stringify(accItems))
  const noFakeProfile = await page.evaluate(() => !document.body.innerText.includes("质量管理员"))
  check("无硬编码虚假用户资料", noFakeProfile)
  await page.keyboard.press("Escape")
}

/* ---------- 15. 视口 1280 / 768 / 移动端 ---------- */
await page.setViewport({ width: 1280, height: 800 })
await page.goto(BASE + "/tasks", { waitUntil: "domcontentloaded" })
await waitForNav()
await new Promise((r) => setTimeout(r, 1200))
await page.screenshot({ path: `${OUT}/07-tasks-1280-dark.png` })
check("1280 截图", true)

await page.setViewport({ width: 768, height: 1024 })
await new Promise((r) => setTimeout(r, 600))
await page.screenshot({ path: `${OUT}/08-tasks-768.png` })
check("768 截图", true)

await page.setViewport({ width: 640, height: 900 })
await page.reload({ waitUntil: "domcontentloaded" })
await page.waitForSelector('[data-slot="sidebar-trigger"]', { timeout: 15000 })
await new Promise((r) => setTimeout(r, 800))
await page.click('[data-slot="sidebar-trigger"]')
await new Promise((r) => setTimeout(r, 600))
const sheetOpen = await page.evaluate(() => !!document.querySelector('[role="dialog"]'))
check("移动端（<768）触发器打开抽屉式侧栏", sheetOpen)
await page.screenshot({ path: `${OUT}/09-tasks-640-sheet.png` })

/* ---------- 汇总 ---------- */
await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n==== 汇总：${results.length - failed.length}/${results.length} 通过 ====`)
if (consoleErrors.length) {
  console.log("控制台错误（前 8 条）:")
  for (const e of consoleErrors.slice(0, 8)) console.log("  -", e)
}
process.exit(failed.length ? 1 : 0)
