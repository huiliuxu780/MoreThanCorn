/** 三视口 DOM 边界断言（2026-09-10 P0-F 任务书 §八）。
 *
 * 断言（每视口 × 每路由）：
 *  1. documentElement.scrollWidth <= viewportWidth（无横向溢出）；
 *  2. documentElement.scrollHeight <= viewportHeight + 2（Shell 不产生页级纵向滚动）；
 *  3. 任意主要容器（aside/nav/main/header/footer/[data-testid]）right <= viewportWidth（不裁切）。
 * 结果写 research/morethancorn/11-p0-rework-20260910/evidence/dom-bounds-<ts>.json。
 * 用法：node scripts/check-dom-bounds.mjs [base=http://localhost:5199]
 */
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const BASE = process.argv[2] ?? "http://localhost:5199";
const VIEWPORTS = [
  { width: 1024, height: 768 },
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
];

const api = await fetch("http://127.0.0.1:8120/api/agents?page=1&pageSize=5").then((r) => r.json());
const agentId = api.items?.[0]?.id;
if (!agentId) {
  console.error("FATAL: 无可用 Agent（产品面为空），无法验证详情/对话页");
  process.exit(2);
}

// 审计返工（09-10 二轮）浏览器门禁页面清单（任务书：导航/Agent 列表/Agent 创建/Agent 详情/
// 对话/Task/新建自动任务/Workflow/AgentFlow/设置页；导航随每页同测）= 11 路由 + 自动任务弹窗态。
const ROUTES = [
  "/tasks",
  "/batch-tasks",
  "/autonomous-tasks",
  "/agents",
  "/agents/new",
  "/agents/new?template=preset-frontend",
  `/agents/${agentId}`,
  `/agents/${agentId}/chat`,
  "/workflows",
  "/agentflows",
  "/settings",
];

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  defaultViewport: VIEWPORTS[2],
});
const results = [];
let failures = 0;

for (const vp of VIEWPORTS) {
  const page = await browser.newPage();
  await page.setViewport(vp);
  const measure = async (page) => page.evaluate(() => {
      const de = document.documentElement;
      const bad = [];
      for (const el of document.querySelectorAll("aside, nav, main, header, footer, [data-testid]")) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && Math.round(r.right) > innerWidth + 1) {
          bad.push({
            sel: el.tagName.toLowerCase() + (el.getAttribute("data-testid") ? `[${el.getAttribute("data-testid")}]` : ""),
            right: Math.round(r.right),
          });
        }
      }
      return {
        scrollW: de.scrollWidth,
        innerW: innerWidth,
        scrollH: de.scrollHeight,
        innerH: innerHeight,
        bad: bad.slice(0, 6),
      };
    });
  for (const route of ROUTES) {
    await page.goto(`${BASE}${route}`, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 1200));
    const m = await measure(page);
    const okW = m.scrollW <= m.innerW;
    const okH = m.scrollH <= m.innerH + 2;
    const okRight = m.bad.length === 0;
    const pass = okW && okH && okRight;
    if (!pass) failures += 1;
    results.push({ viewport: vp, route, ...m, okW, okH, okRight, pass });
    console.log(
      `${pass ? "PASS" : "FAIL"} ${vp.width}x${vp.height} ${route} scrollW=${m.scrollW}/${m.innerW} scrollH=${m.scrollH}/${m.innerH} rightViolations=${m.bad.length}`,
    );
    // 新建自动任务弹窗态（任务书"新建自动任务"页面项的交互终态）
    if (route === "/autonomous-tasks") {
      await page.evaluate(() => {
        const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("新建自动任务"));
        b?.click();
      });
      await new Promise((r) => setTimeout(r, 1000));
      const dm = await measure(page);
      const dOk = dm.scrollW <= dm.innerW && dm.scrollH <= dm.innerH + 2 && dm.bad.length === 0;
      if (!dOk) failures += 1;
      results.push({ viewport: vp, route: "/autonomous-tasks [新建自动任务弹窗]", ...dm, okW: dm.scrollW <= dm.innerW, okH: dm.scrollH <= dm.innerH + 2, okRight: dm.bad.length === 0, pass: dOk });
      console.log(`${dOk ? "PASS" : "FAIL"} ${vp.width}x${vp.height} /autonomous-tasks [弹窗] scrollW=${dm.scrollW}/${dm.innerW} scrollH=${dm.scrollH}/${dm.innerH} rightViolations=${dm.bad.length}`);
      await page.keyboard.press("Escape");
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  await page.close();
}

const out = "research/morethancorn/11-p0-rework-20260910/evidence/dom-bounds.json";
fs.mkdirSync("research/morethancorn/11-p0-rework-20260910/evidence", { recursive: true });
fs.writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), base: BASE, results }, null, 2));
console.log(`evidence: ${out} | failures=${failures}`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
