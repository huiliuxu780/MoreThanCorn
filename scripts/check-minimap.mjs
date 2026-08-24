/** 小地图真机验证（用户报告复核）：无头 Chrome 打开画布，统计小地图节点缩略数。 */
import puppeteer from "puppeteer-core";

const URL = process.argv[2] ?? "http://localhost:5173/config/agents/1acbe9f81c2546f7a9d3068a761d707f";

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--window-size=1440,1000"],
  defaultViewport: { width: 1440, height: 1000 },
});
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));

await page.goto(URL, { waitUntil: "networkidle2", timeout: 30000 });
await new Promise((r) => setTimeout(r, 3000)); // 等待画布测量

const stats = await page.evaluate(() => {
  const canvasNodes = document.querySelectorAll(".react-flow__node").length;
  const miniNodes = document.querySelectorAll(".react-flow__minimap-node").length;
  const svg = document.querySelector(".react-flow__minimap-svg");
  return { canvasNodes, miniNodes, minimapPresent: !!svg, viewBox: svg?.getAttribute("viewBox") ?? null };
});
console.log("画布节点数:", stats.canvasNodes, "| 小地图缩略数:", stats.miniNodes, "| 小地图存在:", stats.minimapPresent);
if (errors.length) console.log("控制台错误:", errors.slice(0, 5));
await page.screenshot({ path: "/tmp/minimap-check.png" });
await browser.close();
process.exit(stats.canvasNodes > 0 && stats.miniNodes === stats.canvasNodes ? 0 : 1);
