import puppeteer from "puppeteer-core";
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new", defaultViewport: { width: 1440, height: 1000 },
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 150)));

// 1) 找一个自主规划 Agent
const resp = await fetch("http://127.0.0.1:8100/api/agents?pageSize=100");
const agents = (await resp.json()).items;
const auto = agents.find((a) => a.type === "autonomous");
const group = agents.find((a) => a.type === "expert-group");
console.log("测试对象:", auto?.name, "|", group?.name);

// 2) 自主规划页四 Tab
await page.goto(`http://localhost:5173/config/agents/${auto.id}`, { waitUntil: "networkidle2", timeout: 30000 });
await new Promise((r) => setTimeout(r, 2500));
const tabs = await page.evaluate(() => ["Agent搭建", "运行观测", "效果评测", "版本指标"].map((t) => document.body.innerText.includes(t)));
console.log("自主规划四Tab:", JSON.stringify(tabs));
const tpl = await page.evaluate(() => ["通用", "客户服务", "AI 生成"].map((t) => document.body.innerText.includes(t)));
console.log("模板库+AI生成:", JSON.stringify(tpl));

// 3) 切到运行观测
await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.innerText === "运行观测")?.click());
await new Promise((r) => setTimeout(r, 1500));
const obs = await page.evaluate(() => ["总运行", "成功率", "运行记录"].map((t) => document.body.innerText.includes(t)));
console.log("运行观测面板:", JSON.stringify(obs));

// 4) 专家组 → 画布
if (group) {
  await page.goto(`http://localhost:5173/config/agents/${group.id}`, { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2500));
  const canvas = await page.evaluate(() => ({
    hasReactFlow: !!document.querySelector(".react-flow"),
    paletteText: document.body.innerText.slice(0, 4000),
  }));
  console.log("专家组画布:", canvas.hasReactFlow);
}
if (errors.length) console.log("页面错误:", errors.slice(0, 3));
await browser.close();
