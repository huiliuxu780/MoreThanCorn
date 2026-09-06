/** 09-06 原站对齐门禁：四主题（data-theme）+ 导航选中/悬浮交互断言。
 *  交互规格（QoderWake 原站实测）：
 *  - 选中 = fill-secondary 中性底 + 字重 500 + 文字/图标升为主文字色；
 *  - 悬浮 = 与选中同底同前景，仅字重差（400）；
 *  - 默认 = 透明底 + 次级文字色。
 *  四套主题逐一断言 token 应用值并截图。输出 .tmp-docs/theme4/。
 *  用法：node scripts/check-theme4-nav.mjs；依赖前端 5199 + 后端 8120。 */
import fs from "node:fs"
import puppeteer from "puppeteer-core"

const BASE = process.env.MTC_BASE ?? "http://localhost:5199"
const OUT = ".tmp-docs/theme4"
fs.mkdirSync(OUT, { recursive: true })
fs.rmSync(`${OUT}/profile`, { recursive: true, force: true })

/* 期望值 = index.css token 转录（hex → rgb 串） */
const EXPECT = {
  light:            { accent: "rgb(236, 236, 232)", text: "rgb(17, 18, 17)",   muted: "rgb(104, 109, 105)", brandSoft: "rgb(237, 248, 240)" },
  dark:             { accent: "rgb(42, 46, 43)",    text: "rgb(250, 250, 248)", muted: "rgb(167, 173, 168)", brandSoft: "rgb(24, 53, 35)" },
  "light-parchment": { accent: "rgb(237, 232, 224)", text: "rgb(32, 33, 22)",   muted: "rgb(74, 70, 60)",   brandSoft: "rgb(237, 248, 240)" },
  "dark-parchment":  { accent: "rgb(54, 50, 40)",   text: "rgb(250, 249, 246)", muted: "rgb(201, 196, 184)", brandSoft: "rgb(24, 53, 35)" },
}

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
await page.goto(`${BASE}/tasks`, { waitUntil: "domcontentloaded" })

const readState = () => page.evaluate(() => {
  const rail = document.querySelector('[data-testid="app-rail"]')
  const active = rail?.querySelector('a[data-active]')
  const idle = rail?.querySelector('a[href="/agents"]')
  const cs = (el) => {
    if (!el) return null
    const s = getComputedStyle(el)
    const icon = el.querySelector("svg")
    return { bg: s.backgroundColor, color: s.color, weight: s.fontWeight, icon: icon ? getComputedStyle(icon).color : null }
  }
  return { theme: document.documentElement.getAttribute("data-theme"), active: cs(active), idle: cs(idle) }
})

for (const [t, exp] of Object.entries(EXPECT)) {
  await page.evaluate((theme) => localStorage.setItem("mtc-theme", theme), t)
  await page.goto(`${BASE}/tasks`, { waitUntil: "domcontentloaded" })
  await page.waitForSelector('[data-testid="app-rail"] a[data-active]', { timeout: 15000 })
  await new Promise((r) => setTimeout(r, 600))

  let s = await readState()
  check(`${t} data-theme 落定`, s.theme === t, s.theme ?? "null")
  check(`${t} 选中底 = 中性 accent`, s.active?.bg === exp.accent, `${s.active?.bg} 期望 ${exp.accent}`)
  check(`${t} 选中非品牌绿底`, s.active?.bg !== exp.brandSoft, s.active?.bg)
  check(`${t} 选中字重 500`, s.active?.weight === "500", s.active?.weight)
  check(`${t} 选中前景 = 主文字色（文字与图标同升）`,
    s.active?.color === exp.text && s.active?.icon === exp.text,
    `color=${s.active?.color} icon=${s.active?.icon}`)
  check(`${t} 未选中透明底 + 次级色 + 字重 400`,
    s.idle?.bg === "rgba(0, 0, 0, 0)" && s.idle?.color === exp.muted && s.idle?.weight === "400",
    JSON.stringify(s.idle))
  await page.screenshot({ path: `${OUT}/${t}.png` })

  /* 悬浮未选中项：与选中同底同前景，仅字重差 */
  await page.hover('[data-testid="app-rail"] a[href="/agents"]')
  await new Promise((r) => setTimeout(r, 350))
  s = await readState()
  check(`${t} 悬浮底 == 选中底`, s.idle?.bg === s.active?.bg && s.idle?.bg === exp.accent,
    `hover=${s.idle?.bg} active=${s.active?.bg}`)
  check(`${t} 悬浮前景升主文字色（含图标）`,
    s.idle?.color === exp.text && s.idle?.icon === exp.text,
    `color=${s.idle?.color} icon=${s.idle?.icon}`)
  check(`${t} 悬浮字重仍 400（仅字重区分选中）`, s.idle?.weight === "400", s.idle?.weight)
  const rail = await page.$('[data-testid="app-rail"]')
  await rail.screenshot({ path: `${OUT}/${t}-rail-hover.png` })
}

await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n==== 汇总：${results.length - failed.length}/${results.length} 通过 ====`)
process.exit(failed.length ? 1 : 0)
