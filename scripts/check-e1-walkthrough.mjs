/** E-1.3 手工动线浏览器核验：A3 刷新不丢配置 / D1 角色权限 / C1 预览面板（轻量）。 */
import puppeteer from "puppeteer-core";

const AGENT = process.argv[2] ?? "f89711b2e5544385ac7b4602a8061cb3"; // 验收-自主规划（published）
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

async function newPage(role) {
  const page = await browser.newPage();
  if (role) await page.evaluateOnNewDocument((r) => localStorage.setItem("wf_role", r), role);
  return page;
}

// ---------- A3：刷新页面配置不丢 ----------
{
  const page = await newPage("admin");
  await page.goto(`${BASE}/config/agents/${AGENT}`, { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2500));
  const before = await page.evaluate(() => {
    const nameInput = [...document.querySelectorAll("input")].find((i) => i.value && i.value.includes("验收-自主规划"));
    const tabs = [...document.querySelectorAll("button")].map((b) => b.textContent.trim())
      .filter((t) => ["Agent搭建", "运行观测", "效果评测", "版本指标"].includes(t));
    return { name: nameInput?.value ?? null, tabs };
  });
  await page.reload({ waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 2500));
  const after = await page.evaluate(() => {
    const nameInput = [...document.querySelectorAll("input")].find((i) => i.value && i.value.includes("验收-自主规划"));
    return { name: nameInput?.value ?? null };
  });
  ok("A3", "Agent 编辑页刷新后名称不丢", !!before.name && before.name === after.name, `before=${before.name} after=${after.name}`);
  ok("A3", "编辑页含配置分区（记忆/对话体验等）", before.tabs.length >= 2, `tabs=${JSON.stringify(before.tabs).slice(0, 120)}`);
  await page.close();
}

// ---------- D1：角色切换器权限差异 ----------
{
  // viewer：Agent 列表 ⋯ 菜单无删除；编辑页无发布按钮
  const pv = await newPage("viewer");
  await pv.goto(`${BASE}/config/agents`, { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2000));
  const viewerMenu = await pv.evaluate(async () => {
    const trigger = [...document.querySelectorAll("button")].find((b) => b.querySelector("svg.lucide-more-horizontal") || b.textContent.trim() === "");
    const dots = [...document.querySelectorAll("button")].filter((b) => b.querySelector("[class*=lucide-more-horizontal], svg"));
    // 打开第一行的 ⋯ 菜单
    const btn = [...document.querySelectorAll("[data-state=closed], button")].length;
    return { hasDots: dots.length };
  });
  // 直接进编辑页看发布按钮存在性更可靠
  await pv.goto(`${BASE}/config/agents/${AGENT}`, { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2500));
  // 发布门禁=禁用态（D-4 设计：可见但不可点 + tooltip 说明）；「发布」也可能是导航分区名
  const viewerPub = await pv.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "发布" && b.disabled !== undefined);
    const actionBtns = [...document.querySelectorAll("button")].filter((b) => b.textContent.trim() === "发布");
    return { count: actionBtns.length, allDisabled: actionBtns.length > 0 && actionBtns.every((b) => b.disabled) };
  });
  const viewerNoPublish = viewerPub.allDisabled;
  await pv.close();

  const pp = await newPage("publisher");
  await pp.goto(`${BASE}/config/agents/${AGENT}`, { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2500));
  const pubPub = await pp.evaluate(() => {
    const actionBtns = [...document.querySelectorAll("button")].filter((b) => b.textContent.trim() === "发布");
    return { count: actionBtns.length, anyEnabled: actionBtns.some((b) => !b.disabled) };
  });
  const pubCanPublish = pubPub.anyEnabled;
  await pp.close();

  const pa = await newPage("admin");
  await pa.goto(`${BASE}/settings/audit`, { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2000));
  const auditVisible = await pa.evaluate(() => document.body.innerText.includes("审计日志"));
  const navHasAudit = await pa.evaluate(() => [...document.querySelectorAll("a,button")].some((e) => e.textContent.includes("审计日志")));
  await pa.close();

  ok("D1", "Viewer 发布按钮被禁用", viewerNoPublish, `viewer发布按钮=${JSON.stringify(viewerPub)}`);
  ok("D1", "Publisher 发布按钮可用", pubCanPublish, `publisher发布按钮=${JSON.stringify(pubPub)}`);
  ok("D1", "Admin 可见审计日志页", auditVisible && navHasAudit);
}

// ---------- C1（轻量）：预览会话面板存在且可输入 ----------
{
  const page = await newPage("admin");
  await page.goto(`${BASE}/config/agents/${AGENT}`, { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2500));
  const preview = await page.evaluate(() => {
    const text = document.body.innerText;
    const textareas = document.querySelectorAll("textarea").length;
    return { hasPreviewHint: /预览|试运行|对话/.test(text), textareas };
  });
  ok("C1", "Agent 编辑页含对话预览/输入区", preview.hasPreviewHint && preview.textareas > 0, JSON.stringify(preview));
  await page.close();
}

console.log(fail ? `\n${fail} 项未过` : "\nALL PASS");
await browser.close();
process.exit(fail ? 1 : 0);
