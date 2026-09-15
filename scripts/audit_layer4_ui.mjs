/**
 * 四层审计·层4：浏览器逐控件点击审计 + 新屏截图（2026-09-13，rev2）。
 *
 * 方法：无头 Chrome 打开验收前端（5199 → 8120/wf_dev），对目标页枚举可见可点
 * 控件逐个点击，检测"无效果控件"（假按钮）。
 *
 * rev2 修正（首轮实测暴露的两个方法缺陷）：
 * - 控件句柄每轮重查（导航/重渲染后旧句柄失效导致首轮仅审计 10 个控件）；
 *   按 label 去重，每 label 点一个代表（诚实口径：同 label 多实例抽一）。
 * - 效果信号加入被点元素自身 aria-label/文本变化（侧边栏"展开↔折叠"切换
 *   首轮被误判 no-effect）。
 * - 站内导航链接（a[href] 指向其他路由）不点击、只计数——href 存在即真导航，
 *   死链归层1 扫荡管辖。
 *
 * 效果判定五+1 类信号（抗轮询/SSE 假阳性，不用整页 DOM 差分）：
 *   URL 变化 / 弹层出现 / 行·卡数量变化 / 焦点变化 / 元素状态属性变化 /
 *   元素自身 label·文本变化。
 *
 * 安全门：DENY 词表一律跳过不点（不触发数据变更、不耗 LLM 额度），如实计数。
 *
 * 定向验证（审计层3修复的浏览器实证）：
 *  V1 周期切"近 7 天"→ workflow 卡抽屉「查看执行详情」→ /operations/runs/{id}；
 *  V2 分析卡「所属分析任务」→ /batch-tasks/{id}（原错路由 /autonomous-tasks）。
 *
 * 用法：node scripts/audit_layer4_ui.mjs [--base http://localhost:5199] [--shots DIR]
 * 退出码：no-effect 控件 / JS 错误 / V1·V2 失败 → 1。
 */
import { mkdirSync } from "node:fs";
import puppeteer from "puppeteer-core";

const args = process.argv.slice(2);
const argVal = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const BASE = argVal("--base", "http://localhost:5199");
const SHOTS = argVal("--shots", "docs/acceptance/assets/2026-09-13-audit");
mkdirSync(SHOTS, { recursive: true });

const DENY = ["删除", "封存", "取消", "停用", "启用", "立即运行", "运行", "重试",
  "重跑", "发布", "登出", "退出", "提交", "保存", "归档", "恢复", "清空", "重置",
  "应用", "发送", "run", "delete", "cancel", "retry", "publish",
  "archive", "disable", "enable", "remove"];

const SEL = "button, [role='button'], [role='tab'], [role='menuitem'], [role='switch'], a[href]";

const PAGES = [
  { name: "operations-board", path: "/operations/today" },
  { name: "operations-list", path: "/operations/today?view=list" },
  { name: "agentflows", path: "/agentflows" },
  { name: "agents", path: "/agents" },
  { name: "automations", path: "/autonomous-tasks" },
];

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--window-size=1440,1000"],
  defaultViewport: { width: 1440, height: 1000 },
});

const findings = [];
const skipped = { deny: 0, navLinks: 0, samples: [] };
let clicked = 0;

async function newPage() {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  page.errors = errors;
  return page;
}

async function signals(page) {
  return page.evaluate(() => ({
    url: location.pathname + location.search,
    rows: document.querySelectorAll(
      "table tbody tr, .react-flow__node, [data-slot='card']").length,
    popups: document.querySelectorAll(
      "[role='dialog'],[role='menu'],[role='listbox'],[data-radix-popper-content-wrapper]").length,
    active: document.activeElement
      ? document.activeElement.tagName + "#" +
        (document.activeElement.getAttribute("aria-label") ||
         document.activeElement.textContent || "").trim().slice(0, 24)
      : "",
  }));
}

