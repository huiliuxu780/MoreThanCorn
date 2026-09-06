/**
 * MTC-001R 验收自检脚本（可复现）：
 * - 桌面 ≥768px 固定 72px 窄轨（图标+短标签，无展开/收起，无 toggle，Cmd+B 无效）
 * - 底部仅账号入口（09-07：主题=账号菜单子菜单、设置=账号菜单项），菜单向右展开且不裁切
 * - 任一路径最多一个一级项 active（connections→资源；operations→任务；forms→资源；/settings 其余无高亮）
 * - <768px Sheet 抽屉，关闭后焦点回到触发器
 * - Light/Dark/System、持久化、防闪白无回归；产品界面无内部任务号
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

async function clickRailByText(text) {
  const handle = await page.evaluateHandle((t) => {
    const els = [...document.querySelectorAll('[data-testid="app-rail"] button, [data-testid="app-rail"] a')]
    return els.find((b) => b.textContent?.includes(t)) ?? null
  }, text)
  const el = handle.asElement()
  if (!el) throw new Error(`rail item not found: ${text}`)
  await el.click()
  return el
}

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

const railWidth = () =>
  page.evaluate(() => {
    const el = document.querySelector('[data-testid="app-rail"]')
    return el ? getComputedStyle(el).width : null
  })

const railTexts = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="app-rail"] a, [data-testid="app-rail"] button')].map((e) => e.textContent?.trim() ?? ""),
  )

const activeRailTexts = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="app-rail"] [data-active]')].map((e) => e.textContent?.trim() ?? ""),
  )

/* ---------- 1. 首载 + 72px 窄轨 ---------- */
await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 30000 })
await page.waitForSelector('[data-testid="app-rail"]', { timeout: 15000 })
await new Promise((r) => setTimeout(r, 1500))
check("根路径 / → /tasks", page.url().endsWith("/tasks"), page.url())
check("1440 rail 宽 72px", (await railWidth()) === "72px", await railWidth())

const texts = await railTexts()
check(
  "短标签固定：任务/自主/Agent/资源/流程 + 账号（09-07 主题/设置收进账号菜单）",
  ["任务", "自主", "Agent", "资源", "流程", "账号"].every((t) => texts.some((x) => x.includes(t)))
    && !texts.some((x) => x.includes("主题")) && !texts.some((x) => x.includes("设置")),
  JSON.stringify(texts),
)

const noToggle = await page.evaluate(
  () => !document.querySelector('[aria-label="展开或收起侧边栏"]') && !document.querySelector('[data-slot="sidebar-trigger"]'),
)
check("无侧栏 toggle 按钮", noToggle)

const wBefore = await railWidth()
await page.keyboard.down("Meta")
await page.keyboard.press("b")
await page.keyboard.up("Meta")
await new Promise((r) => setTimeout(r, 400))
check("Cmd+B 不改变宽度", (await railWidth()) === wBefore, `${wBefore} → ${await railWidth()}`)

/* ---------- 2. 键盘可聚焦 ---------- */
const focusable = await page.evaluate(() => {
  const els = [...document.querySelectorAll('[data-testid="app-rail"] a, [data-testid="app-rail"] button')]
  return els.every((el) => {
    el.focus()
    return document.activeElement === el
  })
})
check("窄轨全部条目可键盘聚焦", focusable)

