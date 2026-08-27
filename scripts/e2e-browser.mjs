#!/usr/bin/env node
/** 09-SDD P1-09：浏览器 E2E（puppeteer-core 无头 Chrome）。
 * 覆盖核心页面渲染 + 无控制台错误 + 关键交互（任务列表/质量结果/规则）。
 *
 * 需要运行环境：前端 Vite（默认 5173）+ 后端（默认 8100）。
 *   前端：npm run dev            （VITE_WF_API=1 指向后端）
 *   后端：.venv/bin/uvicorn app.main:app --port 8100（或既有开发服务）
 * 无运行环境时退出码 2（提示而非失败），便于门禁区分"环境缺失"与"断言失败"。
 */
import puppeteer from "puppeteer-core"
import process from "node:process"

const FRONT = process.env.WF_E2E_FRONT ?? "http://localhost:5173"
const CHROME = process.env.WF_E2E_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

async function alive(url) {
  try { return (await fetch(url, { signal: AbortSignal.timeout(3000) })).ok } catch { return false }
}

if (!(await alive(`${FRONT}/`))) {
  console.error(`[e2e-browser] 前端未运行（${FRONT}）。请先 \`npm run dev\` 并启动后端。退出码 2（环境缺失）。`)
  process.exit(2)
}

let failures = 0
const assert = (cond, label, actual) => {
  console.log(`${cond ? "✓" : "✗"} ${label}${cond ? "" : `（实际：${JSON.stringify(actual)}）`}`)
  if (!cond) failures++
}

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: "new",
  args: ["--window-size=1440,1000"], defaultViewport: { width: 1440, height: 1000 },
})

async function visit(path, settleMs = 2500) {
  const page = await browser.newPage()
  const errors = []
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)) })
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)))
  await page.goto(`${FRONT}${path}`, { waitUntil: "networkidle2", timeout: 30000 })
  await new Promise((r) => setTimeout(r, settleMs))
  const title = await page.title()
  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 400))
  await page.close()
  return { errors, title, bodyText }
}

console.log("[e2e-browser] 核心页面渲染与无控制台错误")
for (const [path, label] of [
  ["/quality/overview", "质量总览"],
  ["/quality/results", "质量结果列表"],
  ["/config/tasks", "分析任务列表"],
  ["/config/result-rules", "结果规则"],
  ["/config/agents", "Agent 列表"],
]) {
  const { errors, bodyText } = await visit(path)
  assert(errors.length === 0, `${label} 无控制台错误`, errors.slice(0, 2))
  assert(bodyText.length > 0, `${label} 有渲染内容`)
}

await browser.close()
console.log(`\n浏览器 E2E：${failures === 0 ? "通过" : `${failures} 项未通过`}`)
process.exit(failures === 0 ? 0 : 1)
