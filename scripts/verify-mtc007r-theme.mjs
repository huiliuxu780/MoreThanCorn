/**
 * MTC-007R + Theme-R 门禁：Workflow Designer 深色主题成立性验证。
 *
 * A. 静态断言：designer 全部表面源码不得残留 Light-only 实色
 *    （例外白名单：theme/workflow-theme.ts 成对主题桥接值；bg-white/10 控制台透明叠层；
 *      text-white/text-neutral-* 仅允许出现在恒定深色运行控制台内）。
 * B. 浏览器断言：同一 workflow、同视口 1440x900，Light 与 Dark 各截一组对照图，
 *    并对 canvas 根/顶栏/节点面板/节点卡/底部工具条/MiniMap/Inspector 抽屉/对话框
 *    的 computed backgroundColor 做亮度阈值断言。
 *
 * 输出 .tmp-docs/mtc007r/。用法：node scripts/verify-mtc007r-theme.mjs
 * 依赖：前端 5199（.env.local → API 8120）+ 后端 8120 运行中。
 */
import fs from "node:fs"
import path from "node:path"
import puppeteer from "puppeteer-core"

const BASE = process.env.MTC_BASE ?? "http://localhost:5199"
const API = process.env.MTC_API ?? "http://127.0.0.1:8120"
const OUT = ".tmp-docs/mtc007r"
fs.mkdirSync(OUT, { recursive: true })
fs.rmSync(`${OUT}/profile`, { recursive: true, force: true })

