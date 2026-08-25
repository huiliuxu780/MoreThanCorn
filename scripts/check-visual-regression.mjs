/** 07-SDD §9.2/§9.3/V2/V3：视觉基线回归 + 设计令牌 DOM 断言。
 *  用法：node scripts/check-visual-regression.mjs [--update-baseline]
 *  依赖 dev server(5173) + backend(8100) 运行中。 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import puppeteer from "puppeteer-core";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

const ROOT = new URL("..", import.meta.url).pathname;
const BASE_DIR = join(ROOT, "scripts/visual-baseline");
const update = process.argv.includes("--update-baseline");
const API = "http://localhost:8100";
const APP = "http://localhost:5173";
const MAX_DIFF = 0.005; // 单屏差异率上限 0.5%
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(BASE_DIR)) mkdirSync(BASE_DIR, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new", args: ["--window-size=1440,1000"], defaultViewport: { width: 1440, height: 1000 },
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 150)));

// 建确定性工作流
const wid = (await (await fetch(`${API}/api/workflows`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "VIS-REG" }) })).json()).id;
await page.goto(`${APP}/config/workflows/${wid}`, { waitUntil: "networkidle2" });
await sleep(2500);

const clickText = async (t) => page.evaluate((txt) => {
  const vis = (e) => e.offsetParent !== null;
  for (const sel of ["button", "span", "div"]) {
    for (const e of [...document.querySelectorAll(sel)].filter(vis)) {
      if ((e.innerText || "").trim() === txt) { e.click(); return true; }
    }
  }
  return false;
}, t);
const addNode = async (label) => {
  await clickText("添加节点"); await sleep(500);
  await page.evaluate((t) => {
    const e = [...document.querySelectorAll("button")].find((b) => b.offsetParent && (b.innerText || "").trim().endsWith(t));
    if (e) e.click();
  }, label);
  await sleep(700);
  await page.keyboard.press("Escape"); await sleep(300);
};
const openNode = async (label) => {
  await page.evaluate((t) => {
    const n = [...document.querySelectorAll(".react-flow__node")].find((x) => (x.innerText || "").includes(t));
    if (n) n.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }, label);
  await sleep(700);
};

await addNode("大模型"); await addNode("循环迭代"); await addNode("等待/人审");

const shots = [
  ["canvas", async () => { await page.keyboard.press("Escape"); await sleep(300); }],
  ["drawer-llm", async () => { await openNode("大模型"); }],
  ["drawer-loop", async () => { await openNode("循环"); }],
  ["drawer-wait", async () => { await openNode("人审"); }],
];

// §9.3 令牌断言
const tokens = await page.evaluate(() => {
  const out = {};
  const node = document.querySelector(".react-flow__node");
  if (node) {
    const card = node.querySelector('[class*="w-[300px]"]') ?? node.querySelector("div") ?? node; // 取卡片本体
    const cs = getComputedStyle(card);
    out.nodeWidth = cs.width; out.nodeRadius = cs.borderRadius;
  }
  let el = document.querySelector(".react-flow");
  let bg = "rgba(0, 0, 0, 0)";
  while (el && (bg === "rgba(0, 0, 0, 0)" || bg === "transparent")) {
    bg = getComputedStyle(el).backgroundColor;
    el = el.parentElement;
  }
  if (bg !== "rgba(0, 0, 0, 0)") out.canvasBg = bg;
  const drawer = [...document.querySelectorAll("div")].find((d) => d.className.includes?.("w-[360px]"));
  if (drawer) out.drawerWidth = getComputedStyle(drawer).width;
  return out;
});
const tokenFails = [];
if (tokens.nodeWidth && tokens.nodeWidth !== "300px") tokenFails.push(`节点卡宽 ${tokens.nodeWidth} ≠ 300px`);
if (tokens.nodeRadius && tokens.nodeRadius !== "8px") tokenFails.push(`节点卡圆角 ${tokens.nodeRadius} ≠ 8px`);
if (tokens.canvasBg && tokens.canvasBg !== "rgb(238, 241, 246)") tokenFails.push(`画布底 ${tokens.canvasBg} ≠ #EEF1F6`);
if (tokens.drawerWidth && tokens.drawerWidth !== "360px") tokenFails.push(`抽屉宽 ${tokens.drawerWidth} ≠ 360px`);

let failed = false;
for (const [name, prep] of shots) {
  await prep();
  const buf = await page.screenshot();
  const fp = join(BASE_DIR, `${name}.png`);
  if (update || !existsSync(fp)) { writeFileSync(fp, buf); console.log("baseline:", name); continue; }
  const a = PNG.sync.read(readFileSync(fp));
  const b = PNG.sync.read(buf);
  if (a.width !== b.width || a.height !== b.height) {
    console.error(`DIFF ${name}: 尺寸变化 ${a.width}x${a.height} → ${b.width}x${b.height}`); failed = true; continue;
  }
  const diff = new PNG({ width: a.width, height: a.height });
  const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
  const ratio = n / (a.width * a.height);
  if (ratio > MAX_DIFF) {
    writeFileSync(`/tmp/vr-diff-${name}.png`, PNG.sync.write(diff));
    console.error(`DIFF ${name}: ${(ratio * 100).toFixed(2)}% > 0.5%（热图 /tmp/vr-diff-${name}.png）`);
    failed = true;
  } else console.log(`OK ${name}: ${(ratio * 100).toFixed(3)}%`);
}

if (tokenFails.length) { failed = true; tokenFails.forEach((t) => console.error("TOKEN:", t)); }
else console.log("TOKENS OK:", JSON.stringify(tokens));
if (errors.length) { failed = true; console.error("console errors:", errors.slice(0, 3)); }

await browser.close();
process.exit(failed ? 1 : 0);
