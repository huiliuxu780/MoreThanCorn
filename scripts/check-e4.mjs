/** E-4 浏览器验收：预览消息操作（复制/👍/👎）、Prompt # mention、节点单测入口。 */
import puppeteer from "puppeteer-core";

const AGENT = "f89711b2e5544385ac7b4602a8061cb3";   // 自主规划（预览面板）
const DIALOGUE = "1acbe9f81c2546f7a9d3068a761d707f"; // 画布（节点单测）
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

// ---------- E-4.1：预览发消息后，AI 回答下有 复制/👍/👎 ----------
{
  const page = await newPage();
  await page.goto(`${BASE}/config/agents/${AGENT}`, { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2500));
  // 输入并发送（mock LLM 秒回）
  await page.type('input[placeholder="说出你的问题吧"]', "介绍一下你自己");
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.includes(""));
    // 发送按钮带 Send 图标，按最后一个主色按钮
    [...document.querySelectorAll("button")].filter((b) => b.style.background).slice(-1)[0]?.click();
  });
  await new Promise((r) => setTimeout(r, 4000));
  const actions = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")].map((b) => b.textContent.trim());
    return { copy: btns.includes("复制"), up: btns.includes("👍"), down: btns.includes("👎") };
  });
  ok("E-4.1", "AI 回答下出现 复制/👍/👎", actions.copy && actions.up && actions.down, JSON.stringify(actions));
  // 点赞可点且持久化
  await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "👍")?.click(); });
  await new Promise((r) => setTimeout(r, 800));
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem("wf-preview-feedback") ?? "{}"));
  ok("E-4.1", "点赞持久化到本地反馈", Object.values(persisted).includes("up"), JSON.stringify(persisted));
  await page.close();
}

// ---------- E-4.2：rolePrompt 输入 # 唤起资源选择器 ----------
{
  const page = await newPage();
  await page.goto(`${BASE}/config/agents/${AGENT}`, { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2500));
  const ta = await page.$('textarea[placeholder*="#"]');
  ok("E-4.2", "角色提示词输入框存在（含 # 引导）", !!ta);
  if (ta) {
    await ta.click();
    await page.keyboard.type("#");
    await new Promise((r) => setTimeout(r, 600));
    const picker = await page.evaluate(() => {
      const box = [...document.querySelectorAll("div")].find((d) => d.textContent.includes("暂无已挂载资源") || [...d.children].some((c) => c.tagName === "BUTTON" && c.textContent.includes("技能")));
      return !!box;
    });
    ok("E-4.2", "输入 # 唤起资源选择浮层", picker);
  }
  await page.close();
}

// ---------- E-4.3：画布节点 ⋯「单测此节点」→ 对话框 → 真执行 ----------
{
  const page = await newPage();
  await page.goto(`${BASE}/config/agents/${DIALOGUE}`, { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 3500));
  // 点击第一个节点卡片使其选中
  const node = await page.$(".react-flow__node");
  if (node) await node.click();
  await new Promise((r) => setTimeout(r, 600));
  // 打开 ⋯ 菜单
  const more = await page.evaluateHandle(() =>
    [...document.querySelectorAll(".react-flow__node button")].find((b) => b.title === "更多"));
  if (more.asElement()) {
    const box = await more.asElement().boundingBox();
    if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  }
  await new Promise((r) => setTimeout(r, 600));
  const hasItem = await page.evaluate(() =>
    [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "单测此节点"));
  ok("E-4.3", "节点 ⋯ 菜单含「单测此节点」", hasItem);
  if (hasItem) {
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "单测此节点")?.click(); });
    await new Promise((r) => setTimeout(r, 800));
    const dlgVisible = await page.evaluate(() => document.body.innerText.includes("单测节点"));
    // 执行（默认输入 {}）
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "执行单测")?.click(); });
    await new Promise((r) => setTimeout(r, 2500));
    const result = await page.evaluate(() => ({
      okMark: document.body.innerText.includes("✓ 输出") || document.body.innerText.includes("✗"),
    }));
    ok("E-4.3", "单测对话框可打开并执行出结果", dlgVisible && result.okMark, JSON.stringify(result));
  }
  await page.close();
}

console.log(fail ? `\n${fail} 项未过` : "\nALL PASS");
await browser.close();
process.exit(fail ? 1 : 0);
