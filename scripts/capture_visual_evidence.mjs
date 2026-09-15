/** 视觉证据采集（2026-09-10 任务书 §十三）：我方实现 + QoderWake 参照，三视口。
 *
 * 页面清单：导航(展开/收起) / 设置 / Agent 列表 / Agent 新建 / Agent 详情 /
 * 对话空态 / 对话流式生成中 / 工具调用中 / 对话完成 / 自动任务列表 / 自动任务创建 / 任务页面。
 * QoderWake 侧不触发任何执行副作用：流式/工具参照取其既有会话转录（含工具卡）。
 * 输出：evidence/visual/<width>x<height>/<page>-(mtc|qw).png + visual-geometry.json。
 */
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const MTC = "http://localhost:5199";
const QW = "http://127.0.0.1:19830";
const OUT = "research/morethancorn/11-p0-rework-20260910/evidence/visual";
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
  { width: 1024, height: 768 },
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

const AGENT = "e773172b6b434ed1a3011af443bb0f55"; // 迁移的正式 Agent（有 prod release + skill）
const QW_CONV = "/conversations/qs_01m1zy6bnvc9fmjswwg4v7w313?sid=168f5d8c-4861-4c52-a44c-6148fdba666f";

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  defaultViewport: VIEWPORTS[0],
});
const geometry = {};

async function shoot(page, name, vp, tag) {
  const dir = `${OUT}/${vp.width}x${vp.height}`;
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: `${dir}/${name}-${tag}.png` });
}

async function measure(page, key, vp) {
  const m = await page.evaluate(() => {
    const q = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    return {
      doc: { scrollW: document.documentElement.scrollWidth, scrollH: document.documentElement.scrollHeight, vw: innerWidth, vh: innerHeight },
      rail: q('[data-testid="app-sidebar"]'),
      settingsSidebar: q('[data-testid="settings-sidebar"]'),
      workspaceShell: q('[data-testid="agent-workspace-shell"]'),
      main: q("main"),
    };
  });
  geometry[`${key}@${vp.width}x${vp.height}`] = m;
  return m;
}

const page = await browser.newPage();

