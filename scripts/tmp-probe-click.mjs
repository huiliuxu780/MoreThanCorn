import puppeteer from "puppeteer-core";
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--window-size=1440,1000"], defaultViewport: { width: 1440, height: 1000 } });
const page = await browser.newPage();
await page.goto("http://localhost:5199/agents", { waitUntil: "networkidle2", timeout: 30000 });
await new Promise(r => setTimeout(r, 2000));
const before = page.url();
const clicked = await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find(x => x.textContent?.includes("smoke-thinking-0911"));
  if (!b) return "not-found";
  b.click(); return "clicked";
});
await new Promise(r => setTimeout(r, 1500));
console.log(JSON.stringify({ clicked, before, after: page.url() }));
await browser.close();
