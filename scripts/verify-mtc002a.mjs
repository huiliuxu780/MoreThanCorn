/**
 * MTC-002A-R 验收自检脚本（可复现）：
 * - 新旧 API 同数据；canonical 响应不含 legacy-only 字段；
 * - /autonomous-tasks 列表配置版本列显示真实版本号（不能全为 —）；
 * - 五张真实证据截图（无重复文件）：
 *   01-autonomous-tasks-list / 02-autonomous-task-new /
 *   03-autonomous-task-detail-with-runs / 04-autonomous-task-edit / 05-settings-copy
 * 依赖：后端 8120（/api/automations + 门禁）+ 前端 5199。
 */
import fs from "node:fs"
import puppeteer from "puppeteer-core"

const BASE = process.env.MTC_BASE ?? "http://localhost:5199"
const API = process.env.MTC_API ?? "http://127.0.0.1:8120"
const OUT = ".tmp-docs/mtc002a-r"
fs.mkdirSync(OUT, { recursive: true })
fs.rmSync(`${OUT}/profile`, { recursive: true, force: true })

const results = []
function check(name, ok, detail = "") {
  results.push({ name, ok, detail })
  console.log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? ` | ${detail}` : ""}`)
}

/* ---------- 1. 新旧 API 同数据 + canonical 契约（节点侧直连后端） ---------- */
const oldList = await fetch(`${API}/api/tasks?pageSize=200`).then((r) => r.json())
const newList = await fetch(`${API}/api/automations?pageSize=200`).then((r) => r.json())
check(
  "新旧列表接口返回相同 ID 序列",
  JSON.stringify(oldList.items.map((i) => i.id)) === JSON.stringify(newList.items.map((i) => i.id)),
  `old=${oldList.total} new=${newList.total}`,
)
const LEGACY_ONLY = ["taskVersion", "workflowVersionPolicy", "dataAssetId", "dataDefinitionId"]
const REQUIRED = ["id", "name", "description", "status", "agentId", "workflowId", "workflowVersionId", "inputConfig", "scheduleConfig", "executionConfig", "createdAt", "updatedAt", "createdBy", "version"]
for (const item of newList.items.slice(0, 5)) {
  const n = await fetch(`${API}/api/automations/${item.id}`).then((r) => r.json())
  const o = await fetch(`${API}/api/tasks/${item.id}`).then((r) => r.json())
  check(`canonical 契约 ${n.name.slice(0, 18)}：必备字段齐全且无 legacy-only 字段`,
    REQUIRED.every((k) => k in n) && !LEGACY_ONLY.some((k) => k in n))
  check(`新旧详情同记录 ${n.name.slice(0, 18)}`, o.id === n.id && o.name === n.name && o.status === n.status)
}

/* ---------- 2. 浏览器：文案 / 版本列 / 五张真实截图 ---------- */
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  userDataDir: `${OUT}/profile`,
  defaultViewport: { width: 1440, height: 900 },
})
const page = await browser.newPage()
await page.evaluateOnNewDocument(() => localStorage.setItem("mtc-theme", "dark"))

async function openPage(url, waitMs = 1800) {
  await page.goto(BASE + url, { waitUntil: "domcontentloaded" })
  await new Promise((r) => setTimeout(r, waitMs))
}

/* 01 列表页：文案 + 配置版本列真实版本号 */
await openPage("/autonomous-tasks")
check("列表页不出现「分析任务」", await page.evaluate(() => !document.body.innerText.includes("分析任务")))
const versionCells = await page.evaluate(() => {
  const rows = [...document.querySelectorAll("tbody tr")]
  return rows.map((r) => r.cells?.[2]?.innerText?.trim() ?? "")
})
const withVersion = versionCells.filter((t) => /^V\d+$/.test(t))
check("列表配置版本列显示真实版本号（非全 —）", withVersion.length > 0, `V列=${JSON.stringify(versionCells.slice(0, 6))}`)
await page.screenshot({ path: `${OUT}/01-autonomous-tasks-list.png` })

/* 02 新建页 */
await openPage("/autonomous-tasks/new")
check("新建页不出现「分析任务」", await page.evaluate(() => !document.body.innerText.includes("分析任务")))
await page.screenshot({ path: `${OUT}/02-autonomous-task-new.png` })

/* 03 详情（含配置版本 + 最近批次运行记录）：选第一条有版本数据的任务；无版本旧数据显示 — 属正确行为 */
const firstId = (newList.items.find((i) => i.version != null) ?? newList.items[0])?.id
if (firstId) {
  await openPage(`/autonomous-tasks/${firstId}`)
  const detailOk = await page.evaluate(() => {
    const t = document.body.innerText
    return !t.includes("分析任务") && t.includes("运行记录（最近批次）") && /配置版本/.test(t) && /V\d+/.test(t)
  })
  check("详情页含配置版本与最近批次运行记录", detailOk)
  await page.screenshot({ path: `${OUT}/03-autonomous-task-detail-with-runs.png` })

  /* 04 编辑页 */
  await openPage(`/autonomous-tasks/${firstId}/edit`)
  check("编辑页不出现「分析任务」", await page.evaluate(() => !document.body.innerText.includes("分析任务")))
  await page.screenshot({ path: `${OUT}/04-autonomous-task-edit.png` })
} else {
  check("存在可截图的任务", false)
}

/* 05 设置占位文案 */
await openPage("/settings?section=general", 900)
check("设置占位为「功能尚未启用」", await page.evaluate(() => document.body.innerText.includes("「通用」功能尚未启用")))
await page.screenshot({ path: `${OUT}/05-settings-copy.png` })

/* 五张截图互不重复：比较纯 SHA-256（不含文件名） */
import { createHash } from "node:crypto"
const shots = ["01-autonomous-tasks-list.png", "02-autonomous-task-new.png", "03-autonomous-task-detail-with-runs.png", "04-autonomous-task-edit.png", "05-settings-copy.png"]
const hashes = shots.map((f) => createHash("sha256").update(fs.readFileSync(`${OUT}/${f}`)).digest("hex"))
check("五张截图 SHA-256 互不相同", new Set(hashes).size === hashes.length, hashes.map((h) => h.slice(0, 8)).join(" "))

await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n==== 汇总：${results.length - failed.length}/${results.length} 通过 ====`)
process.exit(failed.length ? 1 : 0)
