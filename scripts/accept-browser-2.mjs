/** 本地闭环验收-浏览器阶段2：质量结果列表→详情(输入/输出/规则版本/追踪)→复核→刷新持久化。 */
import puppeteer from "puppeteer-core";
const BASE = "http://localhost:5173";
const SHOT = (n) => `/tmp/accept-evidence/${n}.png`;
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new", args: ["--window-size=1440,1000"], defaultViewport: { width: 1440, height: 1000 } });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 150)));

async function login() {
  await page.goto(`${BASE}/quality/results`, { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 800));
  if (await page.$('input[placeholder="用户名"]')) {
    await page.type('input[placeholder="用户名"]', "admin");
    await page.type('input[placeholder="密码"]', "admin");
    await page.evaluate(() => { const d = document.querySelector('[role="dialog"]') ?? document;
      [...d.querySelectorAll("button")].find((x) => x.textContent.trim() === "登录")?.click(); });
    await new Promise((r) => setTimeout(r, 1200));
    await page.goto(`${BASE}/quality/results`, { waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 1200));
  }
}
await login();
await page.screenshot({ path: SHOT("03-quality-results-list") });
const listTxt = await page.evaluate(() => document.body.innerText.match(/D-00\d/g) ?? []);
console.log("结果列表含 D-00x:", [...new Set(listTxt)].join(","));

// 打开首行详情
const opened = await page.evaluate(() => {
  const tr = document.querySelector("table tbody tr");
  if (tr) { tr.click(); return true; } return false;
});
await new Promise((r) => setTimeout(r, 1500));
console.log("opened detail:", opened, "url:", page.url());
await page.screenshot({ path: SHOT("04-result-detail") });
const detailHas = await page.evaluate(() => {
  const t = document.body.innerText;
  return { input: t.includes("输入") || t.includes("interactionId"), output: t.includes("输出") || t.includes("score"),
           rule: /规则/.test(t), trace: /追踪|Trace|trace/.test(t) };
});
console.log("详情含 输入/输出/规则/追踪:", JSON.stringify(detailHas));

// 进入复核 → 完成复核
await page.evaluate(() => { [...document.querySelectorAll("button")].find((x) => x.textContent.includes("进入复核"))?.click(); });
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: SHOT("05-review-mode") });
await page.evaluate(() => { [...document.querySelectorAll("button")].find((x) => x.textContent.includes("完成复核"))?.click(); });
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: SHOT("06-review-dialog") });
// 在复核对话框中选择 通过/维持 并提交
const dlgTxt = await page.evaluate(() => document.querySelector('[role="dialog"]')?.innerText.slice(0, 300) ?? "no-dialog");
console.log("复核对话框:", dlgTxt.replace(/\n/g, " | "));
await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"]'); if (!d) return;
  const opt = [...d.querySelectorAll("button")].find((x) => /通过|维持|approve/i.test(x.textContent));
  opt?.click();
});
await new Promise((r) => setTimeout(r, 500));
await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"]'); if (!d) return;
  const submit = [...d.querySelectorAll("button")].find((x) => /提交|确认|完成|保存/.test(x.textContent));
  submit?.click();
});
await new Promise((r) => setTimeout(r, 1200));
await page.screenshot({ path: SHOT("07-after-review") });

// 刷新确认持久化
await page.reload({ waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 1200));
const persisted = await page.evaluate(() => /已复核|复核|COMPLETED|IN_REVIEW/.test(document.body.innerText));
console.log("刷新后复核状态仍在:", persisted);
await page.screenshot({ path: SHOT("08-after-refresh") });
console.log("pageerrors:", errors.length ? errors.slice(0, 3) : "无");
await browser.close();