/* ---------- 3. 菜单向右展开且不裁切（09-07：主题收进账号菜单子菜单） ---------- */
async function openThemeSub() {
  // 先确保无残留菜单（关闭动画约 150ms），避免抓到正在卸载的旧菜单节点
  await page.keyboard.press("Escape")
  await new Promise((r) => setTimeout(r, 400))
  await clickRailByText("账号")
  await page.waitForSelector('[role="menu"]', { timeout: 5000 })
  await new Promise((r) => setTimeout(r, 400))
  const subHandle = await page.evaluateHandle(() => {
    const menus = [...document.querySelectorAll('[role="menu"]')]
    const menu = menus[menus.length - 1]
    return [...menu.querySelectorAll('[role="menuitem"]')].find((m) => m.textContent?.includes("主题")) ?? null
  })
  const subEl = subHandle.asElement()
  if (!subEl) throw new Error("theme subtrigger not found in account menu")
  await subEl.click()
  await page.waitForFunction(() => document.querySelectorAll('[role="menu"]').length >= 2, { timeout: 5000 })
}
await openThemeSub()
const themeMenuRect = await page.evaluate(() => {
  const menus = [...document.querySelectorAll('[role="menu"]')]
  const sub = menus[menus.length - 1]
  const t = [...document.querySelectorAll('[role="menuitem"]')].find((m) => m.textContent?.includes("主题"))
  const r = sub.getBoundingClientRect()
  const tr = t.getBoundingClientRect()
  return { left: r.left, right: r.right, vw: window.innerWidth, triggerRight: tr.right }
})
check("主题子菜单向右展开且不裁切", themeMenuRect.left >= themeMenuRect.triggerRight - 2 && themeMenuRect.right <= themeMenuRect.vw, JSON.stringify(themeMenuRect))
const themeItems = await page.evaluate(() => {
  const menus = [...document.querySelectorAll('[role="menu"]')]
  return [...menus[menus.length - 1].querySelectorAll('[role="menuitem"]')].map((m) => m.textContent?.trim())
})
check("主题菜单五项", ["跟随系统", "浅色", "深色", "浅色羊皮纸", "深色羊皮纸"].every((t) => themeItems.some((m) => m?.includes(t))))
await clickMenuItem("深色")
await new Promise((r) => setTimeout(r, 300))
const darkOn = await page.evaluate(() => document.documentElement.getAttribute("data-theme") === "dark" && getComputedStyle(document.body).backgroundColor === "rgb(8, 9, 9)")
check("深色立即生效", darkOn)
await page.screenshot({ path: `${OUT}/r-02-tasks-1440-dark.png` })

await clickRailByText("账号")
await page.waitForSelector('[role="menu"]', { timeout: 5000 })
const accRect = await page.evaluate(() => {
  const m = document.querySelector('[role="menu"]')
  const t = [...document.querySelectorAll('[data-testid="app-rail"] button')].find((b) => b.textContent?.includes("账号"))
  const r = m.getBoundingClientRect()
  const tr = t.getBoundingClientRect()
  return { left: r.left, right: r.right, vw: window.innerWidth, triggerRight: tr.right }
})
check("账号菜单向右展开且不裁切", accRect.left >= accRect.triggerRight - 2 && accRect.right <= accRect.vw, JSON.stringify(accRect))
const accItems = await page.evaluate(() => [...document.querySelectorAll('[role="menu"] [role="menuitem"], [role="menu"] [role="menuitemradio"]')].map((m) => m.textContent?.trim()))
check("账号菜单真实身份项", accItems.some((t) => t?.includes("我的偏好")) && accItems.some((t) => t?.includes("退出登录")), JSON.stringify(accItems))
await page.keyboard.press("Escape")

/* ---------- 4. Light 截图 + 防闪白 + 持久化 ---------- */
await openThemeSub()
await clickMenuItem("浅色")
await new Promise((r) => setTimeout(r, 300))
await page.screenshot({ path: `${OUT}/r-01-tasks-1440-light.png` })
await openThemeSub()
await clickMenuItem("深色")
await new Promise((r) => setTimeout(r, 300))
await page.reload({ waitUntil: "domcontentloaded" })
const earlyDark = await page.evaluate(() => ({
  dark: document.documentElement.getAttribute("data-theme") === "dark",
  htmlBg: getComputedStyle(document.documentElement).backgroundColor,
}))
check("刷新持久化 + 首帧不闪白", earlyDark.dark && earlyDark.htmlBg === "rgb(8, 9, 9)", earlyDark.htmlBg)
await page.waitForSelector('[data-testid="app-rail"]', { timeout: 15000 })

/* ---------- 5. Active 归属唯一 ---------- */
const activeCases = [
  ["/settings/connections", "资源", "设置"],
  ["/operations/task-runs", "任务", "设置"],
  ["/config/forms", "资源", "任务"],
  ["/autonomous-tasks", "自主", "任务"],
]
for (const [path, expectActive, expectNot] of activeCases) {
  await page.goto(BASE + path, { waitUntil: "domcontentloaded" })
  await new Promise((r) => setTimeout(r, 1000))
  const act = await activeRailTexts()
  check(
    `${path} → 「${expectActive}」唯一高亮`,
    act.length === 1 && act[0].includes(expectActive) && !act.some((t) => t.includes(expectNot)),
    JSON.stringify(act),
  )
}
// 09-07：设置入口收进账号菜单 → /settings/**（connections 除外）窄轨无高亮
await page.goto(BASE + "/settings/audit", { waitUntil: "domcontentloaded" })
await new Promise((r) => setTimeout(r, 1000))
const auditAct = await activeRailTexts()
check("/settings/audit → 窄轨无高亮（设置入口在账号菜单内）", auditAct.length === 0, JSON.stringify(auditAct))
await page.screenshot({ path: `${OUT}/r-05-connections-active-dark.png` })

