import puppeteer from "puppeteer-core";
const SEL = "button, [role='button'], [role='tab'], [role='menuitem'], [role='switch'], a[href]";
const LBL = "smoke-thinking-0911冒烟测试：验证深度思考";
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--window-size=1440,1000"], defaultViewport: { width: 1440, height: 1000 } });
const page = await browser.newPage();
await page.goto("http://localhost:5199/agents", { waitUntil: "networkidle2", timeout: 30000 });
await new Promise(r => setTimeout(r, 1500));
const info = await page.evaluate((sel, lbl) => {
  const out = [];
  for (const el of document.querySelectorAll(sel)) {
    const t = (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 30);
    if (t === lbl) {
      const r = el.getBoundingClientRect();
      out.push({ tag: el.tagName, x: r.x + r.width/2, y: r.y + r.height/2, w: r.width, h: r.height, cls: (el.className||"").slice(0,60) });
    }
  }
  return out;
}, SEL, LBL);
console.log("matches:", JSON.stringify(info, null, 1));
const before = page.url();
if (info[0]) { await page.mouse.click(info[0].x, info[0].y); await new Promise(r => setTimeout(r, 800)); }
console.log(JSON.stringify({ before, after: page.url() }));
await browser.close();