const results = []
function check(name, ok, detail = "") {
  results.push({ name, ok, detail })
  console.log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? ` | ${detail}` : ""}`)
}

/* ============ A. 静态扫描：Light-only 实色 ============ */

const SCAN_DIRS = ["src/features/designer"]
const SCAN_FILES = [
  "src/components/wf/controls.tsx",
  "src/components/wf/sections.tsx",
  "src/components/agent-ops-panels.tsx",
]
/** 成对主题桥接文件（light+dark 值必须同时存在，本身即 token 化实现） */
const SCAN_EXEMPT = new Set([
  "src/features/designer/theme/workflow-theme.ts",
])

const BANNED = [
  [/(?:^|[^-\w])bg-white(?!\/)/g, "bg-white（非透明叠层）"],
  [/#fff\b|#ffffff\b/gi, "#fff/#ffffff"],
  [/#FEF0F0|#F0F9EB|#F7F9FC|#FAFBFC|#F1F3F7|#EEF1F6/gi, "浅色面板 hex"],
  [/#A8B3C5|#94A3B8|#D9DEE7|#EDF0F4/gi, "浅灰 hex"],
  [/#3D6BFF|#5B8DEF/gi, "旧蓝色 hex"],
  [/#1F2329|#5A6472|#B9C2CF|#7A8699/gi, "旧墨色 hex"],
  [/#F56C6C|#F97E2B|#FFF4EA|#188F00|#34C759|#7ED491/gi, "旧状态 hex"],
  [/#2A3242|#3B4557/gi, "旧控制台 hex（应走 --wf-console token）"],
  [/rgba\(238\s*,\s*241\s*,\s*246/gi, "rgba(238,241,246,…)"],
  [/(?:hover:)?bg-neutral-(?:50|100)\b/g, "bg-neutral-50/100"],
  [/(?:hover:)?border-neutral-\d+/g, "border-neutral-*"],
]

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) yield* walk(p)
    else if (/\.(tsx?|jsx?)$/.test(e.name) && !/\.test\./.test(e.name)) yield p
  }
}

const scanTargets = [...SCAN_DIRS.flatMap((d) => [...walk(d)]), ...SCAN_FILES]
const violations = []
for (const file of scanTargets) {
  if (SCAN_EXEMPT.has(file)) continue
  const lines = fs.readFileSync(file, "utf-8").split("\n")
  lines.forEach((line, i) => {
    for (const [re, label] of BANNED) {
      re.lastIndex = 0
      if (re.test(line)) violations.push(`${file}:${i + 1} ${label} → ${line.trim().slice(0, 110)}`)
    }
  })
}
check(`静态扫描 ${scanTargets.length - SCAN_EXEMPT.size} 个源文件无 Light-only 实色`, violations.length === 0,
  violations.length ? `\n  ${violations.join("\n  ")}` : "0 违规")
/* 豁免文件必须成对定义 light/dark */
const themeSrc = fs.readFileSync("src/features/designer/theme/workflow-theme.ts", "utf-8")
check("theme/workflow-theme.ts 桥接值 light/dark 成对", /light:\s*\{/.test(themeSrc) && /dark:\s*\{/.test(themeSrc))

/* ============ B. 浏览器 Light/Dark 对照 ============ */

const j = (p) => fetch(`${API}${p}`).then((r) => r.json()).catch(() => null)

/* 选一个有节点的 workflow（同 workflow 同视口对照） */
const list = await j("/api/workflows?page=1&pageSize=20")
let wfId = null
for (const w of list?.items ?? []) {
  const d = await j(`/api/workflows/${w.id}`)
  if ((d?.definition?.graph?.nodes ?? []).length > 0) { wfId = w.id; break }
}
check("存在含节点的 workflow 夹具", !!wfId, wfId ?? "")

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  userDataDir: `${OUT}/profile`,
  defaultViewport: { width: 1440, height: 900 },
})
const page = await browser.newPage()
/* 先落到同源页面，localStorage 才可写（about:blank 会 SecurityError） */
await page.goto(`${BASE}/workflows`, { waitUntil: "domcontentloaded" })

const LUM_FN = () => {
  const lum = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const bg = getComputedStyle(el).backgroundColor
    const m = bg.match(/[\d.]+/g)
    if (!m) return null
    const [r, g, b, a] = m.map(Number)
    if (a === 0) return null
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255
  }
  return {
    root: lum('[data-testid="wf-designer-root"]'),
    topbar: lum('[data-testid="wf-topbar"]'),
    palette: lum('[data-testid="wf-palette"]'),
    card: lum('[data-testid="wf-node-card"]'),
    toolbar: lum('[data-testid="wf-bottom-toolbar"]'),
    minimap: lum(".react-flow__minimap"),
    inspector: lum('[data-testid="wf-inspector"]'),
    dialog: lum('[role="dialog"]'),
  }
}

async function shot(name) {
  await page.screenshot({ path: `${OUT}/${name}` })
  console.log(`SHOT | ${name}`)
}

async function openCanvas(theme) {
  await page.evaluate((t) => {
    localStorage.setItem("mtc-theme", t)
    localStorage.setItem("wf-palette-open", "1")
  }, theme)
  await page.goto(`${BASE}/workflows/${wfId}`, { waitUntil: "domcontentloaded" })
  await new Promise((r) => setTimeout(r, 3500))
}

async function openInspector() {
  const node = await page.$(".react-flow__node")
  if (!node) return false
  await node.click()
  await new Promise((r) => setTimeout(r, 1200))
  return true
}

function assertSurfaces(mode, s) {
  const dark = mode === "dark"
  const expect = {
    root: dark ? [0, 0.12] : [0.8, 1],
    topbar: dark ? [0, 0.3] : [0.85, 1],
    palette: dark ? [0, 0.3] : [0.85, 1],
    card: dark ? [0, 0.3] : [0.85, 1],
    toolbar: dark ? [0, 0.3] : [0.85, 1],
    minimap: dark ? [0, 0.3] : [0.85, 1],
    inspector: dark ? [0, 0.3] : [0.85, 1],
  }
  for (const [key, [lo, hi]] of Object.entries(expect)) {
    const v = s[key]
    check(`${mode} 表面亮度 ${key}`, v != null && v >= lo && v <= hi,
      v == null ? "元素缺失/透明" : `L=${v.toFixed(3)} 期望[${lo},${hi}]`)
  }
}

if (wfId) {
  /* ---- Light ---- */
  await openCanvas("light")
  const isLight = await page.evaluate(() => !document.documentElement.classList.contains("dark"))
  check("light 模式 html 无 .dark", isLight)
  await shot("designer-light.png")
  const openedL = await openInspector()
  check("light Inspector 可打开", openedL)
  await shot("designer-inspector-light.png")
  assertSurfaces("light", await page.evaluate(LUM_FN))

  /* ---- Dark（同 workflow 同视口） ---- */
  await openCanvas("dark")
  const isDark = await page.evaluate(() => document.documentElement.classList.contains("dark"))
  check("dark 模式 html.dark 生效", isDark)
  await shot("designer-dark.png")
  const openedD = await openInspector()
  check("dark Inspector 可打开", openedD)
  await shot("designer-inspector-dark.png")
  const darkSurfaces = await page.evaluate(LUM_FN)
  assertSurfaces("dark", darkSurfaces)

  /* ---- Dark 对话框（基础信息 Dialog） ---- */
  const metaBtn = await page.$('button[title="工作流基础信息"]')
  if (metaBtn) {
    await metaBtn.click()
    await new Promise((r) => setTimeout(r, 900))
    const withDialog = await page.evaluate(LUM_FN)
    check("dark 对话框亮度", withDialog.dialog != null && withDialog.dialog <= 0.3,
      withDialog.dialog == null ? "dialog 缺失" : `L=${withDialog.dialog.toFixed(3)}`)
    await shot("designer-dialog-dark.png")
    await page.keyboard.press("Escape")
    await new Promise((r) => setTimeout(r, 500))
  } else check("dark 对话框亮度", false, "基础信息按钮缺失")
}

await browser.close()

const shots = fs.readdirSync(OUT).filter((f) => f.endsWith(".png"))
check("对照截图数量 >= 5", shots.length >= 5, shots.join(", "))
const failed = results.filter((r) => !r.ok)
console.log(`\n==== 汇总：${results.length - failed.length}/${results.length} 通过 ====`)
process.exit(failed.length ? 1 : 0)
