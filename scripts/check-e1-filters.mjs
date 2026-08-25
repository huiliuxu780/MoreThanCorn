/** E-1.1 浏览器验证：质量结果页筛选走真实词表（后端 /api/quality/vocab），mocks 已删。 */
import puppeteer from "puppeteer-core";

const URL = process.argv[2] ?? "http://localhost:5173/quality/results";

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--window-size=1440,1000"],
  defaultViewport: { width: 1440, height: 1000 },
});
const page = await browser.newPage();
const errors = [];
const vocabResps = [];
page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("favicon")) errors.push(m.text().slice(0, 200)); });
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
page.on("response", (r) => { if (r.url().includes("/api/quality/vocab")) vocabResps.push(r.status()); });

const fail = (msg) => { console.log("FAIL:", msg); return browser.close().then(() => process.exit(1)); };

await page.goto(URL, { waitUntil: "networkidle2", timeout: 30000 });
await new Promise((r) => setTimeout(r, 2000));

// 1) vocab 端点被调用且 200
if (!vocabResps.length || vocabResps[0] !== 200) await fail(`vocab 请求未命中或失败: ${JSON.stringify(vocabResps)}`);
console.log("PASS: /api/quality/vocab 被调用且 200");

// 2) 表格有真实数据行
const rowCount = await page.evaluate(() => document.querySelectorAll("tbody tr").length);
if (!rowCount) await fail("表格无数据行");
console.log(`PASS: 表格加载 ${rowCount} 行`);

// 3) 「质量问题」下拉含已发布规则词表项（后端 criteria）
const trigger = await page.evaluateHandle(() =>
  [...document.querySelectorAll("button[role=combobox]")].find((b) => /全部问题|承诺需复核/.test(b.textContent)));
if (!trigger) await fail("未找到『质量问题』筛选器");
await trigger.asElement().click();
await new Promise((r) => setTimeout(r, 500));
const criterionOptions = await page.evaluate(() =>
  [...document.querySelectorAll("[role=option]")].map((o) => o.textContent.trim()));
console.log("质量问题选项:", JSON.stringify(criterionOptions));
if (!criterionOptions.some((t) => t.includes("承诺需复核"))) await fail("下拉缺少已发布规则词表项『承诺需复核』");
console.log("PASS: 质量问题下拉来自真实规则词表");

// 4) 选中该问题 → 列表被筛选（行数变化且全部含该问题摘要）
const opt = await page.evaluateHandle(() =>
  [...document.querySelectorAll("[role=option]")].find((o) => o.textContent.includes("承诺需复核")));
await opt.asElement().click();
await new Promise((r) => setTimeout(r, 1500));
const after = await page.evaluate(() => ({
  rows: document.querySelectorAll("tbody tr").length,
  allMatch: [...document.querySelectorAll("tbody tr")].every((tr) => tr.textContent.includes("承诺需复核")),
}));
if (!after.rows || !after.allMatch) await fail(`criterion 筛选无效: ${JSON.stringify(after)}`);
console.log(`PASS: 按质量问题筛选生效（${after.rows} 行，全部匹配）`);

// 5) 班组/服务类型下拉可打开（真实数据无该维度 → 空选项是诚实态，不报错即可）
for (const label of ["全部班组", "全部服务类型"]) {
  const t = await page.evaluateHandle((l) =>
    [...document.querySelectorAll("button[role=combobox]")].find((b) => b.textContent.includes(l)), label);
  if (!t) { console.log(`WARN: 未找到『${label}』筛选器（布局差异？）`); continue; }
  await t.asElement().click();
  await new Promise((r) => setTimeout(r, 400));
  const opts = await page.evaluate(() => [...document.querySelectorAll("[role=option]")].map((o) => o.textContent.trim()));
  console.log(`『${label}』选项: ${JSON.stringify(opts)}（空=真实数据无此维度，属诚实态）`);
  await page.keyboard.press("Escape");
  await new Promise((r) => setTimeout(r, 300));
}

if (errors.length) { console.log("控制台错误:", errors.slice(0, 5)); await browser.close(); process.exit(1); }
await page.screenshot({ path: "/tmp/e1-filters.png" });
console.log("ALL PASS（截图 /tmp/e1-filters.png）");
await browser.close();
process.exit(0);
