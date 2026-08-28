/** R-Archive UI 只读封存验证（SDD 10 R-A4）：无头 Chrome 检查列表/详情/画布的封存态。 */
import puppeteer from "puppeteer-core";

const BASE = "http://localhost:5175";
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--window-size=1440,1000"],
  defaultViewport: { width: 1440, height: 1000 },
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  (" + extra + ")" : ""}`);
  cond ? pass++ : fail++;
};
const text = () => document.body.innerText;

// 1. Agents 列表：无创建入口 + 封存徽标
await page.goto(`${BASE}/config/agents`, { waitUntil: "networkidle2", timeout: 30000 });
await new Promise((r) => setTimeout(r, 2000));
let t = await page.evaluate(text);
ok("列表：无「创建Agent」按钮", !(await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.innerText.trim() === "创建Agent"))));
ok("列表：标题旁封存提示", t.includes("旧版 Agent 已封存"));
ok("列表：卡片「已封存」徽标", t.includes("已封存"));
ok("列表：无「使用中/已归档」外的新建入口", !(await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.innerText.trim() === "创建"))));
await page.screenshot({ path: "/tmp/ra4-agents-list.png" });

// 2. 取一个旧 Agent 详情（autonomous 或 dialogue）
const agents = await (await fetch("http://127.0.0.1:8100/api/agents?pageSize=50")).json();
const first = agents.items?.[0];
ok("前置：库中存在历史 Agent", !!first, first?.name ?? "none");
if (first) {
  await page.goto(`${BASE}/config/agents/${first.id}`, { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 3000));
  t = await page.evaluate(text);
  ok("详情：显示「已封存 · 只读」或封存提示", t.includes("已封存 · 只读") || t.includes("已封存"));
  ok("详情：无「发布」按钮", !(await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.innerText.trim() === "发布"))));
  ok("详情：无「保存」按钮", !(await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.innerText.trim() === "保存"))));
  ok("详情：无「试运行」按钮", !(await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.innerText.trim() === "试运行"))));
  ok("详情：无「预览调试」面板", !t.includes("预览调试"));
  ok("详情：历史 Tab 保留（运行观测/版本指标）", t.includes("运行观测") && t.includes("版本指标"));
  await page.screenshot({ path: "/tmp/ra4-agent-detail.png" });
  console.log("detail-agent:", first.type, first.id);
}

// 3. 独立工作流页不受影响（能力保留）
const wfs = await (await fetch("http://127.0.0.1:8100/api/workflows?pageSize=20")).json();
const wf = (wfs.items ?? []).find((w) => w.status !== "deprecated");
ok("前置：存在独立工作流", !!wf);
if (wf) {
  await page.goto(`${BASE}/config/workflows/${wf.id}`, { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2500));
  ok("独立工作流：「保存」按钮保留", await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.innerText.trim() === "保存")));
  ok("独立工作流：「发布」按钮保留", await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.innerText.trim() === "发布")));
  ok("独立工作流：「试运行」按钮保留", await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.innerText.trim() === "试运行")));
  await page.screenshot({ path: "/tmp/ra4-workflow-unchanged.png" });
}

ok("无页面 JS 错误", errors.length === 0, errors.join(" | ").slice(0, 160));
console.log(`\n==== ${pass}/${pass + fail} PASS ====`);
await browser.close();
process.exit(fail ? 1 : 0);