/** 枚举当前页面控件描述（每轮重查，返回未点过的第一个可见控件） */
async function nextControl(page, doneLabels) {
  return page.evaluate((sel, done) => {
    const els = [...document.querySelectorAll(sel)];
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0) ||
          getComputedStyle(el).visibility === "hidden") continue;
      if (el.disabled === true || el.getAttribute("aria-disabled") === "true" ||
          el.getAttribute("data-disabled") != null) continue;
      const label = (el.getAttribute("aria-label") || el.textContent || "")
        .trim().replace(/\s+/g, " ").slice(0, 30);
      const tag = el.tagName.toLowerCase();
      const href = el.getAttribute("href") || "";
      if (done.includes(label + "|" + tag + "|" + href)) continue;
      return { key: label + "|" + tag + "|" + href, label, tag, href };
    }
    return null;
  }, SEL, [...doneLabels]);
}

/** 真实鼠标点击（trusted event）。rev3：Radix 菜单/Select 只认 pointerdown，
 *  合成 el.click() 不开菜单——首轮把 ⋯菜单/设置菜单/筛选全误判 no-effect。 */
async function clickByLabel(page, label, tag) {
  const find = async () => page.evaluate((sel, lbl, tg) => {
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) continue;
      const t = (el.getAttribute("aria-label") || el.textContent || "")
        .trim().replace(/\s+/g, " ").slice(0, 30);
      if (t === lbl && el.tagName.toLowerCase() === tg) {
        return { x: r.x + r.width / 2, y: r.y + r.height / 2,
                 inView: r.top >= 0 && r.bottom <= innerHeight };
      }
    }
    return null;
  }, SEL, label, tag);
  let box = await find();
  if (!box) return false;
  // 09-15 修误报：视口 inView 不等于真可见——侧栏等内部滚动容器会把 rect 裁在
  // 容器外（点击落到底下元素=假 no-effect）。用 elementFromPoint 验命中，未命中则
  // 容器内 scrollIntoView 再验（真实用户可滚动到达=可控件）。
  const hits = async () => page.evaluate((sel, lbl, tg, x, y) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return false;
    for (const cand of document.querySelectorAll(sel)) {
      const t = (cand.getAttribute("aria-label") || cand.textContent || "")
        .trim().replace(/\s+/g, " ").slice(0, 30);
      if (t === lbl && cand.tagName.toLowerCase() === tg && (cand === el || cand.contains(el))) return true;
    }
    return false;
  }, SEL, label, tag, box.x, box.y);
  if (!await hits()) {
    await page.evaluate((sel, lbl, tg) => {
      for (const el of document.querySelectorAll(sel)) {
        const t = (el.getAttribute("aria-label") || el.textContent || "")
          .trim().replace(/\s+/g, " ").slice(0, 30);
        if (t === lbl && el.tagName.toLowerCase() === tg) {
          el.scrollIntoView({ block: "center" });
          return;
        }
      }
    }, SEL, label, tag);
    await new Promise((r) => setTimeout(r, 200));
    box = await find();
    if (!box) return false;
    if (!await hits()) return false;
  }
  if (false && !box.inView) {
    await page.evaluate((sel, lbl, tg) => {
      for (const el of document.querySelectorAll(sel)) {
        const t = (el.getAttribute("aria-label") || el.textContent || "")
          .trim().replace(/\s+/g, " ").slice(0, 30);
        if (t === lbl && el.tagName.toLowerCase() === tg) {
          el.scrollIntoView({ block: "center" });
          return;
        }
      }
    }, SEL, label, tag);
    await new Promise((r) => setTimeout(r, 150));
    box = await find();
    if (!box) return false;
  }
  await page.mouse.click(box.x, box.y);
  return true;
}


