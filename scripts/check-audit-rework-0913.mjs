/** 09-13 审计返工浏览器实证（临时脚本，跑完归档删除）。
 *  V1 任务看板：KPI 真实数字（非全 0）/ 无「查收结果」内部文案 / 需要操作计数=waiting
 *  V2 数据接入：轮询表单出现 URL/间隔/游标字段；映射文案=触发输入键→payload 路径
 *  V3 连接页：行渲染 + 协议 tab 全量计数 + 操作按钮 focus 可见 + 搜索 aria-label
 *  V4 壳常驻：路由切换瞬间侧栏仍在（Suspense 下沉）
 */
import { mkdirSync } from "node:fs";
import puppeteer from "puppeteer-core";

const BASE = "http://localhost:5199";
const SHOTS = "docs/acceptance/assets/2026-09-13-audit-rework";
mkdirSync(SHOTS, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--window-size=1440,1000"],
  defaultViewport: { width: 1440, height: 1000 },
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
const out = {};

// ---- V1 任务看板 ----
await page.goto(`${BASE}/tasks`, { waitUntil: "networkidle2", timeout: 30000 });
await new Promise((r) => setTimeout(r, 2000));
out.v1 = await page.evaluate(() => {
  const text = document.body.innerText;
  const kpis = [...document.querySelectorAll("section[aria-label='工作记录'] strong")]
    .map((s) => s.textContent.trim());
  return {
    kpiValues: kpis,
    kpiAllZero: kpis.length > 0 && kpis.every((k) => k === "0"),
    hasShouchao: text.includes("查收"),
    hasInternalStageText: text.includes("不伪造"),
    needsActionTab: (text.match(/需要操作（(\d+)）/) ?? [])[1] ?? null,
    hasQueueLabel: text.includes("排队中"),
    tableRows: document.querySelectorAll("table tbody tr").length,
  };
});
await page.screenshot({ path: `${SHOTS}/v1-task-board.png` });

// ---- V2 数据接入：轮询表单 ----
await page.goto(`${BASE}/data-sources`, { waitUntil: "networkidle2", timeout: 30000 });
await new Promise((r) => setTimeout(r, 1200));
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("新建数据源"));
  b?.click();
});
await new Promise((r) => setTimeout(r, 600));
// 选轮询
await page.evaluate(() => {
  const trig = document.querySelector("[role='dialog'] [aria-labelledby='ds-kind-label'], [role='dialog'] #ds-kind");
  trig?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  trig?.click();
});
await new Promise((r) => setTimeout(r, 500));
await page.evaluate(() => {
  const opt = [...document.querySelectorAll("[role='option']")].find((o) => o.textContent.includes("轮询"));
  opt?.click();
});
await new Promise((r) => setTimeout(r, 700));
out.v2 = await page.evaluate(() => {
  const dlg = document.querySelector("[role='dialog']");
  const t = dlg?.innerText ?? "";
  return {
    hasUrl: !!dlg?.querySelector("#ds-url"),
    hasInterval: !!dlg?.querySelector("#ds-interval"),
    hasCursor: !!dlg?.querySelector("#ds-cursor-field") && !!dlg?.querySelector("#ds-cursor-param"),
    mappingLabelOk: t.includes("触发输入键 → payload"),
    mappingLabelOldWrong: t.includes("payload 路径 → 触发输入键"),
    authHonestNote: t.includes("匿名 GET"),
    labelLinked: !!dlg?.querySelector("label[for='ds-name']"),
  };
});
await page.screenshot({ path: `${SHOTS}/v2-datasource-polling-form.png` });
await page.keyboard.press("Escape");

// ---- V3 连接页 ----
await page.goto(`${BASE}/settings/connections`, { waitUntil: "networkidle2", timeout: 30000 });
await new Promise((r) => setTimeout(r, 1800));
out.v3 = await page.evaluate(() => {
  const text = document.body.innerText;
  const search = document.querySelector("input[aria-label='搜索 Connection']");
  const tabs = [...document.querySelectorAll("button")].filter((b) => /^\S+ \(\d+\)$/.test(b.textContent.trim()));
  const actionBtn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "编辑");
  return {
    searchAria: !!search,
    protoTabs: tabs.map((b) => b.textContent.trim()).slice(0, 6),
    actionFocusVisible: actionBtn ? actionBtn.className.includes("focus-visible:opacity-100") : null,
    noHardcodedBlack: !document.body.innerHTML.includes("bg-black"),
    hasCards: text.includes("凭据") || text.includes("连接"),
    untestedMark: text.includes("待验证") || text.includes("未测试"),
  };
});
await page.screenshot({ path: `${SHOTS}/v3-connections.png` });

// ---- V4 壳常驻（Suspense 下沉）----
await page.goto(`${BASE}/tasks`, { waitUntil: "networkidle2", timeout: 30000 });
await new Promise((r) => setTimeout(r, 800));
// 点击导航去一个未加载过的懒路由，150ms 内检查侧栏是否仍在
await page.evaluate(() => {
  const a = [...document.querySelectorAll("nav a")].find((x) => x.getAttribute("href") === "/workflows");
  a?.click();
});
await new Promise((r) => setTimeout(r, 150));
out.v4 = await page.evaluate(() => ({
  navStillThere: !!document.querySelector("nav"),
  url: location.pathname,
}));
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: `${SHOTS}/v4-shell-persists.png` });

out.jsErrors = errors;
console.log(JSON.stringify(out, null, 1));
await browser.close();
const fail = out.v1.kpiAllZero || out.v1.hasShouchao || !out.v2.hasUrl ||
  !out.v2.mappingLabelOk || !out.v3.searchAria || !out.v4.navStillThere ||
  errors.length > 0;
process.exit(fail ? 1 : 0);
