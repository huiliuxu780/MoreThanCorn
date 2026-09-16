import { mkdirSync } from "node:fs";
import puppeteer from "puppeteer-core";
const SHOTS = "/Users/rivers/MoreThanCorn/docs/acceptance/assets/2026-09-14-openapi-import";
mkdirSync(SHOTS, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new", args: ["--window-size=1440,1000"], defaultViewport: { width: 1440, height: 1000 } });
const page = await browser.newPage();
await page.goto("http://localhost:5199/data-sources", { waitUntil: "networkidle2", timeout: 30000 });
await new Promise((r) => setTimeout(r, 2500));
await page.screenshot({ path: `${SHOTS}/04-sls-source.png` });
console.log("shot 04-sls-source");
await browser.close();
