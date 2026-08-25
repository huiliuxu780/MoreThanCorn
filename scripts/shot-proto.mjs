import puppeteer from "puppeteer-core";
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--window-size=1440,1000"], defaultViewport: { width: 1440, height: 1000 } });
const page = await browser.newPage();
await page.goto("file:///Users/rivers/MoreThanCorn/docs/sdd/prototypes/node-master-spec-prototype.html", { waitUntil: "networkidle2" });
await new Promise(r => setTimeout(r, 400));
for (const id of ["s24", "s6"]) {
  await page.evaluate((s) => { document.querySelector(`[data-s="${s}"]`).click(); }, id);
  await new Promise(r => setTimeout(r, 200));
  await page.screenshot({ path: `/tmp/proto-${id}.png` });
}
await browser.close();
console.log("shots done");
