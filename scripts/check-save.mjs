import puppeteer from "puppeteer-core";
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--window-size=1440,1000"], defaultViewport: { width: 1440, height: 1000 } });
const page = await browser.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push("PAGEERROR: " + String(e).slice(0, 400)));
page.on("console", (m) => { if (m.type() === "error") errs.push("CONSOLE: " + m.text().slice(0, 300)); });
page.on("requestfailed", (r) => errs.push("REQFAIL: " + r.url().slice(0, 120) + " " + (r.failure()?.errorText ?? "")));
page.on("response", (r) => { if (r.status() >= 400) errs.push(`HTTP ${r.status()}: ` + r.url().slice(0, 140)); });
await page.goto("http://localhost:5173/config/workflows/414508880329493182a5a5699514d1ae", { waitUntil: "networkidle2", timeout: 30000 });
await new Promise((r) => setTimeout(r, 2500));
// 点保存
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.innerText || "").trim() === "保存");
  if (b) b.click();
});
await new Promise((r) => setTimeout(r, 2000));
// 点发布
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.innerText || "").trim() === "发布");
  if (b) b.click();
});
await new Promise((r) => setTimeout(r, 2000));
const body = await page.evaluate(() => document.body?.innerText?.slice(0, 400));
console.log("BODY:", JSON.stringify(body));
console.log("ERRS:", errs.slice(0, 10).join("\n") || "none");
await browser.close();
