/** P0 节点总纲验证（06-workflow-node-master-spec §2）：
 *  x-control 映射 / # 唤起铺全 / 校验呈现三处 / 节点描述图标。
 *  无头 Chrome 直启（不碰用户 Chrome）；临时工作流走 API 创建。 */
import puppeteer from "puppeteer-core";
import { writeFileSync } from "node:fs";

const API = "http://localhost:5173";
const BACK = "http://localhost:8100";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1 临时工作流
const wf = await (await fetch(`${BACK}/api/workflows`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: "P0-节点总纲验证（临时）" }),
})).json();
const wid = wf.id;
console.log("scratch-workflow", wid);

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--window-size=1440,1000"],
  defaultViewport: { width: 1440, height: 1000 },
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });

await page.goto(`${API}/config/workflows/${wid}`, { waitUntil: "networkidle2", timeout: 30000 });
await sleep(3000);

const clickText = (text, exact = true) => page.evaluate((t, ex) => {
  const vis = (e) => e.offsetParent !== null;
  for (const sel of ["button", "span", "div"]) {
    for (const e of [...document.querySelectorAll(sel)].filter(vis)) {
      const s = (e.innerText || "").trim();
      if (ex ? s === t : s.endsWith(t)) { e.click(); return true; }
    }
  }
  return false;
}, text, exact);

// 2 加三个通用表单节点
for (const label of ["变量处理", "对话回复", "工作流选择"]) {
  await clickText("添加节点"); await sleep(700);
  const ok = await page.evaluate((t) => {
    const e = [...document.querySelectorAll("button")].find((b) => b.offsetParent && (b.innerText || "").trim().endsWith(t));
    if (e) { e.click(); return true; } return false;
  }, label);
  console.log("palette-add", label, ok);
  await sleep(900);
  await page.keyboard.press("Escape"); await sleep(300);
}
console.log("nodes", await page.evaluate(() => document.querySelectorAll(".react-flow__node").length));

// 3 校验呈现：顶栏红点 + 节点卡红点
const topBadge = await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => x.offsetParent && (x.innerText || "").includes("检查"));
  return b ? b.innerText.replace(/\s+/g, "") : null;
});
console.log("topbar-check-badge", topBadge);
const cardBadge = await page.evaluate(() => {
  for (const n of document.querySelectorAll(".react-flow__node")) {
    const badge = [...n.querySelectorAll("span")].find((s) => (s.title || "").length > 0 && s.className.includes("rounded-full"));
    if (badge) return { node: (n.innerText || "").split("\n")[0], count: badge.innerText, title: badge.title };
  }
  return null;
});
console.log("node-card-badge", JSON.stringify(cardBadge));

// 4 逐节点抽屉检查
const openNode = async (namePart) => {
  await page.evaluate((t) => {
    const n = [...document.querySelectorAll(".react-flow__node")].find((x) => (x.innerText || "").includes(t));
    if (n) n.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }, namePart);
  await sleep(900);
};
const drawerText = () => page.evaluate(() => {
  const d = [...document.querySelectorAll("div")].find((x) => x.className.includes("absolute") && x.className.includes("right-0") && x.className.includes("w-[360px]"));
  return d ? d.innerText : "";
});

await openNode("变量处理");
let t = await drawerText();
console.log("transform-desc", t.includes("声明式模板"));
console.log("transform-#hint", t.includes("唤起变量选择器"));
console.log("transform-issues-box", t.includes("未完整配置") || t.includes("未连接"));

// # 唤起级联
const typed = await page.evaluate(() => {
  const ta = [...document.querySelectorAll("textarea")].find((x) => x.offsetParent && (x.placeholder || "").includes("请输入"));
  if (!ta) return false;
  ta.focus(); return true;
});
if (typed) { await page.keyboard.type("#"); await sleep(600); }
t = await drawerText();
console.log("transform-#-cascader", t.includes("系统变量"));
await page.keyboard.press("Escape"); await sleep(300);

await openNode("对话回复");
t = await drawerText();
console.log("reply-desc", t.includes("对话回复节点把内容写入对话流"));
console.log("reply-label", t.includes("回复内容"));
console.log("reply-#hint", t.includes("唤起变量选择器"));

await openNode("工作流选择");
t = await drawerText();
console.log("wfselect-multi-label", t.includes("候选工作流（多选）"));
console.log("wfselect-list", t.includes("暂无工作流") || t.includes("P0-节点总纲验证"));

await page.screenshot({ path: "/tmp/p0-nodespec.png" });

// ---- 第二段：FLOW 画布（对话型 Agent）覆盖 reply / workflow-select ----
const ag = await (await fetch(`${BACK}/api/agents`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: "P0验证对话型", type: "dialogue" }),
})).json();
console.log("scratch-agent", ag.id);
await page.goto(`${API}/config/agents/${ag.id}`, { waitUntil: "networkidle2", timeout: 30000 });
await sleep(3000);
for (const label of ["对话回复", "工作流选择"]) {
  await clickText("添加节点"); await sleep(700);
  const ok = await page.evaluate((t) => {
    const e = [...document.querySelectorAll("button")].find((b) => b.offsetParent && (b.innerText || "").trim().endsWith(t));
    if (e) { e.click(); return true; } return false;
  }, label);
  console.log("flow-palette-add", label, ok);
  await sleep(900);
  await page.keyboard.press("Escape"); await sleep(300);
}
await openNode("对话回复");
let t2 = await drawerText();
console.log("reply-desc", t2.includes("对话回复节点把内容写入对话流"));
console.log("reply-label", t2.includes("回复内容"));
console.log("reply-#hint", t2.includes("唤起变量选择器"));
await openNode("工作流选择");
t2 = await drawerText();
console.log("wfselect-multi-label", t2.includes("候选工作流（多选）"));
console.log("wfselect-list", t2.includes("P0-节点总纲验证") || t2.includes("暂无工作流"));
await page.screenshot({ path: "/tmp/p0-flow.png" });

console.log("console-errors", errors.slice(0, 5));
await browser.close();
console.log("DONE");
