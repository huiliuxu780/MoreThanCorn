/** 纯浏览器闭环验收-创建段：Connection→Datasource→Asset 全经 UI。 */
import puppeteer from "puppeteer-core";
const BASE = "http://localhost:5173";
const SHOT = (n) => `/tmp/accept-evidence/${n}.png`;
const log = (...a) => console.log("[full]", ...a);
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new", args: ["--window-size=1500,1000"], defaultViewport: { width: 1500, height: 1000 } });
const page = await browser.newPage();
page.on("pageerror", (e) => log("PAGEERROR", String(e).slice(0, 120)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login() {
  await page.goto(`${BASE}/settings/connections`, { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(800);
  if (await page.$('input[placeholder="用户名"]')) {
    await page.type('input[placeholder="用户名"]', "admin"); await page.type('input[placeholder="密码"]', "admin");
    await page.evaluate(() => { const d = document.querySelector('[role="dialog"]') ?? document;
      [...d.querySelectorAll("button")].find((x) => x.textContent.trim() === "登录")?.click(); });
    await sleep(1200); await page.goto(`${BASE}/settings/connections`, { waitUntil: "networkidle2" }); await sleep(1000);
  }
}
// 在给定容器内按 Label 文本填 input
async function fillByLabel(labelText, value, placeholder) {
  return page.evaluate(({ labelText, value, placeholder }) => {
    const scope = document.querySelector('[role="dialog"]') ?? document;
    const labels = [...scope.querySelectorAll("label, .text-xs")].filter((l) => l.textContent.trim().startsWith(labelText));
    for (const l of labels) {
      const wrap = l.closest("div");
      const input = wrap?.querySelector("input") ?? wrap?.nextElementSibling?.querySelector?.("input");
      if (input) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      }
    }
    if (placeholder) { const i = scope.querySelector(`input[placeholder="${placeholder}"]`); if (i) {
      const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set; s.call(i, value); i.dispatchEvent(new Event("input", { bubbles: true })); return true; } }
    return false;
  }, { labelText, value, placeholder });
}
// radix select：按触发器附近 label 或当前值，选 option
async function selectOption(optionText) {
  // 先点所有 combobox 不行；改为：调用前已点 trigger。这里直接选 option。
  const ok = await page.evaluate((optionText) => {
    const opt = [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent.trim() === optionText || o.textContent.includes(optionText));
    if (opt) { opt.click(); return true; } return false;
  }, optionText);
  await sleep(400); return ok;
}
async function clickButton(text, scopeDialog = false) {
  return page.evaluate(({ text, scopeDialog }) => {
    const scope = scopeDialog ? (document.querySelector('[role="dialog"]') ?? document) : document;
    const b = [...scope.querySelectorAll("button")].find((x) => x.textContent.includes(text));
    if (b) { b.click(); return true; } return false;
  }, { text, scopeDialog });
}
// 打开某 label 对应的 select trigger
async function openSelectByLabel(labelText) {
  return page.evaluate((labelText) => {
    const scope = document.querySelector('[role="dialog"]') ?? document;
    const labels = [...scope.querySelectorAll("label, .text-xs")].filter((l) => l.textContent.trim().startsWith(labelText));
    for (const l of labels) {
      const wrap = l.closest("div");
      const trig = wrap?.querySelector("button[role=combobox], [data-slot=select-trigger], button");
      if (trig) { trig.click(); return true; }
    }
    return false;
  }, labelText);
}

await login();

// ---- 1 Connection ----
log("click 创建连接:", await clickButton("创建连接"));
await sleep(600);
log("fill name:", await fillByLabel("名称", "r3-pg"));
// 协议 select -> PostgreSQL
await openSelectByLabel("协议"); await sleep(300);
log("select protocol:", await selectOption("PostgreSQL"));
await sleep(300);
log("host:", await fillByLabel("Host", "127.0.0.1", "db.internal"));
log("port:", await fillByLabel("Port", "5432"));
log("user:", await fillByLabel("用户名", "rivers", "rivers"));
log("db:", await fillByLabel("数据库", "wf_accept", "wf_accept"));
// secret (password input)
await page.evaluate(() => { const d = document.querySelector('[role="dialog"]'); const i = d?.querySelector('input[type="password"]'); if (i) { const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set; s.call(i, "x"); i.dispatchEvent(new Event("input", { bubbles: true })); } });
await sleep(300);
await page.screenshot({ path: SHOT("f1-conn-form") });
log("click 创建:", await clickButton("创建", true));
await sleep(1200);
await page.screenshot({ path: SHOT("f2-conn-created") });

// ---- 2 Datasource ----
await page.goto(`${BASE}/config/data-resources/new`, { waitUntil: "networkidle2" }); await sleep(1000);
log("ds 下一步(step0):", await clickButton("下一步")); await sleep(500);
log("ds name:", await fillByLabel("名称", "r3-ds"));
// ConnectionPicker select -> r3-pg
await page.evaluate(() => { const t = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("选择 Connection")); t?.click(); });
await sleep(400);
log("ds pick conn:", await selectOption("r3-pg"));
log("ds location:", await fillByLabel("库 / Bucket / 路径", "wf_accept", "db_cc"));
await page.screenshot({ path: SHOT("f3-ds-form") });
log("ds 下一步(step1):", await clickButton("下一步")); await sleep(600);
log("ds 执行测试:", await clickButton("执行测试")); await sleep(2500);
await page.screenshot({ path: SHOT("f4-ds-test") });
log("ds 保存并启用:", await clickButton("保存并启用")); await sleep(1000);

// ---- 3 Asset ----
await page.goto(`${BASE}/config/data-resources/new`, { waitUntil: "networkidle2" }); await sleep(1000);
// step0 选类型 asset
const typePicked = await page.evaluate(() => {
  const el = [...document.querySelectorAll("button,[role=radio],div")].find((x) => /数据资产|Asset/i.test(x.textContent) && x.textContent.length < 60);
  if (el) { el.click(); return el.textContent.trim(); } return null;
});
log("asset type picked:", typePicked);
await sleep(400);
log("asset 下一步(step0):", await clickButton("下一步")); await sleep(500);
log("asset name:", await fillByLabel("名称", "r3-asset"));
await page.evaluate(() => { const t = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("选择数据源") || b.textContent.includes("选择 Datasource")); t?.click(); });
await sleep(400);
log("asset pick ds:", await selectOption("r3-ds"));
log("asset location:", await fillByLabel("表 / 路径", "accept_input", "t_call_session"));
log("asset timeField:", await fillByLabel("时间字段", "interactionTime", "interactionTime"));
log("asset recordIdField:", await fillByLabel("记录 ID 字段", "interactionId", "interactionId"));
await page.screenshot({ path: SHOT("f5-asset-form") });
log("asset 下一步(step1):", await clickButton("下一步")); await sleep(600);
log("asset 执行测试:", await clickButton("执行测试")); await sleep(2500);
await page.screenshot({ path: SHOT("f6-asset-test") });
log("asset 保存并启用:", await clickButton("保存并启用")); await sleep(1000);
await page.screenshot({ path: SHOT("f7-asset-done") });

await browser.close();
log("done");
