/** E-2 浏览器验收：复制/归档（列表⋯菜单）、灰度徽标+停止、版本对比弹窗、编辑锁徽标。 */
import puppeteer from "puppeteer-core";

const AGENT = "f89711b2e5544385ac7b4602a8061cb3"; // 已有 50% 灰度发布
const DIALOGUE = "1acbe9f81c2546f7a9d3068a761d707f"; // 画布型，历史抽屉
const BASE = "http://localhost:5173";

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--window-size=1440,1000"],
  defaultViewport: { width: 1440, height: 1000 },
});
let fail = 0;
const ok = (id, name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${id}  ${name}${extra ? "  " + extra : ""}`);
  if (!cond) fail++;
};
async function newPage() {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => localStorage.setItem("wf_role", "admin"));
  return page;
}

// ---------- E-2.1：列表 ⋯ 菜单含复制/归档，复制生效 ----------
{
  const page = await newPage();
  await page.goto(`${BASE}/config/agents`, { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2500));
  // 找第一张卡片的 ⋯ 按钮并用真实点击打开（Radix 需要 pointer 事件）
  const btn = await page.evaluateHandle(() =>
    [...document.querySelectorAll("button")].find((b) => b.querySelector("svg.lucide-ellipsis, svg.lucide-more-horizontal")));
  const opened = !!btn.asElement();
  if (opened) {
    const box = await btn.asElement().boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  }
  await new Promise((r) => setTimeout(r, 800));
  const menuItems = await page.evaluate(() =>
    [...document.querySelectorAll("[role=menuitem]")].map((m) => m.textContent.trim()));
  ok("E-2.1", "列表 ⋯ 菜单含 复制/归档/删除", opened && ["复制", "归档"].every((t) => menuItems.includes(t)) && menuItems.includes("删除"),
    JSON.stringify(menuItems));
  await page.keyboard.press("Escape");
  // 归档筛选器在场
  const hasArchivedFilter = await page.evaluate(() =>
    [...document.querySelectorAll("button[role=combobox]")].some((b) => b.textContent.includes("使用中")));
  ok("E-2.1", "归档筛选器在场（使用中/已归档）", hasArchivedFilter);
  await page.close();
}

// ---------- E-2.3：自主规划头部灰度徽标；E-2.4：编辑锁徽标 ----------
{
  // 清理前序用例残留租约（10 分钟未过期会被判为"他人占用"——互斥本身是对的）
  await fetch(`http://localhost:8100/api/locks/agent:${AGENT}/force`, { method: "DELETE" }).catch(() => undefined);
  const page = await newPage();
  await page.goto(`${BASE}/config/agents/${AGENT}`, { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 3000));
  const header = await page.evaluate(() => document.body.innerText.slice(0, 600));
  ok("E-2.3", "头部显示「灰度 50%」徽标", /灰度 50%/.test(header));
  ok("E-2.4", "头部显示编辑锁状态", /编辑锁持有/.test(header));
  await page.close();
}

// ---------- E-2.2：发布对话框「对比变更」弹出行级 diff；灰度输入在场 ----------
{
  const page = await newPage();
  await page.goto(`${BASE}/config/agents/${AGENT}`, { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2500));
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "发布");
    btn?.click();
  });
  await new Promise((r) => setTimeout(r, 1200));
  const dlg = await page.evaluate(() => document.body.innerText);
  ok("E-2.2", "发布对话框含「对比变更」入口", dlg.includes("对比变更"));
  // 打开对比弹窗（当前草稿 vs 最新版本）
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "对比变更");
    btn?.click();
  });
  await new Promise((r) => setTimeout(r, 2500));
  const diffInfo = await page.evaluate(() => ({
    hasTitle: document.body.innerText.includes("版本对比"),
    hasSelectors: [...document.querySelectorAll("button[role=combobox]")].some((b) => b.textContent.includes("当前草稿")),
    diffLines: document.querySelectorAll(".bg-emerald-50, .bg-red-50").length,
  }));
  ok("E-2.2", "版本对比弹窗：草稿/版本选择器 + 行级增删渲染",
    diffInfo.hasTitle && diffInfo.hasSelectors && diffInfo.diffLines > 0, JSON.stringify(diffInfo));
  await page.keyboard.press("Escape");
  await new Promise((r) => setTimeout(r, 600));
  // 生成版本 → 部署步骤应有灰度输入
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("生成版本"));
    btn?.click();
  });
  await new Promise((r) => setTimeout(r, 3000));
  const deploy = await page.evaluate(() => ({
    text: document.body.innerText,
    canaryInput: !!([...document.querySelectorAll("input[type=number]")].find((i) => i.min === "0" && i.max === "100")),
  }));
  ok("E-2.3", "部署步骤含灰度比例输入（0=全量）", deploy.canaryInput && deploy.text.includes("灰度比例"),
    `含灰度输入=${deploy.canaryInput}`);
  await page.close();
}

// ---------- E-2.2：画布历史抽屉「对比」入口 ----------
{
  const page = await newPage();
  await page.goto(`${BASE}/config/agents/${DIALOGUE}`, { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 3500));
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.title === "历史版本");
    btn?.click();
  });
  await new Promise((r) => setTimeout(r, 1200));
  const drawer = await page.evaluate(() => ({
    hasTitle: document.body.innerText.includes("历史版本"),
    compareBtns: [...document.querySelectorAll("button")].filter((b) => b.textContent.trim() === "对比").length,
  }));
  ok("E-2.2", "画布历史抽屉含「对比」入口", drawer.hasTitle && drawer.compareBtns > 0, JSON.stringify(drawer));
  await page.close();
}

console.log(fail ? `\n${fail} 项未过` : "\nALL PASS");
await browser.close();
process.exit(fail ? 1 : 0);
