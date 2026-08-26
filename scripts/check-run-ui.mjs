import puppeteer from "puppeteer-core";
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--window-size=1440,1000"], defaultViewport: { width: 1440, height: 1000 } });
const page = await browser.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push("PAGEERROR: " + String(e).slice(0, 300)));
await page.goto("http://localhost:5173/config/workflows/414508880329493182a5a5699514d1ae", { waitUntil: "networkidle2", timeout: 30000 });
await new Promise((r) => setTimeout(r, 2500));
// 试运行
await page.evaluate(() => { [...document.querySelectorAll("button")].find((x) => (x.innerText || "").trim() === "试运行")?.click(); });
await new Promise((r) => setTimeout(r, 600));
await page.evaluate(() => { [...document.querySelectorAll("button")].find((x) => (x.innerText || "").trim() === "开始运行")?.click(); });
await new Promise((r) => setTimeout(r, 700));
// running 中的 class
const runningCls = await page.evaluate(() => [...document.querySelectorAll(".react-flow__node")].map((n) => n.querySelector("div")?.className).filter((c) => c?.includes("node-st-")));
console.log("RUNNING CLASSES:", JSON.stringify(runningCls));
await new Promise((r) => setTimeout(r, 4000));
// 结果条点击
const before = await page.evaluate(() => document.body.innerText.includes("输入") );
const clicked = await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.innerText || "").includes("运行成功"));
  if (!b) return "no-button";
  b.click();
  return "clicked";
});
await new Promise((r) => setTimeout(r, 500));
const expanded = await page.evaluate(() => {
  const bars = [...document.querySelectorAll("button")].filter((x) => (x.innerText || "").includes("运行成功"));
  return bars.map((b) => b.parentElement?.innerText?.slice(0, 60));
});
console.log("CLICK:", clicked, "EXPANDED:", JSON.stringify(expanded));
console.log("ERRS:", errs.slice(0, 4).join("\n") || "none");
await browser.close();
