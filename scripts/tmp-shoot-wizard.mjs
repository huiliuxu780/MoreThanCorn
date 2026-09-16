import puppeteer from "puppeteer-core";
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--window-size=1440,1000"], defaultViewport: { width: 1440, height: 1000 } });
const page = await browser.newPage();
const errs = [];
page.on("pageerror", e => errs.push(String(e).slice(0,140)));
const shot = (n) => page.screenshot({ path: `/tmp/wiz-${n}.png` });
const clickText = async (t) => {
  const ok = await page.evaluate((txt) => {
    const els = [...document.querySelectorAll("button")];
    const el = els.find(e => e.textContent?.trim().startsWith(txt));
    if (el) { el.click(); return true } return false;
  }, t);
  await new Promise(r => setTimeout(r, 700));
  return ok;
};
await page.goto("http://localhost:5199/data-sources/wizard", { waitUntil: "networkidle2", timeout: 30000 });
await new Promise(r => setTimeout(r, 1500));
await shot(1);
await page.evaluate(() => {
  const cards = [...document.querySelectorAll("button")];
  const sls = cards.find(b => b.textContent?.includes("SLS 日志"));
  sls?.click();
});
await new Promise(r => setTimeout(r, 500));
await clickText("下一步：凭据");
await shot(2);
await clickText("下一步：源配置");
await shot(3);
await clickText("下一步：路由");
await shot(4);
console.log("errs:", errs.length, errs.join(" | "));
await browser.close();
