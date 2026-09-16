import puppeteer from "puppeteer-core";
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--window-size=1440,1000"], defaultViewport: { width: 1440, height: 1000 } });
const page = await browser.newPage();
const errs = [];
page.on("pageerror", e => errs.push(String(e).slice(0,140)));
await page.goto("http://localhost:5199/data-sources", { waitUntil: "networkidle2", timeout: 30000 });
await new Promise(r => setTimeout(r, 2500));
await page.screenshot({ path: "/tmp/band.png" });
await page.goto("http://localhost:5199/data-sources/da363b4af61340a186f81ecda681d4b4", { waitUntil: "networkidle2", timeout: 30000 });
await new Promise(r => setTimeout(r, 2500));
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find(x => x.textContent?.includes("新建路由"));
  b?.click();
});
await new Promise(r => setTimeout(r, 1200));
await page.screenshot({ path: "/tmp/detail-route.png", fullPage: true });
console.log("errs:", errs.length, errs.join(" | "));
await browser.close();
