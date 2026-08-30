/** R8-UI 真机验证：四屏截图 + 控制台错误收集（11 §7 / acceptance/11-r8-ui-acceptance.md E-4）。 */
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

const BASE = "http://localhost:5173";
const OUT = "/tmp/r8-ui-shots";
mkdirSync(OUT, { recursive: true });

const AGENT = process.env.R8_AGENT ?? "7612c24c31f7443e9226bc8c53b57c3c";
const RUN = process.env.R8_RUN ?? "33a361a468c6409abbde5a128da838a6";

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--window-size=1600,1100"],
  defaultViewport: { width: 1600, height: 1100 },
});

const errors = [];
const page = await browser.newPage();
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)) });
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));

const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });

// ① Providers 管理页（资源中心 Tab）
await page.goto(`${BASE}/config/ai-resources?tab=providers`, { waitUntil: "networkidle2", timeout: 30000 });
await new Promise((r) => setTimeout(r, 1500));
const provRows = await page.evaluate(() => document.querySelectorAll("table tbody tr").length);
console.log("providers 行数:", provRows);
await shot("1-providers");

// ② Run Detail（agent 视角）
await page.goto(`${BASE}/config/agents/${AGENT}/runs/${RUN}`, { waitUntil: "networkidle2", timeout: 30000 });
await new Promise((r) => setTimeout(r, 2000));
const rdText = await page.evaluate(() => document.body.innerText);
console.log("RunDetail 含执行目标卡:", rdText.includes("执行目标"), "| 含 Runtime 卡:", rdText.includes("Runtime"), "| 含质检派生:", rdText.includes("规则派生"));
await shot("2-rundetail-agent");

// ③ 任务向导执行目标步
await page.goto(`${BASE}/config/tasks/new`, { waitUntil: "networkidle2", timeout: 30000 });
await new Promise((r) => setTimeout(r, 1200));
await page.evaluate(() => {
  const btns = [...document.querySelectorAll("input")];
  const name = btns[0];
  if (name) { name.focus(); }
});
await page.type("input", "R8 验证任务").catch(() => undefined);
await page.evaluate(() => {
  const next = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("下一步"));
  next?.click();
});
await new Promise((r) => setTimeout(r, 1200));
const wizText = await page.evaluate(() => document.body.innerText);
console.log("向导含执行目标类型:", wizText.includes("执行目标类型"), "| 含三选策略:", wizText.includes("最新沙箱发布"));
await shot("3-wizard-target");

// ④ 配置页（对照卡/分区卡/测试面板）
await page.goto(`${BASE}/config/agents/${AGENT}`, { waitUntil: "networkidle2", timeout: 30000 });
await new Promise((r) => setTimeout(r, 1500));
const cfgText = await page.evaluate(() => document.body.innerText);
console.log("配置页含对照卡:", cfgText.includes("草稿版本") && cfgText.includes("最近发布"), "| 含测试面板:", cfgText.includes("测试 Agent"), "| 含已冻结:", cfgText.includes("已冻结"));
await shot("4-config-page");

console.log("控制台错误:", errors.length ? errors.slice(0, 5) : "无");
await browser.close();
process.exit(0);