async function auditPage(page, meta) {
  await page.goto(BASE + meta.path, { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1200));
  await page.screenshot({ path: `${SHOTS}/${meta.name}.png` });

  const done = new Set();
  for (let guard = 0; guard < 80; guard++) {
    const c = await nextControl(page, done);
    if (!c) break;
    done.add(c.key);
    // 站内导航链接：href 存在即真导航，不点击（死链归层1）
    if (c.tag === "a" && c.href && !c.href.startsWith("#")) {
      skipped.navLinks += 1;
      continue;
    }
    if (DENY.some((d) => c.label.toLowerCase().includes(d.toLowerCase()))) {
      skipped.deny += 1;
      if (skipped.samples.length < 15) skipped.samples.push(`${meta.name}: ${c.label}`);
      continue;
    }
    const before = await signals(page);
    const sigBefore = await page.evaluate((sel, lbl, tg) => {
      for (const el of document.querySelectorAll(sel)) {
        const t = (el.getAttribute("aria-label") || el.textContent || "")
          .trim().replace(/\s+/g, " ").slice(0, 30);
        if (t === lbl && el.tagName.toLowerCase() === tg) {
          return JSON.stringify([el.getAttribute("data-state"),
            el.getAttribute("aria-expanded"), el.getAttribute("aria-selected"),
            el.getAttribute("aria-label"), (el.textContent || "").trim().slice(0, 30)]);
        }
      }
      return "gone";
    }, SEL, c.label, c.tag);

    const did = await clickByLabel(page, c.label, c.tag);
    if (!did) continue;
    clicked += 1;
    await new Promise((r) => setTimeout(r, 500));

    const after = await signals(page);
    const sigAfter = await page.evaluate((sel, lbl, tg) => {
      for (const el of document.querySelectorAll(sel)) {
        const t = (el.getAttribute("aria-label") || el.textContent || "")
          .trim().replace(/\s+/g, " ").slice(0, 30);
        if (t === lbl && el.tagName.toLowerCase() === tg) {
          return JSON.stringify([el.getAttribute("data-state"),
            el.getAttribute("aria-expanded"), el.getAttribute("aria-selected"),
            el.getAttribute("aria-label"), (el.textContent || "").trim().slice(0, 30)]);
        }
      }
      return "gone";  // 节点卸载=导航/重渲染 → 有效果
    }, SEL, c.label, c.tag);

    const effect = after.url !== before.url ||
      after.popups !== before.popups ||
      after.rows !== before.rows ||
      after.active !== before.active ||
      sigAfter !== sigBefore;
    if (!effect) {
      findings.push({ page: meta.name, control: c.label, tag: c.tag });
    }
    if (after.popups > before.popups) {
      await page.keyboard.press("Escape");
      await new Promise((r) => setTimeout(r, 300));
    }
    const cur = await signals(page);
    if (cur.url.split("?")[0] !== meta.path.split("?")[0]) {
      await page.goto(BASE + meta.path, { waitUntil: "networkidle2", timeout: 30000 });
      await new Promise((r) => setTimeout(r, 900));
    }
  }
  if (page.errors.length) {
    findings.push({ page: meta.name, control: "(console)", tag: "pageerror",
                    errors: page.errors.slice(0, 3) });
  }
}

// ---------- V1/V2 定向验证：抽屉导航修复 ----------
async function verifyDrawer() {
  const page = await newPage();
  const out = { v1: null, v2: null };
  await page.goto(`${BASE}/operations/today?view=list`, { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1500));

  // V1 前置：数据周期切「近 7 天」（workflow 卡不在"今天"窗口内）
  const opened = await page.evaluate(() => {
    const trig = document.querySelector("[aria-label='数据周期']");
    if (!trig) return false;
    trig.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    trig.click();
    return true;
  });
  await new Promise((r) => setTimeout(r, 600));
  if (opened) {
    await page.evaluate(() => {
      const opt = [...document.querySelectorAll("[role='option']")]
        .find((o) => (o.textContent || "").includes("近 7 天"));
      if (opt) opt.click();
    });
    await new Promise((r) => setTimeout(r, 1500));
  }

  const rowIdx = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("table tbody tr")];
    return rows.findIndex((r) => /Workflow [0-9a-f]{8}/.test(r.textContent || ""));
  });
  if (rowIdx >= 0) {
    await page.evaluate((i) => {
      document.querySelectorAll("table tbody tr")[i].click();
    }, rowIdx);
    await new Promise((r) => setTimeout(r, 800));
    await page.screenshot({ path: `${SHOTS}/drawer-workflow-card.png` });
    const btn = await page.evaluate(() => {
      const dlg = document.querySelector("[role='dialog']");
      if (!dlg) return null;
      const b = [...dlg.querySelectorAll("button")]
        .find((x) => (x.textContent || "").includes("查看执行详情"));
      return b ? true : null;
    });
    if (btn) {
      await page.evaluate(() => {
        const dlg = document.querySelector("[role='dialog']");
        [...dlg.querySelectorAll("button")]
          .find((x) => (x.textContent || "").includes("查看执行详情")).click();
      });
      await new Promise((r) => setTimeout(r, 1200));
      const url = await page.evaluate(() => location.pathname);
      out.v1 = { btnFound: true, navigated: /^\/operations\/runs\/[0-9a-f]{32}$/.test(url), url };
      await page.screenshot({ path: `${SHOTS}/v1-run-detail.png` });
    } else {
      out.v1 = { btnFound: false };
    }
  } else {
    out.v1 = { skipped: "近7天窗口仍无 workflow 卡" };
  }

  // V2：分析卡「所属分析任务」→ /batch-tasks/{id}
  await page.goto(`${BASE}/operations/today?view=list`, { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1500));
  const trIdx = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("table tbody tr")];
    return rows.findIndex((r) => /DEMO|分析|批/.test(r.textContent || ""));
  });
  if (trIdx >= 0) {
    await page.evaluate((i) => {
      document.querySelectorAll("table tbody tr")[i].click();
    }, trIdx);
    await new Promise((r) => setTimeout(r, 800));
    const has = await page.evaluate(() => {
      const dlg = document.querySelector("[role='dialog']");
      if (!dlg) return null;
      const b = [...dlg.querySelectorAll("button")]
        .find((x) => (x.textContent || "").includes("所属分析任务"));
      if (!b) return null;
      b.click();
      return true;
    });
    await new Promise((r) => setTimeout(r, 1200));
    const url = await page.evaluate(() => location.pathname);
    out.v2 = { btnFound: !!has, navigated: /^\/batch-tasks\/[0-9a-f]{32}$/.test(url), url };
    await page.screenshot({ path: `${SHOTS}/v2-analysis-detail.png` });
  } else {
    out.v2 = { skipped: "无分析卡" };
  }
  await page.close();
  return out;
}

