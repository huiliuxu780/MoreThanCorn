/** 本地闭环验收-浏览器阶段3：重启后端后确认结果持久化 + 连接测试真实回显。 */
import puppeteer from "puppeteer-core";
const BASE = "http://localhost:5173";
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new", args: ["--window-size=1440,1000"], defaultViewport: { width: 1440, height: 1000 } });
const page = await browser.newPage();
await page.goto(`${BASE}/quality/results`, { waitUntil: "networkidle2", timeout: 30000 });
await new Promise((r) => setTimeout(r, 800));
if (await page.$('input[placeholder="用户名"]')) {
  await page.type('input[placeholder="用户名"]', "admin"); await page.type('input[placeholder="密码"]', "admin");
  await page.evaluate(() => { const d = document.querySelector('[role="dialog"]') ?? document;
    [...d.querySelectorAll("button")].find((x) => x.textContent.trim() === "登录")?.click(); });
  await new Promise((r) => setTimeout(r, 1200));
  await page.goto(`${BASE}/quality/results`, { waitUntil: "networkidle2" }); await new Promise((r) => setTimeout(r, 1200));
}
const rows = await page.evaluate(() => document.querySelectorAll("table tbody tr").length);
const total = await page.evaluate(() => (document.body.innerText.match(/全部结果\s*(\d+)/) || [])[1]);
console.log("重启后 结果行数:", rows, "| 全部结果:", total);
await page.screenshot({ path: "/tmp/accept-evidence/09-after-backend-restart.png" });
// 连接页真实测试回显
await page.goto(`${BASE}/settings/connections`, { waitUntil: "networkidle2" }); await new Promise((r) => setTimeout(r, 1200));
await page.screenshot({ path: "/tmp/accept-evidence/10-connections.png" });
const connTxt = await page.evaluate(() => document.body.innerText.includes("accept-pg"));
console.log("连接页含 accept-pg:", connTxt);
await browser.close();
