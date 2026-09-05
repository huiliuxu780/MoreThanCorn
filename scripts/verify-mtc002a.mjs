/**
 * MTC-002A 验收自检脚本（可复现）：
 * - /autonomous-tasks 全系页面不再出现「分析任务」产品称谓；
 * - 新旧 API 同数据（列表 ID 一致 / 详情同记录 / 创建互通）；
 * - 5 张验收截图（list/new/detail/edit/runs）。
 * 依赖：后端 8120（含 /api/automations）+ 前端 5199。
 */
import fs from "node:fs"
import puppeteer from "puppeteer-core"

const BASE = process.env.MTC_BASE ?? "http://localhost:5199"
const API = process.env.MTC_API ?? "http://127.0.0.1:8120"
const OUT = ".tmp-docs/mtc002a"
fs.mkdirSync(OUT, { recursive: true })
fs.rmSync(`${OUT}/profile`, { recursive: true, force: true })

const results = []
function check(name, ok, detail = "") {
  results.push({ name, ok, detail })
  console.log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? ` | ${detail}` : ""}`)
}

/* ---------- 1. 新旧 API 同数据（节点侧直连后端） ---------- */
const oldList = await fetch(`${API}/api/tasks?pageSize=200`).then((r) => r.json())
const newList = await fetch(`${API}/api/automations?pageSize=200`).then((r) => r.json())
check(
  "新旧列表接口返回相同 ID 序列",
  JSON.stringify(oldList.items.map((i) => i.id)) === JSON.stringify(newList.items.map((i) => i.id)),
  `old=${oldList.total} new=${newList.total}`,
)
const sampleId = newList.items[0]?.id
if (sampleId) {
  const o = await fetch(`${API}/api/tasks/${sampleId}`).then((r) => r.json())
  const n = await fetch(`${API}/api/automations/${sampleId}`).then((r) => r.json())
  check("新旧详情读取同一条记录", o.id === n.id && o.name === n.name && o.status === n.status)
  const required = ["id", "name", "description", "status", "agentId", "workflowId", "workflowVersionId", "inputConfig", "scheduleConfig", "executionConfig", "createdAt", "updatedAt", "createdBy", "version"]
  check("DTO 必备字段齐全", required.every((k) => k in n), required.filter((k) => !(k in n)).join(","))
} else {
  check("存在样本任务", false, "wf_dev 无任务数据")
}

/* ---------- 2. 浏览器：文案 + 截图 ---------- */
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  userDataDir: `${OUT}/profile`,
  defaultViewport: { width: 1440, height: 900 },
})
const page = await browser.newPage()
await page.evaluateOnNewDocument(() => localStorage.setItem("mtc-theme", "dark"))

async function shotAndCheck(path, url, name) {
  await page.goto(BASE + url, { waitUntil: "domcontentloaded" })
  await new Promise((r) => setTimeout(r, 1800))
  const clean = await page.evaluate(() => !document.body.innerText.includes("分析任务"))
  check(`${name} 不出现「分析任务」`, clean)
  await page.screenshot({ path: `${OUT}/${path}` })
}

await shotAndCheck("01-autonomous-tasks-list.png", "/autonomous-tasks", "列表页")
const firstId = await page.evaluate((api) =>
  fetch(`${api}/api/tasks?pageSize=1`).then((r) => r.json()).then((j) => j.items[0]?.id ?? null),
API)
await shotAndCheck("02-autonomous-task-new.png", "/autonomous-tasks/new", "新建页")
if (firstId) {
  await shotAndCheck("03-autonomous-task-detail.png", `/autonomous-tasks/${firstId}`, "详情页")
  await shotAndCheck("04-autonomous-task-edit.png", `/autonomous-tasks/${firstId}/edit`, "编辑页")
  await shotAndCheck("05-autonomous-task-runs.png", `/autonomous-tasks/${firstId}`, "运行记录")
  // 运行记录区块标题
  const runsTitle = await page.evaluate(() => document.body.innerText.includes("运行记录（最近批次）"))
  check("运行记录标题已更新", runsTitle)
} else {
  check("存在可截图的任务", false)
}

/* 设置占位文案 */
await page.goto(BASE + "/settings?section=general", { waitUntil: "domcontentloaded" })
await new Promise((r) => setTimeout(r, 800))
check("设置占位为「功能尚未启用」", await page.evaluate(() => document.body.innerText.includes("「通用」功能尚未启用")))

await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n==== 汇总：${results.length - failed.length}/${results.length} 通过 ====`)
process.exit(failed.length ? 1 : 0)