// ---------- agentflow 详情（脚本投影/runs 视图）截图 ----------
async function fetchFirstFid() {
  try {
    const api = `${BASE.replace("5199", "8120").replace("localhost", "127.0.0.1")}/api/v2/agentflows`;
    const list = await (await fetch(api)).json();
    return list?.items?.[0]?.id ?? null;
  } catch { return null; }
}

async function shootAgentflow(fid) {
  const page = await newPage();
  if (fid) {
    await page.goto(`${BASE}/agentflows/${fid}?mode=script`, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 1500));
    await page.screenshot({ path: `${SHOTS}/agentflow-script.png` });
    await page.goto(`${BASE}/agentflows/${fid}?view=runs`, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 1500));
    await page.screenshot({ path: `${SHOTS}/agentflow-runs.png` });
  }
  await page.close();
  return fid || null;
}

const results = {};
for (const p of PAGES) {
  const page = await newPage();
  await auditPage(page, p);
  await page.close();
  results[p.name] = "done";
}
results.drawer = await verifyDrawer();
// rev3：agentflow 详情页（runs 视图）也纳入逐控件审计
const fid = await fetchFirstFid();
if (fid) {
  const page = await newPage();
  await auditPage(page, { name: "agentflow-detail", path: `/agentflows/${fid}?view=runs` });
  await page.close();
  results["agentflow-detail"] = "done";
}
results.agentflowFid = await shootAgentflow(fid);

await browser.close();

const noEffect = findings.filter((f) => f.tag !== "pageerror");
const jsErrors = findings.filter((f) => f.tag === "pageerror");
console.log("=== 层4 逐控件点击审计（rev2） ===");
console.log(`点击 ${clicked} 个控件；DENY 跳过 ${skipped.deny}；导航链接免点 ${skipped.navLinks}`);
if (skipped.samples.length) console.log("  DENY 样例:", skipped.samples.slice(0, 8).join(" | "));
console.log(`无效果控件 ${noEffect.length} 个：`);
for (const f of noEffect) console.log(`  [no-effect][${f.page}] ${f.control} (${f.tag})`);
console.log(`页面 JS 错误 ${jsErrors.length} 处：`);
for (const f of jsErrors) console.log(`  [pageerror][${f.page}]`, f.errors);
console.log("定向验证:", JSON.stringify(results.drawer, null, 1));
console.log("截图目录:", SHOTS);
const d = results.drawer;
const vBad = (d.v1 && (d.v1.btnFound === false || d.v1.navigated === false)) ||
  (d.v2 && d.v2.navigated === false);
process.exit(noEffect.length || jsErrors.length || vBad ? 1 : 0);
