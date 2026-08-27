/** 09 P2-08 发布治理页真机验证：无头 Chrome 打开 /settings/governance，
 * 确认页头/新建表单/队列表渲染且无控制台错误。 */
import puppeteer from "puppeteer-core";

const URL = process.argv[2] ?? "http://localhost:5173/settings/governance";

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--window-size=1440,1000"],
  defaultViewport: { width: 1440, height: 1000 },
});
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));

await page.goto(URL, { waitUntil: "networkidle2", timeout: 30000 });
await new Promise((r) => setTimeout(r, 2500));

const stats = await page.evaluate(() => {
  const h1 = document.querySelector("h1")?.textContent ?? "";
  const body = document.body.innerText;
  return {
    h1,
    hasForm: body.includes("资源类型") && body.includes("目标版本") && body.includes("提交发布申请"),
    hasQueue: body.includes("发布申请队列"),
    hasEmpty: body.includes("暂无发布申请"),
    hasTable: !!document.querySelector("table"),
  };
});
console.log("页头:", stats.h1);
console.log("新建表单存在:", stats.hasForm, "| 队列区存在:", stats.hasQueue,
  "| 空态:", stats.hasEmpty, "| 表格渲染:", stats.hasTable);
if (errors.length) console.log("控制台错误:", errors.slice(0, 5));
else console.log("控制台错误: 无");
await page.screenshot({ path: "/tmp/governance-check.png" });
await browser.close();
const ok = stats.h1.includes("发布治理") && stats.hasForm && stats.hasQueue && errors.length === 0;
process.exit(ok ? 0 : 1);
