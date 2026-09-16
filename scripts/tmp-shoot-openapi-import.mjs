import { mkdirSync } from "node:fs";
import puppeteer from "puppeteer-core";
const BASE = "http://localhost:5199";
const SHOTS = "/Users/rivers/MoreThanCorn/docs/acceptance/assets/2026-09-14-openapi-import";
mkdirSync(SHOTS, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new", args: ["--window-size=1440,1000"],
  defaultViewport: { width: 1440, height: 1000 },
});
const page = await browser.newPage();
const shot = async (name, path, settle = 2500) => {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise((r) => setTimeout(r, settle));
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
  console.log("shot:", name);
};
await shot("01-tools-list", "/resources/tools");
// 工具详情：找到「热线录音查询」行点进去
await page.goto(`${BASE}/resources/tools`, { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 2000));
const clicked = await page.evaluate(() => {
  const els = [...document.querySelectorAll("a,button,[role='row'],tr,div")];
  const t = els.find((e) => e.textContent?.includes("热线录音查询") && e.textContent.length < 200);
  if (t) { t.click(); return true; }
  return false;
});
await new Promise((r) => setTimeout(r, 2500));
await page.screenshot({ path: `${SHOTS}/02-tool-detail.png` });
console.log("detail clicked:", clicked, "| url:", page.url());
await shot("03-settings-connections", "/settings/connections");
await browser.close();
