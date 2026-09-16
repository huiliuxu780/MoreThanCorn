import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";
const D = "docs/acceptance/assets/2026-09-14-source-kinds";
mkdirSync(D, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new", defaultViewport: { width: 1440, height: 1050 },
});
const page = await browser.newPage();
await page.goto("http://localhost:5199/data-sources", { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 1500));
// 打开创建对话框
await page.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => b.textContent.includes("新建数据源"))?.click();
});
await new Promise((r) => setTimeout(r, 700));
// 打开类型下拉
await page.evaluate(() => {
  document.querySelector("#ds-kind")?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }));
  document.querySelector("#ds-kind")?.click();
});
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: D + "/create-kind-select-icons.png" });
// 选飞书多维表格
await page.evaluate(() => {
  const opt = [...document.querySelectorAll("[role='option']")].find((o) => o.textContent.includes("飞书多维表格"));
  opt?.click();
});
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: D + "/create-feishu-fields.png" });
await page.keyboard.press("Escape");
await new Promise((r) => setTimeout(r, 400));
// 建飞书演示源 → 详情页
const resp = await page.evaluate(async () => {
  const r = await fetch("/api/v2/data-sources", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "客服工单表（飞书演示）", kind: "feishu_bitable",
      config: { app_token: "bascnDEMO", table_id: "tblDEMO", page_size: 100 } }),
  });
  return await r.json();
});
await page.goto("http://localhost:5199/data-sources/" + resp.id, { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 1800));
await page.screenshot({ path: D + "/detail-feishu-light.png" });
// 清理演示源
await page.evaluate(async (id) => {
  await fetch("/api/v2/data-sources/" + id, { method: "DELETE" });
}, resp.id);
console.log("shots done", resp.id);
await browser.close();