/* ---------- 6. 产品界面无内部任务号 ---------- */
for (const p of ["/resources", "/settings", "/settings?section=general"]) {
  await page.goto(BASE + p, { waitUntil: "domcontentloaded" })
  await new Promise((r) => setTimeout(r, 800))
  const clean = await page.evaluate(() => !document.body.innerText.includes("MTC-") && !document.body.innerText.includes("后续任务"))
  check(`产品文案无内部编号 ${p}`, clean)
}
check("设置占位为中性措辞", await page.evaluate(() => document.body.innerText.includes("功能尚未启用") && !document.body.innerText.includes("该功能尚未启用")))

/* ---------- 7. 1280 / 768 恒 80px ---------- */
for (const vw of [1280, 768]) {
  await page.setViewport({ width: vw, height: 900 })
  await page.goto(BASE + "/tasks", { waitUntil: "domcontentloaded" })
  await page.waitForSelector('[data-testid="app-rail"]', { timeout: 15000 })
  await new Promise((r) => setTimeout(r, 800))
  check(`${vw} rail 宽 72px`, (await railWidth()) === "72px", await railWidth())
}
await page.screenshot({ path: `${OUT}/r-03-tasks-768-dark.png` })

/* ---------- 8. 640 Sheet + 焦点回归 ---------- */
await page.setViewport({ width: 640, height: 900 })
await page.goto(BASE + "/tasks", { waitUntil: "domcontentloaded" })
await new Promise((r) => setTimeout(r, 800))
const railHidden = await page.evaluate(() => {
  const el = document.querySelector('[data-testid="app-rail"]')
  return !el || getComputedStyle(el).display === "none"
})
check("640 窄轨隐藏", railHidden)
const burger = await page.$('[aria-label="打开导航"]')
check("640 汉堡按钮存在", !!burger)
await burger.click()
await page.waitForSelector('[role="dialog"]', { timeout: 5000 })
const sheetNav = await page.evaluate(() => {
  const t = document.querySelector('[role="dialog"]')?.textContent ?? ""
  return ["任务", "自主任务", "Agent", "能力与资源", "Workflow", "账号"].every((x) => t.includes(x))
})
check("Sheet 含完整导航与账号入口", sheetNav)
// 09-07：主题/设置收进账号菜单——打开断言（dialog 开场动画 settle 后再抓节点）
await new Promise((r) => setTimeout(r, 500))
const sheetAccHandle = await page.evaluateHandle(() =>
  [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent?.includes("账号")) ?? null)
const sheetAccEl = sheetAccHandle.asElement()
if (!sheetAccEl) throw new Error("account trigger not found in sheet")
await sheetAccEl.click()
await page.waitForSelector('[role="menu"]', { timeout: 5000 })
const sheetMenu = await page.evaluate(() => [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((m) => m.textContent?.trim()))
check("Sheet 账号菜单含主题子菜单与设置", sheetMenu.some((t) => t?.includes("主题")) && sheetMenu.some((t) => t?.includes("设置")), JSON.stringify(sheetMenu))
await page.screenshot({ path: `${OUT}/r-04-tasks-640-sheet.png` })
await page.keyboard.press("Escape") // 关账号菜单
await new Promise((r) => setTimeout(r, 300))
await page.keyboard.press("Escape") // 关 Sheet
await new Promise((r) => setTimeout(r, 500))
const focusBack = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") === "打开导航")
check("Sheet 关闭后焦点回到触发器", focusBack)

/* ---------- 汇总 ---------- */
await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n==== 汇总：${results.length - failed.length}/${results.length} 通过 ====`)
if (consoleErrors.length) {
  console.log("控制台错误（前 8 条）:")
  for (const e of consoleErrors.slice(0, 8)) console.log("  -", e)
}
process.exit(failed.length ? 1 : 0)
