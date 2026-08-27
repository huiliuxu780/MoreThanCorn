/** 本地闭环验收-浏览器阶段1：登录 → 启动任务 → 观察 TaskRun 状态迁移。真实 Chromium。 */
import puppeteer from "puppeteer-core";
const BASE = "http://localhost:5173";
const TASK = process.argv[2] ?? "4b9cd3d50af84daf88bd8a6268591661";
const SHOT = (n) => `/tmp/accept-evidence/${n}.png`;

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new", args: ["--window-size=1440,1000"], defaultViewport: { width: 1440, height: 1000 },
});
const page = await browser.newPage();
const errors = []; const hosts = new Set();
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 150)); });
page.on("pageerror", (e) => errors.push(String(e).slice(0, 150)));
page.on("request", (r) => { try { hosts.add(new URL(r.url()).host); } catch {} });

await page.goto(`${BASE}/config/tasks/${TASK}`, { waitUntil: "networkidle2", timeout: 30000 });
await new Promise((r) => setTimeout(r, 1200));

// 登录（若出现登录对话框）
await new Promise((r) => setTimeout(r, 800));
const hasLogin = await page.$('input[placeholder="用户名"]');
console.log("login dialog present:", !!hasLogin);
if (hasLogin) {
  await page.type('input[placeholder="用户名"]', "admin");
  await page.type('input[placeholder="密码"]', "admin");
  await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]') ?? document;
    const btns = [...dlg.querySelectorAll("button")];
    const b = btns.find((x) => x.textContent.trim() === "登录" && !x.textContent.includes("中"));
    b?.click();
  });
  await new Promise((r) => setTimeout(r, 1500));
  await page.goto(`${BASE}/config/tasks/${TASK}`, { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1500));
}
await page.screenshot({ path: SHOT("01-logged-in-task") });

// 点击 立即执行
const clicked = await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("立即执行"));
  if (b) { b.click(); return true; } return false;
});
console.log("clicked 立即执行:", clicked);

// 轮询状态迁移（页面不自动轮询，故每次刷新观察真实状态）
const seen = [];
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 1500));
  await page.reload({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 800));
  const st = await page.evaluate(() => {
    const badges = [...document.querySelectorAll("table tbody tr")].slice(0, 1)
      .map((tr) => tr.innerText.replace(/\s+/g, " ").slice(0, 120));
    return badges[0] ?? "";
  });
  const cur = (st.match(/queued|running|pending|success|partial|failed|completed|cancelled/i) || ["?"])[0];
  if (!seen.length || seen[seen.length - 1] !== cur) { seen.push(cur); console.log(`t=${(i * 1.5).toFixed(0)}s status=${cur} :: ${st}`); }
  if (/success|partial|failed|completed|cancelled/i.test(cur)) break;
}
console.log("状态迁移序列:", seen.join(" -> "));
await page.screenshot({ path: SHOT("02-run-final") });
console.log("请求目标host:", [...hosts].join(", "));
console.log("控制台错误:", errors.length ? errors.slice(0, 5) : "无");
await browser.close();
