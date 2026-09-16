import puppeteer from "puppeteer-core";
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--window-size=1440,1000"], defaultViewport: { width: 1440, height: 1000 } });
const page = await browser.newPage();
await page.goto("http://localhost:5199/settings/connections", { waitUntil: "networkidle2", timeout: 30000 });
await new Promise((r) => setTimeout(r, 2500));
await page.screenshot({ path: "/Users/rivers/MoreThanCorn/docs/acceptance/assets/2026-09-14-openapi-import/05-oat-conn-filled.png" });
console.log("shot 05");
await browser.close();
