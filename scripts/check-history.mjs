import puppeteer from "puppeteer-core";
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new", defaultViewport: { width: 1440, height: 1000 },
});
const page = await browser.newPage();
await page.goto("http://localhost:5173/config/agents/1acbe9f81c2546f7a9d3068a761d707f", { waitUntil: "networkidle2", timeout: 30000 });
await new Promise((r) => setTimeout(r, 2500));
await page.click('button[title="历史版本"]');
await new Promise((r) => setTimeout(r, 1500));
const info = await page.evaluate(() => {
  const drawerText = document.body.innerText;
  const hasV2 = /V2\b/.test(drawerText);
  const hasProd = drawerText.includes("线上");
  const hasHash = drawerText.includes("sha256:");
  return { hasV2, hasProd, hasHash };
});
console.log("历史版本抽屉:", JSON.stringify(info));
await page.screenshot({ path: "/tmp/history-check.png" });
await browser.close();
process.exit(info.hasV2 && info.hasProd ? 0 : 1);