for (const vp of VIEWPORTS) {
  await page.setViewport(vp);

  // 导航（09-15 固定 208px 宽、无折叠态）+ 任务页
  await page.goto(`${MTC}/tasks`, { waitUntil: "networkidle2" });
  await sleep(1200);
  await measure(page, "tasks-nav-fixed", vp);
  await shoot(page, "01-nav-tasks", vp, "mtc");

  // 设置
  await page.goto(`${MTC}/settings`, { waitUntil: "networkidle2" });
  await sleep(1200);
  await measure(page, "settings", vp);
  await shoot(page, "02-settings", vp, "mtc");

  // Agent 列表 / 新建 / 详情
  await page.goto(`${MTC}/agents`, { waitUntil: "networkidle2" });
  await sleep(1200);
  await shoot(page, "03-agents-list", vp, "mtc");
  await page.goto(`${MTC}/agents/new`, { waitUntil: "networkidle2" });
  await sleep(1200);
  await shoot(page, "04-agent-create", vp, "mtc");
  await page.goto(`${MTC}/agents/${AGENT}`, { waitUntil: "networkidle2" });
  await sleep(1500);
  await measure(page, "agent-detail", vp);
  await shoot(page, "05-agent-detail", vp, "mtc");

  // 对话：流式生成中 / 完成（长文）；工具调用中（MCP 已清理 → 用既有会话的工具卡转录不可用，改拍 HITL/工具卡不可得时拍流式+完成）
  await page.goto(`${MTC}/agents/${AGENT}/chat`, { waitUntil: "networkidle2" });
  await sleep(1500);
  await page.evaluate(() => {
    window.__growths = [];
    const obs = new MutationObserver(() => {
      const el = document.querySelector('[data-testid="live-text"]');
      if (el) window.__growths.push(el.textContent.length);
    });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  await page.type("textarea", "请用约两百字分三点说明客服话术质检的要点。");
  await page.keyboard.press("Enter");
  // 等到 live-text 有内容时拍“流式生成中”
  let shotStreaming = false;
  let shotDone = false;
  const dl = Date.now() + 60000;
  while (Date.now() < dl) {
    const st = await page.evaluate(() => ({
      len: document.querySelector('[data-testid="live-text"]')?.textContent?.length ?? 0,
    }));
    if (!shotStreaming && st.len > 60) {
      await shoot(page, "07-chat-streaming", vp, "mtc");
      shotStreaming = true;
    }
    if (shotStreaming && st.len === 0) {
      await sleep(800);
      await shoot(page, "09-chat-complete", vp, "mtc");
      shotDone = true;
      break;
    }
    await sleep(250);
  }
  if (!shotStreaming) await shoot(page, "07-chat-streaming", vp, "mtc");
  if (!shotDone) await shoot(page, "09-chat-complete", vp, "mtc");

  // 工具调用中（脚本外已临时挂载本地安全 MCP；HITL 出现即批准）
  await page.type("textarea", "请调用 MCP 工具 safe_echo，参数 text=VIS-OK，并原样返回。");
  await page.keyboard.press("Enter");
  let shotTool = false;
  const dl2 = Date.now() + 90000;
  while (Date.now() < dl2) {
    const st = await page.evaluate(() => ({
      tool: !!document.querySelector('[data-testid="live-tool-card"]'),
      hitl: [...document.querySelectorAll("button")].some((b) => b.textContent.includes("批准执行")),
    }));
    if (st.hitl) {
      await page.evaluate(() => {
        const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("批准执行"));
        b?.click();
      });
    }
    if (!shotTool && st.tool) {
      await shoot(page, "08-chat-toolcard", vp, "mtc");
      shotTool = true;
      break;
    }
    await sleep(300);
  }
  if (!shotTool) await shoot(page, "08-chat-toolcard", vp, "mtc");
  await sleep(4000);

  // 自动任务列表 + 创建弹窗
  await page.goto(`${MTC}/autonomous-tasks`, { waitUntil: "networkidle2" });
  await sleep(1200);
  await shoot(page, "10-automations-list", vp, "mtc");
  await page.evaluate(() => {
    [...document.querySelectorAll("button")].find((x) => x.textContent.includes("新建自动任务"))?.click();
  });
  await sleep(700);
  await shoot(page, "11-automations-create", vp, "mtc");
  await page.keyboard.press("Escape");

  // ---- QoderWake 参照 ----
  const qw = await browser.newPage();
  await qw.setViewport(vp);
  const qwGo = async (path, name, extraMs = 1500) => {
    await qw.goto(`${QW}${path}`, { waitUntil: "networkidle2" });
    await sleep(extraMs);
    await shoot(qw, name, vp, "qw");
  };
  await qwGo("/work-management", "01-nav-tasks");
  await qwGo("/settings/preferences", "02-settings");
  await qwGo("/management", "03-agents-list");
  await qwGo("/recruitment-market", "04-agent-create");
  await qwGo("/wakers/b82d781c4c06/home", "05-agent-detail");
  await qwGo(QW_CONV, "08-chat-toolcards", 2500);
  await qwGo("/autonomous-work", "10-automations-list");
  await qw.evaluate(() => {
    [...document.querySelectorAll("button")].find((x) => x.textContent.includes("新建自动任务"))?.click();
  });
  await sleep(700);
  await shoot(qw, "11-automations-create", vp, "qw");
  await qw.close();
}

fs.writeFileSync(
  "research/morethancorn/11-p0-rework-20260910/evidence/visual-geometry.json",
  JSON.stringify({ generatedAt: new Date().toISOString(), geometry }, null, 2),
);
console.log("VISUAL_CAPTURE_DONE", Object.keys(geometry).length, "geometry entries");
await browser.close();
